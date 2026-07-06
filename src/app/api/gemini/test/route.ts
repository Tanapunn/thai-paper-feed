import { NextResponse } from "next/server";
import { fetchLatestPapers } from "@/lib/arxiv";
import { summarizePaper } from "@/lib/gemini";

// Dev-only debug route from STEP 2 — never burns Gemini quota from production traffic.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  const papers = await fetchLatestPapers(3);

  const results = [];
  for (const paper of papers) {
    console.log(`[gemini/test] summarizing [${paper.id}] ${paper.titleEn.slice(0, 60)}`);
    const summary = await summarizePaper(paper.titleEn, paper.abstractEn);
    console.log(`[gemini/test] result:`, summary);
    results.push({
      id: paper.id,
      title_en: paper.titleEn,
      ...summary,
    });
  }

  return NextResponse.json({ count: results.length, results });
}
