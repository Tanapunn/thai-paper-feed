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
 */

import { fetchWeeklyEditions } from "@/lib/alphaxiv";
import { ingestEdition } from "@/lib/ingest";

function parseWeeksArg(): number {
  const i = process.argv.indexOf("--weeks");
  if (i !== -1 && process.argv[i + 1]) {
    const n = Number(process.argv[i + 1]);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return 8;
}

async function main() {
  const weeks = parseWeeksArg();
  console.log(`Backfilling up to ${weeks} completed weekly edition(s)…\n`);

  const editions = (await fetchWeeklyEditions(true)).slice(0, weeks);
  if (editions.length === 0) {
    console.log("No completed editions found in the alphaXiv feed window.");
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
