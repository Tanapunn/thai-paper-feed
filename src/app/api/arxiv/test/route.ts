import { NextResponse } from "next/server";
import { fetchLatestPapers } from "@/lib/arxiv";

// Dev-only debug route from STEP 1 — never hits arXiv from production traffic.
export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "Not available in production" }, { status: 404 });
  }

  const papers = await fetchLatestPapers(20);

  console.log(`[arxiv/test] fetched ${papers.length} papers`);
  papers.forEach((p, i) => {
    console.log(
      `[arxiv/test] ${i + 1}. [${p.id}] (${p.category}) ${p.titleEn.slice(0, 80)}`
    );
  });

  return NextResponse.json({ count: papers.length, papers });
}
