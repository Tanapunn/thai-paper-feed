import type { WeeklyEdition, CuratedPaper, FeedInterval } from "@/lib/alphaxiv";
import { fetchWeeklyEditions, CRON_INTERVAL } from "@/lib/alphaxiv";
import { summarizeWithModel } from "@/lib/model";
import { summarizePaper, type GeminiSummary } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase/server";

// One Gemini call every ~4s keeps us under the 15 RPM quota. Only the fallback
// path (papers our model couldn't summarize) hits Gemini, so this rarely triggers.
const DELAY_BETWEEN_GEMINI_CALLS_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type IngestWeekResult = {
  week: string; // weekStart (ISO Monday)
  candidates: number; // papers in the edition
  alreadyInDb: number; // skipped because already ingested
  processed: number; // newly attempted this run
  inserted: string[]; // arxiv ids successfully upserted
  bySummarizer: { ours: number; gemini: number };
  failed: { id: string; error: string }[];
};

function rowFor(paper: CuratedPaper, card: GeminiSummary, summarizer: "ours" | "gemini") {
  return {
    id: paper.id,
    arxiv_url: paper.arxivUrl,
    pdf_url: paper.pdfUrl,
    title_en: paper.titleEn,
    abstract_en: paper.abstractEn,
    authors: paper.authors,
    category: paper.category,
    published_at: paper.publishedAt,
    title_th: card.title_th,
    summary_th: card.summary_th,
    wow_point: card.wow_point,
    tags: card.tags,
    week_start: paper.weekStart,
    rank: paper.rank,
    likes: paper.likes,
    github_stars: paper.githubStars,
    picked_by: paper.pickedBy,
    summarizer,
  };
}

/**
 * Build (or top up) one weekly edition in the DB:
 *   1. skip papers already ingested (idempotent — safe to re-run)
 *   2. summarize the rest with OUR model in a single batch call
 *   3. for any the model couldn't produce a usable card, fall back to Gemini
 *   4. upsert each row with its weekly metadata + which summarizer wrote it
 *
 * Never throws per-paper: a bad card is recorded in `failed` and the edition
 * continues. The whole function can still throw on a hard infra error (DB select).
 */
export async function ingestEdition(edition: WeeklyEdition): Promise<IngestWeekResult> {
  const { weekStart, papers } = edition;

  const { data: existingRows, error: selectError } = await supabaseAdmin
    .from("papers")
    .select("id")
    .in(
      "id",
      papers.map((p) => p.id)
    );
  if (selectError) throw new Error(`supabase select: ${selectError.message}`);

  const existingIds = new Set((existingRows ?? []).map((r) => r.id as string));
  const newPapers = papers.filter((p) => !existingIds.has(p.id));

  const result: IngestWeekResult = {
    week: weekStart,
    candidates: papers.length,
    alreadyInDb: existingIds.size,
    processed: newPapers.length,
    inserted: [],
    bySummarizer: { ours: 0, gemini: 0 },
    failed: [],
  };
  if (newPapers.length === 0) return result;

  // Our model summarizes the whole week in ONE batch request (one cold start).
  const modelCards = await summarizeWithModel(
    newPapers.map((p) => ({ titleEn: p.titleEn, abstractEn: p.abstractEn }))
  );

  for (let i = 0; i < newPapers.length; i++) {
    const paper = newPapers[i];
    let card = modelCards[i];
    let summarizer: "ours" | "gemini" = "ours";

    // Fallback: our model didn't return a usable card for this one → ask Gemini.
    if (!card) {
      try {
        card = await summarizePaper(paper.titleEn, paper.abstractEn);
        summarizer = "gemini";
        await sleep(DELAY_BETWEEN_GEMINI_CALLS_MS); // stay under Gemini RPM
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        result.failed.push({ id: paper.id, error: `gemini fallback: ${message}` });
        continue;
      }
    }

    const { error: upsertError } = await supabaseAdmin
      .from("papers")
      .upsert(rowFor(paper, card, summarizer), { onConflict: "id" });
    if (upsertError) {
      result.failed.push({ id: paper.id, error: upsertError.message });
      continue;
    }

    result.inserted.push(paper.id);
    result.bySummarizer[summarizer]++;
  }

  return result;
}

/**
 * Fetch the latest complete weekly edition and ingest it. If `weekStart` is given,
 * ingest that specific completed week instead. Returns null if the requested week
 * has no edition (e.g. no qualifying papers, or the current week isn't complete yet).
 *
 * `interval` defaults to the weekly-cron window, which only covers the week that
 * just ended. Pass BACKFILL_INTERVAL to reach further back — an older `weekStart`
 * under the default window yields a thin edition or none at all.
 */
export async function ingestWeek(
  weekStart?: string,
  interval: FeedInterval = CRON_INTERVAL
): Promise<IngestWeekResult | null> {
  const editions = await fetchWeeklyEditions(true, interval);
  const edition = weekStart
    ? editions.find((e) => e.weekStart === weekStart) ?? null
    : editions[0] ?? null;
  if (!edition) return null;
  return ingestEdition(edition);
}
