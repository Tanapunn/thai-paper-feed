import Link from "next/link";
import {
  formatMonth,
  formatWeekRange,
  isoWeek,
  weekStartToSlug,
} from "@/lib/week";

// Left-hand calendar nav (English chrome). Editions are grouped by month, newest
// first. The current, still-running week shows as a locked "Compiling…" row so
// readers know a new issue is on the way but not ready yet.

export function WeekCalendar({
  weeks,
  activeWeek,
  currentWeek,
}: {
  weeks: string[]; // weekStarts that have an edition, newest first
  activeWeek: string;
  currentWeek: string; // Monday of the in-progress week
}) {
  // Group editions by their month bucket, preserving newest-first order.
  const groups: { month: string; weeks: string[] }[] = [];
  for (const wk of weeks) {
    const month = formatMonth(wk);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.weeks.push(wk);
    else groups.push({ month, weeks: [wk] });
  }

  // Only show the "Compiling…" row when the current week isn't already published.
  const showCurrent = !weeks.includes(currentWeek);

  return (
    <nav aria-label="Weekly editions" className="text-sm">
      <p className="mb-3 px-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        Weekly Editions
      </p>

      {showCurrent && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-dashed border-zinc-300 px-3 py-2 text-zinc-400">
          <span className="font-medium">This week</span>
          <span className="text-xs">Compiling…</span>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <div key={group.month}>
            <p className="mb-1.5 px-1 text-xs font-semibold text-zinc-500">
              {group.month}
            </p>
            <ul className="flex flex-col gap-1">
              {group.weeks.map((wk) => {
                const { week } = isoWeek(wk);
                const active = wk === activeWeek;
                return (
                  <li key={wk}>
                    <Link
                      href={`/?week=${weekStartToSlug(wk)}`}
                      aria-current={active ? "page" : undefined}
                      className={
                        "flex items-center justify-between rounded-lg px-3 py-2 transition " +
                        (active
                          ? "bg-indigo-600 text-white"
                          : "text-zinc-600 hover:bg-zinc-100")
                      }
                    >
                      <span className="font-semibold">W{week}</span>
                      <span
                        className={
                          "text-xs " + (active ? "text-indigo-100" : "text-zinc-400")
                        }
                      >
                        {formatWeekRange(wk)}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
