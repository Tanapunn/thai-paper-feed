/**
 * Phase B — Stage 5: backfill the last N completed weekly editions into Supabase.
 *
 * Runs the SAME per-edition logic the /api/ingest route uses (src/lib/ingest.ts),
 * but from your machine in a loop — so there's no Vercel 300s limit and the Modal
 * container stays warm across weeks (only the first paper pays the cold start).
 *
 * Needs in .env.local (all already there from Phase A + Stage 5 setup):
 *   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (write to DB)
 *   MODAL_SUMMARIZER_URL, MODAL_SUMMARIZER_TOKEN          (our model)
 *   GEMINI_API_KEY                                        (fallback)
 *
 * Run (default 8 weeks; each run is idempotent — skips papers already ingested):
 *   npx tsx --env-file=.env.local phase-b/scripts/backfill-weeks.ts
 *   npx tsx --env-file=.env.local phase-b/scripts/backfill-weeks.ts --weeks 4
 *
 * Rebuilding ONE week, and/or with a different ranking window. A narrow window
 * ranks a week against itself instead of against older, more-upvoted papers — so
 * it gives a much better edition, but only while it still covers that week:
 *   ... backfill-weeks.ts --week 2026-07-27 --interval "7 Days"
 */

import {
  fetchWeeklyEditions,
  BACKFILL_INTERVAL,
  type FeedInterval,
} from "@/lib/alphaxiv";
import { ingestEdition } from "@/lib/ingest";

const VALID_INTERVALS: FeedInterval[] = ["3 Days", "7 Days", "30 Days", "90 Days"];

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function parseWeeksArg(): number {
  const raw = argValue("--weeks");
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 8;
}

function parseIntervalArg(): FeedInterval {
  const raw = argValue("--interval");
  if (!raw) return BACKFILL_INTERVAL;
  if (!VALID_INTERVALS.includes(raw as FeedInterval)) {
    throw new Error(`--interval must be one of: ${VALID_INTERVALS.join(", ")}`);
  }
  return raw as FeedInterval;
}

async function main() {
  const interval = parseIntervalArg();
  const onlyWeek = argValue("--week");
  const weeks = parseWeeksArg();

  const all = await fetchWeeklyEditions(true, interval);
  const editions = onlyWeek
    ? all.filter((e) => e.weekStart === onlyWeek)
    : all.slice(0, weeks);

  console.log(
    onlyWeek
      ? `Rebuilding week ${onlyWeek} using the "${interval}" window…\n`
      : `Backfilling up to ${weeks} completed weekly edition(s) using "${interval}"…\n`
  );

  if (editions.length === 0) {
    console.log(
      onlyWeek
        ? `Week ${onlyWeek} has no edition in the "${interval}" window ` +
            `(weeks available: ${all.map((e) => e.weekStart).join(", ") || "none"}).`
        : "No completed editions found in the alphaXiv feed window."
    );
    return;
  }

  const totals = { inserted: 0, ours: 0, gemini: 0, failed: 0 };

  for (const edition of editions) {
    console.log(
      `── week ${edition.weekStart}  (${edition.papers.length} candidate papers) ──`
    );
    try {
      const r = await ingestEdition(edition);
      console.log(
        `   in DB already: ${r.alreadyInDb} · inserted: ${r.inserted.length} ` +
          `(ours ${r.bySummarizer.ours}, gemini ${r.bySummarizer.gemini}) · failed: ${r.failed.length}`
      );
      for (const f of r.failed) console.log(`   ⚠️  ${f.id}: ${f.error}`);
      totals.inserted += r.inserted.length;
      totals.ours += r.bySummarizer.ours;
      totals.gemini += r.bySummarizer.gemini;
      totals.failed += r.failed.length;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`   ❌ edition failed: ${message}`);
    }
    console.log("");
  }

  console.log(
    `Done. inserted ${totals.inserted} (ours ${totals.ours}, gemini ${totals.gemini}), ` +
      `failed ${totals.failed}, across ${editions.length} week(s).`
  );
}

main();
