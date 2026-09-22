import { NextRequest } from 'next/server'

import { fail, guard, ok, optionalIso, optionalString, requireIso } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { EventException } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/**
 * Cancel or move a single occurrence.
 *
 * Keyed by `occurrence_start` — the instant the rule generated, not the moved
 * time — so the engine can still match the exception to the slot it replaces.
 * Upsert on (series_id, occurrence_start) keeps it idempotent: cancelling the
 * same Tuesday twice is not an error.
 */
export async function POST(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    const me = await requireMember()
    const body = await req.json()
    const occurrenceStart = requireIso(body.occurrence_start, 'occurrence_start')
    const cancelled = body.cancelled !== false

    const movedTo = optionalIso(body.starts_at, 'starts_at')
    if (!cancelled && !movedTo && !body.title) {
      return fail('Nothing to change on that occurrence.', 422)
    }

    const supabase = createClient()
    const { data: series } = await supabase
      .from('event_series')
      .select('id')
      .eq('id', id)
      .maybeSingle()
    if (!series) return fail('Series not found.', 404)

    const { data, error } = await supabase
      .from('event_exceptions')
      .upsert(
        {
          series_id: id,
          occurrence_start: occurrenceStart,
          cancelled,
          title: cancelled ? null : optionalString(body.title, 140),
          starts_at: cancelled ? null : movedTo,
          ends_at: cancelled ? null : optionalIso(body.ends_at, 'ends_at'),
          location: cancelled ? null : optionalString(body.location, 200),
          description: cancelled ? null : optionalString(body.description),
          created_by: me.id,
        },
        { onConflict: 'series_id,occurrence_start' },
      )
      .select('*')
      .single()

    if (error) return fail(error.message, 400)
    return ok({ exception: data as EventException })
  })
}

/** Undo an exception — put a cancelled or moved occurrence back on the rule. */
export async function DELETE(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const occurrenceStart = req.nextUrl.searchParams.get('occurrence_start')
    if (!occurrenceStart) return fail('`occurrence_start` is required.', 400)

    const parsed = new Date(occurrenceStart)
    if (Number.isNaN(parsed.getTime())) return fail('`occurrence_start` must be a valid date.', 400)

    const supabase = createClient()
    const { error } = await supabase
      .from('event_exceptions')
      .delete()
      .eq('series_id', id)
      .eq('occurrence_start', parsed.toISOString())

    if (error) return fail(error.message, 400)
    return ok({ restored: parsed.toISOString() })
  })
}
