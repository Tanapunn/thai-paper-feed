"""
Phase B - Stage 1.2: Exploratory Data Analysis for the Thai paper-summary dataset.

Reads phase-b/data/merged_dataset.jsonl (one JSON object per line, produced by
bulk-generate-dataset.ts) and reports on the checks recommended for LLM
fine-tuning datasets:
  - schema / missing-field / malformed-JSON checks
  - duplicate-id checks
  - text length distributions (chars + words) per field
  - tag frequency / tag-count-per-row distribution
  - word frequency in summary_th (Thai-tokenized, stopwords removed)
  - category and publish-date distribution
  - Thai-content ratio per field (catches English-leakage / bad Gemini output)
  - exact + near-duplicate summary detection (TF-IDF cosine similarity)
  - a random qualitative sample to read in the terminal

References (checklist this script is based on):
  - "Mastering EDA: A Complete Guide for Every Data Type" (Medium, Ebad Sayed)
    https://medium.com/@sayedebad.777/mastering-eda-a-complete-guide-for-every-data-type-tabular-text-image-time-series-audio-b69ecf9113ac
  - Databricks, "A Practical Guide to LLM Fine Tuning"
    https://www.databricks.com/blog/llm-fine-tuning
  - DigitalOcean, "How to Create Data for Fine-Tuning LLMs"
    https://www.digitalocean.com/community/tutorials/how-to-create-llm-finetuning-dataset
  (duplicate/near-duplicate detection via hashing + TF-IDF cosine similarity,
   text-length histograms, and topic/category balance checks are all called
   out explicitly in the above as standard fine-tuning EDA steps)

Run:
    python phase-b/scripts/eda.py
Or, to point at a different file:
    python phase-b/scripts/eda.py --file phase-b/data/dataset_123.jsonl

Outputs:
  - console report
  - phase-b/data/eda_output/report.md   (same report, saved)
  - phase-b/data/eda_output/*.png       (charts)
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
from collections import Counter
from pathlib import Path

# Windows consoles default to cp1252, which can't print Thai text - force utf-8.
if sys.stdout.encoding is None or sys.stdout.encoding.lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

import matplotlib
matplotlib.use("Agg")  # no display needed, just save PNGs
import matplotlib.pyplot as plt
import pandas as pd
from pythainlp.corpus import thai_stopwords
from pythainlp.tokenize import word_tokenize
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FILE = ROOT / "phase-b" / "data" / "merged_dataset.jsonl"
OUT_DIR = ROOT / "phase-b" / "data" / "eda_output"

THAI_CHAR_RE = re.compile(r"[฀-๿]")
THAI_STOPWORDS = thai_stopwords()


def load_rows(path: Path) -> tuple[list[dict], list[tuple[int, str]]]:
    """Returns (parsed_rows, parse_errors[(line_no, raw_line)])."""
    rows, errors = [], []
    with path.open("r", encoding="utf-8") as f:
        for i, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                rows.append(json.loads(line))
            except json.JSONDecodeError:
                errors.append((i, line[:200]))
    return rows, errors


def build_dataframe(rows: list[dict]) -> tuple[pd.DataFrame, list[dict]]:
    """Flattens rows into a DataFrame; rows whose chatml.assistant isn't valid
    JSON (i.e. Gemini output itself was malformed) are collected separately."""
    records, malformed = [], []
    for row in rows:
        try:
            assistant = json.loads(row["chatml"]["assistant"])
        except (KeyError, json.JSONDecodeError, TypeError) as e:
            malformed.append({"id": row.get("id"), "error": str(e)})
            continue
        records.append(
            {
                "id": row.get("id"),
                "category": row.get("category"),
                "publishedAt": row.get("publishedAt"),
                "title_th": assistant.get("title_th", ""),
                "summary_th": assistant.get("summary_th", ""),
                "wow_point": assistant.get("wow_point", ""),
                "tags": assistant.get("tags", []),
            }
        )
    df = pd.DataFrame.from_records(records)
    if not df.empty:
        df["publishedAt"] = pd.to_datetime(df["publishedAt"], errors="coerce")
    return df, malformed


def thai_ratio(text: str) -> float:
    if not text:
        return 0.0
    thai_chars = len(THAI_CHAR_RE.findall(text))
    total_chars = len(re.sub(r"\s", "", text))
    return thai_chars / total_chars if total_chars else 0.0


def top_words(texts: list[str], top_n: int = 30) -> list[tuple[str, int]]:
    """Word-frequency count across texts, tokenized with pythainlp and with
    Thai + whitespace/punctuation stopwords removed."""
    counts: Counter[str] = Counter()
    for text in texts:
        for word in word_tokenize(text, engine="newmm"):
            word = word.strip()
            if not word or word in THAI_STOPWORDS:
                continue
            if not THAI_CHAR_RE.search(word):
                continue  # drop punctuation / numbers / stray latin tokens
            counts[word] += 1
    return counts.most_common(top_n)


def find_near_duplicates(df: pd.DataFrame, threshold: float = 0.85, top_n: int = 20):
    """TF-IDF cosine similarity over summary_th to catch near-duplicate summaries
    (e.g. Gemini producing near-identical text for two different papers)."""
    texts = df["summary_th"].fillna("").tolist()
    if len(texts) < 2:
        return []
    vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), min_df=1)
    matrix = vectorizer.fit_transform(texts)
    sims = cosine_similarity(matrix)

    pairs = []
    n = len(texts)
    for i in range(n):
        for j in range(i + 1, n):
            if sims[i, j] >= threshold:
                pairs.append((df.iloc[i]["id"], df.iloc[j]["id"], float(sims[i, j])))
    pairs.sort(key=lambda p: -p[2])
    return pairs[:top_n]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", type=str, default=str(DEFAULT_FILE))
    parser.add_argument("--sample-size", type=int, default=5)
    parser.add_argument("--near-dup-threshold", type=float, default=0.85)
    args = parser.parse_args()

    data_path = Path(args.file)
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    report_lines: list[str] = []

    def emit(line: str = ""):
        print(line)
        report_lines.append(line)

    emit(f"# EDA report — {data_path.name}\n")

    raw_rows, parse_errors = load_rows(data_path)
    emit(f"- raw lines read: {len(raw_rows) + len(parse_errors)}")
    emit(f"- lines that failed JSON parsing: {len(parse_errors)}")
    for line_no, snippet in parse_errors[:10]:
        emit(f"  - line {line_no}: {snippet}")

    df, malformed_assistant = build_dataframe(raw_rows)
    emit(f"- rows with malformed `chatml.assistant` (bad Gemini JSON): {len(malformed_assistant)}")
    for m in malformed_assistant[:10]:
        emit(f"  - id={m['id']}: {m['error']}")

    if df.empty:
        emit("\nNo valid rows parsed — stopping here.")
        (OUT_DIR / "report.md").write_text("\n".join(report_lines), encoding="utf-8")
        return

    emit(f"\n## Overview")
    emit(f"- total usable rows: {len(df)}")
    emit(f"- columns: {list(df.columns)}")

    # --- missing / empty field check ---
    emit(f"\n## Missing / empty fields")
    for col in ["title_th", "summary_th", "wow_point"]:
        n_empty = (df[col].fillna("").str.strip() == "").sum()
        emit(f"- {col}: {n_empty} empty ({n_empty / len(df):.1%})")
    n_no_tags = (df["tags"].apply(lambda t: not isinstance(t, list) or len(t) == 0)).sum()
    emit(f"- tags: {n_no_tags} empty ({n_no_tags / len(df):.1%})")

    # --- duplicate id check ---
    emit(f"\n## Duplicate ids")
    dup_ids = df["id"][df["id"].duplicated()].unique().tolist()
    emit(f"- duplicate ids: {len(dup_ids)}")
    if dup_ids:
        emit(f"  - examples: {dup_ids[:10]}")

    # --- text length distributions ---
    emit(f"\n## Text length distributions (characters)")
    fig, axes = plt.subplots(1, 3, figsize=(15, 4))
    for ax, col in zip(axes, ["title_th", "summary_th", "wow_point"]):
        lengths = df[col].fillna("").str.len()
        emit(
            f"- {col}: mean={lengths.mean():.0f}, median={lengths.median():.0f}, "
            f"p10={lengths.quantile(0.1):.0f}, p90={lengths.quantile(0.9):.0f}, "
            f"min={lengths.min()}, max={lengths.max()}"
        )
        ax.hist(lengths, bins=30, color="#4C72B0")
        ax.set_title(f"{col} length (chars)")
        ax.set_xlabel("characters")
    fig.tight_layout()
    fig.savefig(OUT_DIR / "text_length_hist.png", dpi=120)
    plt.close(fig)
    emit(f"  -> saved chart: eda_output/text_length_hist.png")

    # --- Thai-content ratio (catches English-leakage / bad rows) ---
    emit(f"\n## Thai-character ratio per field (low ratio = possible English leakage)")
    for col in ["title_th", "summary_th", "wow_point"]:
        ratios = df[col].fillna("").apply(thai_ratio)
        low = (ratios < 0.5).sum()
        emit(f"- {col}: mean ratio={ratios.mean():.2f}, rows with ratio<0.5: {low} ({low / len(df):.1%})")
        if low > 0:
            worst = df.loc[ratios.sort_values().index[:5], ["id", col]]
            for _, r in worst.iterrows():
                emit(f"    - id={r['id']}: {r[col][:80]!r}")

    # --- tags ---
    emit(f"\n## Tags")
    tag_counts_per_row = df["tags"].apply(lambda t: len(t) if isinstance(t, list) else 0)
    emit(f"- tags per row: mean={tag_counts_per_row.mean():.2f}, min={tag_counts_per_row.min()}, max={tag_counts_per_row.max()}")
    all_tags = Counter(t for tags in df["tags"] if isinstance(tags, list) for t in tags)
    emit(f"- unique tags: {len(all_tags)}")
    emit(f"- top 20 tags:")
    for tag, count in all_tags.most_common(20):
        emit(f"    - {tag}: {count}")

    fig, ax = plt.subplots(figsize=(8, 6))
    top_tags = all_tags.most_common(20)
    ax.barh([t for t, _ in top_tags][::-1], [c for _, c in top_tags][::-1], color="#55A868")
    ax.set_title("Top 20 tags")
    fig.tight_layout()
    fig.savefig(OUT_DIR / "top_tags.png", dpi=120)
    plt.close(fig)
    emit(f"  -> saved chart: eda_output/top_tags.png")

    # --- word frequency (summary_th, stopwords removed) ---
    emit(f"\n## Top words in summary_th (Thai stopwords removed)")
    word_counts = top_words(df["summary_th"].fillna("").tolist(), top_n=30)
    for word, count in word_counts:
        emit(f"    - {word}: {count}")

    if word_counts:
        fig, ax = plt.subplots(figsize=(8, 8))
        ax.barh([w for w, _ in word_counts][::-1], [c for _, c in word_counts][::-1], color="#937860")
        ax.set_title("Top words in summary_th (stopwords removed)")
        fig.tight_layout()
        fig.savefig(OUT_DIR / "top_words.png", dpi=120)
        plt.close(fig)
        emit(f"  -> saved chart: eda_output/top_words.png")

    # --- category distribution ---
    emit(f"\n## Category distribution")
    cat_counts = df["category"].value_counts()
    for cat, count in cat_counts.items():
        emit(f"- {cat}: {count} ({count / len(df):.1%})")

    fig, ax = plt.subplots(figsize=(6, 4))
    cat_counts.plot(kind="bar", ax=ax, color="#C44E52")
    ax.set_title("Category distribution")
    fig.tight_layout()
    fig.savefig(OUT_DIR / "category_distribution.png", dpi=120)
    plt.close(fig)
    emit(f"  -> saved chart: eda_output/category_distribution.png")

    # --- published date distribution ---
    emit(f"\n## Published date range")
    valid_dates = df["publishedAt"].dropna()
    if not valid_dates.empty:
        emit(f"- earliest: {valid_dates.min().date()}, latest: {valid_dates.max().date()}")
        by_month = valid_dates.dt.to_period("M").value_counts().sort_index()
        fig, ax = plt.subplots(figsize=(10, 4))
        by_month.plot(kind="bar", ax=ax, color="#8172B2")
        ax.set_title("Papers by publish month")
        fig.tight_layout()
        fig.savefig(OUT_DIR / "published_by_month.png", dpi=120)
        plt.close(fig)
        emit(f"  -> saved chart: eda_output/published_by_month.png")
    n_missing_date = df["publishedAt"].isna().sum()
    if n_missing_date:
        emit(f"- rows with unparseable/missing publishedAt: {n_missing_date}")

    # --- exact + near-duplicate summaries ---
    emit(f"\n## Exact duplicate summaries")
    exact_dup_mask = df["summary_th"].duplicated(keep=False) & (df["summary_th"].fillna("") != "")
    exact_dups = df[exact_dup_mask]
    emit(f"- rows sharing an identical summary_th with another row: {len(exact_dups)}")
    if len(exact_dups) > 0:
        for summary, group in exact_dups.groupby("summary_th"):
            emit(f"  - ids {group['id'].tolist()}: {summary[:80]!r}")

    emit(f"\n## Near-duplicate summaries (TF-IDF cosine similarity >= {args.near_dup_threshold})")
    near_dups = find_near_duplicates(df, threshold=args.near_dup_threshold)
    emit(f"- near-duplicate pairs found: {len(near_dups)}")
    for id_a, id_b, sim in near_dups[:20]:
        emit(f"  - {id_a} <-> {id_b}: similarity={sim:.3f}")

    # --- qualitative sample ---
    emit(f"\n## Random qualitative sample (n={args.sample_size})")
    sample = df.sample(n=min(args.sample_size, len(df)), random_state=42)
    for _, r in sample.iterrows():
        emit(f"\n--- [{r['id']}] ({r['category']}) ---")
        emit(f"title_th: {r['title_th']}")
        emit(f"summary_th: {r['summary_th']}")
        emit(f"wow_point: {r['wow_point']}")
        emit(f"tags: {r['tags']}")

    (OUT_DIR / "report.md").write_text("\n".join(report_lines), encoding="utf-8")
    emit(f"\nFull report saved to: {OUT_DIR / 'report.md'}")


if __name__ == "__main__":
    main()
