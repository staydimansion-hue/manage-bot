import Anthropic from "@anthropic-ai/sdk";
import { SupabaseClient } from "@supabase/supabase-js";
import { env, hasAnthropic, hasSlack } from "./config";
import { fetchNewMessages } from "./slack";
import { getCategories, getItems } from "./board";
import { applyStatusUpdates } from "./statusUpdates";
import { kstDateString, normalizeIsoDate } from "./dates";

interface ExtractedItem {
  title: string;
  category: string | null;
  due_date: string | null;
}

/**
 * Auto-extract concrete action items from NEW Slack messages since the last
 * processed ts. Designed to be cheap and resilient:
 *  - only reads new messages (capped batch),
 *  - uses the cheapest model (ANTHROPIC_MODEL, default haiku),
 *  - small max_tokens,
 *  - skips gracefully (no throw) when Slack / Anthropic / messages are absent.
 *
 * Extracted items are inserted as source='auto', approved=false (pending admin
 * approval). Advances extraction_state.last_slack_ts to the newest message.
 */
export async function runAutoExtraction(
  db: SupabaseClient,
  boardId: string,
  channelId: string | null
): Promise<{ inserted: number; statusChanged: number; skippedReason?: string }> {
  try {
    if (!channelId) return { inserted: 0, statusChanged: 0, skippedReason: "no_channel" };
    if (!hasSlack()) return { inserted: 0, statusChanged: 0, skippedReason: "no_slack" };
    if (!hasAnthropic()) return { inserted: 0, statusChanged: 0, skippedReason: "no_anthropic" };

    const { data: stateRow } = await db
      .from("extraction_state")
      .select("last_slack_ts")
      .eq("board_id", boardId)
      .maybeSingle();
    const lastTs: string | null = stateRow?.last_slack_ts ?? null;

    const messages = await fetchNewMessages(channelId, lastTs, 30);
    if (messages.length === 0) return { inserted: 0, statusChanged: 0, skippedReason: "no_new_messages" };

    // Oldest first, so "진행중" then "완료" ends as 완료.
    const texts = [...messages].sort((a, b) => Number(a.ts) - Number(b.ts)).map((m) => m.text);

    // 1) Progress reports on existing items ("2번 완결") change their status.
    const status = await applyStatusUpdates(db, boardId, texts);

    // 2) Genuinely new to-dos become pending items. Existing titles (approved
    //    or pending) are passed so the same work is not added again.
    const categories = await getCategories(db, boardId);
    const categoryNames = categories.map((c) => c.name);
    const existingTitles = (await getItems(db, boardId, { includePending: true })).map(
      (i) => i.title
    );

    const extracted = await extractWithLLM(texts, categoryNames, kstDateString(), existingTitles);

    if (extracted.length > 0) {
      const rows = extracted.map((e) => ({
        board_id: boardId,
        category_id:
          e.category && categories.find((c) => c.name === e.category)
            ? categories.find((c) => c.name === e.category)!.id
            : null,
        title: e.title,
        due_date: e.due_date,
        status: "not_started" as const,
        source: "auto" as const,
        approved: false,
      }));
      const { error } = await db.from("action_items").insert(rows);
      if (error) throw error;
    }

    // Advance the cursor to the newest message ts we saw.
    const newestTs = messages.reduce(
      (max, m) => (Number(m.ts) > Number(max) ? m.ts : max),
      lastTs ?? messages[0].ts
    );
    await db
      .from("extraction_state")
      .upsert({ board_id: boardId, last_slack_ts: newestTs });

    return { inserted: extracted.length, statusChanged: status.applied.length };
  } catch (err) {
    // Never fail the cron because of extraction.
    console.error("auto-extraction error:", err);
    return { inserted: 0, statusChanged: 0, skippedReason: "error" };
  }
}

async function extractWithLLM(
  texts: string[],
  categoryNames: string[],
  today: string,
  existingTitles: string[] = []
): Promise<ExtractedItem[]> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });

  const joined = texts.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const catList = categoryNames.length
    ? categoryNames.map((c) => `"${c}"`).join(", ")
    : "없음";

  const existing = existingTitles.length
    ? existingTitles.map((t) => `- ${t}`).join("\n")
    : "없음";

  const prompt = `다음은 마케팅 팀 Slack 채널의 새 메시지입니다. 앞으로 해야 할 구체적인 마케팅 실행 액션 아이템만 뽑아주세요. 잡담/질문/감탄사는 제외합니다.

이미 보드에 있는 항목(같거나 비슷한 일은 다시 뽑지 마세요):
${existing}

다음도 뽑지 마세요: "N번 완료/완결/진행중" 같은 기존 항목의 진행 보고, 이미 끝냈다고 말하는 일, 보드 메시지를 다시 붙여 넣은 내용.

오늘 날짜(KST): ${today}

카테고리 후보: ${catList} (해당 없으면 null)

메시지:
${joined}

각 액션의 마감 기한(due_date)을 추출하세요: 메시지에 "~까지", 날짜, "다음주까지", "이번주 금요일까지" 같은 기한 표현이 있으면 오늘 날짜 기준으로 계산해 "YYYY-MM-DD" 형식으로, 없으면 null 로 설정합니다.

JSON 배열만 출력하세요. 형식: [{"title": "짧은 액션 제목", "category": "카테고리명 또는 null", "due_date": "YYYY-MM-DD 또는 null"}]. 액션이 없으면 [] 를 출력하세요.`;

  const response = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 640,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";
  return parseExtraction(raw, categoryNames);
}

/** Parse the model's JSON output defensively. */
export function parseExtraction(
  raw: string,
  categoryNames: string[]
): ExtractedItem[] {
  try {
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]) as unknown;
    if (!Array.isArray(parsed)) return [];

    const valid = new Set(categoryNames);
    return parsed
      .filter(
        (x): x is { title: unknown; category?: unknown; due_date?: unknown } =>
          typeof x === "object" && x !== null && "title" in x
      )
      .map((x) => {
        const title = String(x.title ?? "").trim();
        const cat =
          typeof x.category === "string" && valid.has(x.category)
            ? x.category
            : null;
        return { title, category: cat, due_date: normalizeIsoDate(x.due_date) };
      })
      .filter((x) => x.title.length > 0 && x.title.length <= 200);
  } catch {
    return [];
  }
}
