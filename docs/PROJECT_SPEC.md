# Thai AI Paper Feed — Phase A (Beta) Spec

> เอกสารนี้เป็น context หลักให้ Claude Code อ่านก่อนเริ่มทุกครั้ง
> เป้าหมาย: ทำเว็บฟีดสรุปเปเปอร์ AI ภาษาไทยให้ใช้งานได้จริงภายใน 1 วัน แล้ว deploy ขึ้น Vercel

---

## 1. หัวใจของโปรเจกต์ (อ่านก่อนตัดสินใจทุกอย่าง)

เป้าหมายเดียวของเบต้านี้:

> **"เปิดมา เห็นฟีดการ์ดเปเปอร์ AI ภาษาไทย ปัดอ่านเล่นแล้วเจอของว้าว"**

อารมณ์ที่ต้องการ = **เหมือนเพื่อนแปะสรุปมาให้อ่านเล่น** ไม่ใช่เหมือนอ่าน paper
อ้างอิงสไตล์: Blognone (พาดหัวไทยกระชับ + 2-3 บรรทัด + กดเข้าไปอ่านต่อ)

ความเจ็บปวดที่แก้: คนไทยสายเทค "ไม่อยากเริ่มกดอ่านเปเปอร์เพราะมันดูเหมือนงาน" — ไม่ใช่เพราะอ่านอังกฤษไม่ได้ แต่เพราะมันรู้สึกต้องใช้ความพยายาม

**สิ่งที่ทำให้การ์ดดี:** สั้น เข้าใจทันที เน้น "เขาทำอะไรได้" (ผลลัพธ์/ความสามารถ) มากกว่า "ทำได้ยังไง" (เทคนิค) — ให้เกิดอาการ "อ่อออ ทำแบบนี้ได้ด้วยเนี่ย"

---

## 2. Scope เบต้า (ทำแค่นี้ อย่าเกิน)

### ✅ ต้องมี
- ดึงเปเปอร์ใหม่จาก **arXiv API** (หมวด cs.CL + cs.AI) ~15-20 ใบล่าสุด
- สรุปเป็นการ์ดภาษาไทยด้วย **Gemini API (free tier)**
- เก็บลง **Supabase**
- หน้าเว็บ **Next.js**: ฟีดการ์ด + หน้ารายละเอียด
- Deploy ขึ้น **Vercel** (เชื่อมกับ GitHub)
- รัน **manual** ก่อน (มีปุ่ม/สคริปต์สั่งดึง+สรุป ไม่ต้อง auto)

### ⏳ ยังไม่ทำในเบต้า (เก็บไว้เฟสหลัง)
- โมเดล fine-tune ของเราเอง (เฟส B)
- auto-run ทุกเช้า (GitHub Actions cron)
- แหล่งอื่นนอกจาก arXiv (OpenAlex, Semantic Scholar)
- เปเปอร์เก่า/classic
- personalize / For You / chatbot
- ดึง conclusion/future work (เบต้าใช้ abstract พอ)

---

## 3. Tech Stack

| ส่วน | ใช้ | หมายเหตุ |
|---|---|---|
| Frontend + Backend | Next.js (App Router) | deploy บน Vercel |
| Database | Supabase (Postgres) | free tier |
| LLM | Gemini API | รุ่น `gemini-2.5-flash` (free tier: 1,500 req/วัน, 15 RPM) |
| แหล่งเปเปอร์ | arXiv API | ฟรี ไม่ต้อง key |
| Deploy | Vercel | เชื่อม GitHub repo → push แล้ว auto deploy |
| Version control | GitHub | commit เป็นระยะตั้งแต่เริ่ม |

**หมายเหตุ Gemini free tier:** prompt ที่ส่งอาจถูกนำไปปรับปรุงโมเดลของ Google ได้ — ไม่เป็นปัญหาเพราะเราส่งแค่ abstract ที่เป็นข้อมูลสาธารณะอยู่แล้ว ห้ามส่งข้อมูลส่วนตัว/ลับ

---

## 4. arXiv API — วิธีดึง

- Endpoint: `http://export.arxiv.org/api/query`
- Query params ที่ใช้:
  - `search_query=cat:cs.CL+OR+cat:cs.AI`
  - `sortBy=submittedDate&sortOrder=descending`
  - `max_results=20`
- ตอบกลับเป็น Atom XML → parse ด้วย library (เช่น `fast-xml-parser`) หรือใช้แพ็กเกจ arxiv สำหรับ JS/Python
- ใส่ User-Agent header สุภาพๆ เช่น `ThaiPaperFeed/0.1 (beta; contact: <email>)`
- เว้นจังหวะการเรียก ~3 วินาที/request ตามมารยาท arXiv

### fields ที่ต้องเก็บจาก arXiv
- `id` (arxiv id เช่น 2607.01234) — ใช้เป็น primary key กันซ้ำ
- `title` (อังกฤษ)
- `summary` (abstract อังกฤษ)
- `authors`
- `primary_category` (เช่น cs.CL)
- `published` (วันที่)
- `link` (URL หน้า abstract) + PDF link

---

## 5. Data model (Supabase)

ตาราง `papers`:

| column | type | มาจาก |
|---|---|---|
| `id` | text (PK) | arxiv id |
| `arxiv_url` | text | ลิงก์ตัวเต็ม |
| `pdf_url` | text | ลิงก์ PDF |
| `title_en` | text | arXiv |
| `abstract_en` | text | arXiv |
| `authors` | text[] | arXiv |
| `category` | text | arXiv primary_category |
| `published_at` | timestamptz | arXiv |
| `title_th` | text | Gemini gen |
| `summary_th` | text | Gemini gen (2-3 บรรทัด) |
| `wow_point` | text | Gemini gen (จุดว้าว 1 อัน) |
| `tags` | text[] | Gemini gen |
| `created_at` | timestamptz | default now() |

---

## 6. Gemini — สิ่งที่ต้อง gen ต่อ 1 เปเปอร์

ส่ง `title_en` + `abstract_en` เข้าไป ให้ Gemini คืน **JSON** ตามนี้:

```json
{
  "title_th": "พาดหัวไทยสไตล์ข่าวเทค สั้น ชวนกด คงศัพท์เทคนิคอังกฤษไว้ (เช่น LLM, RAG ไม่ต้องแปล)",
  "summary_th": "สรุป 2-3 บรรทัด ภาษาพูดเป็นกันเอง เหมือนเพื่อนเล่าให้ฟัง เน้นว่า 'เขาทำอะไรได้'",
  "wow_point": "จุดว้าว 1 ประโยค — สิ่งที่ทำให้คนอ่านแล้วรู้สึก 'อ่อออ ทำแบบนี้ได้ด้วย'",
  "tags": ["แท็ก", "2-4", "อัน"]
}
```

**กติกาการเขียนภาษาไทย (สำคัญมาก — นี่คือหัวใจ):**
- โทน = เพื่อนเล่าให้ฟัง ไม่ใช่สรุปวิชาการ ไม่ใช่ภาษาข่าวทางการ
- ห้ามแปลศัพท์เทคนิคที่คนสายนี้เรียกทับศัพท์ (LLM, fine-tune, RAG, agent, transformer, attention ฯลฯ) — คงไว้เป็นอังกฤษ
- สั้นเข้าไว้ อ่านจบใน 5 วินาที
- เน้น "ทำอะไรได้/เจ๋งตรงไหน" มากกว่ารายละเอียดเทคนิค
- ถ้า abstract เป็นงานเทคนิคจ๋าที่เล่าให้สนุกยาก ให้ดึง "แล้วมันเอาไปใช้ทำอะไรได้" มาเล่าแทน

**การเรียก Gemini:**
- ใช้ `response_mime_type: "application/json"` เพื่อบังคับ output เป็น JSON
- ใส่ retry + exponential backoff (กัน 429 rate limit)
- เว้นจังหวะให้อยู่ใน 15 RPM (เช่น หน่วง ~4 วินาที/เปเปอร์ ก็พอ)

---

## 7. หน้าเว็บ

### หน้าฟีด (`/`)
- แสดงการ์ดเรียงตามใหม่สุดก่อน
- แต่ละการ์ด: `title_th` (เด่น) + `summary_th` (2-3 บรรทัด) + `wow_point` (เน้นสี/ไอคอน 💡) + `tags` (chip เล็กๆ) + ปุ่ม "อ่านต่อ"
- กดการ์ด → ไปหน้ารายละเอียด
- ดีไซน์: สะอาด อ่านง่ายบนมือถือ (คนจะเปิดตอนว่างบนมือถือ) — mobile-first

### หน้ารายละเอียด (`/paper/[id]`)
- `title_th` + `title_en` (ตัวเล็กใต้ลงมา)
- `summary_th` เต็ม + `wow_point`
- `authors`, `category`, `published_at`
- `tags`
- ปุ่มใหญ่: "อ่านเปเปอร์ตัวเต็ม (arXiv)" → `arxiv_url` / "ดาวน์โหลด PDF" → `pdf_url`

### ปุ่ม admin (ชั่วคราวสำหรับเบต้า)
- ปุ่ม/หน้า `/admin` หรือ API route `/api/ingest` ที่กดแล้ว: ดึง arXiv → gen ด้วย Gemini → upsert เข้า Supabase
- กันเปเปอร์ซ้ำด้วย arxiv id (upsert on conflict)

---

## 8. โครงสร้างงานใน 1 วัน

```
[0] setup: clone GitHub repo, ติดตั้ง Next.js, ต่อ Supabase, ใส่ Gemini key ใน .env
[1] เขียน arXiv fetcher → ทดสอบดึง 20 ใบ ดู field ครบ
[2] เขียน Gemini summarizer → ทดสอบ gen 1-2 ใบ ดูคุณภาพภาษาไทย + ปรับ prompt
[3] ต่อ [1]+[2] → เขียนเข้า Supabase (upsert กันซ้ำ)
[4] หน้าฟีด + หน้ารายละเอียด (ดึงจาก Supabase)
[5] ปุ่ม/route ingest สำหรับกดดึงเอง
[6] push GitHub → เชื่อม Vercel → deploy → ได้ลิงก์
[7] เขียน README + commit
```

commit ขึ้น GitHub หลังจบแต่ละสเต็ป

---

## 9. .env ที่ต้องมี

```
GEMINI_API_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...   # ใช้ฝั่ง server ตอน ingest เท่านั้น
```

**อย่า commit .env ขึ้น GitHub** (ใส่ใน .gitignore)

---

## 10. เกณฑ์ว่า "เบต้าเสร็จ"

- [ ] เปิดลิงก์ Vercel แล้วเห็นฟีดการ์ดภาษาไทย
- [ ] กดการ์ดแล้วเข้าหน้ารายละเอียด + ลิงก์ไป arXiv ตัวเต็มได้
- [ ] กดปุ่ม ingest แล้วมีเปเปอร์ใหม่เข้ามาจริง ไม่ซ้ำของเดิม
- [ ] การ์ดอ่านแล้วรู้สึก "เพื่อนเล่าให้ฟัง" ไม่ใช่สรุปวิชาการ
- [ ] repo อยู่บน GitHub มี README

> เบต้าไม่ต้องสวยสมบูรณ์ ขอแค่ใช้ได้จริงและส่งให้เพื่อนลองได้ แล้วค่อยเก็บ feedback มาปรับ
