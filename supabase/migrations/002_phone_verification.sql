-- ===========================================================================
-- 002 — phone verification
--
-- Safe to run on an existing database. Fresh installs get this from schema.sql.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- phone_verifications — one in-flight challenge per profile.
--
-- RLS is ENABLED WITH NO POLICIES. That is deliberate: it denies anon and
-- authenticated entirely, while the service role bypasses RLS. The code hash
-- and the pending number are therefore reachable only from Route Handlers.
--
-- This must not live on `profiles`: the profiles_self_read policy lets each
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
  -- Sliding window for the per-hour send cap.
  send_count        smallint not null default 1,
  window_started_at timestamptz not null default now()
);

alter table public.phone_verifications enable row level security;

comment on table public.phone_verifications is
  'RLS enabled with zero policies — service role only. Do not add a policy.';

-- ---------------------------------------------------------------------------
-- Invariant: profiles.phone_e164 is set only after a successful verification,
-- so "stored" and "verified" cannot drift apart.
-- ---------------------------------------------------------------------------
alter table public.profiles
  drop constraint if exists phone_is_verified;

alter table public.profiles
  add constraint phone_is_verified
  check (phone_e164 is null or phone_verified);

comment on column public.profiles.phone_e164 is
  'E.164. Written only by the verification flow; guaranteed verified.';

-- Any number already stored predates this flow. Trust the admin who seeded it
-- rather than silently cutting off notifications.
update public.profiles
set phone_verified = true
where phone_e164 is not null and not phone_verified;
