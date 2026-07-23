import { NextRequest, NextResponse } from "next/server";
import { fetchLatestPapers } from "@/lib/arxiv";
import { summarizePaper } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase/server";

// Vercel Hobby plan hard cap for serverless functions.
export const maxDuration = 60;

const DELAY_BETWEEN_GEMINI_CALLS_MS = 4000;

// Each new paper costs ~4s (rate-limit delay) + Gemini latency, so we can only
// finish a handful before hitting maxDuration (60s). Cap the batch per request
// and report how many are left — the caller (admin button / cron) just runs again,
// and already-ingested papers are skipped, so the backlog drains over a few runs.
const MAX_PER_RUN = 8;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * This route burns Gemini quota + writes the DB, so it must never be triggerable
 * by an anonymous request (or by a bot/prefetch hitting a GET). Require a shared
 * secret via `Authorization: Bearer <INGEST_SECRET>`, and fail CLOSED if the secret
 * isn't configured — an unconfigured deploy denies everything rather than open up.
 * The /admin button and the Stage 5 cron both send this same header.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.INGEST_SECRET;
  if (!secret) return false; // fail closed
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const papers = await fetchLatestPapers(20);

  const { data: existingRows, error: selectError } = await supabaseAdmin
    .from("papers")
    .select("id")
    .in(
      "id",
      papers.map((p) => p.id)
    );

  if (selectError) {
    return NextResponse.json({ error: selectError.message }, { status: 500 });
  }

  const existingIds = new Set((existingRows ?? []).map((row) => row.id as string));
  const allNew = papers.filter((p) => !existingIds.has(p.id));
  // Process at most MAX_PER_RUN this invocation so we return before the timeout.
  const newPapers = allNew.slice(0, MAX_PER_RUN);
  const remaining = allNew.length - newPapers.length;

  console.log(
    `[ingest] fetched ${papers.length}, already in DB: ${existingIds.size}, ` +
      `new: ${allNew.length}, processing: ${newPapers.length}, remaining after: ${remaining}`
  );

  const inserted: string[] = [];
  const failed: { id: string; error: string }[] = [];

  for (let i = 0; i < newPapers.length; i++) {
    const paper = newPapers[i];
    try {
      console.log(`[ingest] summarizing [${paper.id}] ${paper.titleEn.slice(0, 60)}`);
      const summary = await summarizePaper(paper.titleEn, paper.abstractEn);

      const { error: upsertError } = await supabaseAdmin.from("papers").upsert(
        {
          id: paper.id,
          arxiv_url: paper.arxivUrl,
          pdf_url: paper.pdfUrl,
          title_en: paper.titleEn,
          abstract_en: paper.abstractEn,
          authors: paper.authors,
          category: paper.category,
          published_at: paper.publishedAt,
          title_th: summary.title_th,
          summary_th: summary.summary_th,
          wow_point: summary.wow_point,
          tags: summary.tags,
        },
        { onConflict: "id" }
      );

      if (upsertError) {
        throw new Error(upsertError.message);
      }

      inserted.push(paper.id);
      console.log(`[ingest] upserted [${paper.id}]`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[ingest] failed [${paper.id}]: ${message}`);
      failed.push({ id: paper.id, error: message });
    }

    if (i < newPapers.length - 1) {
      await sleep(DELAY_BETWEEN_GEMINI_CALLS_MS);
    }
  }

  return NextResponse.json({
    fetched: papers.length,
    skippedExisting: existingIds.size,
    inserted: inserted.length,
    insertedIds: inserted,
    remaining,
    failed,
  });
}
