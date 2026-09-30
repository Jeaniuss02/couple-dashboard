-- ===========================================================================
-- 004 — kisses
--
-- One row per kiss. A row-per-tap (rather than a daily counter column) means
-- the history is an audit trail: who kissed whom at what time, and a mis-tap
-- is undone by deleting the row rather than by mutating a number in place.
-- ===========================================================================

create table if not exists public.kisses (
  id         uuid primary key default gen_random_uuid(),
  -- Who tapped the button, not "who received" — same convention as deal_logs.
  logged_by  uuid references public.profiles (id) on delete set null,
  kissed_at  timestamptz not null default now()
);

-- Every read is "this week, newest first".
create index if not exists kisses_kissed_at_idx on public.kisses (kissed_at desc);

alter table public.kisses enable row level security;

-- Board content: world-readable, member-writable — the same shape as deals.
-- Move this to `using (public.is_member())` if the counter should be private.
drop policy if exists kisses_public_read on public.kisses;
create policy kisses_public_read on public.kisses for select using (true);

drop policy if exists kisses_member_write on public.kisses;
create policy kisses_member_write on public.kisses
  for all using (public.is_member()) with check (public.is_member());

-- Live sync: a tap on one phone updates the other without a reload.
do $$ begin
  alter publication supabase_realtime add table public.kisses;
exception when duplicate_object then null; end $$;
