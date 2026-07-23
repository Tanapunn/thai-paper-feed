"""
Phase B — STAGE 3.2 (ส่วน automatic metrics): วัดผลเชิงโครงสร้างของ 5 ผู้เข้าแข่ง

วัดเฉพาะสิ่งที่ "เช็คด้วยโค้ดได้ชัดเจน" — โครงสร้าง JSON / tags / คงศัพท์อังกฤษ / ความยาว
ส่วนคุณภาพ (โทนเพื่อน, ถูกต้อง, จุดว้าว) เป็นงานของ eval_llm_judge.py แยกไฟล์

หลักการรายงาน = 2-3 แกน อย่ายุบ JSON valid เป็นเลขเดียว (ดู memory eval-report-two-axis):
  - syntax   = valid / finished       (เขียน JSON เป็นไหม เมื่อเขียนจบ)
  - fits     = finished / total       (จบใน budget ไหม / verbose แค่ไหน)
  - usable   = (valid & fields) / total (เลขฝั่ง serve จริง)

Input:
  - phase-b/data/test.jsonl            (id, user=Title+Abstract, assistant=Gemini ref)
  - phase-b/data/eval/gen_*.jsonl      (โหลดจาก Drive: id, system_name, raw, sec)
Output:
  - phase-b/eval_results/auto_metrics.json  + ตารางบน stdout

รัน: python phase-b/scripts/eval_auto_metrics.py
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from statistics import median

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "phase-b" / "data"
EVAL_DIR = DATA / "eval"
TEST_FILE = DATA / "test.jsonl"
OUT_DIR = ROOT / "phase-b" / "eval_results"

REQUIRED_FIELDS = ("title_th", "summary_th", "wow_point", "tags")

# ศัพท์เทคนิคที่คนสายนี้เรียกทับศัพท์ — ควรคงเป็นอังกฤษ (ใช้เป็น proxy วัด "ไม่แปลมั่ว")
# ไม่ใช่ allowlist ตายตัว แค่ตัวชี้วัดว่า output คงศัพท์อังกฤษไว้แค่ไหน
TECH_TERMS = [
    "LLM", "RAG", "agent", "transformer", "attention", "fine-tune", "finetune",
    "prompt", "token", "embedding", "diffusion", "GAN", "RL", "LoRA", "GPU",
    "benchmark", "dataset", "zero-shot", "few-shot", "inference", "encoder", "decoder",
]

LATIN_TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9\-\.]+")


def load_jsonl(path: Path) -> list[dict]:
    rows = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def try_parse(raw: str):
    """parse ตรงๆ ก่อน ถ้าไม่ได้ลองดึงบล็อค {...} แรก (เผื่อโมเดลห่อด้วยข้อความอื่น)"""
    try:
        return json.loads(raw)
    except Exception:
        pass
    m = re.search(r"\{.*\}", raw, re.S)
    if m:
        try:
            return json.loads(m.group(0))
        except Exception:
            pass
    return None


def fields_complete(obj) -> bool:
    if not isinstance(obj, dict):
        return False
    for k in REQUIRED_FIELDS:
        v = obj.get(k)
        if v is None:
            return False
        if isinstance(v, str) and not v.strip():
            return False
    tags = obj.get("tags")
    if not isinstance(tags, list) or not (1 <= len(tags) <= 6):
        return False
    if any(not isinstance(t, str) or not t.strip() for t in tags):
        return False
    return True


def card_text(obj) -> str:
    """รวมข้อความการ์ด (ไทยล้วน) สำหรับวัดความยาว/นับศัพท์"""
    if not isinstance(obj, dict):
        return ""
    parts = [str(obj.get(k, "")) for k in ("title_th", "summary_th", "wow_point")]
    tags = obj.get("tags")
    if isinstance(tags, list):
        parts.append(" ".join(str(t) for t in tags))
    return " ".join(parts)


def english_token_count(text: str) -> int:
    """จำนวน token อักษรละติน (proxy: คงศัพท์อังกฤษไว้เยอะ = แปลน้อย)"""
    return len({t for t in LATIN_TOKEN_RE.findall(text) if len(t) >= 2})


def analyse(raw: str) -> dict:
    finished = raw.rstrip().endswith("}")
    obj = try_parse(raw)
    valid = obj is not None
    complete = fields_complete(obj)
    # en_tok / card_len วัดจากเนื้อการ์ด (values) เฉพาะใบ valid เท่านั้น
    # ใบ JSON พังห้ามนับ raw เพราะชื่อ field (title_th ฯลฯ) เป็นละติน -> en_tok เฟ้อฟรี
    # raw_len เก็บ "ทุกใบ" กัน survivorship bias (ใบ verbose ที่โดนตัดต้องไม่หลุดสถิติ)
    return {
        "finished": finished,
        "valid": valid,
        "fields_complete": complete,
        "raw_len": len(raw),
        "card_len": len(card_text(obj)) if valid else None,
        "english_tokens": english_token_count(card_text(obj)) if valid else None,
    }


def aggregate(name: str, items: list[dict]) -> dict:
    n = len(items)
    valid = sum(i["valid"] for i in items)
    complete = sum(i["fields_complete"] for i in items)
    # truncated = ถูกตัดกลาง (parse ไม่ได้ + ไม่ปิด }) — โมเดล verbose จนชนเพดาน token
    truncated = sum(1 for i in items if not i["valid"] and not i["finished"])
    completed = n - truncated          # เขียนจบ (ไม่โดนตัด) = valid + malformed
    card_lens = [i["card_len"] for i in items if i["card_len"] is not None]   # valid เท่านั้น
    raw_lens = [i["raw_len"] for i in items]                                   # ทุกใบ (รวมโดนตัด)
    eng = [i["english_tokens"] for i in items if i["english_tokens"] is not None]
    return {
        "system": name,
        "n": n,
        # --- 2-3 แกน (ห้ามยุบเป็นเลขเดียว) ---
        # syntax = ในบรรดาที่เขียนจบ กี่ % JSON valid (แยก verbosity ออก)
        "syntax_of_completed": round(valid / completed, 3) if completed else None,
        # fits = กี่ % ที่เขียนจบใน budget (ไม่โดนตัด) — วัด verbosity
        "fits_budget": round(completed / n, 3) if n else None,
        # usable = กี่ % ใช้ได้จริง (valid + field ครบ) — เลขฝั่ง serve
        "usable": round(complete / n, 3) if n else None,
        # --- raw counts ---
        "valid": valid,
        "truncated": truncated,
        "completed": completed,
        "fields_complete": complete,
        # --- length / ศัพท์ ---
        "card_len_median": round(median(card_lens)) if card_lens else None,   # การ์ด valid
        "raw_len_median": round(median(raw_lens)) if raw_lens else None,      # ทุกใบ
        "raw_len_max": max(raw_lens) if raw_lens else None,                   # โชว์หาง verbose ที่โดนตัด
        "english_tokens_median": round(median(eng)) if eng else None,
    }


def main() -> None:
    test_rows = load_jsonl(TEST_FILE)
    print(f"test set: {len(test_rows)} ใบ")

    # ผู้เข้าแข่งที่ 5 = Gemini (teacher) — อยู่ในฟิลด์ assistant ของ test.jsonl
    systems: dict[str, dict[str, str]] = {
        "gemini": {r["id"]: r["assistant"] for r in test_rows}
    }

    # อีก 4 ระบบจาก gen_*.jsonl (โหลดจาก Drive)
    if EVAL_DIR.is_dir():
        for path in sorted(EVAL_DIR.glob("gen_*.jsonl")):
            name = path.stem[len("gen_"):]
            systems[name] = {r["id"]: r["raw"] for r in load_jsonl(path)}

    results = []
    for name, id2raw in systems.items():
        items = [analyse(raw) for raw in id2raw.values()]
        results.append(aggregate(name, items))

    # เรียงให้ gemini ท้ายสุด (เป็นเพดานอ้างอิง)
    results.sort(key=lambda r: (r["system"] == "gemini", r["system"]))

    # ---- ตาราง ----
    print(f"\n{'system':<15}{'n':>4}{'syntax':>9}{'fits':>8}{'usable':>9}{'trunc':>7}{'card_med':>9}{'raw_med':>9}{'raw_max':>9}{'en_tok':>8}")
    print("-" * 87)
    for r in results:
        def pct(x):
            return f"{x*100:.0f}%" if x is not None else "-"
        print(
            f"{r['system']:<15}{r['n']:>4}{pct(r['syntax_of_completed']):>9}"
            f"{pct(r['fits_budget']):>8}{pct(r['usable']):>9}{r['truncated']:>7}"
            f"{str(r['card_len_median'] or '-'):>9}{str(r['raw_len_median'] or '-'):>9}"
            f"{str(r['raw_len_max'] or '-'):>9}{str(r['english_tokens_median'] or '-'):>8}"
        )

    print("\nแกน: syntax=valid/completed (เขียนจบแล้ว JSON ถูกกี่%) | fits=completed/total (ไม่โดนตัดกี่%)")
    print("usable=(valid&field ครบ)/total (ฝั่ง serve) | trunc=ถูกตัดกี่ใบ")
    print("card_med=ยาวการ์ด valid | raw_med/raw_max=ยาว raw ทุกใบ (โชว์หาง verbose) | en_tok=token อังกฤษใน card valid")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    out_path = OUT_DIR / "auto_metrics.json"
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"\nเขียนผล -> {out_path.relative_to(ROOT)}")

    if len(systems) < 5:
        print("\n⚠️  เจอแค่", len(systems), "ระบบ — ยังไม่ครบ 5")
        print("    โหลด gen_*.jsonl 4 ไฟล์จาก Drive ไปไว้ที่ phase-b/data/eval/ ก่อน")


if __name__ == "__main__":
    main()
