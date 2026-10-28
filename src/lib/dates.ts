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
