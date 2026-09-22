import { NextRequest } from 'next/server'

import { fail, guard, ok, oneOf, optionalString } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { getMembers, membersPair, nameLookup } from '@/lib/data'
import { claimForfeit, type ClaimResolution } from '@/lib/rotation'
import { createClient } from '@/lib/supabase/server'
import type { DealStep, DealWithSteps, Penalty } from '@/lib/types'
import { notify } from '@/lib/whatsapp/notify'

export const dynamic = 'force-dynamic'

const RESOLUTIONS = ['takeover', 'rotate', 'keep'] as const

/**
 * "Call out / claim penalty" (notification trigger #4).
 *
 * Writes the forfeit to the ledger, applies the chosen resolution to the
 * rotation state, and tells both partners — a penalty nobody sees is just
 * resentment with extra steps.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await params
    const me = await requireMember()
    const body = await req.json().catch(() => ({}))
    const resolution = oneOf<ClaimResolution>(body.resolution ?? 'takeover', RESOLUTIONS, 'resolution')

    const supabase = createClient()
    const { data, error } = await supabase
      .from('deals')
      .select('*, steps:deal_steps(*)')
      .eq('id', id)
      .single()
    if (error || !data) return fail('Deal not found.', 404)

    const deal = {
      ...(data as DealWithSteps),
      steps: [...(((data as DealWithSteps).steps ?? []) as DealStep[])].sort(
        (x, y) => x.step_index - y.step_index,
      ),
    }

    const profiles = await getMembers()
    const nameOf = nameLookup(profiles)
    const result = claimForfeit(deal, membersPair(profiles), { claimedBy: me.id, resolution })

    if (!result.owedBy) return fail('Could not work out whose turn was missed.', 422)
    if (result.owedBy === me.id) return fail('That turn is yours — nothing to claim.', 422)

    if (result.log) await supabase.from('deal_logs').insert(result.log)
    if (Object.keys(result.patch).length > 0) {
      await supabase.from('deals').update(result.patch).eq('id', deal.id)
    }

    const penaltyTitle =
      optionalString(body.title, 140) ?? deal.penalty_title ?? `Missed turn — ${deal.title}`

    const { data: penaltyRow, error: penaltyError } = await supabase
      .from('penalties')
      .insert({
        deal_id: deal.id,
        title: penaltyTitle,
        description: optionalString(body.description) ?? deal.penalty_description,
        owed_by: result.owedBy,
        owed_to: result.owedTo,
        claimed_by: me.id,
      })
      .select('*')
      .single()
    if (penaltyError) return fail(penaltyError.message, 400)

    const notification = await notify({
      key: 'penalty_claimed',
      audience: 'both',
      urgent: true,
      vars: {
        deal_name: deal.title,
        penalty: penaltyTitle,
        owed_by: nameOf(result.owedBy),
        owed_to: nameOf(result.owedTo),
        actor: me.display_name,
      },
    })

    return ok(
      {
        penalty: penaltyRow as Penalty,
        resolution,
        next: { ...result.next, assigneeName: nameOf(result.next.assigneeId) },
        notification,
      },
      201,
    )
  })
}
