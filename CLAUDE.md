# CLAUDE.md

> ไฟล์นี้ Claude Code อ่านอัตโนมัติทุกครั้ง — เก็บเฉพาะสิ่งที่ต้องจำตลอด
> รายละเอียดยาวอยู่ใน docs/ (ชี้ไว้ด้านล่าง)

## โปรเจกต์นี้คืออะไร

เว็บฟีดสรุปเปเปอร์ AI เป็น **ภาษาไทย** อารมณ์เหมือนเพื่อนแปะสรุปมาให้อ่านเล่น (สไตล์ Blognone)
- สั้น กระชับ อ่านเข้าใจทันที เน้น "เขาทำอะไรได้" ให้เกิดอาการ "อ่อออ ทำแบบนี้ได้ด้วย"
- กลุ่มเป้าหมาย: คนไทยสายเทคที่อยากตามเทรนด์ AI แบบชิลๆ (ไม่ใช่นักวิจัยที่ตั้งใจอ่าน paper)
- ความเจ็บปวดที่แก้: "ไม่อยากเริ่มกดอ่าน เพราะมันดูเหมือนงาน" — ไม่ใช่อ่านอังกฤษไม่ได้

## โปรเจกต์นี้มี 2 เฟส (โปรเจกต์เดียวกัน)

- **Phase A** = เว็บที่ทำงานได้ โดยใช้ Gemini API สรุป (เสร็จแล้ว/กำลังทำ)
- **Phase B** = เทรนโมเดลเราเอง (distill จาก Gemini) มาแทน Gemini + วัดผล + รันจริงในเว็บ

Phase A เก็บ dataset ให้ Phase B ไปในตัว (การ์ดที่ Gemini สรุป = ตัวอย่างสอนโมเดลเรา)

## Tech Stack

- Frontend/Backend: Next.js (App Router) → deploy Vercel
- DB: Supabase (Postgres)
- LLM (Phase A + fallback): Gemini API รุ่น `gemini-3.1-flash-lite` (โควต้าจริง 500/วัน, 15 RPM)
- LLM (Phase B): fine-tuned Thai model (ดู `docs/PHASE_B_EXECUTION_PLAN.md`)
- แหล่งเปเปอร์: arXiv API (cs.CL + cs.AI) ฟรี
- Version control: GitHub → push แล้ว Vercel auto deploy

## กติกาสำคัญ (ห้ามพลาด)

1. **โทนภาษาไทย = เพื่อนเล่าให้ฟัง** ไม่ใช่สรุปวิชาการ/ข่าวทางการ
2. **คงศัพท์เทคนิคอังกฤษ** (LLM, RAG, agent, fine-tune, transformer) — ห้ามแปลมั่ว
3. **อย่า commit .env** — เช็ค .gitignore ทุกครั้ง
4. **ทำทีละ step** อย่าทำรวดเดียวทั้งระบบ — รอ user ตรวจก่อนไป step ถัดไป
5. **commit บ่อยๆ** จบแต่ละ step ให้ commit + push

## รายละเอียดเพิ่มเติม (อ่านเมื่อเกี่ยวข้อง)

- สเปกรวม + data model + prompt: `docs/PROJECT_SPEC.md`
- แผนเทรนโมเดล Phase B: `docs/PHASE_B_EXECUTION_PLAN.md`

## สถานะปัจจุบัน

<!-- อัปเดตบรรทัดนี้เรื่อยๆ ให้ Claude Code รู้ว่าทำถึงไหน -->
- [x] Phase A: เว็บ + Gemini summarize + Supabase + deploy (live: thai-paper-feed.vercel.app)
- [ ] Phase B: dataset → เทรน → eval → GGUF → เสียบเข้าเว็บ
