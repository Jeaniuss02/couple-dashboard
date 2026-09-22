import { NextRequest } from 'next/server'

import { fail, guard, ok, optionalString, requireString, ValidationError } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { getMembers, nameLookup } from '@/lib/data'
import { createClient } from '@/lib/supabase/server'
import type { Penalty } from '@/lib/types'
import { notify } from '@/lib/whatsapp/notify'

export const dynamic = 'force-dynamic'

export async function GET() {
  return guard(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('penalties')
      .select('*')
      .order('claimed_at', { ascending: false })
    if (error) return fail(error.message, 500)
    return ok({ penalties: data as Penalty[] })
  })
}

/** Manual ledger entry — an IOU that did not come from a missed chore turn. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const body = await req.json()

    const profiles = await getMembers()
    const nameOf = nameLookup(profiles)
    const ids = new Set(profiles.map((p) => p.id))

    const owedBy = requireString(body.owed_by, 'owed_by', 64)
    const owedTo = requireString(body.owed_to, 'owed_to', 64)
    if (!ids.has(owedBy) || !ids.has(owedTo)) throw new ValidationError('Unknown member.')
    if (owedBy === owedTo) throw new ValidationError('You cannot owe yourself.')

    const title = requireString(body.title, 'title', 140)

    const supabase = createClient()
    const { data, error } = await supabase
      .from('penalties')
      .insert({
        deal_id: optionalString(body.deal_id, 64),
        title,
        description: optionalString(body.description, 400),
        owed_by: owedBy,
        owed_to: owedTo,
        claimed_by: me.id,
      })
      .select('*')
      .single()
    if (error) return fail(error.message, 400)

    const notification = await notify({
      key: 'penalty_claimed',
      audience: 'both',
      urgent: true,
      vars: {
        deal_name: optionalString(body.deal_name, 80) ?? 'an off-book agreement',
        penalty: title,
        owed_by: nameOf(owedBy),
        owed_to: nameOf(owedTo),
        actor: me.display_name,
      },
    })

    return ok({ penalty: data as Penalty, notification }, 201)
  })
}
