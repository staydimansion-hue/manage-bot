import { NextRequest, NextResponse } from "next/server";
import { env, MARKETING_BOARD_KEY } from "@/lib/config";
import { runEvening } from "@/lib/run";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!env.cronSecret || token !== env.cronSecret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await runEvening(MARKETING_BOARD_KEY);
    return NextResponse.json(result);
  } catch (err) {
    console.error("marketing-evening error:", err);
    return NextResponse.json(
      { ok: false, error: "internal_error" },
      { status: 500 }
    );
  }
}
