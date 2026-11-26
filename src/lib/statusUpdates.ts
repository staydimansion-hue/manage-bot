import Anthropic from "@anthropic-ai/sdk";
import { SupabaseClient } from "@supabase/supabase-js";
import { env, hasAnthropic } from "./config";
import { getCategories, getItems, orderItemsForBoard, setItemStatus } from "./board";
import { ActionItem, ItemStatus } from "./types";

/** What a Slack message can do to an existing board item. */
export type StatusAction = ItemStatus | "archive";

export interface AppliedUpdate {
  number: number;
  title: string;
  action: StatusAction;
}

const ACTION_LABEL: Record<StatusAction, string> = {
  done: "완료",
  in_progress: "진행중",
  not_started: "미진행",
  archive: "보드에서 뺌",
};

export function actionLabel(action: StatusAction): string {
  return ACTION_LABEL[action];
}

/**
 * Read Slack messages for progress reports about EXISTING board items
 * ("2번 완결", "사이니지 업로드 끝났어요", "LCD 건 진행중", "4번 중복이라 빼줘")
 * and apply them to the database.
 *
 * Items are referred to by the same continuous numbers the Slack board shows,
 * so "2번 완료" means the 2nd line of the last board. The LLM may also match by
 * title. Only approved, non-archived items can be changed.
 *
 * Never throws: a cron or Slack event must not fail because of this step.
 */
export async function applyStatusUpdates(
  db: SupabaseClient,
  boardId: string,
  texts: string[]
): Promise<{ applied: AppliedUpdate[]; items: ActionItem[] }> {
  const empty = { applied: [], items: [] as ActionItem[] };
  try {
    if (texts.length === 0 || !hasAnthropic()) return empty;

    const categories = await getCategories(db, boardId);
    const items = orderItemsForBoard(
      categories,
      await getItems(db, boardId, { includePending: false })
    );
    if (items.length === 0) return empty;

    const decided = await decideWithLLM(items, texts);

    const applied: AppliedUpdate[] = [];
    const seen = new Set<number>();
    for (const d of decided) {
      if (seen.has(d.number)) continue;
      const item = items[d.number - 1];
      if (!item) continue;
      seen.add(d.number);

      if (d.action === "archive") {
        const { error } = await db
          .from("action_items")
          .update({ archived_at: new Date().toISOString() })
          .eq("id", item.id);
        if (error) throw error;
      } else {
        if (item.status === d.action) continue;
        await setItemStatus(db, item.id, d.action);
      }
      applied.push({ number: d.number, title: item.title, action: d.action });
    }
    return { applied, items };
  } catch (err) {
    console.error("status-update error:", err);
    return empty;
  }
}

async function decideWithLLM(
  items: ActionItem[],
  texts: string[]
): Promise<{ number: number; action: StatusAction }[]> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });

  const board = items
    .map((item, i) => `${i + 1}. [${statusKo(item.status)}] ${item.title}`)
    .join("\n");
  const joined = texts.map((t, i) => `${i + 1}) ${t}`).join("\n");

  const prompt = `마케팅 팀 Slack 채널의 할 일 보드와 팀원 메시지입니다. 메시지에서 "기존 보드 항목"의 진행 상황을 보고하거나 바꿔 달라는 내용만 찾아, 어떤 번호 항목을 어떤 상태로 바꿀지 정하세요.

현재 보드(번호는 Slack 보드에 보이는 번호와 같습니다):
${board}

메시지:
${joined}

규칙:
- 항목은 번호("2번", "#2", "2,4번")나 제목 일부("사이니지 업로드", "LCD 건")로 가리킵니다. 여러 항목을 한 번에 말할 수도 있습니다.
- 상태:
  - "done": 완료·완결·끝·마무리·했습니다·처리함·업로드함 등 끝났다는 말
  - "in_progress": 진행중·하는 중·시작함·작업 중·회신 대기 등 시작했지만 안 끝난 말
  - "not_started": 미진행으로 되돌려 달라·아직 안 함
  - "archive": 중복·삭제·빼줘·취소·필요 없음·기한 지나서 의미 없음 등 보드에서 없애 달라는 말
- 같은 제목의 중복 항목 중 하나를 완료했다고 하면, 나머지 중복 항목은 "archive" 하세요.
- 새로 할 일을 말하는 것, 질문, 잡담, 보드에 없는 일에 대한 보고는 무시합니다.
- 메시지가 예전 보드 줄을 인용하고 번호를 말하면(예: 인용한 줄 "2. ...", "3. ..." 뒤에 "2.3번 삭제"), 그 번호는 인용한 줄의 번호입니다. 인용한 줄의 제목으로 현재 보드 항목을 찾아 그 번호를 쓰세요.
- "삭제", "빼줘", "중복", "하나로" 같은 말은 "in_progress"가 아니라 "archive"입니다. "하나로 합쳐줘"면 가장 위 항목만 남기고 나머지를 "archive" 하세요.
- 확실하지 않으면 넣지 마세요. 같은 번호는 한 번만, 메시지 순서상 마지막 말을 따릅니다.

JSON 배열만 출력하세요. 형식: [{"number": 2, "action": "done"}]. 바꿀 것이 없으면 [].`;

  const response = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";
  return parseDecisions(raw, items.length);
}

const VALID_ACTIONS = new Set<StatusAction>(["done", "in_progress", "not_started", "archive"]);

/** Parse the model's JSON defensively; drop unknown numbers/actions. */
export function parseDecisions(
  raw: string,
  itemCount: number
): { number: number; action: StatusAction }[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        const o = (x ?? {}) as { number?: unknown; action?: unknown };
        return { number: Number(o.number), action: String(o.action) as StatusAction };
      })
      .filter(
        (x) =>
          Number.isInteger(x.number) &&
          x.number >= 1 &&
          x.number <= itemCount &&
          VALID_ACTIONS.has(x.action)
      );
  } catch {
    return [];
  }
}

function statusKo(status: ItemStatus): string {
  return ACTION_LABEL[status];
}
