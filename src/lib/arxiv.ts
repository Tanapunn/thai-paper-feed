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

export async function fetchLatestPapers(maxResults = 20): Promise<ArxivPaper[]> {
  const params = new URLSearchParams({
    search_query: "cat:cs.CL OR cat:cs.AI",
    sortBy: "submittedDate",
    sortOrder: "descending",
    max_results: String(maxResults),
  });

  const response = await fetch(`${ARXIV_API_URL}?${params.toString()}`, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!response.ok) {
    throw new Error(`arXiv API error: ${response.status} ${response.statusText}`);
  }

  const xml = await response.text();
  const parser = new XMLParser({ ignoreAttributes: false });
  const parsed = parser.parse(xml);

  const entries = toArray<RawEntry>(parsed?.feed?.entry);
  return entries.map(parseEntry);
}
