import { supabase } from "@/lib/supabase/client";

export type Paper = {
  id: string;
  arxiv_url: string;
  pdf_url: string;
  title_en: string;
  abstract_en: string;
  authors: string[];
  category: string;
  published_at: string;
  title_th: string | null;
  summary_th: string | null;
  wow_point: string | null;
  tags: string[];
  created_at: string;
  // Phase B Stage 5 — weekly digest fields (null on Phase A rows)
  week_start: string | null; // ISO date (Monday) of the edition this paper belongs to
  rank: number | null;
  likes: number | null;
  github_stars: number | null;
  picked_by: "likes" | "stars" | null;
  summarizer: "ours" | "gemini" | null;
};

export async function getPapers(): Promise<Paper[]> {
  const { data, error } = await supabase
    .from("papers")
    .select("*")
    .order("published_at", { ascending: false });

  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getPaperById(id: string): Promise<Paper | null> {
  const { data, error } = await supabase
    .from("papers")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * The list of weekly editions that exist, newest first — one entry per distinct
 * week_start. Drives the calendar nav. (Postgres has no cheap DISTINCT via the JS
 * client, so we pull the week_start column and dedupe here; the set of weeks is tiny.)
 */
export async function getWeeks(): Promise<string[]> {
  const { data, error } = await supabase
    .from("papers")
    .select("week_start")
    .not("week_start", "is", null)
    .order("week_start", { ascending: false });

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  const weeks: string[] = [];
  for (const row of data ?? []) {
    const wk = row.week_start as string | null;
    if (wk && !seen.has(wk)) {
      seen.add(wk);
      weeks.push(wk);
    }
  }
  return weeks;
}

/** The papers in one weekly edition, ordered by rank (best first). */
export async function getPapersByWeek(weekStart: string): Promise<Paper[]> {
  const { data, error } = await supabase
    .from("papers")
    .select("*")
    .eq("week_start", weekStart)
    .order("rank", { ascending: true });

  if (error) throw new Error(error.message);
  return data ?? [];
}

/** The most recent weekly edition's week_start (null if none ingested yet). */
export async function getLatestWeek(): Promise<string | null> {
  const weeks = await getWeeks();
  return weeks[0] ?? null;
}
