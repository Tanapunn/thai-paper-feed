import { NextRequest, NextResponse } from "next/server";
import { ingestWeek } from "@/lib/ingest";

// Same budget as the manual /api/ingest route: one weekly edition (≤10 papers)
// summarized in a single batch call, comfortably inside Vercel's 300s cap even
// with a Modal cold start.
export const maxDuration = 300;

/**
 * Why the schedule is `5 0 * * 1` (Mon 00:05 UTC) and not some friendlier hour:
 * ingestWeek() ranks candidates inside a window anchored to *now* (CRON_INTERVAL,
 * 7 days), so the window matches the week we're publishing only right after that
 * week closes. Every hour we wait blanks out that many hours of the target week's
 * Monday. The 5-minute offset is deliberate too — firing even a second BEFORE
 * Monday 00:00 makes isWeekComplete() call the week unfinished, and the run would
 * silently re-ingest the previous week instead, skipping this one for good.
 */

/**
 * Weekly cron entry point (see `vercel.json` crons). Vercel invokes cron jobs
 * with GET and — when a `CRON_SECRET` env var is set — automatically attaches
 * `Authorization: Bearer <CRON_SECRET>`. We can't set a custom header on the
 * schedule, so this is the auth handle. Fail CLOSED if the secret is missing.
 */
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // fail closed
  const header = request.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // No arg → latest completed edition. Idempotent: papers already ingested are
    // skipped, so a re-run (or a Monday with nothing new) costs zero model calls.
    const result = await ingestWeek();
    if (!result) {
      return NextResponse.json(
        { message: "no completed edition to ingest" },
        { status: 200 }
      );
    }
    console.log(
      `[ingest-cron] week ${result.week}: candidates ${result.candidates}, ` +
        `alreadyInDb ${result.alreadyInDb}, inserted ${result.inserted.length} ` +
        `(ours ${result.bySummarizer.ours}, gemini ${result.bySummarizer.gemini}), ` +
        `failed ${result.failed.length}`
    );
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ingest-cron] fatal: ${message}`);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
