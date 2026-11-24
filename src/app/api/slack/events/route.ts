import { NextRequest, NextResponse } from "next/server";
import { env, MARKETING_BOARD_KEY } from "@/lib/config";
import { requireSupabase } from "@/lib/supabase";
import { getBoardByKey } from "@/lib/board";
import { postMessage, verifySlackSignature } from "@/lib/slack";
import { actionLabel, applyStatusUpdates } from "@/lib/statusUpdates";
import { buildCurrentBoard } from "@/lib/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

interface SlackEventPayload {
  type: string;
  challenge?: string;
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    channel?: string;
    text?: string;
    ts?: string;
    thread_ts?: string;
  };
}

/** Remove "<@U123>" mention tokens from the text. */
function stripMentions(text: string): string {
  return text.replace(/<@[^>]+>\s*/g, "").trim();
}

/**
 * Slack Events API endpoint. When someone @mentions the bot in the marketing
 * channel ("@Market bot 2번 완결, 4번 중복이라 빼줘"), the message is read for
 * progress reports on board items, the statuses are changed in the database,
 * and the updated board is posted back in the thread. Plain messages are still
 * picked up by the morning/evening run, so mentioning is only for "right now".
 */
export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!env.slackSigningSecret) {
    console.error("slack events: SLACK_SIGNING_SECRET is not set");
    return NextResponse.json({ error: "not_configured" }, { status: 500 });
  }
  const ok = verifySlackSignature({
    signingSecret: env.slackSigningSecret,
    timestamp: req.headers.get("x-slack-request-timestamp") ?? "",
    signature: req.headers.get("x-slack-signature") ?? "",
    rawBody,
  });
  if (!ok) return NextResponse.json({ error: "invalid_signature" }, { status: 401 });

  const payload = JSON.parse(rawBody) as SlackEventPayload;
  if (payload.type === "url_verification") {
    return NextResponse.json({ challenge: payload.challenge });
  }
  if (payload.type !== "event_callback" || !payload.event) {
    return NextResponse.json({ ok: true });
  }
  // Slack resends when we take >3s; the first delivery is still being handled.
  if (req.headers.get("x-slack-retry-num")) return NextResponse.json({ ok: true });

  const event = payload.event;
  if (event.type !== "app_mention" || event.subtype || event.bot_id || !event.text) {
    return NextResponse.json({ ok: true });
  }

  try {
    const db = requireSupabase();
    const board = await getBoardByKey(db, MARKETING_BOARD_KEY);
    if (!board || !board.slack_channel_id || event.channel !== board.slack_channel_id) {
      return NextResponse.json({ ok: true });
    }

    const text = stripMentions(event.text);
    const threadTs = event.thread_ts ?? event.ts;
    if (!text) return NextResponse.json({ ok: true });

    const { applied } = await applyStatusUpdates(db, board.id, [text]);

    const footnote = applied.length
      ? "반영: " +
        applied.map((a) => `${a.number}번 ${a.title} → ${actionLabel(a.action)}`).join(" · ") +
        " (번호는 반영 전 보드 기준)"
      : "바꿀 항목을 찾지 못했어요. \"2번 완료\", \"사이니지 업로드 진행중\", \"4번 중복이라 빼줘\"처럼 번호나 제목으로 말해 주세요.";

    const { text: fallback, blocks } = await buildCurrentBoard(
      db,
      board.id,
      applied.length ? `✅ 마케팅 보드 반영 (${applied.length}건)` : "마케팅 보드 (변경 없음)",
      footnote
    );
    await postMessage(board.slack_channel_id, fallback, blocks, threadTs);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("slack events error:", err);
    // 200 so Slack does not retry the same mention.
    return NextResponse.json({ ok: true });
  }
}
