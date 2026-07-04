import { NextResponse } from "next/server";
import { fetchLatestPapers } from "@/lib/arxiv";

export async function GET() {
  const papers = await fetchLatestPapers(20);

  console.log(`[arxiv/test] fetched ${papers.length} papers`);
  papers.forEach((p, i) => {
    console.log(
      `[arxiv/test] ${i + 1}. [${p.id}] (${p.category}) ${p.titleEn.slice(0, 80)}`
    );
  });

  return NextResponse.json({ count: papers.length, papers });
}
