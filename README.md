# Marketing PM Bot (manage-bot)

A Next.js (App Router) + TypeScript app backed by Supabase (Postgres) that
posts a **marketing action-item board** into a Slack channel twice a day and
lets people change item status from Slack buttons or a lightweight admin page.

The data model and UI are built as a **shared, generic foundation** keyed by a
`board` concept, so a second "operations/housekeeping" bot can be added later by
reusing the same tables and components. Only the **marketing** board is
implemented now.

## Features

- **Twice-daily Slack posts** (Block Kit), grouped by category:
  - Morning (09:00 KST): today's to-do + yesterday's carried-over incomplete
    items, after a daily rollover.
  - Evening (21:00 KST): completed / in-progress / incomplete recap.
- **Daily rollover**: items completed on a previous day are archived (kept in
  history); incomplete items carry into the new day with a counter. Idempotent.
- **Interactive buttons** per item in Slack: `진행중` / `완료` / `되돌리기`.
- **Auto-extraction**: a cheap LLM reads only NEW channel messages and proposes
  action items, inserted as pending (approval required in admin).
- **Admin page** `/admin/marketing`: manage categories, items, statuses, and
  approve/reject pending auto-extracted items.

## Status emojis & summary

- 🟥 완료 (done) · 🟨 진행중 (in_progress) · ⬜ 미진행 (not_started)
- Overdue (due date passed, not done) items are marked ⚠️.
- Top summary line: `완료 N · 진행중 N · 미진행 N`.

## Tech

- Next.js 15 (App Router), TypeScript, React 19.
- Supabase JS client (service-role, server-side only).
- `@anthropic-ai/sdk` for extraction; Slack Web API via `fetch`.

All external calls are guarded, so the app builds and typechecks without live
credentials. Missing credentials degrade gracefully (e.g. extraction is skipped).

---

## Setup

### 1. Install & build

```bash
npm install
npm run build
npm run lint
```

### 2. Database (Supabase)

In the Supabase SQL editor, run **once, in order**:

1. `supabase/schema.sql`
2. `supabase/seed_marketing.sql`

This creates the tables and seeds the `marketing` board (name
`스테이디멘션-마케팅방`) plus 5 categories: 콘텐츠, 광고, SNS, 제휴, 성과분석.

After you know the Slack channel ID, set it:

```sql
update boards set slack_channel_id = 'C0XXXXXXX' where key = 'marketing';
```

### 3. Environment variables

Copy `.env.example` to `.env.local` (local) or set them in your host. See the
file for the full list:

| Var | Purpose |
| --- | --- |
| `SLACK_BOT_TOKEN` | Bot token (`xoxb-...`) for posting & reading history |
| `SLACK_SIGNING_SECRET` | Verifies interactive button requests |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key (server-side only) |
| `ANTHROPIC_API_KEY` | For LLM auto-extraction (optional) |
| `ANTHROPIC_MODEL` | Defaults to `claude-haiku-4-5-20251001` |
| `CRON_SECRET` | `?token=` guard for cron endpoints |
| `ADMIN_TOKEN` | `?token=` guard for the admin page |

### 4. Slack app

1. Create a Slack app (https://api.slack.com/apps).
2. **OAuth scopes** (Bot Token Scopes): `chat:write`, `channels:history`,
   `groups:history` (use `groups:history` for private channels). Install to the
   workspace and copy the Bot Token into `SLACK_BOT_TOKEN`.
3. Copy the **Signing Secret** (Basic Information) into `SLACK_SIGNING_SECRET`.
4. **Interactivity**: enable it and set the Request URL to
   `https://<your-host>/api/slack/interactions`.
5. **Invite the bot** to the channel `스테이디멘션-마케팅방`
   (`/invite @your-bot`), then set `boards.slack_channel_id` (see step 2).

### 5. Cron jobs (cron-job.org)

Register two GET jobs (times are KST):

- Morning — `https://<your-host>/api/cron/marketing-morning?token=<CRON_SECRET>`
  at **09:00 KST**.
- Evening — `https://<your-host>/api/cron/marketing-evening?token=<CRON_SECRET>`
  at **21:00 KST**.

Both endpoints dedupe on the sent-on date, so a double hit on the same day is a
no-op (returns `already_sent`). Requests without the correct `token` get `401`.

> cron-job.org schedules in a fixed timezone; set the job timezone to
> `Asia/Seoul` or convert 09:00/21:00 KST to UTC (00:00 / 12:00 UTC).

---

## Admin page

Visit `/admin/marketing?token=<ADMIN_TOKEN>`. This is **lightweight auth** — a
shared token in the query string, suitable for a small internal team. Put the
app behind additional protection (VPN / platform auth) if you need more.

## How the runs work

**Morning** (`/api/cron/marketing-morning`):
1. Auto-extraction (reads new Slack messages → pending items).
2. Daily rollover (archive items done on a previous day; carry incomplete).
3. Post the morning board with buttons; mark `last_morning_sent_on`.

**Evening** (`/api/cron/marketing-evening`):
1. Auto-extraction.
2. Post the recap (no rollover); mark `last_evening_sent_on`.

## Extending to a second board

Add a row to `boards` with a new `key` (e.g. `operations`), seed its categories,
add new cron routes that call `runMorning('operations')` / `runEvening(...)`, and
reuse the same admin components with the new board key. The library layer in
`src/lib` is already board-agnostic.
