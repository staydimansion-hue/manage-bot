import { env, hasSlack } from "./config";

const SLACK_API = "https://slack.com/api";

interface SlackApiResult {
  ok: boolean;
  error?: string;
  ts?: string;
  messages?: Array<{ ts: string; text?: string; subtype?: string; bot_id?: string }>;
  [key: string]: unknown;
}

async function slackPost(method: string, body: unknown): Promise<SlackApiResult> {
  if (!hasSlack()) {
    return { ok: false, error: "slack_not_configured" };
  }
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${env.slackBotToken}`,
    },
    body: JSON.stringify(body),
  });
  return (await res.json()) as SlackApiResult;
}

/** Post a Block Kit message to a channel. */
export async function postMessage(
  channel: string,
  text: string,
  blocks: unknown[]
): Promise<SlackApiResult> {
  return slackPost("chat.postMessage", { channel, text, blocks });
}

/**
 * Fetch channel history AFTER a given ts (exclusive via oldest+inclusive=false).
 * Returns human (non-bot) messages only, capped by `limit`.
 */
export async function fetchNewMessages(
  channel: string,
  oldestTs: string | null,
  limit = 30
): Promise<{ ts: string; text: string }[]> {
  if (!hasSlack()) return [];
  const params = new URLSearchParams({
    channel,
    limit: String(limit),
    inclusive: "false",
  });
  if (oldestTs) params.set("oldest", oldestTs);

  const res = await fetch(`${SLACK_API}/conversations.history?${params}`, {
    headers: { Authorization: `Bearer ${env.slackBotToken}` },
  });
  const data = (await res.json()) as SlackApiResult;
  if (!data.ok || !data.messages) return [];

  return data.messages
    .filter((m) => !m.subtype && !m.bot_id && typeof m.text === "string" && m.text.trim())
    .map((m) => ({ ts: m.ts, text: (m.text ?? "").trim() }));
}
