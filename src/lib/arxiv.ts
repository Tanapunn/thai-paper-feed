import { XMLParser } from "fast-xml-parser";

const ARXIV_API_URL = "https://export.arxiv.org/api/query";
const USER_AGENT = "ThaiPaperFeed/0.1 (beta; contact: tanapoom21130@gmail.com)";

export type ArxivPaper = {
  id: string;
  arxivUrl: string;
  pdfUrl: string;
  titleEn: string;
  abstractEn: string;
  authors: string[];
  category: string;
  publishedAt: string;
};

type RawLink = { "@_href"?: string; "@_rel"?: string; "@_title"?: string };
type RawAuthor = { name?: string };
type RawEntry = {
  id?: string;
  title?: string;
  summary?: string;
  published?: string;
  author?: RawAuthor | RawAuthor[];
  link?: RawLink | RawLink[];
  "arxiv:primary_category"?: { "@_term"?: string };
};

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function extractArxivId(rawId: string): string {
  // rawId looks like "http://arxiv.org/abs/2607.01234v1"
  const withoutPrefix = rawId.replace(/^https?:\/\/arxiv\.org\/abs\//, "");
  return withoutPrefix.replace(/v\d+$/, "");
}

function cleanText(text: string | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function parseEntry(entry: RawEntry): ArxivPaper {
  const id = extractArxivId(entry.id ?? "");
  const links = toArray(entry.link);
  const pdfLink = links.find((l) => l["@_title"] === "pdf");

  return {
    id,
    arxivUrl: `https://arxiv.org/abs/${id}`,
    pdfUrl: pdfLink?.["@_href"] ?? `https://arxiv.org/pdf/${id}`,
    titleEn: cleanText(entry.title),
    abstractEn: cleanText(entry.summary),
    authors: toArray(entry.author).map((a) => cleanText(a.name)),
    category: entry["arxiv:primary_category"]?.["@_term"] ?? "",
    publishedAt: entry.published ?? "",
  };
}

export type FetchPapersOptions = {
  start?: number;
  sortBy?: "submittedDate" | "relevance" | "lastUpdatedDate";
  sortOrder?: "ascending" | "descending";
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchLatestPapers(
  maxResults = 20,
  options: FetchPapersOptions = {}
): Promise<ArxivPaper[]> {
  const { start = 0, sortBy = "submittedDate", sortOrder = "descending" } = options;

  const params = new URLSearchParams({
    search_query: "cat:cs.CL OR cat:cs.AI",
    sortBy,
    sortOrder,
    start: String(start),
    max_results: String(maxResults),
  });

  // arXiv returns 503 when it's busy / asking us to slow down. Retry a few times
  // with backoff before giving up — a single 503 is almost always transient.
  const maxRetries = 3;
  let response: Response | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    response = await fetch(`${ARXIV_API_URL}?${params.toString()}`, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (response.ok) break;
    const retryable = response.status === 503 || response.status >= 500 || response.status === 429;
    if (!retryable || attempt === maxRetries) {
      throw new Error(`arXiv API error: ${response.status} ${response.statusText}`);
    }
    const backoffMs = 2 ** attempt * 1500; // 1.5s, 3s, 6s
    console.warn(
      `[arxiv] ${response.status}, retrying in ${backoffMs}ms (attempt ${attempt + 1}/${maxRetries})`
    );
    await sleep(backoffMs);
  }

  const xml = await response!.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);

  const entries = toArray<RawEntry>(parsed?.feed?.entry);
  return entries.map(parseEntry);
}
