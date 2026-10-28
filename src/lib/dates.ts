/**
 * Date helpers. The bot operates on a KST (Asia/Seoul, UTC+9) calendar day,
 * since the team and Slack channel are Korea-based. We derive the KST day
 * without external deps by shifting the UTC epoch by +9h.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** Returns the KST calendar date (YYYY-MM-DD) for a given instant (default now). */
export function kstDateString(instant: Date = new Date()): string {
  const shifted = new Date(instant.getTime() + KST_OFFSET_MS);
  return shifted.toISOString().slice(0, 10);
}

/**
 * True when `iso` (a timestamptz string) falls on a KST day strictly before
 * the reference day. Used by the morning rollover to archive items completed
 * on a previous day.
 */
export function isBeforeKstDay(iso: string | null, referenceDay: string): boolean {
  if (!iso) return false;
  const day = kstDateString(new Date(iso));
  return day < referenceDay;
}

/** True when a due date (YYYY-MM-DD) is strictly before today's KST day. */
export function isOverdue(dueDate: string | null, referenceDay: string): boolean {
  if (!dueDate) return false;
  return dueDate < referenceDay;
}

/**
 * Unix epoch seconds for the start (00:00 KST) of the given KST day
 * (YYYY-MM-DD). Used as a Slack `oldest` cursor to read only today's messages.
 */
export function kstDayStartUnix(day: string): number {
  return Math.floor(Date.parse(`${day}T00:00:00+09:00`) / 1000);
}

/**
 * Validate and normalize a YYYY-MM-DD date string. Returns the string when it
 * is a real calendar date, otherwise null. Used to sanitize LLM-extracted
 * due dates before persisting them.
 */
export function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(`${y}-${mo}-${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  // Guard against overflow (e.g. 2026-02-31 -> Mar 3).
  if (date.toISOString().slice(0, 10) !== `${y}-${mo}-${d}`) return null;
  return `${y}-${mo}-${d}`;
}
