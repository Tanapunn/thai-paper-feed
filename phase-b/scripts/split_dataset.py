"""
Phase B - Stage 1.3: shuffle + split the merged dataset into train/test ChatML files.

Reads phase-b/data/merged_dataset.jsonl (rows already contain a `chatml`
{system, user, assistant} object - see bulk-generate-dataset.ts) and writes:
  - phase-b/data/train.jsonl (~85%)
  - phase-b/data/test.jsonl  (~15%, held out - do not touch until eval)

Each output line is exactly the {system, user, assistant} object per
docs/PHASE_B_EXECUTION_PLAN.md STAGE 1.3, so it's what
`tokenizer.apply_chat_template()` expects on OpenThaiGPT. `id` is kept
alongside for traceability (harmless extra key, ignored by the chat template).

Run:
    python phase-b/scripts/split_dataset.py
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "phase-b" / "data"
MERGED_FILE = DATA_DIR / "merged_dataset.jsonl"
TRAIN_FILE = DATA_DIR / "train.jsonl"
TEST_FILE = DATA_DIR / "test.jsonl"

TEST_FRACTION = 0.15
SEED = 42  # fixed so the split is reproducible across reruns


def load_rows(path: Path) -> list[dict]:
    rows = []
    with path.open("r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def write_jsonl(path: Path, rows: list[dict]) -> None:
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--test-fraction", type=float, default=TEST_FRACTION)
    parser.add_argument("--seed", type=int, default=SEED)
    args = parser.parse_args()

    if TRAIN_FILE.exists() or TEST_FILE.exists():
        raise SystemExit(
            f"Refusing to overwrite existing {TRAIN_FILE.name}/{TEST_FILE.name}. "
            "Delete them first if you intend to re-split (this would invalidate any "
            "eval already run against the current test.jsonl)."
        )

    rows = load_rows(MERGED_FILE)
    print(f"[split] loaded {len(rows)} rows from {MERGED_FILE.name}")

    records = [
        {
            "id": row["id"],
            "system": row["chatml"]["system"],
            "user": row["chatml"]["user"],
            "assistant": row["chatml"]["assistant"],
        }
        for row in rows
    ]

    rng = random.Random(args.seed)
    rng.shuffle(records)

    n_test = round(len(records) * args.test_fraction)
    test_records = records[:n_test]
    train_records = records[n_test:]

    write_jsonl(TRAIN_FILE, train_records)
    write_jsonl(TEST_FILE, test_records)

    print(f"[split] seed={args.seed}, test_fraction={args.test_fraction}")
    print(f"[split] train: {len(train_records)} rows -> {TRAIN_FILE}")
    print(f"[split] test:  {len(test_records)} rows -> {TEST_FILE}")


if __name__ == "__main__":
    main()
