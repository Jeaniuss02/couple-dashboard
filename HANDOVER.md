# Technical handover — "Our Board" (couple-dashboard)

For whoever is taking over **hosting**. Written for an engineer, so it assumes you know Next.js and Supabase; it only covers what is specific (and surprising) about this app.

Repo: `github.com/Jeaniuss02/couple-dashboard`
Supabase project ref: `pjcxokexcoigqbobyhmv` (region **ap-southeast-1 / Singapore**)

---

## 1. What it is, and the one thing that dictates hosting

A two-person private life board: rotation chores ("whose turn is it" — **state-based, not calendar-based**), penalty/IOU ledger, shared calendar with recurrence, moods, wishlist, and a one-tap kiss counter. Two member accounts can write; everyone else gets a read-only public board.

Stack: **Next.js 16.3.5** (App Router, Turbopack, React 19.2.8, Tailwind 4), `@supabase/ssr` 0.5.2, `@supabase/supabase-js` 2.x, `date-fns` 4 + `@date-fns/tz`, vitest.

**It is a server app, not a static site.** No `output: 'export'`. It needs:

- middleware (refreshes the Supabase session cookie on every request),
- Route Handlers under `/api/*` (some use the Supabase **service-role** key),
- cookie-based auth (Server Components read the session),
- and every page is `dynamic = 'force-dynamic'`.

So: **a Node runtime, or a platform that can actually run Next.js.** Two viable paths:

| Path | Notes |
|---|---|
| Own server (recommended for least risk) | Node 20+. `npm ci && npm run build && npm start` (or `.next/standalone/server.js`), behind nginx / Cloudflare tunnel. Nothing else to configure. |
| Cloudflare Workers | Use `@opennextjs/cloudflare` — OpenNext supports **all Next.js 16 minor/patch versions**. Expect roughly a 13.8 MB worker upload (≈2.3 MB gzip). Do **not** use `next-on-pages`; it does not cover App Router route handlers + middleware reliably. |

## 2. Put the runtime next to the database

The database is in **Singapore**. Where the app runs matters more than anything else on this page.

Current live deployment is on Vercel, whose default function region is **iad1 (Washington DC)**. Measured from Kuala Lumpur:

- live page TTFB: **1.2–1.4 s** warm, 3.4 s cold
- Supabase REST from the same machine: **75–100 ms** warm

Every server render makes several Supabase round trips, so the ~250 ms US↔SG hop is paid several times per page. **Run the app in Singapore / Malaysia / anywhere in SEA** (Cloudflare Workers land at the nearest edge; a local VPS is ideal) and the same page should drop to a few hundred ms. If it is still slow after that, the bottleneck is elsewhere — measure before rebuilding anything.

(Vercel users: Project → Settings → Functions → Function Region → `sin1`, then redeploy. This is the 30-second version of the same fix.)

## 3. Environment variables

Only four are read. `grep -r "process.env" src` to confirm.

```
NEXT_PUBLIC_SUPABASE_URL=https://pjcxokexcoigqbobyhmv.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_...     # client-safe, RLS governs it
SUPABASE_SERVICE_ROLE_KEY=sb_secret_...              # SERVER ONLY — never NEXT_PUBLIC_
WHATSAPP_PROVIDER=console                            # console | twilio | meta | webhook
```

- `NEXT_PUBLIC_*` are **inlined at build time** — they must be present in the build environment, not just at runtime.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. It is used only in server-side modules that both start with `import 'server-only'` (`src/lib/supabase/admin.ts`, `src/lib/whatsapp/providers.ts`), so importing one from a Client Component is a build error by construction.
- `.env.example` also lists `NEXT_PUBLIC_SITE_URL`, `APP_TIMEZONE`, `PHONE_VERIFICATION_SECRET` and Twilio/Meta blocks. **Nothing reads SITE_URL or APP_TIMEZONE** — don't bother setting them. `PHONE_VERIFICATION_SECRET` is optional (falls back to the service-role key); it peppers the HMAC over WhatsApp verification codes.

Get the secret key from Supabase → Project Settings → API Keys → Secret keys.

## 4. Supabase side — what must change when the domain changes

**Authentication → URL Configuration** is currently the #1 source of "the login link is broken":

- **Site URL** must be the new production origin (today: `https://couple-dashboard-neon.vercel.app`).
- **Redirect URLs** must include `<origin>/auth/callback` (and `<origin>/**` is convenient).
- Anything not allow-listed silently falls back to the Site URL — which is why a magic link once landed on `http://localhost:3000/?error=...`.

Auth model, worth knowing before you touch it:

- **Email + password** is the primary method (accounts are pre-created in the dashboard with *Auto Confirm User*; there is no signup UI). Magic link still exists as a fallback, but Supabase's built-in mail service **only delivers to addresses on the project's own team** and is capped at **2 messages/hour**, so it works for the owner and nobody else. Custom SMTP is the fix if email auth is ever needed for both people.
- **RLS shape:** read is public on all board content; every write requires `public.is_member()`. A signed-in account whose `profiles.is_member` is `false` sees a read-only board with **every action button hidden** — this is the single most common "the app is broken" report, and it is not a bug when it happens.
- **Realtime:** the browser subscribes to `postgres_changes` on `deals, deal_logs, calendar_events, penalties, event_series, event_exceptions, kisses`. Those tables must stay in the `supabase_realtime` publication (schema does it) or live sync silently stops.
- **Time zone:** "today" and "this week" are computed in `Asia/Kuala_Lumpur` via `TZDate`, deliberately not in the server's zone. Vercel renders in UTC; do not "simplify" this back to `new Date()`.

### SQL to apply, in order

| File | When |
|---|---|
| `supabase/schema.sql` | fresh database — full DDL, RLS, triggers, realtime publication, `is_member()` |
| `supabase/migrations/002,003,004,005_*.sql` | only for a database that already existed at that point (005 = kisses) |
| `supabase/seed-starter.sql` | promotes the two accounts by `display_name`, installs message templates, app settings and two sample deals. Idempotent except that sample deals are skipped once any deal exists. |
| `supabase/cleanup-duplicate-deals.sql` | one-off, if the seed was ever run more than once |
| `supabase/reset-password.sql` | admin password reset via `crypt()`/`gen_salt()` on `auth.users.encrypted_password` |

## 5. Build and verify

```
npm ci
npm test          # 67 tests — rotation engine, recurrence, phone, kisses
npm run typecheck
npm run build
```

`npm run lint` **fails on a pre-existing error** in `src/components/Calendar.tsx` (`react-hooks/set-state-in-effect`), plus warnings in `Wishlist.tsx` / `recurrence.ts`. It is not a gate; `build` + `typecheck` are. After renaming a route, stale `.next/types/validator.ts` errors clear once you run `npm run build` once.

## 6. Gotchas

- **Routes were renamed while this was in flight:** `/deals` → `/tasks`, `/ledger` → `/compensation`, plus `/wishlist`. The API paths stayed `/api/deals`, `/api/penalties`. `supabase/seed-starter.sql` and the README still say "deals" in places.
- **`/compensation` is a legacy route** kept alive so old links work; the ledger is now rendered inside `/tasks`.
- **Multiple contributors.** The owner's other laptop also commits (Claude Code), and an agent commits from hers. Always `git fetch` before pushing; pushes have been rejected twice for this reason. Work on one machine at a time.
- **Deployment protection:** Vercel's "Require Log In" toggle walled the whole project (even production aliases) — that is off now. If a platform adds an equivalent gate, visitors will hit a login screen and the board will look broken.
- **`kisses` and other feature tables can be missing** and the UI degrades on purpose (`getKissStats()` returns `available: false` and the button hides). Missing table ≠ broken build.
- **Windows note:** `curl -o` with an MSYS path (`~/x`) fails silently (exit 23). Use relative or `C:/...` paths.

## 7. Cutover checklist

1. Get access: repo collaborator (write) + Supabase organisation member (so no secret key is ever pasted into a chat).
2. Deploy somewhere in SEA; set the four env vars **before** the build.
3. Point the domain / TLS at the new host.
4. Update Supabase → Authentication → URL Configuration (Site URL + Redirect URLs) to the new origin.
5. Verify: page loads, `/api/kisses` returns `{"ok":true,...}`, both accounts can sign in, one tap on **✓ Done** flips the turn to the other person, one tap on 💋 increments the counter and the partner's phone updates without a reload (Realtime).
6. Only then retire the Vercel project.
