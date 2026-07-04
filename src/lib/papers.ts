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
