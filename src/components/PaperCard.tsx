import Link from "next/link";
import type { Paper } from "@/lib/papers";

// Card content stays Thai (Phase A style the user likes): title_th, summary_th,
// 💡 wow_point, tags. We only add neutral meta around it — rank, category,
// community likes/stars, publication date.

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function PaperCard({ paper }: { paper: Paper }) {
  const hasStars = paper.github_stars != null && paper.github_stars > 0;

  return (
    <Link
      href={`/paper/${paper.id}`}
      className="block rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:shadow-md sm:p-5"
    >
      {/* Meta row: rank · category · community signals */}
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
        {paper.rank != null && (
          <span className="font-mono font-semibold text-zinc-400">
            #{String(paper.rank).padStart(2, "0")}
          </span>
        )}
        {paper.category && (
          <span className="rounded-full bg-indigo-50 px-2.5 py-0.5 font-medium text-indigo-700">
            {paper.category}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-zinc-500">
          {paper.likes != null && <span>🔥 {paper.likes}</span>}
          {hasStars && (
            <span className={paper.picked_by === "stars" ? "text-amber-600" : ""}>
              ★ {paper.github_stars}
            </span>
          )}
        </span>
      </div>

      <h2 className="text-lg font-bold leading-snug text-zinc-900 break-words">
        {paper.title_th ?? paper.title_en}
      </h2>

      {paper.summary_th && (
        <p className="mt-2 text-sm leading-relaxed text-zinc-600 break-words">
          {paper.summary_th}
        </p>
      )}

      {paper.wow_point && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 break-words">
          💡 {paper.wow_point}
        </p>
      )}

      {paper.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {paper.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs text-zinc-600"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex items-center justify-between text-sm">
        {paper.published_at && (
          <span className="text-xs text-zinc-400">{formatDate(paper.published_at)}</span>
        )}
        <span className="font-semibold text-indigo-600">อ่านต่อ →</span>
      </div>
    </Link>
  );
}
