import { NextRequest } from 'next/server'

import { fail, guard, ok, oneOf, optionalString, requireString, ValidationError } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { MoodEntry, MoodScope } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Record how you felt. One entry per person, per period — re-rating the same
 * day overwrites rather than stacking, so the upsert is the whole story.
 *
 * You may only write your OWN mood. The RLS policy enforces it; this handler
 * never accepts a profile_id from the client at all, so there is nothing to
 * tamper with.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const body = await req.json()

    const scope = oneOf<MoodScope>(body.scope ?? 'day', ['day', 'week'] as const, 'scope')
    const score = Number(body.score)
    if (!Number.isInteger(score) || score < 1 || score > 5) {
      throw new ValidationError('Pick a mood from 1 to 5.')
    }

    const raw = requireString(body.entry_date, 'entry_date', 10)
    const date = new Date(`${raw}T12:00:00`)
    if (Number.isNaN(date.getTime())) throw new ValidationError('That is not a valid date.')

    // A weekly entry is stored against the Monday of its week, so the unique
    // constraint collapses duplicates without any extra bookkeeping.
    const entryDate = scope === 'week' ? mondayOf(date) : raw

    const supabase = createClient()
    const { data, error } = await supabase
      .from('mood_entries')
      .upsert(
        {
          profile_id: me.id,
          entry_date: entryDate,
          scope,
          score,
          note: optionalString(body.note, 300),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'profile_id,entry_date,scope' },
      )
      .select('*')
      .single()

    if (error) return fail(error.message, 400)
    return ok({ mood: data as MoodEntry })
  })
}

export async function DELETE(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const entryDate = req.nextUrl.searchParams.get('entry_date')
    const scope = req.nextUrl.searchParams.get('scope') ?? 'day'
    if (!entryDate) return fail('`entry_date` is required.', 400)

    const supabase = createClient()
    const { error } = await supabase
      .from('mood_entries')
      .delete()
      .eq('profile_id', me.id)
      .eq('entry_date', entryDate)
      .eq('scope', scope)

    if (error) return fail(error.message, 400)
    return ok({ cleared: entryDate })
  })
}

/** ISO week start, in local terms. */
function mondayOf(date: Date): string {
  const d = new Date(date)
  const offset = (d.getDay() + 6) % 7 // Sunday=0 -> Monday=0
  d.setDate(d.getDate() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
