# Our Board

A shared living log, calendar and deal tracker for two people. Built for
micro-logging: every action on the board is one tap, and the app does the
remembering — whose turn it is, what hands off to whom, and who owes what.

- **Stack** — Next.js 14 (App Router), Tailwind, Supabase (Postgres + RLS +
  Realtime + magic-link auth), WhatsApp via Twilio / Meta Cloud API / webhook.
- **Roles** — two member accounts can write; everyone else gets a read-only
  public board with all action buttons hidden.

---

## 1. Setup

```bash
npm install
cp .env.example .env.local   # then fill it in
```

**Supabase**

1. Create a project, then run `supabase/schema.sql` in the SQL editor.
2. Have both partners sign in once at `/login` (magic link) so their
   `auth.users` rows exist.
3. Edit the two emails at the top of `supabase/seed.sql` and run it. That
   promotes both accounts to members, installs the message templates and
   creates two sample deals.
4. Copy the project URL, anon key and service-role key into `.env.local`.

**WhatsApp** — leave `WHATSAPP_PROVIDER=console` to start. Messages print to the
server log, so the whole flow is testable without credentials. Switch to
`twilio`, `meta` or `webhook` when you are ready and fill in that section of
`.env.example`.

```bash
npm run dev      # http://localhost:3000
npm test         # rotation engine
npm run typecheck
```

---

## 2. How the rotation engine works

All of it lives in [`src/lib/rotation.ts`](src/lib/rotation.ts) as pure
functions — no I/O — so the same code renders "Next up: …" in the browser and
computes the state transition on the server. 16 tests cover it in
[`rotation.test.ts`](src/lib/rotation.test.ts).

A turn is **sequential state, not a calendar rule**. If nobody eats at home for
three days, nothing happens; the state simply waits.

| Rotation type | Shape | Behaviour |
|---|---|---|
| `alternating` | 1 step | Completing it hands the next turn to the other person. |
| `paired` | 2+ steps, fixed owners | Finishing step *n* assigns step *n+1* and can fire a hand-off WhatsApp. Optionally mirrors the owners each full cycle. |
| `adhoc` | 1 step | No assignee; either partner logs it. |

Two design decisions worth knowing:

- **Alternation is anchored on who actually did the work**, not on who was
  scheduled. If Ava covers a turn that was Noor's, Noor is genuinely up next —
  which is also what makes the "I did it myself" forfeit option fair.
- **The grace window restarts at each hand-off**, not at the start of the cycle.
  `grace_hours` on the deal produces a `dueAt`; past it the turn reads as
  overdue and the other partner can call it out.

---

## 3. Database

`supabase/schema.sql` — full DDL, RLS policies, triggers and the Realtime
publication.

| Table | Holds |
|---|---|
| `profiles` | Both members plus visitors. Phone numbers are readable only by the owner and the service role; visitors read the `public_profiles` view instead. |
| `deals` | A custom agreement plus its live rotation state (`current_step_index`, `current_assignee_id`, `cycle_parity`, `turn_started_at`). |
| `deal_steps` | Ordered stages with optional fixed owners. |
| `deal_logs` | Append-only completion history — the audit trail behind the state. |
| `calendar_events` | One-off plans. Personal (`owner_id` set) or shared. |
| `event_series` | A recurrence rule. Occurrences are generated, never stored. |
| `event_exceptions` | Per-occurrence deviations — cancelled, moved or retitled. |
| `penalties` | The owed ledger. |
| `message_templates` | Editable WhatsApp copy with `{{variables}}`. |
| `app_settings` | Provider name, quiet hours, timezone. Credentials stay in env. |
| `notification_log` | Delivery receipts. Verification codes are redacted here. |
| `phone_verifications` | In-flight OTP challenges. **RLS enabled with zero policies** — deny-all except the service role. |

RLS shape: **read is public on all board content, write requires
`public.is_member()`**. That single function is what makes visitor mode safe
without a second code path.

---

## 4. API

Every mutating handler calls `requireMember()` before touching data, so a
visitor gets a clear 403 rather than a confusing empty result.

| Route | Does | WhatsApp |
|---|---|---|
| `POST /api/events` | Create a plan — or a series, with `recurrence` | → **both** (trigger 1) |
| `GET /api/events?from&to` | One-off events + expanded occurrences | — |
| `PATCH/DELETE /api/events/:id` | Edit / remove a one-off | quiet — only new plans buzz |
| `PATCH/DELETE /api/series/:id` | Edit the rule; `?from=` ends it there | — |
| `POST/DELETE /api/series/:id/occurrence` | Cancel, move or restore one occurrence | — |
| `POST /api/deals` | Create a custom deal with steps | — |
| `PATCH /api/deals/:id` | Edit, archive, or `{action:'rotate'}` to swap turns | — |
| `POST /api/deals/:id/complete` | One-tap completion + state advance | → partner on hand-off (trigger 2) |
| `POST /api/deals/:id/nudge` | Gentle nudge | → assignee (trigger 3) |
| `POST /api/deals/:id/claim` | Claim a forfeit | → **both** (trigger 4) |
| `POST /api/penalties`, `PATCH /api/penalties/:id` | Ledger add / settle | → both |
| `PATCH /api/settings` | Profile, app settings, templates | — |
| `POST /api/phone/start` | Send a verification code | → the number being claimed |
| `POST /api/phone/confirm` | Check the code, promote the number | — |
| `GET/DELETE /api/phone` | Read state / remove number or abandon a challenge | — |
| `POST /api/whatsapp/test` | Prove the chain end to end | → you or both |

**Failure policy:** the database write commits before dispatch, and `notify()`
never throws. A WhatsApp outage can't roll back a calendar event you already
watched land on the board — the response reports what was actually delivered,
and the toast tells you ("Added to the calendar · WhatsApp sent to 2").

**Quiet hours** hold automatic messages but never nudges or penalty call-outs;
those are deliberate taps.

### Key safety

`src/lib/whatsapp/providers.ts` and `src/lib/supabase/admin.ts` both start with
`import 'server-only'`. Importing either from a Client Component is a build
error, so provider credentials and the service-role key cannot reach the
browser. Only `NEXT_PUBLIC_SUPABASE_URL` and the RLS-governed anon key are
exposed.

The Meta adapter retries through an approved template when Graph returns
`131047` (outside the 24-hour customer-service window), so the app keeps
working at 3am.

---

## 4a. Phone verification

Codes are delivered over WhatsApp itself — which is exactly the property being
proven. Rules live in [`src/lib/phone.ts`](src/lib/phone.ts) as pure functions
(20 tests in [`phone.test.ts`](src/lib/phone.test.ts)).

| | |
|---|---|
| Code | 6 digits, `crypto.randomInt`, 10-minute expiry |
| Stored as | HMAC-SHA256 with a server pepper, bound to the phone number |
| Attempts | 5, then the challenge is destroyed |
| Resend | 60s cooldown, max 5 per rolling hour |

Four decisions worth knowing:

- **`profiles.phone_e164` is written only on successful verification**, and a
  `phone_is_verified` check constraint enforces it at the database level. So
  "stored" and "verified" cannot drift — it is an invariant, not a flag two
  code paths have to remember. `PATCH /api/settings` rejects a phone number
  outright and points at the verification endpoint.
- **HMAC, not a bare hash.** A 6-digit code is only a million possibilities; a
  plain digest would fall to an offline sweep the moment the database leaked.
  The pepper lives in the environment, so a database leak alone is not enough.
  The number is mixed into the HMAC too, so a hash captured for one number
  cannot be replayed against a challenge issued for another.
- **Your old number keeps working** until the new one confirms. The pending
  number lives in `phone_verifications`, never on `profiles`.
- **Verification sends bypass quiet hours and `notify_prefs`** — it is an
  account action you just asked for, not board activity. It also skips the
  editable template system entirely, so neither partner can reword the code out
  of their own message.

`notify()` skips unverified numbers and says so in `outcome.skipped`, which
surfaces in the UI toast. Numbers seeded by `seed.sql` are treated as
admin-asserted and marked verified; set them to `NULL` there if you would
rather each partner prove their own.

---

## 4b. Recurring events

Rules in [`src/lib/recurrence.ts`](src/lib/recurrence.ts), 24 tests in
[`recurrence.test.ts`](src/lib/recurrence.test.ts). Supports daily / weekly /
monthly, an interval, multiple weekdays, and ending on a date or after N times.

**Occurrences are expanded on read, never materialised.** "Every Tuesday
forever" is one row. The calendar always asks for a bounded window, which is
exactly what expansion needs, and changing a rule needs no backfill. Expansion
runs server-side so the dashboard and calendar cannot drift, and so it uses the
series' own timezone rather than whatever zone the server happens to run in.

Four decisions worth knowing:

- **DST is handled by calendar arithmetic, not millisecond addition.** Adding
  7×24h to a 9am weekly event silently moves it to 8am after the clocks change.
  The engine steps through `TZDate` in the series' timezone instead, so the
  wall-clock time holds and the *instant* shifts — which is correct. There is a
  test that walks a London series across the October transition.
- **Monthly skips short months rather than clamping.** The 31st simply does not
  occur in February, per RFC 5545. Clamping to the 28th would collapse
  neighbouring occurrences onto the wrong dates and produce duplicates.
- **Exceptions are keyed by the original generated instant**, matched on the
  parsed timestamp rather than the string — so `…Z` and `+08:00` compare equal.
  One table covers both cancelling and moving.
- **"Delete this and all later" sets `until`**, it does not erase history. Past
  occurrences stay on the record, which is what you want for a shared log.

Deleting a recurring occurrence asks which you meant: this one, this and all
later, or the whole series.

---

## 5. Front end

| Route | Component | Notes |
|---|---|---|
| `/` | `DealList`, dashboard | Deals sorted overdue → due → yours → rest. |
| `/calendar` | `Calendar` | Month / week / day, deal overlays, day drawer with the same one-tap controls. |
| `/deals` | `DealsManager` + `DealBuilder` | Rotation rules, step chain, grace window, stakes. |
| `/ledger` | `PenaltyLedger` | Net balance, filters, mark settled. |
| `/settings` | `SettingsPanel` | Phone, prefs, quiet hours, live template preview. |

Realtime: `useRealtimeRefresh` subscribes to `postgres_changes` and calls
`router.refresh()` (debounced 250ms, since one completion writes both a log and
a deal patch). Server Components stay the source of truth.

### Palette

Defined once in `tailwind.config.ts`; components use tokens, never raw hex.

| Token | Hex | Used for |
|---|---|---|
| `gold` / `gold-deep` | `#D4AF37` / `#C5A059` | Accents, your-turn state |
| `camel` | `#C19A6B` | Secondary accents |
| `linen` | `#FAF7F2` | Background |
| `espresso` | `#2B2625` | Type, primary buttons |
| `terracotta` | `#C97A63` | Overdue, penalties |
| `olive` | `#8F9779` | Completed |
| `whatsapp` | `#25D366` | **Only** buttons that send a message |

---

## 6. Known gaps

- **Existing databases need the migrations** — run everything in
  `supabase/migrations/` in order. Fresh installs get it all from `schema.sql`.
- **Editing one occurrence** — the API supports moving or retitling a single
  occurrence (`POST /api/series/:id/occurrence`), but the UI only exposes
  cancelling. The engine and tests cover the move path already.
- **Yearly recurrence and "third Thursday"** — not supported. Daily, weekly
  (incl. multiple weekdays) and monthly-by-date only.
- **Timezone** — `app_settings.timezone` governs quiet hours; each series
  records the zone it was created in; the UI renders in the viewer's local
  zone. Fine for two people in one place, not for a long-distance couple.
