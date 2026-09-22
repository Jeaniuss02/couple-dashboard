import { NextRequest } from 'next/server'

import { fail, guard, ok, optionalString } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { getMembers, membersPair, nameLookup } from '@/lib/data'
import { format } from '@/lib/dates'
import { completeCurrentStep } from '@/lib/rotation'
import { createClient } from '@/lib/supabase/server'
import type { DealStep, DealWithSteps } from '@/lib/types'
import { notify } from '@/lib/whatsapp/notify'

export const dynamic = 'force-dynamic'

/**
 * One-tap completion. Timestamps the step, advances the rotation state, and —
 * when the baton passes mid-cycle — pings the partner who is now up
 * (notification trigger #2).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await params
    const me = await requireMember()
    const body = await req.json().catch(() => ({}))
    const supabase = createClient()

    const { data, error } = await supabase
      .from('deals')
      .select('*, steps:deal_steps(*)')
      .eq('id', id)
      .single()
    if (error || !data) return fail('Deal not found.', 404)

    const deal = normalize(data as DealWithSteps)
    if (deal.steps.length === 0) return fail('This deal has no steps yet.', 422)

    const profiles = await getMembers()
    const members = membersPair(profiles)
    const nameOf = nameLookup(profiles)

    const result = completeCurrentStep(deal, members, {
      completedBy: me.id,
      note: optionalString(body.note, 300),
      source: typeof body.source === 'string' ? body.source : 'dashboard',
    })

    const [{ error: logError }, { error: patchError }] = await Promise.all([
      supabase.from('deal_logs').insert(result.log),
      supabase.from('deals').update(result.patch).eq('id', deal.id),
    ])
    if (logError || patchError) return fail((logError ?? patchError)!.message, 400)

    const dueLine = result.handoff?.dueAt
      ? `\n⏰ by ${format(new Date(result.handoff.dueAt), 'h:mm a')}`
      : ''

    let notification = null
    if (result.handoff) {
      // Mid-cycle hand-off: only the person now holding the baton needs this.
      notification = await notify({
        key: 'handoff',
        audience: { only: result.handoff.to },
        vars: {
          deal_name: deal.title,
          previous_step: result.handoff.fromStepLabel,
          step_name: result.handoff.toStepLabel,
          assigned_to: nameOf(result.handoff.to),
          actor: me.display_name,
          due_line: dueLine,
        },
      })
    } else if (result.turnAdvancedTo) {
      // Cycle closed — tell the partner the turn is theirs now.
      notification = await notify({
        key: 'turn_advanced',
        audience: { only: result.turnAdvancedTo },
        vars: {
          deal_name: deal.title,
          assigned_to: nameOf(result.turnAdvancedTo),
          actor: me.display_name,
        },
      })
    }

    return ok({
      deal: { ...deal, ...result.patch },
      log: result.log,
      next: { ...result.next, assigneeName: nameOf(result.next.assigneeId) },
      cycleCompleted: result.cycleCompleted,
      notification,
    })
  })
}

function normalize(deal: DealWithSteps): DealWithSteps {
  return {
    ...deal,
    steps: [...((deal.steps ?? []) as DealStep[])].sort((x, y) => x.step_index - y.step_index),
  }
}
