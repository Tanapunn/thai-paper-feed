create table if not exists papers (
  id text primary key,
  arxiv_url text not null,
  pdf_url text not null,
  title_en text not null,
  abstract_en text not null,
  authors text[] not null default '{}',
  category text not null,
  published_at timestamptz not null,
  title_th text,
  summary_th text,
  wow_point text,
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  -- Phase B Stage 5 — weekly digest fields (all nullable so Phase A rows stay valid)
  week_start date,          -- Monday (ISO) of the paper's publication week = its edition
  rank int,                 -- 1-based position within its weekly edition (by likes)
  likes int,                -- alphaXiv community likes at ingest time
  github_stars int,         -- repo stars at ingest time (null if no linked repo)
  picked_by text,           -- 'likes' | 'stars' — why it made the cut (display hint)
  summarizer text           -- 'ours' | 'gemini' — which model wrote the Thai card
);

create index if not exists papers_published_at_idx on papers (published_at desc);

alter table papers enable row level security;

do $$ begin
  create policy "Public read access"
    on papers for select
    using (true);
exception when duplicate_object then null;
end $$;

-- ── Phase B Stage 5 migration (safe to re-run on the already-deployed DB) ──
alter table papers add column if not exists week_start date;
alter table papers add column if not exists rank int;
alter table papers add column if not exists likes int;
alter table papers add column if not exists github_stars int;
alter table papers add column if not exists picked_by text;
alter table papers add column if not exists summarizer text;

-- Weekly pages read one edition at a time, ordered by rank.
create index if not exists papers_week_rank_idx on papers (week_start desc, rank asc);
