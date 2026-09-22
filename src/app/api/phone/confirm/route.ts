import { NextRequest } from 'next/server'

import { fail, guard, ok, requireString } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { checkCode, maskPhone, type ChallengeRecord } from '@/lib/phone'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * Confirm a challenge. Only here does a number ever reach `profiles.phone_e164`
 * — which is what makes "stored implies verified" hold, rather than being a
 * flag two code paths have to remember to keep in sync.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const body = await req.json().catch(() => ({}))
    const submitted = requireString(body.code, 'code', 12)

    const admin = createAdminClient()
    const { data: existing } = await admin
      .from('phone_verifications')
      .select('phone_e164, code_hash, expires_at, attempts, sent_at, send_count, window_started_at')
      .eq('profile_id', me.id)
      .maybeSingle()

    if (!existing) return fail('No code is waiting. Request a new one.', 404)

    const challenge = existing as ChallengeRecord & { code_hash: string }
    const result = checkCode(challenge, submitted)

    if (result.status === 'expired') {
      await admin.from('phone_verifications').delete().eq('profile_id', me.id)
      return fail('That code has expired. Request a new one.', 410)
    }

    if (result.status === 'locked') {
      await admin.from('phone_verifications').delete().eq('profile_id', me.id)
      return fail('Too many wrong attempts. Request a new code.', 429)
    }

    if (result.status === 'wrong_phone') {
      await admin.from('phone_verifications').delete().eq('profile_id', me.id)
      return fail('That challenge was malformed. Request a new one.', 422)
    }

    if (result.status === 'mismatch') {
      await admin
        .from('phone_verifications')
        .update({ attempts: challenge.attempts + 1 })
        .eq('profile_id', me.id)

      return fail(
        result.attemptsLeft > 0
          ? `That code doesn't match. ${result.attemptsLeft} ${
              result.attemptsLeft === 1 ? 'try' : 'tries'
            } left.`
          : 'That code doesn’t match. Request a new one.',
        422,
      )
    }

    const { error } = await admin
      .from('profiles')
      // phone_verified must be set in the same statement — the
      // phone_is_verified check constraint rejects the row otherwise.
      .update({ phone_e164: challenge.phone_e164, phone_verified: true })
      .eq('id', me.id)
    if (error) return fail(error.message, 500)

    await admin.from('phone_verifications').delete().eq('profile_id', me.id)

    return ok({ verified: true, phone: maskPhone(challenge.phone_e164) })
  })
}
