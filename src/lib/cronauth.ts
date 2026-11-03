import { NextRequest } from "next/server";
import { env } from "@/lib/config";

/**
 * Authorize a cron request. Accepts EITHER:
 *   - the `?token=<CRON_SECRET>` query param (kept for manual browser testing), OR
 *   - an `Authorization: Bearer <CRON_SECRET>` header (how Vercel Cron calls it).
 *
 * Hard guard: if `CRON_SECRET` is unset/empty, reject everything. This prevents
 * `Bearer undefined` or an empty `?token=` from ever authorizing a request.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return false;

  const token = req.nextUrl.searchParams.get("token");
  if (token && safeEqual(token, secret)) return true;

  const authHeader = req.headers.get("authorization");
  if (authHeader && safeEqual(authHeader, `Bearer ${secret}`)) return true;

  return false;
}

/** Length-checked, constant-time-ish string comparison. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
