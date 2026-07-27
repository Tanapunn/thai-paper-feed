import type { ArxivPaper } from "@/lib/arxiv";

// alphaXiv exposes an undocumented but public (no-auth) feed endpoint — the same
// one the alphaxiv CLI uses. We pull the community-curated trending list, bucket
// papers by the week they were first published, and keep each week's top ~10 by
// community likes. That's our Stage-5 "weekly digest" curation: each finished week
// becomes an issue of the best papers, chosen by the crowd's votes.
const ALPHAXIV_FEED_URL = "https://api.alphaxiv.org/papers/v3/feed";
const USER_AGENT = "ThaiPaperFeed/0.1 (beta; contact: tanapoom21130@gmail.com)";

// One wide pull (top-200 most-liked over 90 days) covers ~13 weeks — enough to
// backfill the ~8 recent weeks that have solid data.
const FEED_PAGE_SIZE = 200;
const FEED_INTERVAL = "90 Days";
const WEEKLY_TOP_N = 10;
// A repo needs a meaningful star count before we flag the paper as "code-notable"
// rather than merely liked. Used only for the display hint `pickedBy`.
const STARS_HIGHLIGHT_MIN = 100;

// universal_paper_id is USUALLY the arXiv id but is sometimes a slug
// (e.g. "2607.language-model-harnesses") — keep only real arXiv ids.
const ARXIV_ID_RE = /^\d{4}\.\d{4,5}$/;

// arXiv categories we consider "AI-adjacent" and want in the feed. Broadened from
// just cs.CL/cs.AI so weeks reliably fill to 10 and cover more of the AI landscape.
const AI_CATS = new Set([
  "cs.CL",
  "cs.AI",
  "cs.LG",
  "cs.CV",
  "cs.RO",
  "cs.SE",
  "cs.IR",
  "cs.MA",
  "cs.NE",
  "stat.ML",
]);

// arXiv code -> reader-friendly Thai/English category shown on cards. Order matters:
// the most specific category wins, cs.AI is the catch-all checked last.
const CATEGORY_PRIORITY: [string, string][] = [
  ["cs.RO", "🤖 Robotics"],
  ["cs.CV", "👁️ Vision"],
  ["cs.SE", "💻 Software"],
  ["cs.IR", "🔍 Search & RAG"],
  ["cs.MA", "🕸️ Multi-agent"],
  ["cs.NE", "🧬 Neural nets"],
  ["cs.CL", "💬 LLM & NLP"],
  ["cs.LG", "📈 Machine Learning"],
  ["stat.ML", "📊 ML Stats"],
  ["cs.DB", "🗄️ Data"],
  ["cs.CY", "🌐 AI & Society"],
  ["cs.AI", "🧠 AI ทั่วไป"],
];

export type CuratedPaper = ArxivPaper & {
  weekStart: string; // ISO date (Monday) of the paper's publication week
  rank: number; // 1-based position within its weekly edition (by likes)
  category: string; // friendly category label
  likes: number;
  githubStars: number | null;
  pickedBy: "likes" | "stars";
};

export type WeeklyEdition = {
  weekStart: string; // ISO date, Monday
  papers: CuratedPaper[];
};

type RawFeedPaper = {
  universal_paper_id?: string;
  title?: string;
  abstract?: string;
  first_publication_date?: string;
  authors?: string[];
  topics?: string[];
  github_stars?: number | null;
  metrics?: { public_total_votes?: number };
};

type RawFeedResponse = { papers?: RawFeedPaper[] };

function cleanText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function pickCategory(topics: string[] | undefined): string {
  const set = new Set(topics ?? []);
  for (const [code, label] of CATEGORY_PRIORITY) {
    if (set.has(code)) return label;
  }
  return "🧠 AI ทั่วไป";
}

function isOnProject(topics: string[] | undefined): boolean {
  return (topics ?? []).some((t) => AI_CATS.has(t));
}

// ISO date (YYYY-MM-DD) of the Monday that starts the given date's week. UTC to
// avoid the server's timezone shifting a paper into the wrong week.
export function weekStartOf(isoDateTime: string): string {
  const d = new Date(isoDateTime);
  const mondayOffset = (d.getUTCDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0, ...
  const monday = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - mondayOffset)
  );
  return monday.toISOString().slice(0, 10);
}

// A week is "complete" once its Sunday has fully passed (i.e. we're into the next
// Monday or later). We only publish complete weeks so papers have had time to
// accumulate votes.
export function isWeekComplete(weekStart: string, now: Date = new Date()): boolean {
  const [y, m, d] = weekStart.split("-").map(Number);
  const nextMonday = Date.UTC(y, m - 1, d + 7); // start of the following week
  return now.getTime() >= nextMonday;
}

function toCurated(raw: RawFeedPaper, weekStart: string, rank: number): CuratedPaper {
  const id = raw.universal_paper_id as string;
  const stars = raw.github_stars ?? null;
  return {
    id,
    arxivUrl: `https://arxiv.org/abs/${id}`,
    pdfUrl: `https://arxiv.org/pdf/${id}`,
    titleEn: cleanText(raw.title),
    abstractEn: cleanText(raw.abstract),
    authors: (raw.authors ?? []).map(cleanText).filter(Boolean),
    category: pickCategory(raw.topics),
    publishedAt: raw.first_publication_date ?? "",
    weekStart,
    rank,
    likes: raw.metrics?.public_total_votes ?? 0,
    githubStars: stars,
    pickedBy: stars != null && stars >= STARS_HIGHLIGHT_MIN ? "stars" : "likes",
  };
}

/**
 * Fetch the alphaXiv trending feed and group it into weekly editions. Each edition
 * holds up to WEEKLY_TOP_N papers, ranked by community likes, for papers first
 * published in that (Monday-started) week. Slug ids and non-AI categories are
 * dropped. Returned newest week first; `onlyComplete` (default) hides the current,
 * still-running week.
 */
export async function fetchWeeklyEditions(onlyComplete = true): Promise<WeeklyEdition[]> {
  const params = new URLSearchParams({
    pageNum: "0",
    pageSize: String(FEED_PAGE_SIZE),
    sort: "Likes",
    interval: FEED_INTERVAL,
  });

  const response = await fetch(`${ALPHAXIV_FEED_URL}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`alphaXiv feed error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as RawFeedResponse;

  // Bucket qualifying papers by publication week.
  const buckets = new Map<string, RawFeedPaper[]>();
  for (const p of data.papers ?? []) {
    if (!ARXIV_ID_RE.test(p.universal_paper_id ?? "")) continue;
    if (!isOnProject(p.topics)) continue;
    if (!p.first_publication_date) continue;
    const wk = weekStartOf(p.first_publication_date);
    const arr = buckets.get(wk) ?? [];
    arr.push(p);
    buckets.set(wk, arr);
  }

  const votes = (p: RawFeedPaper) => p.metrics?.public_total_votes ?? 0;

  const editions: WeeklyEdition[] = [];
  for (const [weekStart, raws] of buckets) {
    if (onlyComplete && !isWeekComplete(weekStart)) continue;
    const top = raws
      .sort((a, b) => votes(b) - votes(a))
      .slice(0, WEEKLY_TOP_N)
      .map((p, i) => toCurated(p, weekStart, i + 1));
    editions.push({ weekStart, papers: top });
  }

  editions.sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1)); // newest first
  return editions;
}

/** Convenience: the single most recent complete weekly edition (or null). */
export async function fetchLatestEdition(): Promise<WeeklyEdition | null> {
  const editions = await fetchWeeklyEditions(true);
  return editions[0] ?? null;
}
