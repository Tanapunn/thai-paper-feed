# 🧠 Thai AI Paper Feed

เว็บ **"ฉบับรายสัปดาห์"** สรุปเปเปอร์ AI เด็ดๆ ของแต่ละสัปดาห์เป็น**ภาษาไทย** สไตล์ "เพื่อนแปะสรุปมาให้อ่านเล่น" — สั้น กระชับ
เน้น **"เขาทำอะไรได้"** มากกว่ารายละเอียดเทคนิค ให้เกิดอาการ "อ่อออ ทำแบบนี้ได้ด้วย" อ้างอิงโทนแบบ Blognone

คนไทยสายเทคหลายคนไม่กล้าเริ่มอ่านเปเปอร์เพราะรู้สึกว่ามันคือ "งาน" — โปรเจกต์นี้แก้ปัญหานั้นด้วยการทำให้อ่านจบใน 5 วินาที

**🔗 Live: [thai-paper-feed.vercel.app](https://thai-paper-feed.vercel.app)**

> **สรุปแต่ละใบด้วยโมเดลที่ fine-tune เอง** (distill จาก Gemini → Typhoon2-Qwen2.5-7B) รันบน Modal GPU · Gemini เหลือเป็นแค่ตาข่ายกันพลาด (fallback)

## ✨ หน้าตาเว็บ

![weekly digest](docs/screenshots/weekly.png)

| หน้ารายละเอียด | Admin (ดึงเปเปอร์ใหม่) |
|---|---|
| ![detail](docs/screenshots/detail.png) | ![admin](docs/screenshots/admin.png) |

## 🧭 โปรเจกต์นี้มี 2 เฟส (โปรเจกต์เดียวกัน)

- **Phase A — เว็บที่ทำงานได้ด้วย Gemini** ✅ ฟีดการ์ดไทย + สรุปด้วย Gemini API + Supabase + deploy Vercel
  (การ์ดที่ Gemini สรุปไว้ = dataset สอนโมเดลเราใน Phase B ไปในตัว)
- **Phase B — เทรนโมเดลเราเองมาแทน Gemini** ✅ distill → fine-tune → eval → GGUF → เสิร์ฟบน Modal → เสียบเข้าเว็บ
  พร้อม pivot เป็น **"ฉบับรายสัปดาห์"**: คัดเปเปอร์เด็ดของสัปดาห์จาก community signals + เติมอัตโนมัติทุกจันทร์ด้วย cron

## 🧩 วิธีทำงานของระบบ (Phase B — weekly digest)

```
alphaXiv public feed (คัดเปเปอร์เด็ดสาย AI ตามยอด likes/stars)
   → bucket ตามสัปดาห์ (จันทร์–อาทิตย์) เอา top ~10 ใบ/สัปดาห์
      → โมเดลเราบน Modal GPU สรุปเป็นไทย (พาดหัว / สรุป / จุดว้าว / แท็ก)
         → ใบไหนโมเดลเราทำไม่ผ่าน → fallback ไป Gemini
            → Supabase (upsert กันซ้ำด้วย arxiv id)
               → Next.js แสดงเป็น "ฉบับรายสัปดาห์" + calendar เลือกสัปดาห์
```

- แต่ละ **สัปดาห์ = 1 ฉบับ** โชว์เฉพาะสัปดาห์ที่จบแล้ว (สัปดาห์ปัจจุบันขึ้น "Compiling…" รอสะสมโหวตก่อน)
- **chrome ของเว็บเป็นอังกฤษ** (header / calendar / week label / footer) — **การ์ดแต่ละใบเป็นไทย** สไตล์ Phase A
- **อัตโนมัติ:** Vercel Cron ทุกวันจันทร์สร้างฉบับของสัปดาห์ที่เพิ่งจบ (idempotent — ยิงซ้ำไม่ทำซ้ำ ไม่มีใบใหม่ = ไม่เรียก GPU)

## 🛠 Tech Stack

| ส่วน | ใช้ |
|---|---|
| Frontend + Backend | Next.js 16 (App Router), React 19 |
| Database | Supabase (Postgres) |
| LLM (หลัก) | **โมเดล fine-tune เอง** — `Tana-Pun/thai-paper-summarizer-7b` (base: Typhoon2-Qwen2.5-7B-Instruct, GGUF Q4_K_M) |
| LLM (fallback) | Gemini API (`gemini-3.1-flash-lite`) |
| Serving โมเดล | Modal (T4 GPU, serverless, llama-cpp-python) |
| แหล่ง + คัดเปเปอร์ | alphaXiv public feed (สาย AI: cs.CL/AI/LG/CV/RO/SE/IR/MA/NE + stat.ML) |
| Styling | Tailwind CSS v4, Noto Sans Thai |
| Automation | Vercel Cron (รายสัปดาห์) |
| Deploy | Vercel |

## 🎓 Phase B — เทรนโมเดลเราเอง

pipeline การเทรน (รายละเอียดเต็มใน [`docs/PHASE_B_EXECUTION_PLAN.md`](docs/PHASE_B_EXECUTION_PLAN.md)):

1. **Dataset** — การ์ดที่ Gemini สรุปไว้ใน Phase A = ตัวอย่างสอน (distillation)
2. **Fine-tune** — LoRA บน Typhoon2-Qwen2.5-7B-Instruct (โมเดลไทย) บน Colab/Studio GPU
3. **Eval** — วัด 2 แกน: JSON syntax / อยู่ใน budget / คุณภาพจริง (LLM-judge) — Q4 คุณภาพเทียบเท่า float
4. **Export** — GGUF Q4_K_M ขึ้น HuggingFace Hub (public)
5. **Serve** — Modal โหลด GGUF (cache บน Volume) เปิด endpoint รับ batch สรุปทีละสัปดาห์

> **สูตร inference ต้องตรงกับตอนเทรน** — system/user prompt มาจาก `SYSTEM_PROMPT` + `buildUserPrompt()` ที่ export ใน `src/lib/gemini.ts` (ทั้งเว็บและ Modal ใช้สตริงเดียวกัน ไม่เขียน prompt ซ้ำ)

notebooks + สคริปต์ทั้งหมดอยู่ใน [`phase-b/`](phase-b/) (eda, train, eval, export, serve)

## 🚀 วิธีรันโปรเจกต์

### 1. Clone และติดตั้ง dependencies

```bash
git clone https://github.com/Tanapunn/thai-paper-feed.git
cd thai-paper-feed
npm install
```

### 2. ตั้งค่า environment variables

คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ค่าจริง:

```bash
cp .env.example .env.local
```

```
# Supabase
NEXT_PUBLIC_SUPABASE_URL=...      # จาก Supabase Project Settings > API
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...      # ใช้ฝั่ง server (ingest) เท่านั้น ห้ามเผยแพร่

# โมเดลเราบน Modal (หลัก)
MODAL_SUMMARIZER_URL=...            # endpoint จาก `modal deploy`
MODAL_SUMMARIZER_TOKEN=...          # bearer token (modal.Secret)

# Gemini (fallback)
GEMINI_API_KEY=...                  # จาก https://aistudio.google.com

# ป้องกัน endpoint ingest
INGEST_SECRET=...                   # ปุ่ม /admin + ingest แบบ manual
CRON_SECRET=...                     # Vercel Cron แนบ Authorization ให้เองเมื่อตั้งค่านี้
```

### 3. สร้างตารางใน Supabase

เปิด Supabase SQL Editor แล้วรันไฟล์ [`supabase/schema.sql`](supabase/schema.sql)

### 4. รัน dev server

```bash
npm run dev
```

เปิด [http://localhost:3000](http://localhost:3000) ดูฟีด · `?week=2026-w29` เลือกสัปดาห์ · [/admin](http://localhost:3000/admin) ดึงเปเปอร์ครั้งแรก

### 5. (ตัวเลือก) backfill หลายสัปดาห์ย้อนหลัง

```bash
npx tsx --env-file=.env.local phase-b/scripts/backfill-weeks.ts --weeks 8
```

## ⚙️ Automation (Vercel Cron)

[`vercel.json`](vercel.json) ตั้ง cron ยิง `/api/ingest-cron` **ทุกวันจันทร์ 06:00 UTC** (≈ 13:00 ไทย) → สร้างฉบับของสัปดาห์ที่เพิ่งจบ
auth ด้วย `CRON_SECRET` (Vercel แนบ `Authorization: Bearer <CRON_SECRET>` ให้อัตโนมัติ) · idempotent — ยิงซ้ำ/ไม่มีใบใหม่ = 0 GPU call

## 📁 โครงสร้างที่สำคัญ

```
src/
  lib/
    alphaxiv.ts        # คัดเปเปอร์รายสัปดาห์จาก alphaXiv feed (bucket + top 10 + หมวด)
    arxiv.ts            # ดึง + parse Atom XML จาก arXiv API (Phase A)
    gemini.ts            # SYSTEM_PROMPT + buildUserPrompt + เรียก Gemini (fallback)
    model.ts             # เรียกโมเดลเราบน Modal (batch summarize)
    ingest.ts            # สร้างฉบับรายสัปดาห์: โมเดลเรา → fallback Gemini → upsert
    papers.ts             # query Supabase (getWeeks / getPapersByWeek / getLatestWeek)
    week.ts               # แปลง weekStart ↔ slug `YYYY-Www` + format ช่วงสัปดาห์
    supabase/{client,server}.ts
  components/
    PaperCard.tsx         # การ์ดไทย (title_th / summary_th / 💡wow / tags) + หมวด/likes/stars
    WeekCalendar.tsx       # calendar เลือกสัปดาห์ (chrome อังกฤษ)
  app/
    page.tsx               # หน้าฉบับรายสัปดาห์ (?week=YYYY-Www)
    paper/[id]/page.tsx     # หน้ารายละเอียด
    admin/page.tsx           # หน้ากดดึงเปเปอร์ (manual)
    api/ingest/route.ts       # สร้างฉบับ 1 สัปดาห์ (auth INGEST_SECRET)
    api/ingest-cron/route.ts   # cron รายสัปดาห์ (auth CRON_SECRET)
phase-b/
  notebooks/   # eda / train / eval / export GGUF (Colab)
  scripts/     # backfill-weeks.ts, test-modal-endpoint.ts, eval_*.py, split_dataset.py
  serve/       # modal_app.py — เสิร์ฟ GGUF บน Modal T4
supabase/schema.sql          # ตาราง papers + คอลัมน์ weekly (week_start/rank/likes/…)
```

## ✅ เกณฑ์ความสำเร็จ

**Phase A**
- [x] เปิดลิงก์ Vercel แล้วเห็นฟีดการ์ดภาษาไทย
- [x] กดการ์ดแล้วเข้าหน้ารายละเอียด + ลิงก์ไป arXiv ตัวเต็มได้
- [x] กดปุ่ม ingest แล้วมีเปเปอร์ใหม่เข้ามาจริง ไม่ซ้ำของเดิม
- [x] การ์ดอ่านแล้วรู้สึก "เพื่อนเล่าให้ฟัง" ไม่ใช่สรุปวิชาการ

**Phase B**
- [x] fine-tune โมเดลไทยของตัวเอง + eval ผ่าน (คุณภาพเทียบ Gemini ได้)
- [x] export GGUF + เสิร์ฟบน Modal GPU เรียกจากเว็บได้จริง
- [x] เว็บสรุปด้วย**โมเดลเรา**เป็นหลัก (Gemini เหลือ fallback)
- [x] pivot เป็นฉบับรายสัปดาห์ + คัดเปเปอร์จาก community signals
- [x] เติมฉบับใหม่อัตโนมัติทุกสัปดาห์ด้วย Vercel Cron

## 📄 License

Personal project สำหรับพอร์ตโฟลิโอ ไม่ได้ตั้งใจ license แบบ opensource เป็นทางการ
