import { requireSupabase } from "./supabase";
import {
  countByStatus,
  getBoardByKey,
  getCategories,
  getItems,
  getSettings,
  runDailyRollover,
  withCategories,
} from "./board";
import { buildBoardBlocks } from "./blocks";
import { postMessage } from "./slack";
import { runAutoExtraction } from "./extraction";
import { buildDiscussionSummary } from "./summary";
import { kstDateString } from "./dates";

export interface RunResult {
  ok: boolean;
  status: "sent" | "already_sent" | "no_channel" | "disabled";
  detail?: Record<string, unknown>;
}

/**
 * Morning run: auto-extract → daily rollover → post "today's to-do + carried
 * over incomplete" read-only board. Deduped on last_morning_sent_on so a
 * repeated same-day cron hit is a no-op.
 */
export async function runMorning(boardKey: string): Promise<RunResult> {
  const db = requireSupabase();
  const board = await getBoardByKey(db, boardKey);
  if (!board) return { ok: false, status: "no_channel", detail: { reason: "no_board" } };

  const settings = await getSettings(db, board.id);
  const today = kstDateString();

  if (!settings.morning_enabled) return { ok: true, status: "disabled" };
  if (settings.last_morning_sent_on === today) {
    return { ok: true, status: "already_sent" };
  }

  const extraction = await runAutoExtraction(db, board.id, board.slack_channel_id);
  const rollover = await runDailyRollover(db, board.id, today);
  const discussionSummary = await buildDiscussionSummary(board.slack_channel_id, today);

  const items = await getItems(db, board.id, { includePending: false });
  const categories = await getCategories(db, board.id);
  const counts = countByStatus(items);
  const withCats = withCategories(items, categories);

  const { text, blocks } = buildBoardBlocks({
    title: `☀️ 오늘의 마케팅 액션 아이템 (${today})`,
    counts,
    categories,
    items: withCats,
    today,
    showEmpty: true,
    discussionSummary,
    footnote: `어제 넘어온 미완료 ${rollover.carried}건 · 자동추출 ${extraction.inserted}건(승인 대기)`,
  });

  if (!board.slack_channel_id) {
    await markMorningSent(db, board.id, today);
    return { ok: true, status: "no_channel", detail: { rollover, extraction } };
  }

  const result = await postMessage(board.slack_channel_id, text, blocks);
  await markMorningSent(db, board.id, today);

  return {
    ok: result.ok,
    status: "sent",
    detail: { rollover, extraction, slack: result.ok ? "ok" : result.error },
  };
}

/**
 * Evening run: auto-extract → post completed/in-progress/incomplete recap
 * (no rollover). Deduped on last_evening_sent_on.
 */
export async function runEvening(boardKey: string): Promise<RunResult> {
  const db = requireSupabase();
  const board = await getBoardByKey(db, boardKey);
  if (!board) return { ok: false, status: "no_channel", detail: { reason: "no_board" } };

  const settings = await getSettings(db, board.id);
  const today = kstDateString();

  if (!settings.evening_enabled) return { ok: true, status: "disabled" };
  if (settings.last_evening_sent_on === today) {
    return { ok: true, status: "already_sent" };
  }

  const extraction = await runAutoExtraction(db, board.id, board.slack_channel_id);
  const discussionSummary = await buildDiscussionSummary(board.slack_channel_id, today);

  const items = await getItems(db, board.id, { includePending: false });
  const categories = await getCategories(db, board.id);
  const counts = countByStatus(items);
  const withCats = withCategories(items, categories);

  const { text, blocks } = buildBoardBlocks({
    title: `🌙 오늘의 마케팅 마감 리캡 (${today})`,
    counts,
    categories,
    items: withCats,
    today,
    discussionSummary,
    footnote: `완료·진행중·미완료 리캡 · 자동추출 ${extraction.inserted}건(승인 대기)`,
  });

  if (!board.slack_channel_id) {
    await markEveningSent(db, board.id, today);
    return { ok: true, status: "no_channel", detail: { extraction } };
  }

  const result = await postMessage(board.slack_channel_id, text, blocks);
  await markEveningSent(db, board.id, today);

  return {
    ok: result.ok,
    status: "sent",
    detail: { extraction, slack: result.ok ? "ok" : result.error },
  };
}

async function markMorningSent(
  db: ReturnType<typeof requireSupabase>,
  boardId: string,
  today: string
): Promise<void> {
  await db.from("board_settings").update({ last_morning_sent_on: today }).eq("board_id", boardId);
}

async function markEveningSent(
  db: ReturnType<typeof requireSupabase>,
  boardId: string,
  today: string
): Promise<void> {
  await db.from("board_settings").update({ last_evening_sent_on: today }).eq("board_id", boardId);
}
