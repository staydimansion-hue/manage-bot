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

function itemLine(item: ItemWithCategory, today: string): string {
  const emoji = STATUS_EMOJI[item.status];
  const overdue = isOverdue(item.due_date, today) && item.status !== "done";
  const due = item.due_date ? ` (마감 ${item.due_date})` : "";
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
}

/**
 * Build a Block Kit message grouped by category. Shared by morning and evening;
 * callers pass different titles, item sets and whether to render buttons.
 */
export function buildBoardBlocks(opts: BuildOptions): {
  text: string;
  blocks: unknown[];
} {
  const { title, counts, categories, items, today, withButtons, footnote } = opts;

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: title, emoji: true } },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${summaryLine(counts)}*` },
    },
    { type: "divider" },
  ];

  // Group items by category (nulls go to a trailing "기타" group).
  const ordered = [...categories].sort((a, b) => a.sort_order - b.sort_order);
  const groups: { name: string; items: ItemWithCategory[] }[] = ordered.map(
    (c) => ({ name: c.name, items: items.filter((i) => i.category_id === c.id) })
  );
  const uncategorized = items.filter((i) => !i.category_id);
  if (uncategorized.length > 0) groups.push({ name: "기타", items: uncategorized });

  const nonEmpty = groups.filter((g) => g.items.length > 0);

  if (nonEmpty.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_오늘 등록된 액션 아이템이 없습니다._" },
    });
  }

  for (const group of nonEmpty) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*${group.name}*\n${group.items
          .map((i) => itemLine(i, today))
          .join("\n")}`,
      },
    });
    if (withButtons) {
      for (const item of group.items) {
        blocks.push({
          type: "context",
          elements: [{ type: "mrkdwn", text: `• ${item.title}` }],
        });
        blocks.push(itemButtons(item));
      }
    }
  }

  if (footnote) {
    blocks.push({ type: "divider" });
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: footnote }],
    });
  }

  return { text: `${title} — ${summaryLine(counts)}`, blocks };
}
