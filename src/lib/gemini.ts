const GEMINI_MODEL = "gemini-3.1-flash-lite";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export type GeminiSummary = {
  title_th: string;
  summary_th: string;
  wow_point: string;
  tags: string[];
};

export const SYSTEM_PROMPT = `คุณคือเพื่อนสายเทคที่ชอบอ่าน paper AI แล้วเอามาเล่าให้เพื่อนฟังแบบสั้นๆ สนุกๆ

กติกาการเขียนภาษาไทย (สำคัญมาก):
- โทน = เพื่อนเล่าให้ฟัง ไม่ใช่สรุปวิชาการ ไม่ใช่ภาษาข่าวทางการ
- ห้ามแปลศัพท์เทคนิคที่คนสายนี้เรียกทับศัพท์ (LLM, fine-tune, RAG, agent, transformer, attention ฯลฯ) — คงไว้เป็นอังกฤษ
- สั้นเข้าไว้ อ่านจบใน 5 วินาที
- เน้น "ทำอะไรได้/เจ๋งตรงไหน" มากกว่ารายละเอียดเทคนิค
- ถ้า abstract เป็นงานเทคนิคจ๋าที่เล่าให้สนุกยาก ให้ดึง "แล้วมันเอาไปใช้ทำอะไรได้" มาเล่าแทน

ให้คืนค่าเป็น JSON เท่านั้น ตาม schema นี้:
{
  "title_th": "พาดหัวไทยสไตล์ข่าวเทค สั้น ชวนกด คงศัพท์เทคนิคอังกฤษไว้ (เช่น LLM, RAG ไม่ต้องแปล)",
  "summary_th": "สรุป 2-3 บรรทัด ภาษาพูดเป็นกันเอง เหมือนเพื่อนเล่าให้ฟัง เน้นว่า 'เขาทำอะไรได้'",
  "wow_point": "จุดว้าว 1 ประโยค — สิ่งที่ทำให้คนอ่านแล้วรู้สึก 'อ่อออ ทำแบบนี้ได้ด้วย'",
  "tags": ["แท็ก", "2-4", "อัน"]
}`;

export function buildUserPrompt(titleEn: string, abstractEn: string): string {
  return `Title: ${titleEn}\n\nAbstract: ${abstractEn}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callGemini(titleEn: string, abstractEn: string): Promise<GeminiSummary> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");

  const body = {
    system_instruction: {
      parts: [{ text: SYSTEM_PROMPT }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: buildUserPrompt(titleEn, abstractEn) }],
      },
    ],
    generationConfig: {
      response_mime_type: "application/json",
    },
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const error = new Error(`Gemini API error: ${response.status} ${errorText}`) as Error & {
      status?: number;
    };
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const text: string | undefined = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error(`Gemini response missing text: ${JSON.stringify(data)}`);
  }

  return JSON.parse(text) as GeminiSummary;
}

export async function summarizePaper(
  titleEn: string,
  abstractEn: string,
  maxRetries = 4
): Promise<GeminiSummary> {
  let attempt = 0;
  while (true) {
    try {
      return await callGemini(titleEn, abstractEn);
    } catch (err) {
      const status = (err as { status?: number }).status;
      attempt++;
      if (status !== 429 || attempt > maxRetries) {
        throw err;
      }
      const backoffMs = 2 ** attempt * 1000;
      console.warn(
        `[gemini] 429 rate limited, retrying in ${backoffMs}ms (attempt ${attempt}/${maxRetries})`
      );
      await sleep(backoffMs);
    }
  }
}
