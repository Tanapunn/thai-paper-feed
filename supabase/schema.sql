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
  created_at timestamptz not null default now()
);

create index if not exists papers_published_at_idx on papers (published_at desc);

alter table papers enable row level security;

create policy "Public read access"
  on papers for select
  using (true);
