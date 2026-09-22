import { NextRequest } from 'next/server'

import { fail, guard, ok } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { getMembers, membersPair, nameLookup } from '@/lib/data'
import { format } from '@/lib/dates'
import { summarizeTurn } from '@/lib/rotation'
import { createClient } from '@/lib/supabase/server'
import type { DealStep, DealWithSteps } from '@/lib/types'
import { notify } from '@/lib/whatsapp/notify'

export const dynamic = 'force-dynamic'

/**
 * Gentle nudge (notification trigger #3). Deliberate tap, so it ignores quiet
 * hours — if you choose to poke someone at 1am, that is between the two of you.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  return guard(async () => {
    const { id } = await params
    const me = await requireMember()
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
    const turn = summarizeTurn(deal, membersPair(profiles))

    // Ad-hoc deals have no assignee, so nudge the partner rather than nobody.
    const target = turn.assigneeId ?? profiles.find((p) => p.id !== me.id)?.id ?? null
    if (!target) return fail('There is nobody to nudge.', 422)
    if (target === me.id) return fail('That turn is yours — no nudge needed.', 422)

    const notification = await notify({
      key: 'nudge',
      audience: { only: target },
      urgent: true,
      vars: {
        deal_name: deal.title,
        step_name: turn.stepLabel,
        assigned_to: nameOf(target),
        actor: me.display_name,
        due_line: turn.dueAt ? `\n⏰ due ${format(turn.dueAt, 'EEE h:mm a')}` : '',
      },
    })

    return ok({ notification, nudged: nameOf(target) })
  })
}
