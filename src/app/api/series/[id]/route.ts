import { NextRequest } from 'next/server'

import { fail, guard, ok, optionalIso, optionalString, requireString } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { EventSeries } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** Edit the whole series. Exceptions survive — a cancelled Tuesday stays cancelled. */
export async function PATCH(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const body = await req.json()

    const patch: Record<string, unknown> = {}
    if ('title' in body) patch.title = requireString(body.title, 'title', 140)
    if ('description' in body) patch.description = optionalString(body.description)
    if ('location' in body) patch.location = optionalString(body.location, 200)
    if ('until' in body) patch.until = optionalIso(body.until, 'until')

    const supabase = createClient()
    const { data, error } = await supabase
      .from('event_series')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()

    if (error) return fail(error.message, 400)
    return ok({ series: data as EventSeries })
  })
}

/**
 * Delete the whole series.
 *
 * `?from=<iso>` ends it instead, by setting `until` just before that instant —
 * which is what "delete this and everything after" should do: past occurrences
 * stay on the record rather than being rewritten out of history.
 */
export async function DELETE(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const supabase = createClient()
    const from = req.nextUrl.searchParams.get('from')

    if (from) {
      const cutoff = new Date(from)
      if (Number.isNaN(cutoff.getTime())) return fail('`from` must be a valid date.', 400)

      const { data, error } = await supabase
        .from('event_series')
        .update({ until: new Date(cutoff.getTime() - 1000).toISOString(), count: null })
        .eq('id', id)
        .select('*')
        .single()

      if (error) return fail(error.message, 400)
      return ok({ series: data as EventSeries, endedFrom: cutoff.toISOString() })
    }

    // Exceptions cascade with the series.
    const { error } = await supabase.from('event_series').delete().eq('id', id)
    if (error) return fail(error.message, 400)
    return ok({ id: id, deleted: true })
  })
}
