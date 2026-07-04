import { NextResponse } from "next/server";
import { fetchLatestPapers } from "@/lib/arxiv";
import { summarizePaper } from "@/lib/gemini";
import { supabaseAdmin } from "@/lib/supabase/server";

// Vercel Hobby plan hard cap for serverless functions.
export const maxDuration = 60;

const DELAY_BETWEEN_GEMINI_CALLS_MS = 4000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function GET() {
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
  const newPapers = papers.filter((p) => !existingIds.has(p.id));

  console.log(
    `[ingest] fetched ${papers.length}, already in DB: ${existingIds.size}, new: ${newPapers.length}`
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
    failed,
  });
}
