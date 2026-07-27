import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  type GeminiSummary,
} from "@/lib/gemini";

// Client for our own fine-tuned model served on Modal (see phase-b/serve/modal_app.py).
// We reuse the EXACT system/user prompt the model was trained on (SYSTEM_PROMPT +
// buildUserPrompt from gemini.ts) so inference matches training. The Modal service
// just runs llama-cpp on the messages we send — the Thai prompt lives only here.

export type SummarizeInput = { titleEn: string; abstractEn: string };

const REQUIRED_FIELDS: (keyof GeminiSummary)[] = [
  "title_th",
  "summary_th",
  "wow_point",
  "tags",
];

// Same tolerant parse as the eval notebook: try strict JSON first, then fall back
// to the first {...} block in case the model wrapped it in prose/backticks.
function parseCard(raw: string): GeminiSummary | null {
  const tryParse = (s: string): GeminiSummary | null => {
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === "object") return obj as GeminiSummary;
    } catch {
      /* fall through */
    }
    return null;
  };

  let card = tryParse(raw);
  if (!card) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (match) card = tryParse(match[0]);
  }
  if (!card) return null;

  // Structural validation — every field present, tags a non-empty-ish array.
  for (const field of REQUIRED_FIELDS) {
    if (card[field] === undefined || card[field] === null) return null;
  }
  if (!Array.isArray(card.tags)) return null;
  if (
    typeof card.title_th !== "string" ||
    typeof card.summary_th !== "string" ||
    typeof card.wow_point !== "string"
  ) {
    return null;
  }
  return card;
}

/**
 * Summarize a batch with our Modal-hosted model. Returns one slot per input in
 * order; a slot is `null` when the model is unconfigured/unreachable or produced
 * an unusable card — the caller (ingest) then falls back to Gemini for those slots.
 * This function never throws, so one bad batch can't take down ingestion.
 */
export async function summarizeWithModel(
  items: SummarizeInput[]
): Promise<(GeminiSummary | null)[]> {
  if (items.length === 0) return [];

  const url = process.env.MODAL_SUMMARIZER_URL;
  const token = process.env.MODAL_SUMMARIZER_TOKEN;
  if (!url || !token) {
    // Model not wired up yet — signal "use fallback" for every item.
    return items.map(() => null);
  }

  const payload = {
    token,
    items: items.map((it) => ({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(it.titleEn, it.abstractEn),
    })),
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn(`[model] Modal returned ${response.status} — falling back to Gemini`);
      return items.map(() => null);
    }

    const data = (await response.json()) as {
      results?: ({ raw?: string; error?: string } | null)[];
    };
    const results = data.results ?? [];

    return items.map((_, i) => {
      const r = results[i];
      if (!r || !r.raw) return null;
      return parseCard(r.raw);
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[model] request failed (${message}) — falling back to Gemini`);
    return items.map(() => null);
  }
}
