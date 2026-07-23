# Thai AI Paper Feed — Phase B Execution Plan (Fine-tune + Serve)

> ต่อจาก Phase A (เว็บที่ใช้ Gemini สรุป) — Phase B คือเทรนโมเดลเราเองมาแทน Gemini
> เป้าหมาย: distill Gemini → เทรน 2 เคสเทียบกัน → เลือกตัวที่ดีสุด → รันจริงในเว็บ
> โมเดล: ลอง 2 เคส (ดู Stage 2) แล้วเลือกผู้ชนะ
> Dataset: bulk-gen 400 ใบด้วยวิธี Phase A (train 340 / test 60)
> ปลายทาง: เทรนสำเร็จ + วัดผลได้ + สลับมาใช้ในเว็บจริง

---

## 0. ภาพรวมทั้ง Phase B

```
[1] เตรียม dataset   bulk-gen 400 ใบ (Gemini) → จัด ChatML → split train/test
        ↓
[2] เทรน 2 เคส       Unsloth Studio บน Colab
                     เคส A: 7-8B + QLoRA (4-bit)
                     เคส B: 3-4B + LoRA (16-bit)
        ↓
[3] วัดผล            เทียบ base vs เคส A vs เคส B vs Gemini (มีตัวเลข) → เลือกผู้ชนะ
        ↓
[4] บีบ + push       merge → GGUF Q4 → ขึ้น Hugging Face Hub (ตัวที่ชนะ)
        ↓
[5] เสียบเข้าเว็บ     สลับ pipeline จาก Gemini API → โมเดลเรา
```

> ⚠️ หมายเหตุขนาดโมเดล: เคส A (7-8B) ceiling ความสามารถสูงกว่าแต่กิน VRAM/เทรนช้ากว่า, เคส B (3-4B) เบากว่า/เทรนเร็วกว่าแต่ ceiling ต่ำกว่า — รันทั้งคู่เพราะ dataset เล็ก ต้นทุนไม่แพง แล้วให้ Stage 3 ตัดสินด้วยตัวเลขจริงว่าเคสไหนคุ้มกว่าสำหรับ **serve** ด้วย (ดูข้อ 4-5 เรื่องทางเลือก serve ประกอบการตัดสินใจ)

---

## STAGE 1 — เตรียม Dataset (~1-2 วัน)

### 1.1 Bulk-generate 400 คู่ (วิธี Phase A) — เสร็จแล้ว

- ดึง abstract จาก arXiv (cs.CL + cs.AI) 400 ใบ — ผสมเปเปอร์ใหม่ + เก่า top-cited ให้หลากหลาย
- ส่งเข้า Gemini (`gemini-3.1-flash-lite` — โควต้าจริงของเรา 500/วัน, 15 RPM) ให้คืน JSON การ์ดไทย (title_th, summary_th, wow_point, tags) แบบเดียวกับ Phase A
- **หน่วง ~4-5 วิ/ใบ + retry backoff** กัน 429
- **ทดสอบ prompt กับ 5-10 ใบให้นิ่งก่อน** ค่อยยิง batch เต็ม (โควต้ามี buffer แค่ ~100 อย่าเผา)
- ถ้าอยากได้เพิ่มเกิน 400 ในอนาคต → เสริม Gemma 4 (1,500/วัน อีกถังแยก)

### 1.2 คุมคุณภาพ (สำคัญกว่าจำนวน)

- validate อัตโนมัติทุกแถว: ครบทุก field ไหม, tags อยู่ใน list ที่กำหนดไหม, summary ยาวพอดีไหม
- แถว fail → re-gen 1 รอบ → ยัง fail ทิ้ง
- **สุ่มตรวจเอง ~15%** ดูว่าโทน "เพื่อนเล่าให้ฟัง" จริงไหม + ไม่มโน — teacher มั่ว = ลูกศิษย์มั่วตาม

### 1.3 จัดรูปแบบ ChatML + split

โครง 1 ตัวอย่าง = 3 ช่อง:
```json
{
  "system": "คุณเป็นผู้ช่วยสรุปเปเปอร์ AI เป็นภาษาไทยแบบเพื่อนเล่าให้ฟัง กระชับ เน้นจุดว้าว คงศัพท์เทคนิคอังกฤษ",
  "user": "<title + abstract อังกฤษ>",
  "assistant": "<การ์ดไทย JSON ที่ Gemini สร้าง>"
}
```
- เก็บเป็น system/user/assistant กลางแบบนี้ไว้ก่อน — ตอนเทรนแต่ละเคส (Stage 2) ให้ Unsloth Studio/`apply_chat_template()` แปลงเป็น chat template ของโมเดลนั้นๆ เอง (เคส A = Qwen2.5 ChatML `<|im_start|>`, เคส B = Gemma chat format) เพราะตอนนี้ยังไม่ fix โมเดลตัวเดียว
- **shuffle ก่อน split** → train 85% (340) / test 15% (60)
- **กันไฟล์ test แยก ห้ามแตะจนวัดผล**
- เซฟเป็น `.jsonl` (train.jsonl / test.jsonl) เก็บใน Google Drive (กัน Colab รีเซ็ต)

**Deliverable Stage 1:** train.jsonl + test.jsonl พร้อมเทรน

---

## STAGE 2 — เทรน 2 เคสด้วย Unsloth Studio บน Colab (~1-2 วัน รวมลองผิดลองถูก)

> เปลี่ยนจากเขียน training script เอง → ใช้ **Unsloth Studio** (no-code web UI ของ Unsloth) ผ่าน Colab notebook ทางการ: `Unsloth_Studio_Colab.ipynb` (จาก repo `unslothai/unsloth`) — เปิด Colab, เลือก **T4 GPU** (ฟรี), รัน "Run all" แล้วเปิด UI ที่ pop up ขึ้นมา รองรับทั้ง LoRA/QLoRA, มี live loss dashboard, และ export เป็น GGUF/safetensors ได้ในตัว

### 2.1 เคส A — 7-8B + QLoRA (ceiling สูงสุด)

- โมเดล: `scb10x/typhoon2-qwen2.5-7b-instruct` (แม่นกว่า OpenThaiGPT 1.5-7B ทั้งอังกฤษ/ไทยจาก benchmark — ฐานเดียวกันคือ Qwen2.5 แต่ tune ดีกว่า)
- โหลดแบบ 4-bit (QLoRA) ใน Studio, LoRA adapter: `r=16, alpha=16, target ทุก linear layers`
- **7B + QLoRA บน T4 16GB = ได้แต่ต้องประหยัด**: `batch=1`, `grad accumulation=8`, `max_seq_length=4096` (พอสำหรับ abstract+การ์ด) — ถ้า OOM ให้ลด max_seq_length เหลือ 3072 หรือ 2048

### 2.2 เคส B — 3-4B + LoRA เต็ม 16-bit (เบา/เร็ว/ไม่มี quantization error)

- โมเดล: `google/gemma-4-E4B-it` (Gemma 4, ~4B effective params, multilingual 140+ ภาษารวมไทย) — **สุ่มตรวจ 5-10 ใบก่อนรันเต็ม** ว่าคุณภาพภาษาไทยของ base model โอเคพอจะ fine-tune ต่อ (แบบเดียวกับที่ Stage 1.1 ทำกับ prompt Gemini)
- โหลดแบบ 16-bit เต็ม (ไม่ต้อง quantize เพราะ 3-4B พอดี VRAM T4) → LoRA adapter เดิม `r=16, alpha=16`
- ข้อดี: ไม่มี quantization noise ตอนเทรน, VRAM เหลือเยอะกว่า → ใช้ `max_seq_length` ยาวขึ้น/batch ใหญ่ขึ้นได้ถ้าต้องการ

### 2.3 เทรนทั้งสองเคส

- `epochs=2-3`, `lr=2e-4`, warmup นิดหน่อย (ปรับตามที่ Studio แนะนำได้)
- **checkpoint บ่อยๆ ขึ้น Drive** (กัน Colab หลุดกลางคัน — โดยเฉพาะเคส A ที่เทรนนานกว่า)
- ดู training loss ควรค่อยๆ ลง — ถ้านิ่งเร็ว/ไม่ลง = lr หรือ data มีปัญหา
- เทรนเสร็จแต่ละเคส → export/merge LoRA เข้า base เก็บไว้ (ยังอยู่บน Colab/Drive หรือ export ตรงจาก Studio)

### 2.4 ถ้า OOM (แผนสำรองเฉพาะเคส A)

1. ลด max_seq_length
2. ลด batch (แต่ batch=1 อยู่แล้ว → ใช้ grad accumulation แทน)
3. ถ้ายังไม่ไหวจริงๆ → ตัดเคส A ออก เหลือแค่เคส B เป็นหลัก (ไม่ต้องฝืน 7B จนเสียเวลาหลายวัน — เคส B ยังให้ผลเปรียบเทียบกับ base/Gemini ได้ครบ)

**Deliverable Stage 2:** โมเดล fine-tuned (merged) 2 ตัว บน Drive/HF — เคส A และเคส B

---

## STAGE 3 — วัดผล (~1 วัน) ← หัวใจ portfolio

### 3.1 เตรียม 4 ผู้เข้าแข่ง

รัน test set (60 ใบ) ผ่าน:
1. **base เคส A** (7-8B, ยังไม่เทรน) — zero-shot
2. **fine-tuned เคส A** (7-8B + QLoRA)
3. **fine-tuned เคส B** (3-4B + LoRA) — เทียบกับ base เคส B แบบ spot-check ได้ถ้ามีเวลา แต่ตัวหลักที่ต้องมีคือ fine-tuned
4. **Gemini** (teacher — เพดานอ้างอิง, `gemini-3.1-flash-lite`)

### 3.2 วัด 2 แบบ

**Automatic (เขียนโค้ดเช็ค):**
- structure valid rate (%) — JSON ครบ field ไหม
- tags อยู่ใน list (%)
- ศัพท์เทคนิคไม่ถูกแปลมั่ว (เช็คด้วย keyword list เช่น LLM/RAG/agent ต้องคงอังกฤษ)

**LLM-as-judge:**
- **judge = Claude (Sonnet 5)** — คนละเจ้ากับ teacher (Gemini) ตั้งใจเลือกเพราะงานวิจัยล่าสุดชี้ว่า Claude judge มักมีอคติแบบ "ตัดคะแนนตัวเองหนักกว่า" (under-prefer ผลลัพธ์ตระกูล Claude เอง) ไม่ใช่เอียงเข้าข้างตัวเอง — ปลอดภัยกว่าในการเป็น judge ให้ teacher จากค่าย Gemini
- ให้คะแนน 1-5: ความถูกต้อง / ความเป็นธรรมชาติภาษาไทย / คุณภาพจุดว้าว
- เทียบ 4 ผู้เข้าแข่งแบบ blind

### 3.3 สรุปเป็นตาราง + เลือกผู้ชนะ

ทำตารางเทียบ → ลง README + (ถ้ามีเวลา) blog post
คาดหวัง: ทั้งสองเคส fine-tuned ควร **ดีกว่า base ชัดเจน** และ **เข้าใกล้ Gemini** (ไม่ต้องชนะ)

**เกณฑ์เลือกผู้ชนะไป Stage 4-5:** ไม่ใช่แค่คะแนนสูงสุด — ชั่งน้ำหนักกับต้นทุน serve ด้วย (เคส A แม่นกว่าแต่ serve หนักกว่า/ช้ากว่าตาม STAGE 5.1) ถ้าคะแนนต่างกันไม่มาก เลือกเคส B (เบากว่า) คุ้มกว่าสำหรับรันจริง แต่ถ้าเคส A แม่นกว่าชัดเจนและงบ serve พอไหว ให้เลือกเคส A — ตัดสินด้วยตัวเลขจาก 3.2 จริง ไม่เดา

**Deliverable Stage 3:** ตารางผลเทียบ 4 ระบบ + สรุปว่าเลือกเคสไหนไปต่อ (พร้อมเหตุผล)

---

## STAGE 4 — บีบเล็ก + ขึ้น Hub (~ครึ่งวัน)

### 4.1 Quantize เป็น GGUF

- ทำเฉพาะ **โมเดลที่ชนะจาก Stage 3** (เคส A หรือเคส B อย่างใดอย่างหนึ่ง) — export ตรงจาก Unsloth Studio หรือใช้ `save_pretrained_gguf()` แปลง merged model → **GGUF Q4_K_M**
- Q4 = เล็กพอรัน CPU, คุณภาพดรอปนิดเดียว — ถ้าดรอปแรงลอง Q5_K_M
- **eval ซ้ำหลัง quantize** (โครงเดิมจาก Stage 3 กับ test set) — เทียบว่าดรอปแค่ไหน

### 4.2 Push ขึ้น Hugging Face Hub

- สร้าง repo บน HF → push ทั้งตัว merged (16-bit) + GGUF
- เขียน model card: distill จากอะไร, dataset ขนาดไหน, ผล eval — **นี่คือหน้าโชว์ portfolio**

**Deliverable Stage 4:** โมเดล GGUF บน HF Hub + model card

---

## STAGE 5 — เสียบเข้าเว็บจริง (~1-2 วัน)

> เป้าหมายคุณคือ "รันจริงในเว็บ" — นี่คือส่วนที่ทำให้ Phase B ต่างจาก "เทรนทิ้งไว้ใน notebook"

### 5.1 เลือกวิธี serve (7B มีเงื่อนไข)

| วิธี | ฟรีไหม | 7B ไหวไหม | ความยาก |
|---|---|---|---|
| **A. GitHub Actions + llama.cpp (CPU)** | ✅ ฟรี | ⚠️ ช้า (7B Q4 บน CPU ~5-8 นาที/ใบ) | กลาง |
| **B. Modal (serverless GPU, free credits)** | ✅ มี credit ฟรีรายเดือน | ✅ เร็ว | กลาง-สูง |
| **C. HF Inference Endpoint** | ⚠️ มีฟรีจำกัด | ✅ | ง่าย |

**คำแนะนำ:** เริ่ม **วิธี A** ก่อน (ฟรีแท้ + ได้เรียน MLOps) โดย **คุมจำนวนเปเปอร์/วัน ≤ 10 ใบ** เพื่อให้เวลารวมไม่เกิน GitHub Actions free (2,000 นาที/เดือน) — ถ้า 7B ช้าเกินทน ค่อยย้าย on-demand ไป **วิธี B (Modal)**

> ถ้าเลือกเคส B (3-4B) ไปต่อ → วิธี A สบายมาก ~2 นาที/ใบ นี่คืออีกเหตุผลที่โมเดลเล็กปลอดภัยกว่าถ้าเป้าหมายคือ "ฟรี + รันจริง" (เป็นปัจจัยหนึ่งที่ต้องชั่งใน Stage 3.3 ตอนเลือกผู้ชนะ)

### 5.2 pipeline ใหม่

```
GitHub Actions cron (เช้า) →
  ดึง arXiv ใหม่ →
  โหลด GGUF จาก HF (cache) →
  รัน llama.cpp สรุป (≤10 ใบ) →
  parse JSON →
  upsert Supabase
```
- เก็บ Gemini ไว้เป็น **fallback** (ถ้าโมเดลเราพัง/JSON เพี้ยน ให้ Gemini รับช่วง) — ระบบไม่ล่ม
- เพิ่ม flag ใน DB ว่าการ์ดนี้สรุปด้วย "โมเดลเรา" หรือ "Gemini" — โชว์ได้ว่าของเราครองสัดส่วนเท่าไหร่

### 5.3 ปิดจ๊อบ

- README อัปเดต: สถาปัตยกรรมใหม่ + ผล eval + เล่า journey Phase A→B
- commit + push

**Deliverable Stage 5:** เว็บที่รันด้วยโมเดลเราเอง อัตโนมัติ

---

## ไทม์ไลน์รวม (~5-7 วันถ้าโฟกัส)

| Stage | เวลา | ตัดจบได้ไหม |
|---|---|---|
| 1. Dataset | 1-2 วัน | — |
| 2. เทรน | 1-2 วัน | ✅ ได้โมเดล = milestone |
| 3. วัดผล | 1 วัน | ✅ ได้ตัวเลข = portfolio |
| 4. GGUF + Hub | ครึ่งวัน | ✅ โมเดลบน HF |
| 5. เข้าเว็บ | 1-2 วัน | ✅ รันจริง |

> ถ้าเวลาหมดหลัง Stage 3-4 เรื่องเล่า portfolio ก็ครบแล้ว (เทรน+วัดผล+โมเดลบน Hub) Stage 5 คือของแถมที่ทำให้ว้าวขึ้น

---

## ความเสี่ยงหลัก & แผนรับ

| ความเสี่ยง | แผนรับ |
|---|---|
| เคส A (7-8B) OOM ตอนเทรน | ลด max_seq_length → ไม่ไหว ตัดเคส A เหลือแค่เคส B (ยังเทียบกับ base/Gemini ได้ครบ) |
| เคส A ช้าเกินตอน serve CPU | คุม ≤10 ใบ/วัน หรือย้าย Modal หรือเลือกเคส B ไปต่อแทน |
| Colab หลุดกลางเทรน | checkpoint บ่อยๆ ขึ้น Drive (เคส A เสี่ยงกว่าเพราะเทรนนานกว่า) |
| โมเดลสรุปมั่ว/JSON พัง | Gemini fallback ในเว็บ + validate ก่อนเขียน DB |
| dataset teacher คุณภาพไม่นิ่ง | ตรวจ 15% + แก้ prompt ก่อนยิง batch ใหญ่ |
| gemma-4-E4B-it ภาษาไทยไม่นิ่งพอ (โมเดลใหม่ ยังไม่มี benchmark ไทยชัดเจน) | สุ่มตรวจ 5-10 ใบก่อนเทรนเต็ม (ดู Stage 2.2) → ถ้าไม่ผ่าน สลับเคส B เป็น Qwen2.5-3B-Instruct แทน |

---

## Checklist "Phase B เสร็จ"

- [x] มี train.jsonl (340) / test.jsonl (60) คุณภาพตรวจแล้ว
- [ ] เทรนจบทั้งเคส A (7-8B+QLoRA) และเคส B (3-4B+LoRA) ด้วย Unsloth Studio ไม่ OOM (หรืออย่างน้อยเคส B)
- [ ] มีตารางเทียบ base vs เคส A vs เคส B vs Gemini + สรุปว่าเลือกเคสไหนไปต่อพร้อมเหตุผล
- [ ] โมเดล GGUF (ตัวที่ชนะ) อยู่บน HF Hub + model card
- [ ] เว็บดึงเปเปอร์ + สรุปด้วยโมเดลเราได้จริง (Gemini เป็น fallback)
- [ ] README เล่า journey Phase A→B + ผล eval

---

## สิ่งที่ต้องมีก่อนเริ่ม

- [ ] Phase A เสร็จ (มีสคริปต์ดึง arXiv + เรียก LLM + เขียน Supabase อยู่แล้ว → reuse ได้เลย)
- [ ] บัญชี: Google (Colab+Drive), Hugging Face, GitHub, Supabase — มีแล้ว
- [ ] Gemini API key (จาก Phase A)
- [ ] อ่าน concept กลุ่ม 2-5 ที่ค้างไว้ (Fine-tuning/LoRA/QLoRA/Unsloth/quantize) — เข้าใจก่อนลงมือ
