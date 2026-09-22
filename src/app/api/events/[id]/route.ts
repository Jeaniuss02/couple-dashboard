import { NextRequest } from 'next/server'

import { fail, guard, ok, oneOf, optionalIso, optionalString, requireString } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { CalendarEvent, EventKind } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const body = await req.json()

    const patch: Record<string, unknown> = {}
    if ('title' in body) patch.title = requireString(body.title, 'title', 140)
    if ('description' in body) patch.description = optionalString(body.description)
    if ('location' in body) patch.location = optionalString(body.location, 200)
    if ('starts_at' in body) patch.starts_at = optionalIso(body.starts_at, 'starts_at')
    if ('ends_at' in body) patch.ends_at = optionalIso(body.ends_at, 'ends_at')
    if ('all_day' in body) patch.all_day = body.all_day === true
    if ('kind' in body) patch.kind = oneOf<EventKind>(body.kind, ['personal', 'shared'] as const, 'kind')
    if ('owner_id' in body) patch.owner_id = body.owner_id || null

    const supabase = createClient()
    const { data, error } = await supabase
      .from('calendar_events')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()

    if (error) return fail(error.message, 400)
    // Edits stay quiet on purpose — only new plans are worth a buzz.
    return ok({ event: data as CalendarEvent })
  })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const supabase = createClient()
    const { error } = await supabase.from('calendar_events').delete().eq('id', id)
    if (error) return fail(error.message, 400)
    return ok({ id: id })
  })
}
