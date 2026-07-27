import type { ArxivPaper } from "@/lib/arxiv";

// alphaXiv exposes an undocumented but public (no-auth) feed endpoint — the same
// one the alphaxiv CLI uses. We pull the community-curated trending list and pick
// the papers people actually voted up (likes) plus the ones whose attached repo
// has the most GitHub stars. That's our Stage-5 beta curation: let the community's
// taste do the selecting instead of "whatever is newest".
const ALPHAXIV_FEED_URL = "https://api.alphaxiv.org/papers/v3/feed";
const USER_AGENT = "ThaiPaperFeed/0.1 (beta; contact: tanapoom21130@gmail.com)";

// How many trending papers to scan, and how we split the final 10.
const FEED_PAGE_SIZE = 50; // yields ~43 real arXiv ids + ≥5 with GitHub stars
const FEED_INTERVAL = "30 Days"; // big enough pool, still recent
const TOP_BY_LIKES = 5;
const TOP_BY_STARS = 5;

// universal_paper_id is USUALLY the arXiv id but is sometimes a slug
// (e.g. "2607.language-model-harnesses") — keep only real arXiv ids.
const ARXIV_ID_RE = /^\d{4}\.\d{4,5}$/;

export type CuratedPaper = ArxivPaper & {
  likes: number;
  githubStars: number | null;
  pickedBy: "likes" | "stars";
};

type RawFeedPaper = {
  universal_paper_id?: string;
  title?: string;
  abstract?: string;
  publication_date?: string;
  authors?: string[];
  topics?: string[];
  github_stars?: number | null;
  metrics?: { public_total_votes?: number };
};

type RawFeedResponse = { papers?: RawFeedPaper[] };

function cleanText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

// Keep this paper's primary category on-project: first cs.* topic, else cs.AI.
function pickCategory(topics: string[] | undefined): string {
  const cs = (topics ?? []).find((t) => /^cs\./i.test(t));
  return cs ?? "cs.AI";
}

function isOnProject(topics: string[] | undefined): boolean {
  return (topics ?? []).some((t) => t === "cs.AI" || t === "cs.CL");
}

function toCurated(raw: RawFeedPaper, pickedBy: "likes" | "stars"): CuratedPaper {
  const id = raw.universal_paper_id as string;
  return {
    id,
    arxivUrl: `https://arxiv.org/abs/${id}`,
    pdfUrl: `https://arxiv.org/pdf/${id}`,
    titleEn: cleanText(raw.title),
    abstractEn: cleanText(raw.abstract),
    authors: (raw.authors ?? []).map(cleanText).filter(Boolean),
    category: pickCategory(raw.topics),
    publishedAt: raw.publication_date ?? "",
    likes: raw.metrics?.public_total_votes ?? 0,
    githubStars: raw.github_stars ?? null,
    pickedBy,
  };
}

/**
 * Fetch the alphaXiv trending feed and return up to 10 curated papers:
 * top 5 by community likes + top 5 by attached-repo GitHub stars, deduped by id
 * (likes take precedence). Papers with a slug id or outside cs.CL/cs.AI are dropped.
 */
export async function fetchCuratedPapers(): Promise<CuratedPaper[]> {
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
  const raw = (data.papers ?? []).filter(
    (p) => ARXIV_ID_RE.test(p.universal_paper_id ?? "") && isOnProject(p.topics)
  );

  // The feed is already sorted by likes descending, so the first N are the
  // most-liked. For stars we sort the same pool by github_stars (non-null).
  const byLikes = raw.slice(0, TOP_BY_LIKES).map((p) => toCurated(p, "likes"));

  const byStars = raw
    .filter((p) => typeof p.github_stars === "number" && p.github_stars > 0)
    .sort((a, b) => (b.github_stars as number) - (a.github_stars as number))
    .slice(0, TOP_BY_STARS)
    .map((p) => toCurated(p, "stars"));

  // Merge likes-first, dedupe by id. If overlap leaves < 10, backfill from the
  // remaining most-liked papers so we still return a full batch when possible.
  const seen = new Set<string>();
  const curated: CuratedPaper[] = [];
  for (const p of [...byLikes, ...byStars]) {
    if (seen.has(p.id)) continue;
    seen.add(p.id);
    curated.push(p);
  }
  if (curated.length < TOP_BY_LIKES + TOP_BY_STARS) {
    for (const p of raw) {
      if (curated.length >= TOP_BY_LIKES + TOP_BY_STARS) break;
      if (seen.has(p.universal_paper_id ?? "")) continue;
      seen.add(p.universal_paper_id as string);
      curated.push(toCurated(p, "likes"));
    }
  }

  return curated;
}
