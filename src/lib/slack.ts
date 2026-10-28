import crypto from "crypto";
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

/** Update an existing message (used by interactive button handlers). */
export async function updateMessage(
  channel: string,
  ts: string,
  text: string,
  blocks: unknown[]
): Promise<SlackApiResult> {
  return slackPost("chat.update", { channel, ts, text, blocks });
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

/**
 * Post a message body to a Slack response_url (interactive callbacks).
 * Returns whether Slack accepted it (HTTP 200 + "ok" body) so callers can log
 * failures instead of silently dropping them.
 */
export async function respondViaUrl(
  responseUrl: string,
  body: unknown
): Promise<{ ok: boolean; detail?: string }> {
  try {
    const res = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const ok = res.ok && text.trim() === "ok";
    return ok ? { ok: true } : { ok: false, detail: `status=${res.status} body=${text.slice(0, 200)}` };
  } catch (err) {
    return { ok: false, detail: String(err) };
  }
}

/**
 * Verify a Slack request signature (v0 scheme) using the signing secret.
 * Rejects stale timestamps (> 5 min) to prevent replay.
 */
export function verifySlackSignature(
  rawBody: string,
  timestamp: string | null,
  signature: string | null
): boolean {
  if (!env.slackSigningSecret || !timestamp || !signature) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (Number.isNaN(age) || age > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", env.slackSigningSecret)
    .update(base)
    .digest("hex");
  const expected = `v0=${hmac}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
