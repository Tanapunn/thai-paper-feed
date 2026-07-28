import { NextRequest, NextResponse } from "next/server";
import { ingestWeek } from "@/lib/ingest";

// Vercel allows up to 300s on all plans (Fluid Compute). One weekly edition is
// ≤10 papers summarized in a single batch call to our model, so a run fits well
// within that even counting a cold start on the Modal container.
export const maxDuration = 300;

/**
 * Burns Gemini quota (fallback path) + writes the DB, so it must never be
 * triggerable anonymously. Require `Authorization: Bearer <INGEST_SECRET>` and
 * fail CLOSED if the secret isn't configured. The /admin button and the Stage 5
 * cron both send this same header.
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

  // Optional { "week": "YYYY-MM-DD" } (a Monday) to (re)build a specific completed
  // edition; omit to build the latest completed week. Body may be empty.
  let weekStart: string | undefined;
  try {
    const body = (await request.json()) as { week?: string } | null;
    weekStart = body?.week;
  } catch {
    /* no/invalid body → latest week */
  }

  try {
    const result = await ingestWeek(weekStart);
    if (!result) {
      return NextResponse.json(
        { message: "no completed edition to ingest", week: weekStart ?? null },
        { status: 200 }
      );
    }
    console.log(
      `[ingest] week ${result.week}: candidates ${result.candidates}, ` +
        `alreadyInDb ${result.alreadyInDb}, inserted ${result.inserted.length} ` +
        `(ours ${result.bySummarizer.ours}, gemini ${result.bySummarizer.gemini}), ` +
        `failed ${result.failed.length}`
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] fatal: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
