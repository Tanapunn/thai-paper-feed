/**
 * Phase B — STAGE 1.1: bulk-generate Thai summary dataset for distillation.
 *
 * Reuses Phase A's arXiv fetcher (src/lib/arxiv.ts) and Gemini summarizer
 * (src/lib/gemini.ts) as-is — no duplicated fetch/summarize logic.
 *
 * Run (small test batch, per STAGE 1 plan — do NOT jump to --limit 500 yet):
 *   npx tsx --env-file=.env.local phase-b/scripts/bulk-generate-dataset.ts --limit 8
 *
 * Every run skips arxiv ids already present in any phase-b/data/*.jsonl file
 * (loaded up front), so re-running across days to top up toward 500 never
 * re-spends Gemini quota re-summarizing a paper we already have.
 *
 * Output:
 *   - phase-b/data/dataset_<timestamp>.jsonl — this run's rows (audit trail)
 *   - phase-b/data/merged_dataset.jsonl — all rows so far, deduped by id
 * This directory is gitignored (phase-b/data/*) so raw dataset files never get committed.
 */

import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fetchLatestPapers, type ArxivPaper } from "@/lib/arxiv";
import { summarizePaper, SYSTEM_PROMPT, buildUserPrompt, type GeminiSummary } from "@/lib/gemini";

const DELAY_BETWEEN_GEMINI_CALLS_MS = 4500; // ~13 RPM, under the 15 RPM quota
const MAX_REGEN_ATTEMPTS = 2; // 1 initial try + 1 re-gen on validation failure
const MAX_PAGES_PER_SIDE = 10; // safety cap on arXiv pagination when skipping dupes

const DATA_DIR = path.join(process.cwd(), "phase-b", "data");
const MERGED_FILE = path.join(DATA_DIR, "merged_dataset.jsonl");

type ChatMlRecord = {
  system: string;
  user: string;
  assistant: string;
};

type DatasetRow = {
  id: string;
  category: string;
  publishedAt: string;
  chatml: ChatMlRecord;
};

type FailedRow = {
  id: string;
  reason: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseLimitArg(argv: string[]): number {
  const flag = argv.find((a) => a.startsWith("--limit="));
  const value = flag ? Number(flag.split("=")[1]) : 8;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --limit value: ${flag}`);
  }
  return value;
}

/**
 * Validates the shape/content of a Gemini summary before it's accepted into the dataset.
 * There's no fixed controlled tag vocabulary in this project (see PROJECT_SPEC.md — tags
 * are freeform), so this only checks structural sanity, not against an allowlist.
 */
function validateSummary(summary: GeminiSummary): string | null {
  if (!summary.title_th?.trim()) return "title_th missing/empty";
  if (!summary.summary_th?.trim()) return "summary_th missing/empty";
  if (!summary.wow_point?.trim()) return "wow_point missing/empty";
  if (!Array.isArray(summary.tags) || summary.tags.length === 0 || summary.tags.length > 6) {
    return "tags missing/empty/too many (expected 1-6)";
  }
  if (summary.tags.some((t) => typeof t !== "string" || !t.trim())) {
    return "tags contains empty/non-string entry";
  }
  return null;
}

function readJsonlIds(filePath: string): string[] {
  if (!existsSync(filePath)) return [];
  const lines = readFileSync(filePath, "utf-8").trim().split("\n").filter(Boolean);
  return lines.map((line) => (JSON.parse(line) as DatasetRow).id);
}

/** Loads every arxiv id already collected in any previous run, so we never re-spend quota on it. */
function loadExistingIds(): Set<string> {
  if (!existsSync(DATA_DIR)) return new Set();
  const files = readdirSync(DATA_DIR).filter((f) => f.endsWith(".jsonl"));
  const ids = new Set<string>();
  for (const file of files) {
    for (const id of readJsonlIds(path.join(DATA_DIR, file))) {
      ids.add(id);
    }
  }
  return ids;
}

/**
 * Pages through arXiv (advancing `start` by `chunkSize` each page) collecting up to
 * `count` papers whose id isn't in `excludeIds`, mutating `excludeIds` as it goes so
 * the "new" and "old" halves of a single run never pick the same paper twice either.
 * Stops after MAX_PAGES_PER_SIDE pages even if short of `count` (arXiv exhausted/slow).
 */
async function fetchUniquePapers(
  count: number,
  excludeIds: Set<string>,
  startOffset: number
): Promise<ArxivPaper[]> {
  if (count <= 0) return [];
  const chunkSize = Math.max(count * 2, 20);
  const collected: ArxivPaper[] = [];
  let start = startOffset;

  for (let page = 0; page < MAX_PAGES_PER_SIDE && collected.length < count; page++) {
    const batch = await fetchLatestPapers(chunkSize, { start });
    if (batch.length === 0) break;

    for (const paper of batch) {
      if (excludeIds.has(paper.id)) continue;
      excludeIds.add(paper.id);
      collected.push(paper);
      if (collected.length >= count) break;
    }
    start += chunkSize;
  }

  return collected;
}

/**
 * Mix strategy for "ใหม่ + เก่าหลากหลาย": arXiv's API has no citation-count field, so
 * true "top-cited old papers" isn't available for free. As a pragmatic substitute, we
 * sample half from the newest submissions and half from a randomized older offset —
 * this gives topic/era variety without a real citation signal. Documented here so the
 * simplification is visible, not hidden.
 */
async function fetchMixedPapers(limit: number, excludeIds: Set<string>): Promise<ArxivPaper[]> {
  const newCount = Math.ceil(limit / 2);
  const oldCount = limit - newCount;

  const newest = await fetchUniquePapers(newCount, excludeIds, 0);

  const randomOffset = 200 + Math.floor(Math.random() * 3000);
  const older = await fetchUniquePapers(oldCount, excludeIds, randomOffset);

  return [...newest, ...older];
}

/** Rebuilds merged_dataset.jsonl from every dataset_*.jsonl run so far, deduped by id. */
function rewriteMergedFile(): number {
  const files = readdirSync(DATA_DIR).filter(
    (f) => f.startsWith("dataset_") && f.endsWith(".jsonl")
  );
  const byId = new Map<string, DatasetRow>();
  for (const file of files) {
    const lines = readFileSync(path.join(DATA_DIR, file), "utf-8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const row = JSON.parse(line) as DatasetRow;
      byId.set(row.id, row);
    }
  }
  const rows = Array.from(byId.values());
  writeFileSync(MERGED_FILE, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");
  return rows.length;
}

async function main() {
  const limit = parseLimitArg(process.argv.slice(2));

  const excludeIds = loadExistingIds();
  console.log(
    `[dataset] target: ${limit} new papers (mixed new + older), skipping ${excludeIds.size} already collected`
  );

  const papers = await fetchMixedPapers(limit, excludeIds);
  console.log(`[dataset] fetched ${papers.length} new unique papers to summarize`);
  if (papers.length < limit) {
    console.warn(
      `[dataset] warning: only found ${papers.length}/${limit} new papers within ${MAX_PAGES_PER_SIDE} pages per side`
    );
  }

  const rows: DatasetRow[] = [];
  const failed: FailedRow[] = [];

  for (let i = 0; i < papers.length; i++) {
    const paper = papers[i];
    console.log(`[dataset] (${i + 1}/${papers.length}) [${paper.id}] ${paper.titleEn.slice(0, 70)}`);

    let lastReason = "";
    let accepted: GeminiSummary | null = null;

    for (let attempt = 1; attempt <= MAX_REGEN_ATTEMPTS; attempt++) {
      try {
        const summary = await summarizePaper(paper.titleEn, paper.abstractEn);
        const validationError = validateSummary(summary);
        if (!validationError) {
          accepted = summary;
          break;
        }
        lastReason = validationError;
        console.warn(`[dataset]   validation failed (attempt ${attempt}): ${validationError}`);
      } catch (err) {
        lastReason = err instanceof Error ? err.message : String(err);
        console.error(`[dataset]   gemini call failed (attempt ${attempt}): ${lastReason}`);
      }
    }

    if (accepted) {
      rows.push({
        id: paper.id,
        category: paper.category,
        publishedAt: paper.publishedAt,
        chatml: {
          system: SYSTEM_PROMPT,
          user: buildUserPrompt(paper.titleEn, paper.abstractEn),
          assistant: JSON.stringify(accepted),
        },
      });
    } else {
      failed.push({ id: paper.id, reason: lastReason });
    }

    if (i < papers.length - 1) {
      await sleep(DELAY_BETWEEN_GEMINI_CALLS_MS);
    }
  }

  mkdirSync(DATA_DIR, { recursive: true });
  const outFile = path.join(DATA_DIR, `dataset_${Date.now()}.jsonl`);
  writeFileSync(outFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf-8");

  console.log(`\n[dataset] done: ${rows.length} accepted, ${failed.length} failed`);
  if (failed.length > 0) {
    console.log("[dataset] failed rows:", failed);
  }
  console.log(`[dataset] wrote ${rows.length} rows -> ${outFile}`);

  const totalMerged = rewriteMergedFile();
  console.log(`[dataset] merged_dataset.jsonl now has ${totalMerged} unique rows total`);

  console.log("\n[dataset] sample preview:");
  for (const row of rows.slice(0, 3)) {
    console.log(`\n--- [${row.id}] ---`);
    console.log(row.chatml.assistant);
  }
}

main().catch((err) => {
  console.error("[dataset] fatal error:", err);
  process.exit(1);
});
