import { SupabaseClient } from "@supabase/supabase-js";
import {
  ActionItem,
  Board,
  BoardCounts,
  Category,
  ItemStatus,
  ItemWithCategory,
  BoardSettings,
} from "./types";
import { isBeforeKstDay, kstDateString } from "./dates";

/** Fetch a board by its key (e.g. 'marketing'). */
export async function getBoardByKey(
  db: SupabaseClient,
  key: string
): Promise<Board | null> {
  const { data, error } = await db
    .from("boards")
    .select("*")
    .eq("key", key)
    .maybeSingle();
  if (error) throw error;
  return (data as Board) ?? null;
}

/** Fetch active categories for a board, ordered by sort_order. */
export async function getCategories(
  db: SupabaseClient,
  boardId: string,
  opts: { includeInactive?: boolean } = {}
): Promise<Category[]> {
  let query = db
    .from("categories")
    .select("*")
    .eq("board_id", boardId)
    .order("sort_order", { ascending: true });
  if (!opts.includeInactive) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data as Category[]) ?? [];
}

/**
 * Active items for the board = approved AND not archived. Optionally include
 * pending (unapproved, auto-extracted) items for the admin page.
 */
export async function getItems(
  db: SupabaseClient,
  boardId: string,
  opts: { includePending?: boolean } = {}
): Promise<ActionItem[]> {
  let query = db
    .from("action_items")
    .select("*")
    .eq("board_id", boardId)
    .is("archived_at", null)
    .order("created_at", { ascending: true });
  if (!opts.includePending) query = query.eq("approved", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data as ActionItem[]) ?? [];
}

/** Join items with categories for rendering. */
export function withCategories(
  items: ActionItem[],
  categories: Category[]
): ItemWithCategory[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  return items.map((item) => ({
    ...item,
    category: item.category_id ? byId.get(item.category_id) ?? null : null,
  }));
}

/**
 * Items in the exact order the Slack board numbers them: categories by
 * sort_order, then uncategorized items (the "기타" group) last. "2번 완료" in
 * Slack refers to index 1 of this list, so blocks.ts and the status-update step
 * must both use this order.
 */
export function orderItemsForBoard<T extends ActionItem>(
  categories: Category[],
  items: T[]
): T[] {
  const ordered = [...categories].sort((a, b) => a.sort_order - b.sort_order);
  const known = new Set(ordered.map((c) => c.id));
  const result: T[] = [];
  for (const c of ordered) result.push(...items.filter((i) => i.category_id === c.id));
  result.push(...items.filter((i) => !i.category_id || !known.has(i.category_id)));
  return result;
}

/** Count items by status (approved + active items only). */
export function countByStatus(items: ActionItem[]): BoardCounts {
  const counts: BoardCounts = { done: 0, in_progress: 0, not_started: 0 };
  for (const item of items) {
    if (!item.approved) continue;
    counts[item.status] += 1;
  }
  return counts;
}

/** Fetch settings row for a board, creating a default if missing. */
export async function getSettings(
  db: SupabaseClient,
  boardId: string
): Promise<BoardSettings> {
  const { data, error } = await db
    .from("board_settings")
    .select("*")
    .eq("board_id", boardId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as BoardSettings;

  const fallback: BoardSettings = {
    board_id: boardId,
    morning_enabled: true,
    evening_enabled: true,
    last_morning_sent_on: null,
    last_evening_sent_on: null,
  };
  const { error: upsertError } = await db.from("board_settings").upsert(fallback);
  if (upsertError) throw upsertError;
  return fallback;
}

/**
 * Idempotent daily rollover (run in the morning, before posting):
 *  - Items done on a PREVIOUS day are archived (archived_at set) so they drop
 *    off the active board but remain in history.
 *  - Incomplete items (not_started / in_progress) stay active and have their
 *    carried_over_count incremented once per rollover day.
 *
 * Idempotency: completed items already have archived_at set after the first
 * pass (so the query excludes them). For carry-over we guard with a marker in
 * settings is not enough, so we only increment items whose created day or last
 * carry predates today — we track that via a per-day guard using settings'
 * last_morning_sent_on being compared by the caller. To keep rollover itself
 * safe on repeat calls within the same day, we re-read and skip already-archived
 * rows, and the carry increment is bounded by the morning dedupe in the route.
 */
export async function runDailyRollover(
  db: SupabaseClient,
  boardId: string,
  today: string = kstDateString()
): Promise<{ archived: number; carried: number; expired: number; duplicates: number }> {
  const all = await getItems(db, boardId, { includePending: false });

  // 기한이 지난 지 EXPIRE_GRACE_DAYS일 넘은 미완료 항목은 보드에서 뺀다(행사 전 점검처럼
  // 날짜가 지나면 의미 없는 일이 계속 올라오지 않게). 기록은 archived_at으로 남는다.
  const expired = all.filter(
    (i) => i.status !== "done" && isExpired(itemDeadline(i, today), today)
  );
  // 같은 분류 안에서 제목이 같거나 거의 같은 항목은 가장 먼저 만든 것만 남긴다.
  const duplicates = findDuplicates(all.filter((i) => !expired.includes(i)));
  const dropped = new Set([...expired, ...duplicates].map((i) => i.id));
  const items = all.filter((i) => !dropped.has(i.id));

  const toArchive = [
    ...items.filter((i) => i.status === "done" && isBeforeKstDay(i.completed_at, today)),
    ...expired,
    ...duplicates,
  ];
  // Only carry over items that were created on a PREVIOUS KST day. Items created
  // today are still "day 1" and must stay at carried_over_count 0 (no "N일째"
  // suffix); they only start accruing the suffix once they survive to tomorrow.
  const toCarry = items.filter(
    (i) =>
      (i.status === "not_started" || i.status === "in_progress") &&
      isBeforeKstDay(i.created_at, today)
  );

  const nowIso = new Date().toISOString();

  if (toArchive.length > 0) {
    const { error } = await db
      .from("action_items")
      .update({ archived_at: nowIso })
      .in(
        "id",
        toArchive.map((i) => i.id)
      );
    if (error) throw error;
  }

  // Increment carried_over_count per incomplete item. The morning route dedupes
  // on last_morning_sent_on so this runs at most once per KST day.
  for (const item of toCarry) {
    const { error } = await db
      .from("action_items")
      .update({ carried_over_count: item.carried_over_count + 1 })
      .eq("id", item.id);
    if (error) throw error;
  }

  return {
    archived: toArchive.length,
    carried: toCarry.length,
    expired: expired.length,
    duplicates: duplicates.length,
  };
}

/** 기한이 지나고 이만큼(일) 더 지나면 보드에서 뺀다. */
export const EXPIRE_GRACE_DAYS = 3;

/**
 * 항목의 기한(YYYY-MM-DD). due_date가 없으면 제목의 "(~10/24까지)", "~11/06까지" 같은
 * 표기에서 읽는다.
 */
export function itemDeadline(item: Pick<ActionItem, "due_date" | "title">, today: string): string | null {
  if (item.due_date) return item.due_date.slice(0, 10);
  const m = item.title.match(/~\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*까지/);
  if (!m) return null;
  const [ty] = today.split("-").map(Number);
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  // 작년·올해·내년 중 오늘에 가장 가까운 날짜로 본다(11월에 "~1/5까지"면 내년 1/5).
  return [ty - 1, ty, ty + 1]
    .map((y) => `${y}-${pad(mm)}-${pad(dd)}`)
    .sort((a, b) => Math.abs(daysBetween(today, a)) - Math.abs(daysBetween(today, b)))[0];
}

export function isExpired(deadline: string | null, today: string): boolean {
  return !!deadline && daysBetween(deadline, today) > EXPIRE_GRACE_DAYS;
}

/** b - a, 일 단위(YYYY-MM-DD). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}

/** 제목 비교용: 괄호 안 기한·공백·기호를 없애고, 끝의 흔한 동사 차이(게시/업로드/올리기)를 맞춘다. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[\s·.,:;'"`~!?\-_/]+/g, "")
    .replace(/(게시|업로드|올리기|올림|등록)$/, "");
}

/** 같은 분류에서 정규화한 제목이 같은 항목 중 가장 먼저 만든 것을 뺀 나머지. */
export function findDuplicates<T extends Pick<ActionItem, "id" | "title" | "category_id" | "created_at">>(
  items: T[]
): T[] {
  const sorted = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const seen = new Set<string>();
  const dups: T[] = [];
  for (const it of sorted) {
    const key = `${it.category_id ?? ""}|${normalizeTitle(it.title)}`;
    if (seen.has(key)) dups.push(it);
    else seen.add(key);
  }
  return dups;
}

/** Change an item's status, maintaining completed_at. Returns the updated item. */
export async function setItemStatus(
  db: SupabaseClient,
  itemId: string,
  status: ItemStatus
): Promise<ActionItem | null> {
  const patch: Partial<ActionItem> = { status };
  patch.completed_at = status === "done" ? new Date().toISOString() : null;
  const { data, error } = await db
    .from("action_items")
    .update(patch)
    .eq("id", itemId)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as ActionItem) ?? null;
}
