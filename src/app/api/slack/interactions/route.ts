import { NextRequest, NextResponse } from "next/server";
import { MARKETING_BOARD_KEY } from "@/lib/config";
import { requireSupabase } from "@/lib/supabase";
import { verifySlackSignature, updateMessage, respondViaUrl } from "@/lib/slack";
import {
  countByStatus,
  getBoardByKey,
  getCategories,
  getItems,
  setItemStatus,
  withCategories,
} from "@/lib/board";
import { buildBoardBlocks, parseStatusActionId } from "@/lib/blocks";
import { kstDateString } from "@/lib/dates";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface SlackInteractionPayload {
  type: string;
  actions?: Array<{ action_id: string; value?: string }>;
  channel?: { id: string };
  message?: { ts: string; blocks?: Array<{ type: string; text?: { text?: string } }> };
  response_url?: string;
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  const timestamp = req.headers.get("x-slack-request-timestamp");
  const signature = req.headers.get("x-slack-signature");

  if (!verifySlackSignature(raw, timestamp, signature)) {
    return NextResponse.json({ ok: false, error: "bad_signature" }, { status: 401 });
  }

  // Slack sends `payload=<url-encoded JSON>` as application/x-www-form-urlencoded.
  const params = new URLSearchParams(raw);
  const payloadRaw = params.get("payload");
  if (!payloadRaw) {
    return NextResponse.json({ ok: false, error: "no_payload" }, { status: 400 });
  }

  let payload: SlackInteractionPayload;
  try {
    payload = JSON.parse(payloadRaw) as SlackInteractionPayload;
  } catch {
    return NextResponse.json({ ok: false, error: "bad_payload" }, { status: 400 });
  }

  if (payload.type !== "block_actions" || !payload.actions?.length) {
    return NextResponse.json({ ok: true });
  }

  const action = payload.actions[0];
  const parsed = parseStatusActionId(action.action_id);
  if (!parsed) return NextResponse.json({ ok: true });

  try {
    const db = requireSupabase();
    await setItemStatus(db, parsed.itemId, parsed.status);

    const board = await getBoardByKey(db, MARKETING_BOARD_KEY);
    if (!board) return NextResponse.json({ ok: true });

    const today = kstDateString();
    const items = await getItems(db, board.id, { includePending: false });
    const categories = await getCategories(db, board.id);
    const counts = countByStatus(items);
    const withCats = withCategories(items, categories);

    // Preserve the original header title when we can read it from the message.
    const header = payload.message?.blocks?.find((b) => b.type === "header");
    const title = header?.text?.text ?? `마케팅 액션 아이템 (${today})`;

    const { text, blocks } = buildBoardBlocks({
      title,
      counts,
      categories,
      items: withCats,
      today,
      withButtons: true,
      footnote: `마지막 업데이트: ${new Date().toISOString()}`,
    });

    // Prefer chat.update by channel+ts; fall back to response_url.
    if (payload.channel?.id && payload.message?.ts) {
      await updateMessage(payload.channel.id, payload.message.ts, text, blocks);
    } else if (payload.response_url) {
      await respondViaUrl(payload.response_url, {
        replace_original: true,
        text,
        blocks,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("slack interactions error:", err);
    return NextResponse.json({ ok: false, error: "internal_error" }, { status: 200 });
  }
}
