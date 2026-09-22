import { NextRequest } from 'next/server'

import { fail, guard, ok, requireString } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import {
  canSend,
  expiryFrom,
  generateCode,
  hashCode,
  maskPhone,
  normalizeE164,
  RESEND_COOLDOWN_SECONDS,
  verificationMessage,
  type ChallengeRecord,
} from '@/lib/phone'
import { createAdminClient } from '@/lib/supabase/admin'
import { activeProvider, send } from '@/lib/whatsapp/providers'

export const dynamic = 'force-dynamic'

/**
 * Start (or restart) a WhatsApp verification challenge for the caller's own
 * number. The code goes out over the same transport the app uses for
 * notifications — which is precisely the thing being proven.
 *
 * Sends bypass quiet hours and notify_prefs on purpose: this is an
 * account action the user just asked for, not a notification about the board.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const body = await req.json().catch(() => ({}))

    const phone = normalizeE164(requireString(body.phone, 'phone', 24))
    if (!phone) {
      return fail(
        'Use the international format with a country code, e.g. +60123456789.',
        422,
      )
    }

    const admin = createAdminClient()

    // The partner's number must not be claimable — otherwise one of you could
    // quietly route the other's alerts to your own phone.
    const { data: taken } = await admin
      .from('profiles')
      .select('id')
      .eq('phone_e164', phone)
      .neq('id', me.id)
      .maybeSingle()
    if (taken) return fail('That number is already in use on this board.', 409)

    const { data: existing } = await admin
      .from('phone_verifications')
      .select('phone_e164, expires_at, attempts, sent_at, send_count, window_started_at')
      .eq('profile_id', me.id)
      .maybeSingle()

    const now = new Date()
    const decision = canSend((existing as ChallengeRecord | null) ?? null, now)
    if (!decision.allowed) {
      return fail(decision.reason, 429)
    }

    const code = generateCode()
    const { error: upsertError } = await admin.from('phone_verifications').upsert({
      profile_id: me.id,
      phone_e164: phone,
      code_hash: hashCode(code, phone),
      expires_at: expiryFrom(now),
      attempts: 0,
      sent_at: now.toISOString(),
      send_count: decision.windowReset ? 1 : (existing?.send_count ?? 0) + 1,
      window_started_at: decision.windowReset
        ? now.toISOString()
        : (existing?.window_started_at ?? now.toISOString()),
    })
    if (upsertError) return fail(upsertError.message, 500)

    const result = await send({ to: phone, body: verificationMessage(code) })

    await admin.from('notification_log').insert({
      trigger_key: 'phone_verification',
      provider: result.provider ?? activeProvider(),
      to_e164: phone,
      // The code never reaches the log — a delivery receipt should not be a
      // second place the secret lives.
      body: '[verification code redacted]',
      ok: result.ok,
      provider_id: result.providerId ?? null,
      error: result.error ?? null,
    })

    if (!result.ok) {
      // Clear the challenge so a failed send does not burn the hourly budget.
      await admin.from('phone_verifications').delete().eq('profile_id', me.id)
      return fail(
        `Could not send the code: ${result.error ?? 'unknown provider error'}`,
        502,
      )
    }

    return ok({
      sentTo: maskPhone(phone),
      expiresAt: expiryFrom(now),
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
      provider: result.provider,
    })
  })
}
