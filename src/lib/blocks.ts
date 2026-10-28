import { BoardCounts, ItemStatus, ItemWithCategory, Category } from "./types";
import { isOverdue } from "./dates";

const STATUS_EMOJI: Record<ItemStatus, string> = {
  done: "🟥",
  in_progress: "🟨",
  not_started: "⬜",
};

/** Build the action_id for a status button so the interactions route can parse it. */
export function statusActionId(itemId: string, status: ItemStatus): string {
  return `set_status:${status}:${itemId}`;
}

export function parseStatusActionId(
  actionId: string
): { status: ItemStatus; itemId: string } | null {
  const parts = actionId.split(":");
  if (parts.length !== 3 || parts[0] !== "set_status") return null;
  const status = parts[1] as ItemStatus;
  if (!["not_started", "in_progress", "done"].includes(status)) return null;
  return { status, itemId: parts[2] };
}

function summaryLine(counts: BoardCounts): string {
  return `완료 ${counts.done} · 진행중 ${counts.in_progress} · 미진행 ${counts.not_started}`;
}

/** Format a YYYY-MM-DD due date as a compact " (~MM/DD까지)" suffix. */
function dueSuffix(dueDate: string | null): string {
  if (!dueDate) return "";
  const m = dueDate.match(/^\d{4}-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return ` (~${m[1]}/${m[2]}까지)`;
}

function itemLine(item: ItemWithCategory, today: string): string {
  const emoji = STATUS_EMOJI[item.status];
  const overdue = isOverdue(item.due_date, today) && item.status !== "done";
  const due = dueSuffix(item.due_date);
  const carried =
    item.carried_over_count > 0 ? ` _(${item.carried_over_count}일째)_` : "";
  const warn = overdue ? " ⚠️" : "";
  return `${emoji} ${item.title}${due}${carried}${warn}`;
}

/** Buttons for a single item: 진행중 / 완료 / 되돌리기. */
function itemButtons(item: ItemWithCategory) {
  return {
    type: "actions",
    block_id: `item_actions:${item.id}`,
    elements: [
      {
        type: "button",
        text: { type: "plain_text", text: "진행중", emoji: true },
        action_id: statusActionId(item.id, "in_progress"),
        value: item.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "완료", emoji: true },
        style: "primary",
        action_id: statusActionId(item.id, "done"),
        value: item.id,
      },
      {
        type: "button",
        text: { type: "plain_text", text: "되돌리기", emoji: true },
        action_id: statusActionId(item.id, "not_started"),
        value: item.id,
      },
    ],
  };
}

interface BuildOptions {
  title: string;
  counts: BoardCounts;
  categories: Category[];
  items: ItemWithCategory[];
  today: string;
  withButtons: boolean;
  footnote?: string;
  /** Optional 오늘 채널 논의 요약 section text (Korean, multi-line). */
  discussionSummary?: string;
  /**
   * When true, render EVERY active category (even empty ones, shown with
   * "(없음)") so the full board is visible with nothing omitted — used by the
   * morning report. When false, only categories that have items are shown.
   */
  showEmpty?: boolean;
}

// Slack hard-caps a message at 50 blocks. Leave headroom for the fixed
// header/summary/divider/footnote blocks.
const MAX_BLOCKS = 50;

/**
 * Build a Block Kit message grouped by category. Shared by morning and evening;
 * callers pass different titles, item sets and whether to render buttons.
 *
 * The morning report (showEmpty) shows all categories and every item with no
 * truncation. Because per-item buttons cost 2 blocks each, a large board can
 * exceed Slack's 50-block limit; when that happens we drop the per-item buttons
 * and fall back to a compact text-only layout (one section per category) so the
 * full board still posts and nothing is omitted.
 */
export function buildBoardBlocks(opts: BuildOptions): {
  text: string;
  blocks: unknown[];
} {
  const {
    title,
    counts,
    categories,
    items,
    today,
    withButtons,
    footnote,
    discussionSummary,
    showEmpty,
  } = opts;

  // Group items by category (nulls go to a trailing "기타" group).
  const ordered = [...categories].sort((a, b) => a.sort_order - b.sort_order);
  const groups: { name: string; items: ItemWithCategory[] }[] = ordered.map(
    (c) => ({ name: c.name, items: items.filter((i) => i.category_id === c.id) })
  );
  const uncategorized = items.filter((i) => !i.category_id);
  if (uncategorized.length > 0) groups.push({ name: "기타", items: uncategorized });

  // showEmpty keeps empty categories (not the synthetic 기타 bucket).
  const shown = showEmpty ? groups : groups.filter((g) => g.items.length > 0);

  const head = (): unknown[] => {
    const h: unknown[] = [
      { type: "header", text: { type: "plain_text", text: title, emoji: true } },
      {
        type: "section",
        text: { type: "mrkdwn", text: `*${summaryLine(counts)}*` },
      },
    ];
    if (discussionSummary) {
      h.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*📝 오늘 채널 논의 요약*\n${discussionSummary}`,
        },
      });
    }
    h.push({ type: "divider" });
    return h;
  };

  const foot = (): unknown[] =>
    footnote
      ? [
          { type: "divider" },
          { type: "context", elements: [{ type: "mrkdwn", text: footnote }] },
        ]
      : [];

  // Compact layout: one section per category listing all item lines.
  const buildCompact = (): unknown[] => {
    const body: unknown[] = [];
    if (shown.length === 0) {
      body.push({
        type: "section",
        text: { type: "mrkdwn", text: "_오늘 등록된 액션 아이템이 없습니다._" },
      });
    }
    for (const group of shown) {
      const lines = group.items.length
        ? group.items.map((i) => itemLine(i, today)).join("\n")
        : "_(없음)_";
      body.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${group.name}*\n${lines}` },
      });
    }
    return [...head(), ...body, ...foot()];
  };

  // Interactive layout: category header + per-item line section & buttons.
  const buildInteractive = (): unknown[] => {
    const body: unknown[] = [];
    const nonEmpty = shown.filter((g) => g.items.length > 0);
    if (nonEmpty.length === 0 && shown.length === 0) {
      body.push({
        type: "section",
        text: { type: "mrkdwn", text: "_오늘 등록된 액션 아이템이 없습니다._" },
      });
    }
    for (const group of shown) {
      if (group.items.length === 0) {
        body.push({
          type: "section",
          text: { type: "mrkdwn", text: `*${group.name}*\n_(없음)_` },
        });
        continue;
      }
      body.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${group.name}*` },
      });
      for (const item of group.items) {
        body.push({
          type: "section",
          text: { type: "mrkdwn", text: itemLine(item, today) },
        });
        body.push(itemButtons(item));
      }
    }
    return [...head(), ...body, ...foot()];
  };

  let blocks = withButtons ? buildInteractive() : buildCompact();
  if (blocks.length > MAX_BLOCKS) {
    // Too many blocks for Slack — drop buttons and render the full board
    // compactly so nothing is omitted.
    if (withButtons) {
      console.warn(
        `buildBoardBlocks: ${blocks.length} blocks exceeds ${MAX_BLOCKS}; falling back to text-only layout`
      );
    }
    blocks = buildCompact();
  }

  return { text: `${title} — ${summaryLine(counts)}`, blocks };
}
