-- Seed data for the MARKETING board. Run AFTER schema.sql.
-- Idempotent: safe to run multiple times.

-- Board --------------------------------------------------------------------
-- slack_channel_id is left NULL here; set it after inviting the bot to the
-- channel 스테이디멘션-마케팅방 (see README). [미정: 실제 channel ID]
insert into boards (key, name, slack_channel_id, active)
values ('marketing', '스테이디멘션-마케팅방', null, true)
on conflict (key) do update set name = excluded.name;

-- Categories ---------------------------------------------------------------
insert into categories (board_id, name, sort_order, active)
select b.id, v.name, v.sort_order, true
from boards b
cross join (values
  ('콘텐츠', 1),
  ('광고', 2),
  ('SNS', 3),
  ('제휴', 4),
  ('성과분석', 5)
) as v(name, sort_order)
where b.key = 'marketing'
  and not exists (
    select 1 from categories c
    where c.board_id = b.id and c.name = v.name
  );

-- Settings -----------------------------------------------------------------
insert into board_settings (board_id, morning_enabled, evening_enabled)
select id, true, true from boards where key = 'marketing'
on conflict (board_id) do nothing;

-- Extraction state ---------------------------------------------------------
insert into extraction_state (board_id, last_slack_ts)
select id, null from boards where key = 'marketing'
on conflict (board_id) do nothing;
