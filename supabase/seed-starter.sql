-- ===========================================================================
-- Couple Board — 启动脚本 (Phase 1)  ·  run AFTER schema.sql
-- 在 Supabase → SQL Editor 贴这个，按 Run
-- ===========================================================================

-- --- 1. 把你们两个升级成正式成员 (member) --------------------------------
-- 网站在「不是 member」的时候会隐藏所有按钮（这是设计好的安全机制）。
-- 这里把你们两个账号的 is_member 打开，名字和 emoji 之后可以在网站
-- 的 Settings 页面自己改。
update public.profiles
set is_member = true,
    emoji = case display_name
              when 'wengthongkwan' then '🌙'
              when 'zhencomando'   then '☀️'
              else emoji end,
    color = case display_name
              when 'wengthongkwan' then '#C5A059'
              when 'zhencomando'   then '#C19A6B'
              else color end
where display_name in ('wengthongkwan', 'zhencomando');

-- 手机号码故意留空：Phase 2 接 WhatsApp 群组通知时再填，
-- 那时也要先通过 WhatsApp 验证码流程才能写入（资料表有强制检查）。

-- --- 2. WhatsApp 讯息范本（Phase 2 会用，先装好）-------------------------
insert into public.message_templates (key, label, body) values
  ('event_created',
   'New calendar event',
   E'📅 *New plan on the board*\n{{event_name}}\n🕘 {{date_time}}{{location_line}}\nAdded by {{actor}}\n\n— Couple Board'),

  ('handoff',
   'Routine hand-off',
   E'🔄 *{{deal_name}}* — your turn\n{{previous_step}} is done ({{actor}}).\nNext: *{{step_name}}* — {{assigned_to}}{{due_line}}\n\n— Couple Board'),

  ('turn_advanced',
   'Turn advanced',
   E'✅ *{{deal_name}}* done by {{actor}}.\nNext up: *{{assigned_to}}*\n\n— Couple Board'),

  ('nudge',
   'Gentle nudge',
   E'🫶 Gentle nudge: *{{deal_name}}* — {{step_name}} is waiting on {{assigned_to}}.{{due_line}}\n\n— Couple Board'),

  ('penalty_claimed',
   'Penalty claimed',
   E'⚖️ *Deal breaker!*\n{{actor}} claimed a forfeit on *{{deal_name}}*.\n{{owed_by}} owes {{owed_to}}: _{{penalty}}_\n\n— Couple Board'),

  ('penalty_settled',
   'Penalty settled',
   E'🎉 Settled: _{{penalty}}_\n{{owed_by}} is square with {{owed_to}}.\n\n— Couple Board')
on conflict (key) do nothing;

-- --- 3. 网站设定 ---------------------------------------------------------
insert into public.app_settings
  (id, whatsapp_provider, notifications_on, quiet_hours_start, quiet_hours_end, timezone)
values
  (true, 'console', true, 23, 7, 'Asia/Kuala_Lumpur')
on conflict (id) do nothing;

-- --- 4. 两个示范家务（让你马上看到轮候机制在动，之后可自行删除/修改）-----
do $$
declare
  a uuid;  -- 第一个 member（wengthongkwan）
  b uuid;  -- 第二个 member（zhencomando）
  dish uuid;
  laundry uuid;
begin
  select id into a from public.profiles where is_member order by created_at limit 1;
  select id into b from public.profiles where is_member and id <> a order by created_at limit 1;
  if a is null or b is null then
    raise notice 'Skipping sample deals — need two member profiles first.';
    return;
  end if;

  -- 洗碗：严格轮流，一键完成，18 小时宽限期
  insert into public.deals
    (title, emoji, description, rotation_type, grace_hours,
     penalty_title, penalty_description, current_assignee_id, created_by, sort_order)
  values
    ('洗碗 Dish Duty', '🍽️', '上次洗的人就免役。在家没开火就一直算着，周末不算。',
     'alternating', 18,
     '周末咖啡', '跳过洗碗轮次 → 下个周末的咖啡你请。',
     a, a, 0)
  returning id into dish;

  insert into public.deal_steps (deal_id, step_index, label, assignee_id)
  values (dish, 0, '洗碗', null);

  -- 洗衣：链式步骤（一人洗 → 另一人晾），每完成一轮角色互换
  insert into public.deals
    (title, emoji, description, rotation_type, swap_each_cycle, grace_hours,
     penalty_title, penalty_description, current_step_index, current_assignee_id, created_by, sort_order)
  values
    ('洗衣 Laundry', '🧺', '一人开机洗，另一人晾。每完成一整轮互换角色。',
     'paired', true, 6,
     '15 分钟按摩', '忘记晾衣服 → 欠 15 分钟按摩。',
     0, a, a, 1)
  returning id into laundry;

  insert into public.deal_steps (deal_id, step_index, label, assignee_id, notify_on_ready) values
    (laundry, 0, '开机洗衣服', a, false),
    (laundry, 1, '晾衣服',     b, true);
end $$;

-- --- 完成后的检查 --------------------------------------------------------
-- 应该看到两行，且 is_member = true
select display_name, emoji, is_member from public.profiles order by created_at;
