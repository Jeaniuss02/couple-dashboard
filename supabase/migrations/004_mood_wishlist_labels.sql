-- ===========================================================================
-- 004 — mood tracking, wishlist, event colour labels, anniversary countdown
--
-- Safe to re-run. Run after schema.sql (and 002/003, which are idempotent).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Event colour labels
--
-- Stored as a name rather than an index so the database stays readable and a
-- future palette change cannot silently re-colour existing events.
-- ---------------------------------------------------------------------------
do $$ begin
  create type event_label as enum
    ('gold', 'camel', 'terracotta', 'olive', 'blush', 'plum', 'sky', 'sand');
exception when duplicate_object then null; end $$;

alter table public.calendar_events
  add column if not exists label event_label not null default 'camel';

alter table public.event_series
  add column if not exists label event_label not null default 'camel';

-- ---------------------------------------------------------------------------
-- mood_entries — one rating per person, per period.
--
-- `scope` lets the same table hold a daily check-in and a looser weekly one.
-- For a weekly entry, entry_date is the MONDAY of that week, so the unique
-- constraint does the de-duplication for us.
--
-- Deliberately NOT world-readable: how someone felt on a Tuesday is not
-- public-board material, even though the rest of the board is.
-- ---------------------------------------------------------------------------
create table if not exists public.mood_entries (
  id         uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null,
  scope      text not null default 'day' check (scope in ('day', 'week')),
  -- 1 rough … 5 wonderful
  score      smallint not null check (score between 1 and 5),
  note       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, entry_date, scope)
);

create index if not exists mood_entries_date_idx on public.mood_entries (entry_date desc);

-- ---------------------------------------------------------------------------
-- wishlist_items — things you two want to do, with a rough when.
-- ---------------------------------------------------------------------------
create table if not exists public.wishlist_items (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  note        text,
  -- Intentionally nullable: plenty of wishes have no date yet, and forcing one
  -- turns a wishlist into a to-do list.
  target_date date,
  -- null = shared wish; otherwise whose wish it is
  owner_id    uuid references public.profiles (id) on delete set null,
  status      text not null default 'open' check (status in ('open', 'done')),
  done_at     timestamptz,
  sort_order  integer not null default 0,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists wishlist_status_idx on public.wishlist_items (status, target_date);

-- ---------------------------------------------------------------------------
-- Anniversary, for the countdown. Stored rather than hardcoded so it can be
-- changed without a deploy — and so the countdown rolls over every year.
-- ---------------------------------------------------------------------------
alter table public.app_settings
  add column if not exists anniversary_date date;

alter table public.app_settings
  add column if not exists anniversary_label text not null default 'Our anniversary';

update public.app_settings
set anniversary_date = date '2026-10-24'
where anniversary_date is null;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------
drop trigger if exists mood_touch on public.mood_entries;
create trigger mood_touch before update on public.mood_entries
  for each row execute function public.touch_updated_at();

drop trigger if exists wishlist_touch on public.wishlist_items;
create trigger wishlist_touch before update on public.wishlist_items
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.mood_entries   enable row level security;
alter table public.wishlist_items enable row level security;

-- Mood: members only, both directions. Each partner may only write their OWN
-- rating — you can see how they felt, you cannot record it for them.
drop policy if exists mood_member_read on public.mood_entries;
create policy mood_member_read on public.mood_entries
  for select using (public.is_member());

drop policy if exists mood_own_write on public.mood_entries;
create policy mood_own_write on public.mood_entries
  for all using (auth.uid() = profile_id) with check (auth.uid() = profile_id);

-- Wishlist: same shape as the rest of the board — world-readable, member-writable.
drop policy if exists wishlist_public_read on public.wishlist_items;
create policy wishlist_public_read on public.wishlist_items
  for select using (true);

drop policy if exists wishlist_member_write on public.wishlist_items;
create policy wishlist_member_write on public.wishlist_items
  for all using (public.is_member()) with check (public.is_member());

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$ begin
  alter publication supabase_realtime add table public.mood_entries;
  alter publication supabase_realtime add table public.wishlist_items;
exception when duplicate_object then null; end $$;
