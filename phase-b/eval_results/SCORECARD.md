# Phase B — Stage 3.3 Scorecard (5 ระบบ × 60 ใบ test set)

รายงาน **2 แกน** (อย่ายุบเป็นเลขเดียว):
- **Structure** = auto-metrics วัดด้วยโค้ด (JSON/field/ความยาว/คงศัพท์อังกฤษ)
- **Quality** = LLM-as-judge (Claude Sonnet 5, blind, 1-5) วัดสิ่งที่โค้ดวัดไม่ได้

judge เห็นแค่ paper (EN) + การ์ดไทย 1 ใบ ไม่รู้ว่าใครสรุป · Gemini ถูก judge แบบเดียวกับผู้เข้าแข่งคนอื่น

---

## แกน Quality — LLM judge (เฉลี่ย 1-5, n=60/ระบบ)

| system         | accuracy | tone | wow  | **avg** |
|----------------|:--------:|:----:|:----:|:-------:|
| gemini (teacher) | 3.95   | 4.68 | 3.73 | **4.12** |
| **ft_case_a**  | 3.45     | 4.37 | 3.42 | **3.75** |
| ft_case_b      | 3.13     | 4.13 | 3.02 | **3.43** |
| base_case_a    | 3.50     | 2.43 | 2.00 | **2.64** |
| base_case_b    | 2.77     | 1.68 | 1.65 | **2.03** |

## แกน Structure — auto-metrics (n=60/ระบบ)

| system         | syntax | fits | usable | trunc | card_med | en_tok |
|----------------|:------:|:----:|:------:|:-----:|:--------:|:------:|
| gemini         | 100%   | 100% | 100%   | 0     | 451      | 9 |
| ft_case_a      | 98%    | 100% | 98%    | 0     | 430      | 8 |
| ft_case_b      | 100%   | 100% | 100%   | 0     | 423      | 8 |
| base_case_a    | 100%   | 100% | 100%   | 0     | 457      | 4 |
| base_case_b    | 96%    | 80%  | 60%    | 12    | 686      | 5 |

`syntax`=valid/completed · `fits`=completed/total · `usable`=(valid&field ครบ)/total · `trunc`=โดนตัดกี่ใบ · `en_tok`=token อังกฤษใน card valid

---

## คำตัดสิน

**ผู้ชนะฝั่งนักเรียน (ที่จะเอาไป serve) = `ft_case_a`**

เหตุผล:
1. **Quality นำ ft_case_b ทุกแกน** (avg 3.75 vs 3.43) — สำคัญที่สุดเพราะเป้าหมายคือ "อ่านสนุก" ไม่ใช่ JSON ถูก
2. **ไล่ Gemini teacher มาใกล้** (3.75 vs 4.12 = 91% ของครู) ทั้งที่เป็นโมเดล 3B รันเองฟรี
3. **Structure แทบสมบูรณ์** — usable 98% (พลาด schema แค่ 1/60), ไม่มีใบโดนตัดเลย
4. การ์ดสั้นกระชับ (median 430 char) ใกล้ Gemini (451) — คุมความยาวได้

**สิ่งที่ fine-tune แก้ได้จริง (base → ft):**
- **tone พุ่ง** 2.43 → 4.37 (base_case_a) — นี่คือคุณค่าหลักของ fine-tune ไม่ใช่ JSON
- **wow พุ่ง** 2.0 → 3.42 — base เขียนพาดหัวจืด, ft เขียนให้อยากอ่าน
- **คงศัพท์อังกฤษ** en_tok 4 → 8 — base ชอบแปลศัพท์เทคนิคมั่ว, ft คงไว้แบบครู
- base_case_b ยัง verbose ชนเพดาน (12 ใบโดนตัด, median 686) — ft คุมได้หมด

**ข้อสังเกต:** base_case_a ได้ accuracy 3.5 (ไม่ต่ำ) แต่ tone/wow พังเพราะเขียนแบบแปลตรงตัว/วิชาการ → ยืนยันว่า fine-tune ซื้อ "โทน+จุดว้าว" ไม่ใช่ "ความถูกต้อง"

→ **Stage 4: export `ft_case_a` เป็น GGUF Q4_K_M ขึ้น HF Hub แล้วเสียบเข้าเว็บแทน Gemini**
