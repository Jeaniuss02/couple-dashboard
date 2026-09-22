import { NextRequest } from 'next/server'

import {
  fail,
  guard,
  ok,
  oneOf,
  optionalIso,
  optionalString,
  requireIso,
  requireString,
  ValidationError,
} from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { getEvents, getMembers, getSettings, nameLookup } from '@/lib/data'
import { formatForMessage } from '@/lib/dates'
import { describeRecurrence } from '@/lib/recurrence'
import { createClient } from '@/lib/supabase/server'
import type { CalendarEvent, EventKind, EventSeries, RecurrenceFreq } from '@/lib/types'
import { notify } from '@/lib/whatsapp/notify'

export const dynamic = 'force-dynamic'

const FREQS = ['daily', 'weekly', 'monthly'] as const

/** Public read. Returns one-off events and expanded series occurrences together. */
export async function GET(req: NextRequest) {
  return guard(async () => {
    const fromParam = req.nextUrl.searchParams.get('from')
    const toParam = req.nextUrl.searchParams.get('to')
    if (!fromParam || !toParam) {
      return fail('Both `from` and `to` are required.', 400)
    }

    const from = new Date(fromParam)
    const to = new Date(toParam)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return fail('`from` and `to` must be valid dates.', 400)
    }
    // Expansion is bounded by the window, so the window itself must be bounded.
    if (to.getTime() - from.getTime() > 400 * 24 * 3600_000) {
      return fail('That range is too wide — ask for a year or less.', 400)
    }

    return ok({ events: await getEvents(from, to) })
  })
}

/**
 * Create a plan. With `recurrence`, it creates a series instead of a single
 * event; either way both partners get one WhatsApp (trigger #1) describing the
 * rule rather than one message per occurrence.
 */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const body = await req.json()

    const kind = oneOf<EventKind>(body.kind ?? 'shared', ['personal', 'shared'] as const, 'kind')
    const ownerId = kind === 'personal' ? requireString(body.owner_id, 'owner_id', 64) : null
    const startsAt = requireIso(body.starts_at, 'starts_at')
    const endsAt = optionalIso(body.ends_at, 'ends_at')
    if (endsAt && endsAt < startsAt) throw new ValidationError('The end time is before the start time.')

    const title = requireString(body.title, 'title', 140)
    const description = optionalString(body.description)
    const location = optionalString(body.location, 200)
    const allDay = body.all_day === true

    const supabase = createClient()
    const members = await getMembers()
    const nameOf = nameLookup(members)
    const kindLabel = kind === 'personal' ? `${nameOf(ownerId)}’s plan` : 'shared plan'

    // ---- recurring ----------------------------------------------------
    if (body.recurrence) {
      const rule = parseRecurrence(body.recurrence, startsAt)
      const settings = await getSettings()

      const { data, error } = await supabase
        .from('event_series')
        .insert({
          title,
          description,
          location,
          starts_at: startsAt,
          duration_minutes:
            allDay || !endsAt
              ? null
              : Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000),
          all_day: allDay,
          kind,
          owner_id: ownerId,
          created_by: me.id,
          timezone: rule.timezone ?? settings?.timezone ?? 'Asia/Kuala_Lumpur',
          freq: rule.freq,
          interval: rule.interval,
          byweekday: rule.byweekday,
          until: rule.until,
          count: rule.count,
        })
        .select('*')
        .single()

      if (error) return fail(error.message, 400)
      const series = data as EventSeries

      const notification = await notify({
        key: 'event_created',
        audience: 'both',
        vars: {
          event_name: series.title,
          // One message for the rule, not one per occurrence.
          date_time: `${formatForMessage({
            starts_at: series.starts_at,
            ends_at: endsAt,
            all_day: series.all_day,
          })}\n🔁 ${describeRecurrence(series)}`,
          location_line: series.location ? `\n📍 ${series.location}` : '',
          actor: me.display_name,
          kind: kindLabel,
        },
      })

      return ok({ series, recurrence: describeRecurrence(series), notification }, 201)
    }

    // ---- one-off ------------------------------------------------------
    const { data, error } = await supabase
      .from('calendar_events')
      .insert({
        title,
        description,
        location,
        starts_at: startsAt,
        ends_at: endsAt,
        all_day: allDay,
        kind,
        owner_id: ownerId,
        created_by: me.id,
      })
      .select('*')
      .single()

    if (error) return fail(error.message, 400)
    const event = data as CalendarEvent

    const notification = await notify({
      key: 'event_created',
      audience: 'both',
      vars: {
        event_name: event.title,
        date_time: formatForMessage(event),
        location_line: event.location ? `\n📍 ${event.location}` : '',
        actor: me.display_name,
        kind: kindLabel,
      },
    })

    if (notification.sent > 0) {
      await supabase
        .from('calendar_events')
        .update({ notified_at: new Date().toISOString() })
        .eq('id', event.id)
    }

    return ok({ event, notification }, 201)
  })
}

interface ParsedRule {
  freq: RecurrenceFreq
  interval: number
  byweekday: number[] | null
  until: string | null
  count: number | null
  timezone: string | null
}

function parseRecurrence(raw: unknown, startsAt: string): ParsedRule {
  const rule = raw as Record<string, unknown>
  const freq = oneOf<RecurrenceFreq>(rule.freq, FREQS, 'recurrence.freq')

  const interval = Number(rule.interval ?? 1)
  if (!Number.isInteger(interval) || interval < 1 || interval > 52) {
    throw new ValidationError('Repeat interval must be a whole number between 1 and 52.')
  }

  let byweekday: number[] | null = null
  if (freq === 'weekly' && Array.isArray(rule.byweekday) && rule.byweekday.length > 0) {
    const days = [...new Set(rule.byweekday.map(Number))].sort((a, b) => a - b)
    if (days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new ValidationError('Weekdays must be 0 (Monday) through 6 (Sunday).')
    }
    byweekday = days
  }

  const count = rule.count == null || rule.count === '' ? null : Number(rule.count)
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > 500)) {
    throw new ValidationError('Repeat count must be between 1 and 500.')
  }

  const until = optionalIso(rule.until, 'recurrence.until')
  // The schema's one_end_rule constraint rejects both; catch it here with a
  // message that says what to do about it.
  if (until && count !== null) {
    throw new ValidationError('Choose either an end date or a number of repeats, not both.')
  }
  if (until && until <= startsAt) {
    throw new ValidationError('The repeat end date is before the first occurrence.')
  }

  return {
    freq,
    interval,
    byweekday,
    until,
    count,
    timezone: typeof rule.timezone === 'string' && rule.timezone ? rule.timezone : null,
  }
}
