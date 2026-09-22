import { NextRequest } from 'next/server'

import { fail, guard, ok, optionalString, requireString } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { getMembers, membersPair } from '@/lib/data'
import { rotateTurn } from '@/lib/rotation'
import { createClient } from '@/lib/supabase/server'
import type { DealStep, DealWithSteps } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const body = await req.json()
    const supabase = createClient()

    // `action: 'rotate'` is the no-blame "swap whose turn it is" button.
    if (body.action === 'rotate') {
      const { data, error } = await supabase
        .from('deals')
        .select('*, steps:deal_steps(*)')
        .eq('id', id)
        .single()
      if (error || !data) return fail('Deal not found.', 404)

      const deal = data as DealWithSteps
      const profiles = await getMembers()
      const patch = rotateTurn(
        { ...deal, steps: (deal.steps ?? []) as DealStep[] },
        membersPair(profiles),
      )
      const { data: updated, error: updateError } = await supabase
        .from('deals')
        .update(patch)
        .eq('id', id)
        .select('*, steps:deal_steps(*)')
        .single()
      if (updateError) return fail(updateError.message, 400)
      return ok({ deal: updated as DealWithSteps })
    }

    const patch: Record<string, unknown> = {}
    if ('title' in body) patch.title = requireString(body.title, 'title', 80)
    if ('emoji' in body) patch.emoji = optionalString(body.emoji, 8) ?? '🫧'
    if ('description' in body) patch.description = optionalString(body.description, 400)
    if ('penalty_title' in body) patch.penalty_title = optionalString(body.penalty_title, 140)
    if ('penalty_description' in body)
      patch.penalty_description = optionalString(body.penalty_description, 400)
    if ('grace_hours' in body)
      patch.grace_hours = body.grace_hours === null || body.grace_hours === '' ? null : Number(body.grace_hours)
    if ('swap_each_cycle' in body) patch.swap_each_cycle = body.swap_each_cycle === true
    if ('is_active' in body) patch.is_active = body.is_active !== false
    if ('sort_order' in body) patch.sort_order = Number(body.sort_order) || 0
    if ('current_assignee_id' in body) patch.current_assignee_id = body.current_assignee_id || null

    const { data, error } = await supabase
      .from('deals')
      .update(patch)
      .eq('id', id)
      .select('*, steps:deal_steps(*)')
      .single()
    if (error) return fail(error.message, 400)
    return ok({ deal: data as DealWithSteps })
  })
}

/** Soft-archive by default; `?hard=1` really removes it and its history. */
export async function DELETE(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const supabase = createClient()
    const hard = req.nextUrl.searchParams.get('hard') === '1'

    const { error } = hard
      ? await supabase.from('deals').delete().eq('id', id)
      : await supabase.from('deals').update({ is_active: false }).eq('id', id)

    if (error) return fail(error.message, 400)
    return ok({ id: id, archived: !hard })
  })
}
