import crypto from "node:crypto";
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
  blocks: unknown[],
  threadTs?: string
): Promise<SlackApiResult> {
  return slackPost("chat.postMessage", {
    channel,
    text,
    blocks,
    ...(threadTs ? { thread_ts: threadTs } : {}),
  });
}

/**
 * Verify a Slack Events API request (v0 HMAC-SHA256 signature). Rejects
 * requests older than 5 minutes to block replays.
 */
export function verifySlackSignature(opts: {
  signingSecret: string;
  timestamp: string;
  signature: string;
  rawBody: string;
}): boolean {
  const { signingSecret, timestamp, signature, rawBody } = opts;
  if (!signingSecret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;
  const expected =
    "v0=" +
    crypto.createHmac("sha256", signingSecret).update(`v0:${timestamp}:${rawBody}`).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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
