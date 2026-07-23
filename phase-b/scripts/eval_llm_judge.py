"""
Phase B — STAGE 3.2 (ส่วน LLM-as-judge): ให้ Claude Sonnet 5 ให้คะแนนคุณภาพการ์ด

วัด "คุณภาพ" ที่ auto-metrics วัดไม่ได้ — ความถูกต้อง / โทนเพื่อนเล่า / จุดว้าว
เป็นแกนคนละอันกับ structure (ดู memory eval-report-two-axis)

ทำไมใช้ claude CLI (headless) ไม่ใช่ API key:
  - เรียก Claude ผ่าน auth เดียวกับ Claude Code (Pro/Max plan) — ไม่ต้องมี API key/จ่ายเพิ่ม
  - แต่ละ call = process ใหม่ context สะอาด -> judge แต่ละใบ blind + อิสระ โดยธรรมชาติ
  - รันจาก temp cwd -> ไม่โหลด CLAUDE.md ของโปรเจกต์ -> judge ไม่ถูก bias ด้วย context โปรเจกต์

กติกา blind (สำคัญ ตามแผน):
  - judge เห็นแค่ [paper (EN)] + [การ์ดไทย 1 ใบ] เท่านั้น
  - ไม่บอกว่าใครสรุป, ไม่ยื่นเฉลยของ Gemini ให้ (ไม่งั้น Gemini ชนะอัตโนมัติ)
  - Gemini ก็ถูก judge แบบเดียวกับผู้เข้าแข่งคนอื่น

resume ได้: ข้ามคู่ (id, system) ที่ให้คะแนนไปแล้ว (เหมือน generate)

รัน: python phase-b/scripts/eval_llm_judge.py          # ทั้งหมด 60x5 = 300 คู่
     python phase-b/scripts/eval_llm_judge.py --limit 5  # ลองน้อยๆ ก่อน
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "phase-b" / "data"
EVAL_DIR = DATA / "eval"
TEST_FILE = DATA / "test.jsonl"
OUT_DIR = ROOT / "phase-b" / "eval_results"
OUT_FILE = OUT_DIR / "judge_scores.jsonl"

MODEL = "sonnet"          # Claude Sonnet 5 (judge — คนละเจ้ากับ teacher Gemini)
JUDGE_TIMEOUT = 180       # วินาที/call
CLEAN_CWD = tempfile.mkdtemp(prefix="judge_")   # cwd ว่าง กัน CLAUDE.md leak เข้า judge

RUBRIC = """คุณคือกรรมการให้คะแนน "การ์ดสรุป paper AI ภาษาไทย" อย่างเข้มงวดและยุติธรรม
เป้าหมายของการ์ด: ให้คนไทยสายเทคอ่านเล่นแบบเพื่อนเล่าให้ฟัง สั้น กระชับ อยากอ่านต่อ

ให้คะแนน 3 แกน แกนละ 1-5 (5 = ดีเยี่ยม, 1 = แย่มาก):
1. accuracy — ตรงกับ paper จริงไหม ไม่มโน/บิดเบือน (เทียบกับ title+abstract ที่ให้)
2. tone — ภาษาไทยแบบ "เพื่อนเล่าให้ฟัง" ไหม (ไม่ใช่โทนวิชาการ/แปลแข็ง/ยืดยาว) + คงศัพท์เทคนิคอังกฤษไว้ (LLM, RAG, transformer ฯลฯ ไม่แปลมั่ว)
3. wow — จุดว้าว (wow_point/พาดหัว) ทำให้รู้สึก "อ่อออ ทำแบบนี้ได้ด้วย" อยากกดอ่านไหม

ตอบกลับเป็น JSON บรรทัดเดียวเท่านั้น ห้ามมีข้อความอื่น:
{"accuracy": <1-5>, "tone": <1-5>, "wow": <1-5>, "reason": "<เหตุผลสั้นๆ ไทย 1 ประโยค>"}"""


def load_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def split_paper(user_field: str) -> tuple[str, str]:
    """'Title: ...\\n\\nAbstract: ...' -> (title, abstract)"""
    m = re.match(r"Title:\s*(.*?)\n\nAbstract:\s*(.*)", user_field, re.S)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return user_field.strip(), ""


def card_for_judge(raw: str) -> str:
    """แปลง raw ของโมเดลเป็นข้อความการ์ดให้ judge อ่าน — parse ได้ก็จัดรูป, ไม่ได้ก็ส่ง raw ดิบ
    (judge วัด 'คุณภาพเนื้อหา' ไม่ใช่ JSON valid — structure วัดแยกใน auto-metrics แล้ว)"""
    obj = None
    try:
        obj = json.loads(raw)
    except Exception:
        m = re.search(r"\{.*\}", raw, re.S)
        if m:
            try:
                obj = json.loads(m.group(0))
            except Exception:
                obj = None
    if isinstance(obj, dict):
        tags = obj.get("tags")
        tags_s = ", ".join(map(str, tags)) if isinstance(tags, list) else str(tags)
        return (
            f"พาดหัว: {obj.get('title_th', '')}\n"
            f"สรุป: {obj.get('summary_th', '')}\n"
            f"จุดว้าว: {obj.get('wow_point', '')}\n"
            f"tags: {tags_s}"
        )
    return f"(JSON พัง — ข้อความดิบ)\n{raw}"


def build_prompt(title: str, abstract: str, raw: str) -> str:
    return (
        f"{RUBRIC}\n\n"
        f"===== PAPER (อังกฤษ, ใช้เช็ค accuracy) =====\n"
        f"Title: {title}\nAbstract: {abstract}\n\n"
        f"===== การ์ดสรุปไทยที่ต้องให้คะแนน =====\n"
        f"{card_for_judge(raw)}"
    )


def call_judge(prompt: str) -> tuple[dict, str] | None:
    """เรียก claude headless (prompt ผ่าน stdin) -> (คะแนน, model id จริง); None ถ้าพลาด

    model id จริงมาจาก envelope.modelUsage (เช่น 'claude-sonnet-5') ไม่ใช่ alias 'sonnet'
    — เก็บลงผลเพื่อให้ reproduce ได้ (alias อาจชี้รุ่นใหม่ในอนาคต)
    """
    try:
        proc = subprocess.run(
            ["claude", "-p", "--model", MODEL, "--output-format", "json"],
            input=prompt, cwd=CLEAN_CWD, capture_output=True,
            text=True, encoding="utf-8", errors="replace", timeout=JUDGE_TIMEOUT,
        )
    except Exception:
        return None
    out = proc.stdout or ""
    if proc.returncode != 0 or not out.strip():
        return None
    text, actual_model = out, MODEL
    try:
        envelope = json.loads(out)
        if isinstance(envelope, dict):
            text = envelope.get("result") or out
            used = envelope.get("modelUsage")
            if isinstance(used, dict) and used:
                actual_model = next(iter(used))       # เช่น 'claude-sonnet-5'
    except Exception:
        pass
    if not isinstance(text, str):
        return None
    m = re.search(r"\{.*\}", text, re.S)
    if not m:
        return None
    try:
        scores = json.loads(m.group(0))
    except Exception:
        return None
    if not all(k in scores for k in ("accuracy", "tone", "wow")):
        return None
    return scores, actual_model


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="จำกัดจำนวนคู่ (0 = ทั้งหมด) สำหรับลองก่อน")
    args = ap.parse_args()

    test_rows = load_jsonl(TEST_FILE)
    papers = {r["id"]: split_paper(r["user"]) for r in test_rows}

    # 5 ระบบ: gemini (จาก test.assistant) + 4 gen files
    systems: dict[str, dict[str, str]] = {"gemini": {r["id"]: r["assistant"] for r in test_rows}}
    for path in sorted(EVAL_DIR.glob("gen_*.jsonl")):
        systems[path.stem[len("gen_"):]] = {r["id"]: r["raw"] for r in load_jsonl(path)}

    print(f"ระบบที่ judge: {list(systems)}  ({len(test_rows)} ใบ/ระบบ)")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    done = set()
    if OUT_FILE.exists():
        for r in load_jsonl(OUT_FILE):
            done.add((r["id"], r["system"]))
        print(f"มีคะแนนเดิม {len(done)} คู่ -> ทำต่อ")

    # interleave ตาม paper id (ใบที่ 1 ทุกระบบ -> ใบที่ 2 ทุกระบบ ...)
    # เพื่อให้ partial run (หลุด/quota หมดกลางทาง) ยังได้ N ใบที่ครบทุกระบบ = เทียบ paired ได้เลย
    ids_in_order = [r["id"] for r in test_rows]
    todo = [
        (pid, sysname, systems[sysname][pid])
        for pid in ids_in_order
        for sysname in systems
        if pid in systems[sysname] and (pid, sysname) not in done
    ]
    if args.limit:
        todo = todo[: args.limit]
    print(f"เหลือ judge {len(todo)} คู่\n")

    fails = 0
    with open(OUT_FILE, "a", encoding="utf-8") as f:
        for i, (pid, sysname, raw) in enumerate(todo, 1):
            title, abstract = papers.get(pid, (raw, ""))
            res = call_judge(build_prompt(title, abstract, raw))
            if res is None:
                fails += 1
                print(f"  [{i}/{len(todo)}] {sysname} {pid} -> ❌ judge พลาด (ข้ามไว้ รันซ้ำทีหลัง)")
                continue
            scores, judge_model = res
            row = {
                "id": pid, "system": sysname,
                "accuracy": scores["accuracy"], "tone": scores["tone"], "wow": scores["wow"],
                "reason": scores.get("reason", ""),
                "judge_model": judge_model,             # เช่น 'claude-sonnet-5' (id จริง)
                "judged_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            }
            f.write(json.dumps(row, ensure_ascii=False) + "\n")
            f.flush()
            if i % 10 == 0 or i == len(todo):
                print(f"  [{i}/{len(todo)}] {sysname} {pid} -> acc {scores['accuracy']} tone {scores['tone']} wow {scores['wow']}")

    print(f"\nเสร็จ -> {OUT_FILE.relative_to(ROOT)}  (พลาด {fails} คู่ รันซ้ำเพื่อเก็บตก)")


if __name__ == "__main__":
    main()
