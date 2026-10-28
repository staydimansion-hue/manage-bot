import Anthropic from "@anthropic-ai/sdk";
import { env, hasAnthropic, hasSlack } from "./config";
import { fetchNewMessages } from "./slack";
import { kstDayStartUnix } from "./dates";

/** Shown in the Slack board when there is nothing to summarize or on any error. */
export const EMPTY_SUMMARY = "오늘 논의 내용 없음";

/**
 * Read TODAY's (KST day) human messages from the marketing Slack channel and
 * ask Haiku for a concise 3–5 line Korean summary, emphasizing commitments /
 * decisions and any "언제까지(기한)" mentions.
 *
 * Fully resilient: returns a neutral line (never throws) when Slack/Anthropic
 * are not configured, when there are no messages, or when the call fails. The
 * caller can safely render the result without guarding — a cron must never fail
 * because of the summary.
 */
export async function buildDiscussionSummary(
  channelId: string | null,
  today: string
): Promise<string> {
  try {
    if (!channelId || !hasSlack() || !hasAnthropic()) return EMPTY_SUMMARY;

    const oldest = String(kstDayStartUnix(today));
    const messages = await fetchNewMessages(channelId, oldest, 50);
    if (messages.length === 0) return EMPTY_SUMMARY;

    const summary = await summarizeWithLLM(messages.map((m) => m.text));
    return summary || EMPTY_SUMMARY;
  } catch (err) {
    console.error("discussion-summary error:", err);
    return EMPTY_SUMMARY;
  }
}

async function summarizeWithLLM(texts: string[]): Promise<string> {
  const client = new Anthropic({ apiKey: env.anthropicApiKey });

  const joined = texts.map((t, i) => `${i + 1}. ${t}`).join("\n");

  const prompt = `다음은 오늘 마케팅 팀 Slack 채널에서 오간 메시지입니다. 한국어로 3~5줄의 간결한 요약을 작성하세요. 결정 사항과 담당자가 약속한 일(commitments)을 우선하고, "언제까지" 같은 기한 언급이 있으면 꼭 포함하세요. 잡담은 생략합니다. 불릿("- ")으로 각 줄을 시작하고, 요약 외 다른 말은 쓰지 마세요.

메시지:
${joined}`;

  const response = await client.messages.create({
    model: env.anthropicModel,
    max_tokens: 400,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const raw = textBlock && "text" in textBlock ? textBlock.text : "";
  return raw.trim();
}
