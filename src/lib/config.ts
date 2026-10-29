/**
 * Centralized environment config. Values are read lazily so that the app can
 * build/typecheck without live credentials. External calls guard on presence.
 */

export const env = {
  // Slack
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  // Anthropic
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",

  // Secrets for protected routes
  cronSecret: process.env.CRON_SECRET ?? "",
  adminToken: process.env.ADMIN_TOKEN ?? "",
};

export function hasSupabase(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

export function hasSlack(): boolean {
  return Boolean(env.slackBotToken);
}

export function hasAnthropic(): boolean {
  return Boolean(env.anthropicApiKey);
}

/** The board we currently implement. Designed so a second board can be added later. */
export const MARKETING_BOARD_KEY = "marketing";
