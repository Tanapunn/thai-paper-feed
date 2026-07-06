# Thai AI Paper Feed — Phase B Execution Plan (Fine-tune + Serve)

> ต่อจาก Phase A (เว็บที่ใช้ Gemini สรุป) — Phase B คือเทรนโมเดลเราเองมาแทน Gemini
> เป้าหมาย: distill Gemini → OpenThaiGPT 7B → รันจริงในเว็บ
> โมเดล: `openthaigpt/openthaigpt1.5-7b-instruct`
> Dataset: bulk-gen ~500 ใบด้วยวิธี Phase A
> ปลายทาง: เทรนสำเร็จ + วัดผลได้ + สลับมาใช้ในเว็บจริง

---

## 0. ภาพรวมทั้ง Phase B

```
[1] เตรียม dataset   bulk-gen 500 ใบ (Gemini) → จัด ChatML → split train/test
        ↓
[2] เทรน            Unsloth + QLoRA บน Colab (OpenThaiGPT 7B)
        ↓
[3] วัดผล            เทียบ base vs fine-tuned vs Gemini (มีตัวเลข)
        ↓
[4] บีบ + push       merge → GGUF Q4 → ขึ้น Hugging Face Hub
        ↓
[5] เสียบเข้าเว็บ     สลับ pipeline จาก Gemini API → โมเดลเรา
```

> ⚠️ หมายเหตุ 7B: ตัวนี้ใหญ่กว่า 3-4B → **เทรน**บน Colab T4 ฟรียัง "ได้แต่ตึง" และ **รัน**บน CPU ช้ากว่า ดูข้อ 4-5 เรื่องทางเลือก serve

---

## STAGE 1 — เตรียม Dataset (~1-2 วัน)

### 1.1 Bulk-generate 500 คู่ (วิธี Phase A)

- ดึง abstract จาก arXiv (cs.CL + cs.AI) ~500 ใบ — ผสมเปเปอร์ใหม่ + เก่า top-cited ให้หลากหลาย
- ส่งเข้า Gemini (`gemini-3.1-flash-lite` — โควต้าจริงของเรา 500/วัน, 15 RPM) ให้คืน JSON การ์ดไทย (title_th, summary_th, wow_point, tags) แบบเดียวกับ Phase A
- **หน่วง ~4-5 วิ/ใบ + retry backoff** กัน 429
- **ทดสอบ prompt กับ 5-10 ใบให้นิ่งก่อน** ค่อยยิง batch 500 (โควต้ามี buffer แค่ ~100 อย่าเผา)
- ถ้าอยากได้เกิน 500 ในวันเดียว → เสริม Gemma 4 (1,500/วัน อีกถังแยก)

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
- ใช้ `tokenizer.apply_chat_template()` ของ OpenThaiGPT (เป็น ChatML `<|im_start|>` — ตรงกับที่เรียนมา)
- **shuffle ก่อน split** → train 85% (~425) / test 15% (~75)
- **กันไฟล์ test แยก ห้ามแตะจนวัดผล**
- เซฟเป็น `.jsonl` (train.jsonl / test.jsonl) เก็บใน Google Drive (กัน Colab รีเซ็ต)

**Deliverable Stage 1:** train.jsonl + test.jsonl พร้อมเทรน

---

## STAGE 2 — เทรนบน Colab (~1-2 วัน รวมลองผิดลองถูก)

### 2.1 เตรียม Colab

- เปิด Colab → Runtime → เลือก **T4 GPU** (ฟรี)
- ติดตั้ง Unsloth (`pip install unsloth`)
- โครง notebook: ยืมของพี่เลี้ยง (typhoon + Unsloth) มาเป็นแม่แบบ เปลี่ยนแค่ (ก) ชื่อโมเดล เป็น OpenThaiGPT 7B (ข) dataset เป็นของเรา

### 2.2 โหลดโมเดลแบบ QLoRA

- โหลด `openthaigpt/openthaigpt1.5-7b-instruct` แบบ 4-bit (QLoRA) ผ่าน Unsloth
- ใส่ LoRA adapter: `r=16, alpha=16, target ทุก linear layers`
- **7B + QLoRA บน T4 16GB = ได้แต่ต้องประหยัด**: `batch=1`, `grad accumulation=8`, `max_seq_length=4096` (พอสำหรับ abstract+การ์ด) — ถ้า OOM ให้ลด max_seq_length เหลือ 3072 หรือ 2048

### 2.3 เทรน

- `epochs=2-3`, `lr=2e-4`, warmup นิดหน่อย
- **checkpoint ทุก ~50 steps ขึ้น Drive** (กัน Colab หลุดกลางคัน — 7B เทรนนานกว่า เสี่ยงหลุดกว่า)
- ดู training loss ควรค่อยๆ ลง — ถ้านิ่งเร็ว/ไม่ลง = lr หรือ data มีปัญหา
- เทรนเสร็จ merge LoRA เข้า base เก็บไว้ (ยังอยู่บน Colab/Drive)

### 2.4 ถ้า OOM (แผนสำรอง)

1. ลด max_seq_length
2. ลด batch (แต่ batch=1 อยู่แล้ว → ใช้ grad accumulation แทน)
3. ถ้ายังไม่ไหวจริงๆ → **fallback เป็น Typhoon 3B** (แผนนี้ทำงานกับ 3B ได้ทันทีโดยแทบไม่แก้อะไร) — อย่าฝืน 7B จนเสียเวลาหลายวัน

**Deliverable Stage 2:** โมเดล fine-tuned (merged) บน Drive

---

## STAGE 3 — วัดผล (~1 วัน) ← หัวใจ portfolio

### 3.1 เตรียม 3 ผู้เข้าแข่ง

รัน test set (~75 ใบ) ผ่าน:
1. **base** OpenThaiGPT 7B (ยังไม่เทรน) — zero-shot
2. **fine-tuned** ของเรา
3. **Gemini** (teacher — เพดานอ้างอิง)

### 3.2 วัด 2 แบบ

**Automatic (เขียนโค้ดเช็ค):**
- structure valid rate (%) — JSON ครบ field ไหม
- tags อยู่ใน list (%)
- ศัพท์เทคนิคไม่ถูกแปลมั่ว (เช็คด้วย keyword list เช่น LLM/RAG/agent ต้องคงอังกฤษ)

**LLM-as-judge:**
- ใช้ **judge คนละเจ้ากับ teacher** (teacher=Gemini → judge=Claude หรือกลับกัน) เลี่ยง bias
- ให้คะแนน 1-5: ความถูกต้อง / ความเป็นธรรมชาติภาษาไทย / คุณภาพจุดว้าว
- เทียบ 3 ผู้เข้าแข่งแบบ blind

### 3.3 สรุปเป็นตาราง

ทำตารางเทียบ → ลง README + (ถ้ามีเวลา) blog post
คาดหวัง: fine-tuned ควร **ดีกว่า base ชัดเจน** และ **เข้าใกล้ Gemini** (ไม่ต้องชนะ)

**Deliverable Stage 3:** ตารางผลเทียบ 3 ระบบ

---

## STAGE 4 — บีบเล็ก + ขึ้น Hub (~ครึ่งวัน)

### 4.1 Quantize เป็น GGUF

- ใช้ Unsloth `save_pretrained_gguf()` แปลง merged model → **GGUF Q4_K_M** (บรรทัดเดียว)
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

> ถ้าใช้ Typhoon 3B (fallback) → วิธี A สบายมาก ~2 นาที/ใบ นี่คืออีกเหตุผลที่ 3B ปลอดภัยกว่าถ้าเป้าหมายคือ "ฟรี + รันจริง"

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
| 7B OOM ตอนเทรน | ลด max_seq_length → ไม่ไหว fallback Typhoon 3B (แผนเดิมใช้ได้ทันที) |
| 7B ช้าเกินตอน serve CPU | คุม ≤10 ใบ/วัน หรือย้าย Modal หรือใช้ 3B |
| Colab หลุดกลางเทรน | checkpoint ทุก 50 steps ขึ้น Drive |
| โมเดลสรุปมั่ว/JSON พัง | Gemini fallback ในเว็บ + validate ก่อนเขียน DB |
| dataset teacher คุณภาพไม่นิ่ง | ตรวจ 15% + แก้ prompt ก่อนยิง batch ใหญ่ |

---

## Checklist "Phase B เสร็จ"

- [ ] มี train.jsonl / test.jsonl (~500 คู่) คุณภาพตรวจแล้ว
- [ ] เทรน OpenThaiGPT 7B จบ ไม่ OOM (หรือ fallback 3B)
- [ ] มีตารางเทียบ base vs fine-tuned vs Gemini
- [ ] โมเดล GGUF อยู่บน HF Hub + model card
- [ ] เว็บดึงเปเปอร์ + สรุปด้วยโมเดลเราได้จริง (Gemini เป็น fallback)
- [ ] README เล่า journey Phase A→B + ผล eval

---

## สิ่งที่ต้องมีก่อนเริ่ม

- [ ] Phase A เสร็จ (มีสคริปต์ดึง arXiv + เรียก LLM + เขียน Supabase อยู่แล้ว → reuse ได้เลย)
- [ ] บัญชี: Google (Colab+Drive), Hugging Face, GitHub, Supabase — มีแล้ว
- [ ] Gemini API key (จาก Phase A)
- [ ] อ่าน concept กลุ่ม 2-5 ที่ค้างไว้ (Fine-tuning/LoRA/QLoRA/Unsloth/quantize) — เข้าใจก่อนลงมือ
