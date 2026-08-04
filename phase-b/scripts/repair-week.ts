/**
 * Phase B — Stage 5: repair ONE weekly edition that came out short.
 *
 * Why this exists as a separate script instead of a change to ingest.ts:
 * ingestEdition() deliberately skips papers already in the DB, so a week that is
 * topped up later keeps the ranks and like counts from its FIRST run while the
 * newly added papers get ranks from the SECOND run's ordering. Two orderings in
 * one edition means duplicate ranks, and getPapersByWeek() sorts on rank.
 *
 * That only bites a week written twice with different candidate sets — which the
 * weekly cron never does: it fires right after a week closes with the "7 Days"
 * window, sees the whole week at once, and fills all 10 slots in a single pass.
 * So this is a repair tool for the few editions ingested before that was true
 * (and for the rare cron run that dies half way), not part of the normal path.
 *
 * What it does, on top of a normal ingest:
 *   1. summarize + insert the papers the edition is missing   (ingestEdition — unchanged)
 *   2. rewrite rank/likes/github_stars/picked_by for EVERY paper in the edition,
 *      so the whole week reflects one single ranking instead of two
 *
 * Dry run by default — prints the plan without touching the DB or waking Modal.
 * Add --apply to actually write.
 *
 *   npx tsx --env-file=.env.local phase-b/scripts/repair-week.ts --week 2026-07-20 --interval "30 Days"
 *   npx tsx --env-file=.env.local phase-b/scripts/repair-week.ts --week 2026-07-20 --interval "30 Days" --apply
 *
 * Pick the NARROWEST window that still covers the week: a wide window makes the
 * week compete against older papers with more accumulated likes and it loses
 * candidates (2026-07-20 had 35 candidates under "30 Days" but only 6 under "90 Days").
 */

import {
  fetchWeeklyEditions,
  BACKFILL_INTERVAL,
  type FeedInterval,
  type WeeklyEdition,
} from "@/lib/alphaxiv";
import { ingestEdition } from "@/lib/ingest";
import { supabaseAdmin } from "@/lib/supabase/server";

const VALID_INTERVALS: FeedInterval[] = ["3 Days", "7 Days", "30 Days", "90 Days"];

type DbRow = {
  id: string;
  rank: number | null;
  likes: number | null;
  github_stars: number | null;
  picked_by: string | null;
};

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

function parseInterval(): FeedInterval {
  const raw = argValue("--interval");
  if (!raw) return BACKFILL_INTERVAL;
  if (!VALID_INTERVALS.includes(raw as FeedInterval)) {
    throw new Error(`--interval must be one of: ${VALID_INTERVALS.join(", ")}`);
  }
  return raw as FeedInterval;
}

async function rowsForWeek(week: string): Promise<DbRow[]> {
  const { data, error } = await supabaseAdmin
    .from("papers")
    .select("id, rank, likes, github_stars, picked_by")
    .eq("week_start", week)
    .order("rank", { ascending: true });
  if (error) throw new Error(`supabase select: ${error.message}`);
  return (data ?? []) as DbRow[];
}

/** Side-by-side of what's in the DB now vs what this edition says it should be. */
function printPlan(edition: WeeklyEdition, before: DbRow[]): void {
  const byId = new Map(before.map((r) => [r.id, r]));

  console.log(`  id           | rank        | likes         | สถานะ`);
  console.log(`  -------------|-------------|---------------|------------------`);
  for (const p of edition.papers) {
    const old = byId.get(p.id);
    if (!old) {
      console.log(
        `  ${p.id.padEnd(12)} |    → ${String(p.rank).padStart(2)}     |     → ${String(p.likes).padStart(4)}    | 🆕 สรุปใหม่ + insert`
      );
      continue;
    }
    const rankMoved = old.rank !== p.rank;
    const likesMoved = old.likes !== p.likes;
    const note = rankMoved || likesMoved ? "🔧 อัปเดต metadata" : "✅ ตรงอยู่แล้ว";
    console.log(
      `  ${p.id.padEnd(12)} | ${String(old.rank ?? "-").padStart(3)} → ${String(p.rank).padStart(2)}     | ` +
        `${String(old.likes ?? "-").padStart(5)} → ${String(p.likes).padStart(4)}   | ${note}`
    );
  }

  const editionIds = new Set(edition.papers.map((p) => p.id));
  const orphans = before.filter((r) => !editionIds.has(r.id));
  if (orphans.length > 0) {
    console.log(
      `\n  ⚠️  ${orphans.length} ใบอยู่ใน DB วีคนี้ แต่ไม่ติด top-10 รอบใหม่: ` +
        `${orphans.map((o) => `${o.id} (rank ${o.rank})`).join(", ")}`
    );
    console.log(
      `      สคริปต์นี้ไม่ลบให้ — rank เดิมจะค้างและอาจชนกับ rank ใหม่ ตัดสินใจเองว่าจะลบไหม`
    );
  }
}

/** Rewrite the weekly ranking metadata for every paper in the edition. */
async function reRank(edition: WeeklyEdition): Promise<{ updated: number; missing: string[] }> {
  let updated = 0;
  const missing: string[] = [];

  for (const p of edition.papers) {
    const { data, error } = await supabaseAdmin
      .from("papers")
      .update({
        week_start: p.weekStart,
        rank: p.rank,
        likes: p.likes,
        github_stars: p.githubStars,
        picked_by: p.pickedBy,
      })
      .eq("id", p.id)
      .select("id");
    if (error) throw new Error(`supabase update ${p.id}: ${error.message}`);
    if ((data ?? []).length === 0) missing.push(p.id); // never got inserted (summarize failed)
    else updated++;
  }

  return { updated, missing };
}

async function main() {
  const week = argValue("--week");
  if (!week) throw new Error(`ต้องระบุ --week YYYY-MM-DD (วันจันทร์ของสัปดาห์นั้น)`);
  const interval = parseInterval();
  const apply = process.argv.includes("--apply");

  const editions = await fetchWeeklyEditions(true, interval);
  const edition = editions.find((e) => e.weekStart === week);
  if (!edition) {
    console.log(
      `วีค ${week} ไม่มีใน window "${interval}" ` +
        `(วีคที่เห็น: ${editions.map((e) => e.weekStart).join(", ") || "ไม่มีเลย"})`
    );
    return;
  }

  const before = await rowsForWeek(week);
  console.log(
    `วีค ${week} · window "${interval}" · edition มี ${edition.papers.length} ใบ · ใน DB ตอนนี้ ${before.length} ใบ\n`
  );
  printPlan(edition, before);

  if (!apply) {
    console.log(`\n(dry run — ยังไม่แตะ DB) ใส่ --apply เพื่อเขียนจริง`);
    return;
  }

  console.log(`\n── 1/2 สรุป + insert ใบที่ยังไม่มี ──`);
  const r = await ingestEdition(edition);
  console.log(
    `   มีอยู่แล้ว ${r.alreadyInDb} · insert ${r.inserted.length} ` +
      `(ours ${r.bySummarizer.ours}, gemini ${r.bySummarizer.gemini}) · พลาด ${r.failed.length}`
  );
  for (const f of r.failed) console.log(`   ⚠️  ${f.id}: ${f.error}`);

  console.log(`\n── 2/2 เขียน rank/likes ใหม่ทั้ง edition ──`);
  const { updated, missing } = await reRank(edition);
  console.log(`   อัปเดต ${updated} ใบ` + (missing.length ? ` · ไม่พบใน DB: ${missing.join(", ")}` : ""));

  const after = await rowsForWeek(week);
  console.log(`\n── ผลลัพธ์: ${after.length} ใบ ──`);
  for (const row of after) {
    console.log(`   rank ${String(row.rank).padStart(2)} | ${row.id} | likes ${row.likes}`);
  }
  const ranks = after.map((x) => x.rank);
  const dupes = ranks.filter((x, i) => ranks.indexOf(x) !== i);
  console.log(
    dupes.length ? `\n   ⚠️  rank ยังซ้ำ: ${[...new Set(dupes)].join(", ")}` : `\n   ✅ rank ไม่ซ้ำ`
  );
}

main();
