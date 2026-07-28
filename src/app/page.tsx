import { getWeeks, getPapersByWeek } from "@/lib/papers";
import { PaperCard } from "@/components/PaperCard";
import { WeekCalendar } from "@/components/WeekCalendar";
import {
  currentWeekStart,
  formatWeekRange,
  isoWeek,
  slugToWeekStart,
} from "@/lib/week";

export const dynamic = "force-dynamic";

// Weekly digest home. `?week=2026-w29` selects an edition; no param shows the
// latest. Chrome (header, calendar, footer) is English; the cards stay Thai.
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week: weekParam } = await searchParams;
  const weeks = await getWeeks(); // weekStarts, newest first

  if (weeks.length === 0) {
    return (
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-16 text-center">
        <h1 className="text-2xl font-bold text-zinc-900">Paper Week</h1>
        <p className="mt-3 text-zinc-500">No editions yet. Check back soon.</p>
      </main>
    );
  }

  // Resolve which edition to show: the requested week if it exists, else latest.
  const requested = weekParam ? slugToWeekStart(weekParam) : null;
  const activeWeek =
    requested && weeks.includes(requested) ? requested : weeks[0];
  const isLatest = activeWeek === weeks[0];

  const papers = await getPapersByWeek(activeWeek);
  const { week: weekNo } = isoWeek(activeWeek);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-6 sm:py-10 md:flex-row">
      {/* Calendar nav */}
      <aside className="md:w-60 md:shrink-0">
        <WeekCalendar
          weeks={weeks}
          activeWeek={activeWeek}
          currentWeek={currentWeekStart()}
        />
      </aside>

      {/* Edition */}
      <main className="min-w-0 flex-1">
        <header className="mb-6 border-b border-zinc-200 pb-4">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
              Week {weekNo}
            </span>
            {isLatest && (
              <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-xs font-medium text-white">
                Latest
              </span>
            )}
          </div>
          <h1 className="mt-1 text-2xl font-bold text-zinc-900">Weekly Edition</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {formatWeekRange(activeWeek)} · {papers.length} papers
          </p>
        </header>

        {papers.length === 0 ? (
          <p className="text-center text-zinc-500">No papers in this edition.</p>
        ) : (
          <ul className="flex flex-col gap-4">
            {papers.map((paper) => (
              <li key={paper.id}>
                <PaperCard paper={paper} />
              </li>
            ))}
          </ul>
        )}

        <footer className="mt-10 border-t border-zinc-200 pt-4 text-center text-xs text-zinc-400">
          powered by our own model · th
        </footer>
      </main>
    </div>
  );
}
