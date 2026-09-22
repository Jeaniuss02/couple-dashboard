import { NextRequest } from 'next/server'

import { fail, guard, ok, optionalString, requireString, ValidationError } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Settings covers three things: the app-wide row, the caller's own profile
 * (including their WhatsApp number), and message template bodies.
 *
 * A member may only edit their *own* phone number — the RLS policy on profiles
 * enforces that too, this just gives a clearer error.
 */
export async function PATCH(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const body = await req.json()
    const supabase = createClient()

    if (body.profile) {
      const profile = body.profile as Record<string, unknown>

      // Phone numbers are owned by the verification flow, which is the only
      // thing that may write profiles.phone_e164. Accepting one here would
      // reintroduce unverified numbers through the side door.
      if ('phone_e164' in profile || 'phone_verified' in profile) {
        throw new ValidationError(
          'Phone numbers change through verification — use /api/phone/start.',
        )
      }

      const patch: Record<string, unknown> = {}
      if ('display_name' in profile) patch.display_name = requireString(profile.display_name, 'name', 40)
      if ('emoji' in profile) patch.emoji = optionalString(profile.emoji, 8) ?? '🤍'
      if ('color' in profile) patch.color = optionalString(profile.color, 9) ?? '#C5A059'
      if (profile.notify_prefs && typeof profile.notify_prefs === 'object') {
        patch.notify_prefs = profile.notify_prefs
      }

      const { error } = await supabase.from('profiles').update(patch).eq('id', me.id)
      if (error) return fail(error.message, 400)
    }

    if (body.settings) {
      const s = body.settings as Record<string, unknown>
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if ('notifications_on' in s) patch.notifications_on = s.notifications_on !== false
      if ('quiet_hours_start' in s) patch.quiet_hours_start = nullableHour(s.quiet_hours_start)
      if ('quiet_hours_end' in s) patch.quiet_hours_end = nullableHour(s.quiet_hours_end)
      if ('timezone' in s) patch.timezone = requireString(s.timezone, 'timezone', 64)

      const { error } = await supabase.from('app_settings').upsert({ id: true, ...patch })
      if (error) return fail(error.message, 400)
    }

    if (Array.isArray(body.templates)) {
      for (const raw of body.templates) {
        const t = raw as Record<string, unknown>
        const key = requireString(t.key, 'template key', 40)
        const { error } = await supabase.from('message_templates').upsert({
          key,
          label: requireString(t.label ?? key, 'template label', 80),
          body: requireString(t.body, 'template body', 1500),
          enabled: t.enabled !== false,
          updated_at: new Date().toISOString(),
        })
        if (error) return fail(error.message, 400)
      }
    }

    return ok({ saved: true })
  })
}

function nullableHour(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const hour = Number(value)
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new ValidationError('Quiet hours must be whole hours between 0 and 23.')
  }
  return hour
}
