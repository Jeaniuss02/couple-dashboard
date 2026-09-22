-- ===========================================================================
-- Couple Board — seed
--
-- Prerequisite: both partners have signed in once (magic link), so auth.users
-- and the auto-created profiles rows exist. Then edit the two emails below
-- and run this whole file.
-- ===========================================================================

-- --- 1. Promote the two accounts to members -------------------------------
--
-- Seeding a number here bypasses the WhatsApp OTP flow, so phone_verified must
-- be set alongside it (the phone_is_verified check constraint enforces this).
-- That is fine for an admin bootstrap: you are asserting these numbers are
-- right. To make each partner prove their own instead, set the phone column to
-- NULL and verify from Settings.
update public.profiles p
set display_name   = v.display_name,
    emoji          = v.emoji,
    color          = v.color,
    phone_e164     = v.phone,
    phone_verified = v.phone is not null,
    is_member      = true
from (values
  -- These two colours identify each of you everywhere: avatars, calendar
  -- stripes, chart series. They are a validated categorical pair (ΔE 25.5
  -- normal vision, 20.4 under protanopia) — the original warm-on-warm pair
  -- was ΔE 3.1, i.e. the same colour to everyone.
  ('you@example.com',     'Ava',  '🌙', '#B5842B', '+60123456789'),
  ('partner@example.com', 'Noor', '☀️', '#0F6E96', '+60198765432')
) as v(email, display_name, emoji, color, phone)
where p.id = (select id from auth.users u where u.email = v.email);

-- --- 2. WhatsApp message templates ----------------------------------------
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

-- --- 3. App settings ------------------------------------------------------
insert into public.app_settings (id, whatsapp_provider, notifications_on, quiet_hours_start, quiet_hours_end, timezone)
values (true, 'console', true, 23, 7, 'Asia/Kuala_Lumpur')
on conflict (id) do nothing;

-- --- 4. Two starter deals -------------------------------------------------
do $$
declare
  a uuid;  -- first member
  b uuid;  -- second member
  dish uuid;
  laundry uuid;
begin
  select id into a from public.profiles where is_member order by created_at limit 1;
  select id into b from public.profiles where is_member and id <> a order by created_at limit 1;
  if a is null or b is null then
    raise notice 'Skipping sample deals — need two member profiles first.';
    return;
  end if;

  -- Dish duty: strictly alternating, one tap, 18h grace.
  insert into public.deals
    (title, emoji, description, rotation_type, grace_hours,
     penalty_title, penalty_description, current_assignee_id, created_by, sort_order)
  values
    ('Dish Duty', '🍽️', 'Whoever did it last is off the hook. State carries over weekends.',
     'alternating', 18,
     'Weekend coffee run', 'Skip your dish turn and next weekend''s coffee is on you.',
     a, a, 0)
  returning id into dish;

  insert into public.deal_steps (deal_id, step_index, label, assignee_id)
  values (dish, 0, 'Wash the dishes', null);

  -- Laundry: fixed paired steps that mirror each cycle.
  insert into public.deals
    (title, emoji, description, rotation_type, swap_each_cycle, grace_hours,
     penalty_title, penalty_description, current_step_index, current_assignee_id, created_by, sort_order)
  values
    ('Laundry Routine', '🧺', 'One washes, the other hangs. Roles swap every full cycle.',
     'paired', true, 6,
     '15-minute massage', 'Forget to hang the laundry and you owe a 15-minute massage.',
     0, a, a, 1)
  returning id into laundry;

  insert into public.deal_steps (deal_id, step_index, label, assignee_id, notify_on_ready) values
    (laundry, 0, 'Wash the clothes',   a, false),
    (laundry, 1, 'Hang / dry the load', b, true);
end $$;
