-- ===========================================================================
-- 003 — recurring events
--
-- Safe to run on an existing database. Fresh installs get this from schema.sql.
--
-- Occurrences are NOT materialised. A series stores a rule; the expansion
-- engine (src/lib/recurrence.ts) generates instances inside whatever window
-- the calendar is showing. "Every Tuesday forever" is one row, not 5,000.
-- ===========================================================================

do $$ begin
  create type recurrence_freq as enum ('daily', 'weekly', 'monthly');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- event_series — the rule
-- ---------------------------------------------------------------------------
create table if not exists public.event_series (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  location         text,

  -- The first occurrence, as an instant. Later ones are derived from it.
  starts_at        timestamptz not null,
  -- Held as a duration rather than an end instant: every occurrence is the
  -- same length, and an end time would have to be recomputed anyway.
  duration_minutes integer check (duration_minutes is null or duration_minutes >= 0),
  all_day          boolean not null default false,

  kind             event_kind not null default 'shared',
  owner_id         uuid references public.profiles (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,

  -- The zone the rule is expressed in. "Weekly at 9am" means 9am HERE, which
  -- is what keeps the time stable across a daylight-saving transition.
  timezone         text not null default 'Asia/Kuala_Lumpur',

  freq             recurrence_freq not null,
  interval         smallint not null default 1 check (interval between 1 and 52),
  -- Weekly only. 0 = Monday … 6 = Sunday. Null means "same weekday as starts_at".
  byweekday        smallint[],

  -- Two ways to stop, both optional. Null in both means it runs forever.
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
-- event_exceptions — per-occurrence deviations
--
-- One mechanism for both cases: `cancelled` skips the occurrence, and the
-- nullable override columns move or retitle a single one. Keyed by the
-- ORIGINAL generated instant, which is what the engine can match on.
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
-- RLS — same shape as the rest of the board: world-readable, member-writable.
--
-- Exceptions MUST be publicly readable. If a visitor could read the series but
-- not its cancellations, the board would show plans that were called off.
-- ---------------------------------------------------------------------------
alter table public.event_series     enable row level security;
alter table public.event_exceptions enable row level security;

do $$
declare t text;
begin
  foreach t in array array['event_series', 'event_exceptions'] loop
    execute format('drop policy if exists %I_public_read on public.%I', t, t);
    execute format('create policy %I_public_read on public.%I for select using (true)', t, t);

    execute format('drop policy if exists %I_member_write on public.%I', t, t);
    execute format(
      'create policy %I_member_write on public.%I for all
         using (public.is_member()) with check (public.is_member())', t, t);
  end loop;
end $$;

drop trigger if exists event_series_touch on public.event_series;
create trigger event_series_touch before update on public.event_series
  for each row execute function public.touch_updated_at();

do $$ begin
  alter publication supabase_realtime add table public.event_series;
  alter publication supabase_realtime add table public.event_exceptions;
exception when duplicate_object then null; end $$;
