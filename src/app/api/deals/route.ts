import { NextRequest } from 'next/server'

import { fail, guard, ok, oneOf, optionalString, requireString, ValidationError } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { getMembers } from '@/lib/data'
import { createClient } from '@/lib/supabase/server'
import type { DealWithSteps, RotationType } from '@/lib/types'

export const dynamic = 'force-dynamic'

const ROTATIONS = ['alternating', 'paired', 'adhoc'] as const

export async function GET() {
  return guard(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('deals')
      .select('*, steps:deal_steps(*)')
      .order('sort_order')
    if (error) return fail(error.message, 500)
    return ok({ deals: data as DealWithSteps[] })
  })
}

/**
 * Create a custom deal with its steps.
 *
 * Shape by rotation type:
 *   alternating → exactly one step, no fixed owner; `first_assignee_id` seeds the turn
 *   paired      → 2+ steps, each with a fixed owner
 *   adhoc       → exactly one step, nobody assigned
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const body = await req.json()

    const rotation = oneOf<RotationType>(body.rotation_type ?? 'alternating', ROTATIONS, 'rotation_type')
    const rawSteps: unknown[] = Array.isArray(body.steps) ? body.steps : []
    const memberIds = new Set((await getMembers()).map((p) => p.id))

    const steps = rawSteps.map((raw, index) => {
      const step = raw as { label?: unknown; assignee_id?: unknown; notify_on_ready?: unknown }
      const assignee =
        typeof step.assignee_id === 'string' && step.assignee_id ? step.assignee_id : null
      if (assignee && !memberIds.has(assignee)) {
        throw new ValidationError('Steps can only be assigned to one of the two members.')
      }
      return {
        step_index: index,
        label: requireString(step.label, `Step ${index + 1} label`, 120),
        assignee_id: rotation === 'paired' ? assignee : null,
        notify_on_ready: step.notify_on_ready !== false,
      }
    })

    if (steps.length === 0) throw new ValidationError('Add at least one step.')
    if (rotation === 'paired' && steps.length < 2) {
      throw new ValidationError('A paired routine needs at least two steps.')
    }
    if (rotation === 'paired' && steps.some((s) => !s.assignee_id)) {
      throw new ValidationError('Every step in a paired routine needs an owner.')
    }
    if (rotation !== 'paired' && steps.length > 1) {
      throw new ValidationError('Alternating and ad-hoc deals use a single step.')
    }

    const firstAssignee =
      rotation === 'paired'
        ? steps[0].assignee_id
        : rotation === 'alternating'
          ? (typeof body.first_assignee_id === 'string' && memberIds.has(body.first_assignee_id)
              ? body.first_assignee_id
              : me.id)
          : null

    const graceHours = parseGrace(body.grace_hours)

    const supabase = createClient()
    const { data: deal, error } = await supabase
      .from('deals')
      .insert({
        title: requireString(body.title, 'title', 80),
        emoji: optionalString(body.emoji, 8) ?? '🫧',
        description: optionalString(body.description, 400),
        rotation_type: rotation,
        swap_each_cycle: rotation === 'paired' && body.swap_each_cycle === true,
        grace_hours: graceHours,
        penalty_title: optionalString(body.penalty_title, 140),
        penalty_description: optionalString(body.penalty_description, 400),
        current_step_index: 0,
        current_assignee_id: firstAssignee,
        turn_started_at: new Date().toISOString(),
        created_by: me.id,
        sort_order: Number.isFinite(body.sort_order) ? Number(body.sort_order) : 0,
      })
      .select('*')
      .single()

    if (error) return fail(error.message, 400)

    const { error: stepError } = await supabase
      .from('deal_steps')
      .insert(steps.map((s) => ({ ...s, deal_id: deal.id })))

    if (stepError) {
      // Keep the table clean rather than leaving a stepless deal behind.
      await supabase.from('deals').delete().eq('id', deal.id)
      return fail(stepError.message, 400)
    }

    const { data: full } = await supabase
      .from('deals')
      .select('*, steps:deal_steps(*)')
      .eq('id', deal.id)
      .single()

    return ok({ deal: full as DealWithSteps }, 201)
  })
}

function parseGrace(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const hours = Number(value)
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new ValidationError('Grace window must be a positive number of hours.')
  }
  return Math.min(Math.round(hours), 24 * 30)
}
