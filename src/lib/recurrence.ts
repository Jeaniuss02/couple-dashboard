import { TZDate } from '@date-fns/tz'
import {
  addDays,
  addMonths,
  addWeeks,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  differenceInCalendarWeeks,
  getDate,
  startOfWeek,
} from 'date-fns'

import type { BoardEvent, EventException, EventSeries } from './types'

/**
 * Recurrence expansion.
 *
 * Occurrences are generated on read, never stored — so an open-ended series is
 * one row rather than thousands, and changing the rule does not need a backfill.
 *
 * All arithmetic runs on TZDate in the series' own timezone. That is what keeps
 * "every Tuesday at 9am" at 9am across a daylight-saving transition: adding
 * seven *calendar* days preserves wall-clock time, whereas adding 7×24h would
 * silently shift the event by an hour twice a year.
 */

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const

/** Safety valve: stops a pathological rule from spinning forever. */
const MAX_OCCURRENCES = 2000

export interface ExpandOptions {
  /** Window start, inclusive. */
  from: Date
  /** Window end, exclusive. */
  to: Date
}

/**
 * Every occurrence of `series` that starts inside the window, with exceptions
 * applied. Cancelled occurrences are dropped; overridden ones are rewritten.
 */
export function expandSeries(
  series: EventSeries,
  exceptions: EventException[],
  { from, to }: ExpandOptions,
): BoardEvent[] {
  const overrides = new Map(
    exceptions
      .filter((e) => e.series_id === series.id)
      // Match on the instant, not the string — '…Z' and '+00:00' are equal.
      .map((e) => [Date.parse(e.occurrence_start), e]),
  )

  const results: BoardEvent[] = []

  for (const occurrence of occurrences(series, from, to)) {
    const key = occurrence.getTime()
    const exception = overrides.get(key)
    if (exception?.cancelled) continue

    const event = materialize(series, new Date(key), exception ?? null)
    // An override can move an occurrence out of the window entirely.
    const startedAt = Date.parse(event.starts_at)
    if (startedAt < from.getTime() || startedAt >= to.getTime()) continue

    results.push(event)
  }

  return results
}

/** Expand several series at once, sorted with one-off events by start time. */
export function expandAll(
  seriesList: EventSeries[],
  exceptions: EventException[],
  options: ExpandOptions,
): BoardEvent[] {
  return seriesList.flatMap((series) => expandSeries(series, exceptions, options))
}

// ---------------------------------------------------------------------------
// Occurrence generation
// ---------------------------------------------------------------------------

function* occurrences(series: EventSeries, from: Date, to: Date): Generator<Date> {
  const tz = series.timezone || 'UTC'
  const base = new TZDate(Date.parse(series.starts_at), tz)
  const until = series.until ? Date.parse(series.until) : null
  const limit = series.count ?? null

  let emitted = 0
  let index = startIndexFor(series, base, from, tz)
  let guard = 0

  while (guard < MAX_OCCURRENCES) {
    guard += 1

    const slot = occurrencesAtIndex(series, base, index, tz)
    if (slot.length === 0 && index > 0 && slotIsPastWindow(series, base, index, tz, to)) break

    for (const candidate of slot) {
      const time = candidate.getTime()
      if (time < Date.parse(series.starts_at)) continue

      // `count` counts from the very first occurrence, not from the window —
      // so the index has to be tracked globally even when we fast-forward.
      const ordinal = ordinalFor(series, base, candidate, tz)
      if (limit !== null && ordinal >= limit) return
      if (until !== null && time > until) return
      if (time >= to.getTime()) return

      if (time >= from.getTime()) {
        emitted += 1
        yield new Date(time)
      }
    }

    index += 1
  }
}

/**
 * Jump straight to the step that lands near the window instead of walking from
 * the series start. Without this, scrolling to next year on a daily event would
 * burn through hundreds of iterations before drawing anything.
 *
 * Deliberately conservative — it rewinds two steps, because a weekly rule with
 * several weekdays can emit occurrences earlier in the week than the anchor.
 */
function startIndexFor(series: EventSeries, base: TZDate, from: Date, tz: string): number {
  if (from.getTime() <= Date.parse(series.starts_at)) return 0
  const target = new TZDate(from.getTime(), tz)

  let steps: number
  switch (series.freq) {
    case 'daily':
      steps = Math.floor(differenceInCalendarDays(target, base) / series.interval)
      break
    case 'weekly':
      steps = Math.floor(
        differenceInCalendarWeeks(target, base, { weekStartsOn: 1 }) / series.interval,
      )
      break
    case 'monthly':
      steps = Math.floor(differenceInCalendarMonths(target, base) / series.interval)
      break
  }

  // A `count` limit needs every earlier occurrence counted, so skipping ahead
  // would give the wrong ordinal. Pay the iterations instead.
  if (series.count !== null) return 0
  return Math.max(0, steps - 2)
}

/** The occurrence(s) generated by step `index`. Weekly-with-weekdays yields several. */
function occurrencesAtIndex(
  series: EventSeries,
  base: TZDate,
  index: number,
  tz: string,
): TZDate[] {
  const step = index * series.interval

  switch (series.freq) {
    case 'daily':
      return [addDays(base, step)]

    case 'weekly': {
      if (!series.byweekday?.length) return [addWeeks(base, step)]

      // Anchor on the Monday of the first week so the selected weekdays are
      // generated in calendar order regardless of which day the series began.
      const weekStart = startOfWeek(base, { weekStartsOn: 1 })
      const week = addWeeks(weekStart, step)
      return [...series.byweekday]
        .sort((a, b) => a - b)
        .map((weekday) => withTimeOf(addDays(week, weekday), base, tz))
    }

    case 'monthly': {
      const candidate = addMonths(base, step)
      // RFC 5545 skips months that lack the day (the 31st in February) rather
      // than clamping. Clamping would collapse Jan 31 and Feb 28 onto adjacent
      // days and produce duplicates.
      return getDate(candidate) === getDate(base) ? [candidate] : []
    }
  }
}

/** Has step `index` moved entirely past the window? Used to stop generating. */
function slotIsPastWindow(
  series: EventSeries,
  base: TZDate,
  index: number,
  tz: string,
  to: Date,
): boolean {
  // Monthly rules can emit nothing for a given step (skipped short months), so
  // probe the raw position rather than the emitted list.
  const probe =
    series.freq === 'monthly'
      ? addMonths(base, index * series.interval)
      : series.freq === 'weekly'
        ? addWeeks(base, index * series.interval)
        : addDays(base, index * series.interval)
  return probe.getTime() >= to.getTime()
}

/** Zero-based position of `candidate` in the series, for the `count` limit. */
function ordinalFor(series: EventSeries, base: TZDate, candidate: TZDate, tz: string): number {
  if (series.freq === 'weekly' && series.byweekday?.length) {
    const weekStart = startOfWeek(base, { weekStartsOn: 1 })
    const weeksIn = Math.floor(
      differenceInCalendarWeeks(candidate, weekStart, { weekStartsOn: 1 }) / series.interval,
    )
    const sorted = [...series.byweekday].sort((a, b) => a - b)
    const dayOfWeek = (candidate.getDay() + 6) % 7 // JS Sunday=0 → Monday=0
    const within = sorted.indexOf(dayOfWeek)
    const baseDay = (base.getDay() + 6) % 7
    // Occurrences before the series start in its first week do not count.
    const skippedInFirstWeek = sorted.filter((d) => d < baseDay).length
    return weeksIn * sorted.length + (within < 0 ? 0 : within) - skippedInFirstWeek
  }

  switch (series.freq) {
    case 'daily':
      return Math.round(differenceInCalendarDays(candidate, base) / series.interval)
    case 'weekly':
      return Math.round(
        differenceInCalendarWeeks(candidate, base, { weekStartsOn: 1 }) / series.interval,
      )
    case 'monthly':
      return Math.round(differenceInCalendarMonths(candidate, base) / series.interval)
  }
}

/** Copy the wall-clock time from `source` onto `day`, in the series timezone. */
function withTimeOf(day: TZDate, source: TZDate, tz: string): TZDate {
  const result = new TZDate(day.getTime(), tz)
  result.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), 0)
  return result
}

// ---------------------------------------------------------------------------
// Turning an occurrence into something the calendar can render
// ---------------------------------------------------------------------------

function materialize(
  series: EventSeries,
  occurrence: Date,
  exception: EventException | null,
): BoardEvent {
  const startsAt = exception?.starts_at ?? occurrence.toISOString()
  const endsAt =
    exception?.ends_at ??
    (series.duration_minutes != null && !series.all_day
      ? new Date(Date.parse(startsAt) + series.duration_minutes * 60_000).toISOString()
      : null)

  return {
    // Synthetic and stable: the series plus the original instant. Lets the UI
    // key rows and lets a delete say exactly which occurrence it meant.
    id: occurrenceId(series.id, occurrence),
    title: exception?.title ?? series.title,
    description: exception?.description ?? series.description,
    location: exception?.location ?? series.location,
    starts_at: startsAt,
    ends_at: endsAt,
    all_day: series.all_day,
    kind: series.kind,
    owner_id: series.owner_id,
    created_by: series.created_by,
    notified_at: null,
    created_at: series.created_at,
    updated_at: series.created_at,
    series_id: series.id,
    occurrence_start: occurrence.toISOString(),
    moved: !!exception && !exception.cancelled && !!exception.starts_at,
  }
}

export function occurrenceId(seriesId: string, occurrence: Date): string {
  return `series:${seriesId}:${occurrence.toISOString()}`
}

export function parseOccurrenceId(
  id: string,
): { seriesId: string; occurrenceStart: string } | null {
  if (!id.startsWith('series:')) return null
  const rest = id.slice('series:'.length)
  const split = rest.indexOf(':')
  if (split < 0) return null
  const seriesId = rest.slice(0, split)
  const occurrenceStart = rest.slice(split + 1)
  if (!seriesId || Number.isNaN(Date.parse(occurrenceStart))) return null
  return { seriesId, occurrenceStart }
}

// ---------------------------------------------------------------------------
// Description — shared by the UI badge and the WhatsApp message, so the two
// can never describe the same rule differently.
// ---------------------------------------------------------------------------

export function describeRecurrence(series: Pick<
  EventSeries,
  'freq' | 'interval' | 'byweekday' | 'until' | 'count' | 'starts_at' | 'timezone'
>): string {
  const every = series.interval === 1 ? '' : ` ${ordinalWord(series.interval)}`

  let core: string
  switch (series.freq) {
    case 'daily':
      core = series.interval === 1 ? 'Every day' : `Every ${series.interval} days`
      break
    case 'weekly': {
      if (series.byweekday?.length) {
        const days = [...series.byweekday]
          .sort((a, b) => a - b)
          .map((d) => WEEKDAY_LABELS[d])
          .join(', ')
        core = `Every${every} week on ${days}`
      } else {
        const day = WEEKDAY_LABELS[(new Date(series.starts_at).getDay() + 6) % 7]
        core = series.interval === 1 ? `Every ${day}` : `Every${every} week on ${day}`
      }
      break
    }
    case 'monthly': {
      const day = new TZDate(Date.parse(series.starts_at), series.timezone || 'UTC').getDate()
      core = series.interval === 1
        ? `Monthly on the ${withOrdinalSuffix(day)}`
        : `Every ${series.interval} months on the ${withOrdinalSuffix(day)}`
      break
    }
  }

  if (series.count) return `${core}, ${series.count} times`
  if (series.until) {
    const end = new TZDate(Date.parse(series.until), series.timezone || 'UTC')
    return `${core}, until ${end.getDate()}/${end.getMonth() + 1}/${end.getFullYear()}`
  }
  return core
}

function ordinalWord(n: number): string {
  return n === 2 ? 'other' : `${n}`
}

function withOrdinalSuffix(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  const suffix = ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'
  return `${n}${n % 10 <= 3 ? suffix : 'th'}`
}
