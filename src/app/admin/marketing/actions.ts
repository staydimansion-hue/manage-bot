"use server";

import { revalidatePath } from "next/cache";
import { env, MARKETING_BOARD_KEY } from "@/lib/config";
import { requireSupabase } from "@/lib/supabase";
import { getBoardByKey, setItemStatus } from "@/lib/board";
import { ItemStatus } from "@/lib/types";

const ADMIN_PATH = "/admin/marketing";

/** Lightweight shared-token auth. Throws on mismatch. */
function assertAuthed(token: string | null): void {
  if (!env.adminToken || token !== env.adminToken) {
    throw new Error("unauthorized");
  }
}

async function boardId(): Promise<string> {
  const db = requireSupabase();
  const board = await getBoardByKey(db, MARKETING_BOARD_KEY);
  if (!board) throw new Error("board_not_found");
  return board.id;
}

function revalidate() {
  revalidatePath(ADMIN_PATH);
}

// ---------- Categories ----------

export async function addCategory(formData: FormData): Promise<void> {
  assertAuthed(formData.get("token") as string | null);
  const db = requireSupabase();
  const name = String(formData.get("name") ?? "").trim();
  const sortOrder = Number(formData.get("sort_order") ?? 0) || 0;
  if (!name) return;
  await db
    .from("categories")
    .insert({ board_id: await boardId(), name, sort_order: sortOrder, active: true });
  revalidate();
}

export async function updateCategory(formData: FormData): Promise<void> {
  assertAuthed(formData.get("token") as string | null);
  const db = requireSupabase();
  const id = String(formData.get("id"));
  const name = String(formData.get("name") ?? "").trim();
  const sortOrder = Number(formData.get("sort_order") ?? 0) || 0;
  if (!id || !name) return;
  await db.from("categories").update({ name, sort_order: sortOrder }).eq("id", id);
  revalidate();
}

export async function deleteCategory(formData: FormData): Promise<void> {
  assertAuthed(formData.get("token") as string | null);
  const db = requireSupabase();
  const id = String(formData.get("id"));
  if (!id) return;
  // Soft-delete: deactivate so existing items keep their reference.
  await db.from("categories").update({ active: false }).eq("id", id);
  revalidate();
}

// ---------- Action items ----------

export async function addItem(formData: FormData): Promise<void> {
  assertAuthed(formData.get("token") as string | null);
  const db = requireSupabase();
  const title = String(formData.get("title") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "");
  const dueDate = String(formData.get("due_date") ?? "").trim();
  if (!title) return;
  await db.from("action_items").insert({
    board_id: await boardId(),
    category_id: categoryId || null,
    title,
    status: "not_started",
    source: "manual",
    approved: true,
    due_date: dueDate || null,
  });
  revalidate();
}

export async function updateItem(formData: FormData): Promise<void> {
  assertAuthed(formData.get("token") as string | null);
  const db = requireSupabase();
  const id = String(formData.get("id"));
  const title = String(formData.get("title") ?? "").trim();
  const categoryId = String(formData.get("category_id") ?? "");
  const dueDate = String(formData.get("due_date") ?? "").trim();
  if (!id || !title) return;
  await db
    .from("action_items")
    .update({ title, category_id: categoryId || null, due_date: dueDate || null })
    .eq("id", id);
  revalidate();
}

export async function deleteItem(formData: FormData): Promise<void> {
  assertAuthed(formData.get("token") as string | null);
  const db = requireSupabase();
  const id = String(formData.get("id"));
  if (!id) return;
  await db.from("action_items").delete().eq("id", id);
  revalidate();
}

export async function changeStatus(formData: FormData): Promise<void> {
  assertAuthed(formData.get("token") as string | null);
  const db = requireSupabase();
  const id = String(formData.get("id"));
  const status = String(formData.get("status")) as ItemStatus;
  if (!id || !["not_started", "in_progress", "done"].includes(status)) return;
  await setItemStatus(db, id, status);
  revalidate();
}

// ---------- Approve / reject pending (auto-extracted) ----------

export async function approveItem(formData: FormData): Promise<void> {
  assertAuthed(formData.get("token") as string | null);
  const db = requireSupabase();
  const id = String(formData.get("id"));
  if (!id) return;
  await db.from("action_items").update({ approved: true }).eq("id", id);
  revalidate();
}

export async function rejectItem(formData: FormData): Promise<void> {
  assertAuthed(formData.get("token") as string | null);
  const db = requireSupabase();
  const id = String(formData.get("id"));
  if (!id) return;
  await db.from("action_items").delete().eq("id", id);
  revalidate();
}
