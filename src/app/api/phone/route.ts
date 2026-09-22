import { NextRequest } from 'next/server'

import { fail, guard, ok } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { maskPhone } from '@/lib/phone'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** Current state of the caller's own number, for the Settings panel. */
export async function GET() {
  return guard(async () => {
    const me = await requireMember()
    const admin = createAdminClient()

    const [{ data: profile }, { data: pending }] = await Promise.all([
      admin.from('profiles').select('phone_e164, phone_verified').eq('id', me.id).maybeSingle(),
      admin
        .from('phone_verifications')
        .select('phone_e164, expires_at, sent_at, attempts')
        .eq('profile_id', me.id)
        .maybeSingle(),
    ])

    return ok({
      phone: profile?.phone_e164 ? maskPhone(profile.phone_e164) : null,
      verified: !!profile?.phone_verified && !!profile?.phone_e164,
      pending: pending
        ? {
            phone: maskPhone(pending.phone_e164),
            expiresAt: pending.expires_at,
            sentAt: pending.sent_at,
          }
        : null,
    })
  })
}

/**
 * Remove the caller's number, or abandon an in-flight challenge.
 * `?pending=1` drops only the challenge and leaves a verified number in place.
 */
export async function DELETE(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const admin = createAdminClient()
    const pendingOnly = req.nextUrl.searchParams.get('pending') === '1'

    await admin.from('phone_verifications').delete().eq('profile_id', me.id)

    if (!pendingOnly) {
      const { error } = await admin
        .from('profiles')
        .update({ phone_e164: null, phone_verified: false })
        .eq('id', me.id)
      if (error) return fail(error.message, 500)
    }

    return ok({ cleared: pendingOnly ? 'pending' : 'phone' })
  })
}
