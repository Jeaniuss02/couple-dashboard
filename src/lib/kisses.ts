import { TZDate } from '@date-fns/tz'
import { addDays, format, startOfDay, startOfWeek } from 'date-fns'

import { WEEK_STARTS_ON } from './dates'
import type { KissRow, KissStats } from './types'

/**
 * Kiss counter maths.
 *
 * "Today" and "this week" have to mean today in *their* timezone, not on
 * whichever machine happens to render the page — Vercel's servers are in UTC,
 * so a kiss at 9am Monday in KL would otherwise land on Sunday. All the day
 * boundaries below are therefore computed as TZDate wall-clock midnights and
 * converted back to real instants.
 */
export const KISS_TZONE = 'Asia/Kuala_Lumpur'

export const EMPTY_KISS_STATS: KissStats = {
  available: false,
  today: 0,
  week: 0,
  total: 0,
  days: [],
  last: null,
}

function inZone(now: Date): TZDate {
  return new TZDate(now, KISS_TZONE)
}

/** Midnight-to-midnight for the current day, as instants. */
export function kissDayRange(now: Date = new Date()): { from: Date; to: Date } {
  const start = startOfDay(inZone(now))
  return { from: new Date(start.getTime()), to: new Date(addDays(start, 1).getTime()) }
}

/** Monday 00:00 through next Monday 00:00 — the week the board calls "this week". */
export function kissWeekRange(now: Date = new Date()): { from: Date; to: Date } {
  const start = startOfWeek(inZone(now), { weekStartsOn: WEEK_STARTS_ON })
  return { from: new Date(start.getTime()), to: new Date(addDays(start, 7).getTime()) }
}

/** 'yyyy-MM-dd' in KL — the bucket key used by the seven-day strip. */
export function kissDayKey(at: string | Date): string {
  const date = typeof at === 'string' ? new Date(at) : at
  return format(new TZDate(date, KISS_TZONE), 'yyyy-MM-dd')
}

/**
 * Turns this week's rows into the numbers the UI shows.
 *
 * Rows outside the week window are dropped here rather than trusted to the
 * caller's query — the strip and the weekly total then cannot disagree even if
 * a future caller fetches a wider range.
 */
export function buildKissStats(rows: KissRow[], total = 0, now: Date = new Date()): KissStats {
  const { from: weekFrom, to: weekTo } = kissWeekRange(now)
  const inWeek = rows.filter((row) => {
    const at = Date.parse(row.kissed_at)
    return at >= weekFrom.getTime() && at < weekTo.getTime()
  })

  const today = startOfDay(inZone(now))
  const days = Array.from({ length: 7 }, (_, offset) => {
    const day = addDays(today, offset - 6)
    return { key: format(day, 'yyyy-MM-dd'), label: format(day, 'EEEEE'), count: 0 }
  })

  const bucketFor = new Map(days.map((day) => [day.key, day]))
  let newest: KissRow | null = null
  let todayCount = 0

  for (const row of inWeek) {
    const at = Date.parse(row.kissed_at)
    if (at >= today.getTime()) todayCount += 1
    const bucket = bucketFor.get(kissDayKey(row.kissed_at))
    if (bucket) bucket.count += 1
    if (!newest || at > Date.parse(newest.kissed_at)) newest = row
  }

  return {
    available: true,
    today: todayCount,
    week: inWeek.length,
    total: Math.max(total, inWeek.length),
    days,
    last: newest ? { at: newest.kissed_at, by: newest.logged_by } : null,
  }
}
