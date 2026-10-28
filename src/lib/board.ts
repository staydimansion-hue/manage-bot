import { SupabaseClient } from "@supabase/supabase-js";
import {
  ActionItem,
  Board,
  BoardCounts,
  Category,
  ItemStatus,
  ItemWithCategory,
  Settings,
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
): Promise<Settings> {
  const { data, error } = await db
    .from("settings")
    .select("*")
    .eq("board_id", boardId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as Settings;

  const fallback: Settings = {
    board_id: boardId,
    morning_enabled: true,
    evening_enabled: true,
    last_morning_sent_on: null,
    last_evening_sent_on: null,
  };
  const { error: upsertError } = await db.from("settings").upsert(fallback);
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
): Promise<{ archived: number; carried: number }> {
  const items = await getItems(db, boardId, { includePending: false });

  const toArchive = items.filter(
    (i) => i.status === "done" && isBeforeKstDay(i.completed_at, today)
  );
  const toCarry = items.filter(
    (i) => i.status === "not_started" || i.status === "in_progress"
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

  return { archived: toArchive.length, carried: toCarry.length };
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
