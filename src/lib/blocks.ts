import { BoardCounts, ItemStatus, ItemWithCategory, Category } from "./types";
import { isOverdue } from "./dates";

const STATUS_EMOJI: Record<ItemStatus, string> = {
  done: "🟥",
  in_progress: "🟨",
  not_started: "⬜",
};

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

interface BuildOptions {
  title: string;
  counts: BoardCounts;
  categories: Category[];
  items: ItemWithCategory[];
  today: string;
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

/**
 * Build a read-only Block Kit message grouped by category. Shared by morning
 * and evening; callers pass different titles, item sets and whether empty
 * categories are shown.
 *
 * The board carries no interactive controls — status changes are made in the
 * /admin/marketing admin page. Each category renders as one section (a bold
 * header followed by newline-separated item lines), with a divider between
 * categories so they read as a clean, separated board. Collapsing each
 * category to a single section keeps the message well under Slack's 50-block
 * limit naturally.
 *
 * The morning report (showEmpty) shows all categories, empty ones as "(없음)";
 * the evening report shows only categories that have items.
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

  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: title, emoji: true } },
    {
      type: "section",
      text: { type: "mrkdwn", text: `*${summaryLine(counts)}*` },
    },
  ];

  if (discussionSummary) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*📝 오늘 채널 논의 요약*\n${discussionSummary}`,
      },
    });
  }

  blocks.push({ type: "divider" });

  if (shown.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_오늘 등록된 액션 아이템이 없습니다._" },
    });
  } else {
    // One section per category, separated by dividers.
    shown.forEach((group, idx) => {
      if (idx > 0) blocks.push({ type: "divider" });
      const lines = group.items.length
        ? group.items.map((i) => itemLine(i, today)).join("\n")
        : "_(없음)_";
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: `*${group.name}*\n${lines}` },
      });
    });
  }

  if (footnote) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: footnote }] });
  }

  return { text: `${title} — ${summaryLine(counts)}`, blocks };
}
