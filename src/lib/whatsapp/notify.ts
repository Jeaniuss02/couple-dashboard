import 'server-only'

import { createAdminClient } from '@/lib/supabase/admin'
import type { MemberContact } from '@/lib/types'
import { activeProvider, isValidE164, send, type SendResult } from './providers'
import { DEFAULT_TEMPLATES, render, type TemplateKey, type TemplateVars } from './templates'

export type NotifyAudience = 'both' | { only: string | null } | { except: string | null }

export interface NotifyArgs {
  key: TemplateKey
  vars: TemplateVars
  audience: NotifyAudience
  /** Nudges and penalty call-outs are deliberate taps — they ignore quiet hours. */
  urgent?: boolean
}

export interface NotifyOutcome {
  attempted: number
  sent: number
  skipped: string[]
  results: (SendResult & { to: string; name: string })[]
}

/**
 * Loads both partners, renders the template, and fans out.
 *
 * Failures never throw: a WhatsApp outage must not roll back a calendar event
 * that the user already saw land on the board. Callers surface `outcome`.
 */
export async function notify(args: NotifyArgs): Promise<NotifyOutcome> {
  const outcome: NotifyOutcome = { attempted: 0, sent: 0, skipped: [], results: [] }

  let admin: ReturnType<typeof createAdminClient>
  try {
    admin = createAdminClient()
  } catch (err) {
    outcome.skipped.push(err instanceof Error ? err.message : 'admin client unavailable')
    return outcome
  }

  const [{ data: settings }, { data: members }, { data: tpl }] = await Promise.all([
    admin.from('app_settings').select('*').eq('id', true).maybeSingle(),
    admin
      .from('profiles')
      .select('id, display_name, emoji, color, is_member, phone_e164, phone_verified, notify_prefs')
      .eq('is_member', true),
    admin.from('message_templates').select('*').eq('key', args.key).maybeSingle(),
  ])

  if (settings && settings.notifications_on === false) {
    outcome.skipped.push('notifications are switched off in settings')
    return outcome
  }
  if (tpl && tpl.enabled === false) {
    outcome.skipped.push(`template "${args.key}" is disabled`)
    return outcome
  }
  if (!args.urgent && settings && inQuietHours(settings.quiet_hours_start, settings.quiet_hours_end, settings.timezone)) {
    outcome.skipped.push('quiet hours')
    return outcome
  }

  const body = render(tpl?.body ?? DEFAULT_TEMPLATES[args.key].body, args.vars)
  const recipients = pickRecipients((members ?? []) as MemberContact[], args.audience, args.key)

  for (const person of recipients) {
    if (!isValidE164(person.phone_e164)) {
      outcome.skipped.push(`${person.display_name} has no WhatsApp number yet`)
      continue
    }
    // Belt and braces: the phone_is_verified constraint should make this
    // unreachable, but a number that was never confirmed must never receive
    // board activity — that is the whole point of the verification flow.
    if (!person.phone_verified) {
      outcome.skipped.push(`${person.display_name}’s number is not verified`)
      continue
    }
    outcome.attempted += 1

    const result = await send({ to: person.phone_e164, body })
    if (result.ok) outcome.sent += 1
    outcome.results.push({ ...result, to: person.phone_e164, name: person.display_name })

    await admin.from('notification_log').insert({
      trigger_key: args.key,
      provider: result.provider ?? activeProvider(),
      to_e164: person.phone_e164,
      body,
      ok: result.ok,
      provider_id: result.providerId ?? null,
      error: result.error ?? null,
    })
  }

  return outcome
}

function pickRecipients(
  members: MemberContact[],
  audience: NotifyAudience,
  key: TemplateKey,
): MemberContact[] {
  const prefKey = prefFor(key)
  const opted = members.filter((m) => m.notify_prefs?.[prefKey] !== false)

  if (audience === 'both') return opted
  if ('only' in audience) return opted.filter((m) => m.id === audience.only)
  return opted.filter((m) => m.id !== audience.except)
}

function prefFor(key: TemplateKey): keyof MemberContact['notify_prefs'] {
  switch (key) {
    case 'event_created':
      return 'event_created'
    case 'nudge':
      return 'nudge'
    case 'penalty_claimed':
    case 'penalty_settled':
      return 'penalty'
    default:
      return 'handoff'
  }
}

/** Handles windows that wrap midnight, e.g. 23 → 07. */
function inQuietHours(start: number | null, end: number | null, timezone: string): boolean {
  if (start == null || end == null || start === end) return false
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: timezone }).format(
      new Date(),
    ),
  )
  return start < end ? hour >= start && hour < end : hour >= start || hour < end
}
