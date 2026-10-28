/** Shared domain types. These mirror the Supabase schema in supabase/schema.sql. */

export type ItemStatus = "not_started" | "in_progress" | "done";
export type ItemSource = "manual" | "auto";

export interface Board {
  id: string;
  key: string;
  name: string;
  slack_channel_id: string | null;
  active: boolean;
}

export interface Category {
  id: string;
  board_id: string;
  name: string;
  sort_order: number;
  active: boolean;
}

export interface ActionItem {
  id: string;
  board_id: string;
  category_id: string | null;
  title: string;
  status: ItemStatus;
  source: ItemSource;
  approved: boolean;
  due_date: string | null;
  created_at: string;
  completed_at: string | null;
  archived_at: string | null;
  carried_over_count: number;
}

export interface BoardSettings {
  board_id: string;
  morning_enabled: boolean;
  evening_enabled: boolean;
  last_morning_sent_on: string | null;
  last_evening_sent_on: string | null;
}

export interface ExtractionState {
  board_id: string;
  last_slack_ts: string | null;
}

/** An item joined with its category, used for rendering. */
export interface ItemWithCategory extends ActionItem {
  category: Category | null;
}

export interface BoardCounts {
  done: number;
  in_progress: number;
  not_started: number;
}
