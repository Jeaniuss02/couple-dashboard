import { NextRequest } from 'next/server'

import { fail, guard, ok, oneOf, optionalString } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { getMembers, nameLookup } from '@/lib/data'
import { createClient } from '@/lib/supabase/server'
import type { Penalty, PenaltyStatus } from '@/lib/types'
import { notify } from '@/lib/whatsapp/notify'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** Mark settled (or waived, when someone is feeling generous). */
export async function PATCH(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const body = await req.json().catch(() => ({}))
    const status = oneOf<PenaltyStatus>(
      body.status ?? 'settled',
      ['open', 'settled', 'waived'] as const,
      'status',
    )

    const supabase = createClient()
    const { data, error } = await supabase
      .from('penalties')
      .update({
        status,
        settled_at: status === 'open' ? null : new Date().toISOString(),
        settled_note: optionalString(body.settled_note, 240),
      })
      .eq('id', id)
      .select('*')
      .single()
    if (error) return fail(error.message, 400)

    const penalty = data as Penalty
    let notification = null
    if (status === 'settled') {
      const nameOf = nameLookup(await getMembers())
      notification = await notify({
        key: 'penalty_settled',
        audience: 'both',
        vars: {
          penalty: penalty.title,
          owed_by: nameOf(penalty.owed_by),
          owed_to: nameOf(penalty.owed_to),
        },
      })
    }

    return ok({ penalty, notification })
  })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const supabase = createClient()
    const { error } = await supabase.from('penalties').delete().eq('id', id)
    if (error) return fail(error.message, 400)
    return ok({ id: id })
  })
}
