// Helpers to move between the DB's internal week key (weekStart = ISO Monday date,
// e.g. "2026-07-13") and the pretty URL slug the site uses (`2026-w29`, ISO
// week-year + week number), plus English labels for the chrome.

const DAY_MS = 24 * 60 * 60 * 1000;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function mondayOffset(d: Date): number {
  return (d.getUTCDay() + 6) % 7; // Sun=0 -> 6, Mon=1 -> 0, ...
}

/** ISO week-year + week number for a date. Uses the week's Thursday (ISO rule). */
export function isoWeek(isoDate: string): { year: number; week: number } {
  const [y, m, d] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Shift to the Thursday of this week — that determines both the week number
  // and (at year boundaries) the ISO week-year.
  date.setUTCDate(date.getUTCDate() - mondayOffset(date) + 3);
  const year = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(year, 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() - mondayOffset(firstThursday) + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
  return { year, week };
}

/** "2026-07-13" -> "2026-w29" */
export function weekStartToSlug(weekStart: string): string {
  const { year, week } = isoWeek(weekStart);
  return `${year}-w${String(week).padStart(2, "0")}`;
}

/** "2026-w29" -> "2026-07-13" (Monday of that ISO week), or null if malformed. */
export function slugToWeekStart(slug: string): string | null {
  const m = slug.match(/^(\d{4})-w(\d{1,2})$/i);
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  // Monday of ISO week 1 = the Monday on/before Jan 4.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - mondayOffset(jan4));
  const monday = new Date(week1Monday);
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  return monday.toISOString().slice(0, 10);
}

/** "2026-07-13" -> "Jul 13–19, 2026" (spans the Mon–Sun of the edition's week). */
export function formatWeekRange(weekStart: string): string {
  const [y, m, d] = weekStart.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, d));
  const end = new Date(start.getTime() + 6 * DAY_MS);

  const sM = start.getUTCMonth();
  const eM = end.getUTCMonth();
  const sD = start.getUTCDate();
  const eD = end.getUTCDate();
  const eY = end.getUTCFullYear();

  if (sM === eM) return `${MONTHS[sM]} ${sD}–${eD}, ${eY}`;
  return `${MONTHS[sM]} ${sD} – ${MONTHS[eM]} ${eD}, ${eY}`;
}

/** "2026-07-13" -> "July 2026" (month bucket for the calendar nav). */
export function formatMonth(weekStart: string): string {
  const [y, m] = weekStart.split("-").map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** ISO Monday of the week containing `now` (defaults to today), as "YYYY-MM-DD". */
export function currentWeekStart(now: Date = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - mondayOffset(d));
  return d.toISOString().slice(0, 10);
}
