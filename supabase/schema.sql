-- ===========================================================================
-- Couple Board — schema
-- Run in the Supabase SQL editor (or `supabase db push`) before seed.sql.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
do $$ begin
  create type rotation_type as enum ('alternating', 'paired', 'adhoc');
exception when duplicate_object then null; end $$;

do $$ begin
  create type penalty_status as enum ('open', 'settled', 'waived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type event_kind as enum ('personal', 'shared');
exception when duplicate_object then null; end $$;

do $$ begin
  create type recurrence_freq as enum ('daily', 'weekly', 'monthly');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- profiles — exactly two rows have is_member = true. Everyone else is a visitor.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  display_name   text not null,
  emoji          text not null default '🤍',
  color          text not null default '#C5A059',
  -- E.164 with country code, e.g. +60123456789. Never exposed to anon.
  phone_e164     text,
  phone_verified boolean not null default false,
  is_member      boolean not null default false,
  notify_prefs   jsonb not null default
                 '{"event_created":true,"handoff":true,"nudge":true,"penalty":true}'::jsonb,
  created_at     timestamptz not null default now(),
  -- A number is stored only once verified, so the two cannot drift apart.
  constraint phone_is_verified check (phone_e164 is null or phone_verified)
);

comment on column public.profiles.phone_e164 is
  'E.164 incl. country code. Written only by the verification flow; guaranteed verified.';

-- Visitor-safe projection: names/colors but no phone numbers.
-- Intentionally SECURITY DEFINER (the default) so it can read past the RLS
-- policy on profiles while exposing only non-sensitive columns.
create or replace view public.public_profiles as
  select id, display_name, emoji, color, is_member
  from public.profiles;

-- ---------------------------------------------------------------------------
-- deals — a custom agreement with a rotation rule and optional stakes
-- ---------------------------------------------------------------------------
create table if not exists public.deals (
  id                  uuid primary key default gen_random_uuid(),
  title               text not null,
  emoji               text not null default '🫧',
  description         text,
  rotation_type       rotation_type not null default 'alternating',

  -- paired deals only: mirror the fixed step owners at the end of each cycle
  swap_each_cycle     boolean not null default false,

  -- hours a turn may sit before it counts as overdue (null = never nags)
  grace_hours         integer check (grace_hours is null or grace_hours > 0),

  -- pre-agreed stakes, surfaced on the "Claim penalty" sheet
  penalty_title       text,
  penalty_description text,

  -- ---- live rotation state (owned by lib/rotation.ts) ----
  current_step_index  integer not null default 0,
  current_assignee_id uuid references public.profiles (id) on delete set null,
  cycle_parity        smallint not null default 0 check (cycle_parity in (0, 1)),
  turn_started_at     timestamptz default now(),
  last_completed_at   timestamptz,

  is_active           boolean not null default true,
  sort_order          integer not null default 0,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- deal_steps — ordered stages. 'alternating'/'adhoc' deals have exactly one.
-- ---------------------------------------------------------------------------
create table if not exists public.deal_steps (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references public.deals (id) on delete cascade,
  step_index      integer not null,
  label           text not null,
  -- fixed owner for 'paired' steps; null means "computed at runtime"
  assignee_id     uuid references public.profiles (id) on delete set null,
  notify_on_ready boolean not null default true,
  unique (deal_id, step_index)
);

create index if not exists deal_steps_deal_idx on public.deal_steps (deal_id, step_index);

-- ---------------------------------------------------------------------------
-- deal_logs — append-only completion history; the audit trail behind the state
-- ---------------------------------------------------------------------------
create table if not exists public.deal_logs (
  id              uuid primary key default gen_random_uuid(),
  deal_id         uuid not null references public.deals (id) on delete cascade,
  step_index      integer not null,
  step_label      text not null,
  assigned_to     uuid references public.profiles (id) on delete set null,
  completed_by    uuid references public.profiles (id) on delete set null,
  completed_at    timestamptz not null default now(),
  cycle_completed boolean not null default false,
  -- true when someone covered a turn that was not theirs
  was_takeover    boolean not null default false,
  note            text,
  source          text not null default 'dashboard'
);

create index if not exists deal_logs_deal_time_idx
  on public.deal_logs (deal_id, completed_at desc);
create index if not exists deal_logs_time_idx
  on public.deal_logs (completed_at desc);

-- ---------------------------------------------------------------------------
-- calendar_events — personal (owner_id set) or shared (owner_id null)
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_events (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  description text,
  location    text,
  starts_at   timestamptz not null,
  ends_at     timestamptz,
  all_day     boolean not null default false,
  kind        event_kind not null default 'shared',
  owner_id    uuid references public.profiles (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  -- stamped once the "new event" WhatsApp fan-out succeeds; keeps retries idempotent
  notified_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint ends_after_starts check (ends_at is null or ends_at >= starts_at),
  constraint personal_needs_owner check (kind <> 'personal' or owner_id is not null)
);

create index if not exists calendar_events_range_idx on public.calendar_events (starts_at);

-- ---------------------------------------------------------------------------
-- event_series — a recurrence rule.
--
-- Occurrences are NOT materialised. src/lib/recurrence.ts expands the rule
-- inside whatever window the calendar is showing, so "every Tuesday forever"
-- is one row rather than thousands, and editing the rule needs no backfill.
-- ---------------------------------------------------------------------------
create table if not exists public.event_series (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  location         text,
  starts_at        timestamptz not null,
  -- A duration, not an end instant: every occurrence is the same length.
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  all_day          boolean not null default false,
  kind             event_kind not null default 'shared',
  owner_id         uuid references public.profiles (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,
  -- The zone the rule is expressed in. "Weekly at 9am" means 9am HERE, which
  -- is what holds the time steady across a daylight-saving transition.
  timezone         text not null default 'Asia/Kuala_Lumpur',
  freq             recurrence_freq not null,
  interval         smallint not null default 1 check (interval between 1 and 52),
  -- Weekly only. 0 = Monday … 6 = Sunday. Null = same weekday as starts_at.
  byweekday        smallint[],
  until            timestamptz,
  count            smallint check (count is null or count > 0),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint personal_series_needs_owner check (kind <> 'personal' or owner_id is not null),
  constraint one_end_rule check (until is null or count is null),
  constraint weekday_range check (
    byweekday is null or (
      array_length(byweekday, 1) between 1 and 7
      and 0 <= all(byweekday) and 6 >= all(byweekday)
    )
  )
);

create index if not exists event_series_start_idx on public.event_series (starts_at);

-- ---------------------------------------------------------------------------
-- event_exceptions — per-occurrence deviations. One mechanism for both cases:
-- `cancelled` skips an occurrence, the nullable columns move or retitle one.
-- Keyed by the ORIGINAL generated instant, which is what the engine matches on.
-- ---------------------------------------------------------------------------
create table if not exists public.event_exceptions (
  id               uuid primary key default gen_random_uuid(),
  series_id        uuid not null references public.event_series (id) on delete cascade,
  occurrence_start timestamptz not null,
  cancelled        boolean not null default false,
  title            text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  location         text,
  description      text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (series_id, occurrence_start)
);

create index if not exists event_exceptions_series_idx
  on public.event_exceptions (series_id, occurrence_start);

-- ---------------------------------------------------------------------------
-- penalties — the owed ledger
-- ---------------------------------------------------------------------------
create table if not exists public.penalties (
  id           uuid primary key default gen_random_uuid(),
  deal_id      uuid references public.deals (id) on delete set null,
  title        text not null,
  description  text,
  owed_by      uuid not null references public.profiles (id) on delete cascade,
  owed_to      uuid not null references public.profiles (id) on delete cascade,
  status       penalty_status not null default 'open',
  claimed_by   uuid references public.profiles (id) on delete set null,
  claimed_at   timestamptz not null default now(),
  settled_at   timestamptz,
  settled_note text,
  constraint no_self_debt check (owed_by <> owed_to)
);

create index if not exists penalties_status_idx on public.penalties (status, claimed_at desc);

-- ---------------------------------------------------------------------------
-- message_templates — editable WhatsApp copy with {{variable}} placeholders
-- ---------------------------------------------------------------------------
create table if not exists public.message_templates (
  key        text primary key,
  label      text not null,
  body       text not null,
  enabled    boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- app_settings — single row. Provider *credentials* live in env, not here.
-- ---------------------------------------------------------------------------
create table if not exists public.app_settings (
  id                 boolean primary key default true check (id),
  whatsapp_provider  text not null default 'console',
  whatsapp_from      text,
  notifications_on   boolean not null default true,
  quiet_hours_start  smallint check (quiet_hours_start between 0 and 23),
  quiet_hours_end    smallint check (quiet_hours_end between 0 and 23),
  timezone           text not null default 'Asia/Kuala_Lumpur',
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- phone_verifications — one in-flight WhatsApp OTP challenge per profile.
--
-- RLS is enabled with NO policies below, which denies anon and authenticated
-- entirely while the service role bypasses RLS. The code hash and pending
-- number are therefore reachable only from Route Handlers.
--
-- This deliberately does not live on `profiles`: profiles_self_read lets each
-- member read the other's row, which would expose their partner's challenge.
-- ---------------------------------------------------------------------------
create table if not exists public.phone_verifications (
  profile_id        uuid primary key references public.profiles (id) on delete cascade,
  phone_e164        text not null,
  -- HMAC-SHA256(code, server pepper). Never the code itself.
  code_hash         text not null,
  expires_at        timestamptz not null,
  attempts          smallint not null default 0,
  sent_at           timestamptz not null default now(),
  send_count        smallint not null default 1,
  window_started_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- notification_log — delivery receipts, for the Settings > Activity panel
-- ---------------------------------------------------------------------------
create table if not exists public.notification_log (
  id           uuid primary key default gen_random_uuid(),
  trigger_key  text not null,
  provider     text not null,
  to_e164      text not null,
  body         text not null,
  ok           boolean not null,
  provider_id  text,
  error        text,
  created_at   timestamptz not null default now()
);

create index if not exists notification_log_time_idx on public.notification_log (created_at desc);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Membership check used by every write policy. SECURITY DEFINER so the policy
-- on profiles does not recurse into itself.
create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_member
  );
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists deals_touch on public.deals;
create trigger deals_touch before update on public.deals
  for each row execute function public.touch_updated_at();

drop trigger if exists events_touch on public.calendar_events;
create trigger events_touch before update on public.calendar_events
  for each row execute function public.touch_updated_at();

drop trigger if exists event_series_touch on public.event_series;
create trigger event_series_touch before update on public.event_series
  for each row execute function public.touch_updated_at();

-- Every new auth user gets a visitor profile; flip is_member by hand for the two.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row Level Security
--   read  → everyone, including anonymous visitors (the public board)
--   write → members only
-- ---------------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.deals             enable row level security;
alter table public.deal_steps        enable row level security;
alter table public.deal_logs         enable row level security;
alter table public.calendar_events   enable row level security;
alter table public.penalties         enable row level security;
alter table public.message_templates enable row level security;
alter table public.app_settings      enable row level security;
alter table public.notification_log  enable row level security;
alter table public.event_series      enable row level security;
alter table public.event_exceptions  enable row level security;

-- Deny-all by design: no policy is ever added for this table, so only the
-- service role (which bypasses RLS) can read or write challenges.
alter table public.phone_verifications enable row level security;

-- profiles: phone numbers stay private. Visitors read public_profiles instead.
drop policy if exists profiles_self_read on public.profiles;
create policy profiles_self_read on public.profiles
  for select using (auth.uid() = id or public.is_member());

drop policy if exists profiles_self_write on public.profiles;
create policy profiles_self_write on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

grant select on public.public_profiles to anon, authenticated;

-- Board content: world-readable, member-writable.
do $$
declare t text;
begin
  foreach t in array array[
    'deals', 'deal_steps', 'deal_logs', 'calendar_events', 'penalties', 'message_templates',
    -- event_exceptions MUST be publicly readable: a visitor who could read the
    -- series but not its cancellations would see plans that were called off.
    'event_series', 'event_exceptions'
  ] loop
    execute format('drop policy if exists %I_public_read on public.%I', t, t);
    execute format('create policy %I_public_read on public.%I for select using (true)', t, t);

    execute format('drop policy if exists %I_member_write on public.%I', t, t);
    execute format(
      'create policy %I_member_write on public.%I for all
         using (public.is_member()) with check (public.is_member())', t, t);
  end loop;
end $$;

-- Settings + delivery receipts are member-only in both directions.
drop policy if exists app_settings_member on public.app_settings;
create policy app_settings_member on public.app_settings
  for all using (public.is_member()) with check (public.is_member());

drop policy if exists notification_log_member on public.notification_log;
create policy notification_log_member on public.notification_log
  for select using (public.is_member());

-- ---------------------------------------------------------------------------
-- Realtime — drives live sync between the two phones and the public board
-- ---------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.deals;
  alter publication supabase_realtime add table public.deal_logs;
  alter publication supabase_realtime add table public.calendar_events;
  alter publication supabase_realtime add table public.penalties;
  alter publication supabase_realtime add table public.event_series;
  alter publication supabase_realtime add table public.event_exceptions;
exception when duplicate_object then null; end $$;
