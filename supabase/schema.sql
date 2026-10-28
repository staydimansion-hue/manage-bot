-- Marketing PM Bot — shared, generic schema (Postgres / Supabase).
-- Designed so a second board (e.g. 'operations') can reuse the same tables,
-- keyed by `boards.key`. Run this ONCE, then run seed_marketing.sql.

-- Extensions ---------------------------------------------------------------
create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- Enums --------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'item_status') then
    create type item_status as enum ('not_started', 'in_progress', 'done');
  end if;
  if not exists (select 1 from pg_type where typname = 'item_source') then
    create type item_source as enum ('manual', 'auto');
  end if;
end$$;

-- boards -------------------------------------------------------------------
-- One row per board. The marketing board is seeded separately.
create table if not exists boards (
  id               uuid primary key default gen_random_uuid(),
  key              text not null unique,            -- e.g. 'marketing'
  name             text not null,
  slack_channel_id text,                            -- Slack channel to post into
  active           boolean not null default true,
  created_at       timestamptz not null default now()
);

-- categories ---------------------------------------------------------------
create table if not exists categories (
  id         uuid primary key default gen_random_uuid(),
  board_id   uuid not null references boards(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists categories_board_idx on categories(board_id);

-- action_items -------------------------------------------------------------
create table if not exists action_items (
  id                 uuid primary key default gen_random_uuid(),
  board_id           uuid not null references boards(id) on delete cascade,
  category_id        uuid references categories(id) on delete set null,
  title              text not null,
  status             item_status not null default 'not_started',
  source             item_source not null default 'manual',
  approved           boolean not null default true,     -- auto items start false
  due_date           date,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,                       -- set when status -> done
  archived_at        timestamptz,                       -- set by daily rollover
  carried_over_count int not null default 0
);
create index if not exists action_items_board_idx on action_items(board_id);
create index if not exists action_items_active_idx
  on action_items(board_id, approved, archived_at);

-- extraction_state ---------------------------------------------------------
-- Tracks the last processed Slack message ts so auto-extraction only reads
-- NEW messages.
create table if not exists extraction_state (
  board_id      uuid primary key references boards(id) on delete cascade,
  last_slack_ts text
);

-- board_settings -----------------------------------------------------------
-- Per-board send toggles + same-day dedupe guards.
create table if not exists board_settings (
  board_id             uuid primary key references boards(id) on delete cascade,
  morning_enabled      boolean not null default true,
  evening_enabled      boolean not null default true,
  last_morning_sent_on date,
  last_evening_sent_on date
);
