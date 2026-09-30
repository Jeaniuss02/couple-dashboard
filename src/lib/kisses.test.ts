import { describe, expect, it } from 'vitest'

import { buildKissStats, kissDayKey, kissDayRange, kissWeekRange } from './kisses'
import type { KissRow } from './types'

/**
 * The counter's whole job is getting "today" right on a server that runs in
 * UTC while the two people using it live at UTC+8. Every case below is a
 * rollover, because that is the only place this can go wrong.
 */

const row = (iso: string, by: string | null = 'a'): KissRow => ({
  id: iso,
  logged_by: by,
  kissed_at: iso,
})

describe('kissDayKey', () => {
  it('rolls over at midnight in Kuala Lumpur, not at midnight UTC', () => {
    // 23:59 KL on the 22nd
    expect(kissDayKey('2026-09-22T15:59:00Z')).toBe('2026-09-22')
    // 00:00 KL on the 23rd — the same instant as 16:00 UTC the day before
    expect(kissDayKey('2026-09-22T16:00:00Z')).toBe('2026-09-23')
    // 07:30 KL — a late-evening UTC kiss belongs to the next KL day
    expect(kissDayKey('2026-09-22T23:30:00Z')).toBe('2026-09-23')
  })
})

describe('kissDayRange', () => {
  it('spans KL midnight even when "now" is the previous UTC day', () => {
    const { from, to } = kissDayRange(new Date('2026-09-22T23:30:00Z'))
    expect(from.toISOString()).toBe('2026-09-22T16:00:00.000Z')
    expect(to.toISOString()).toBe('2026-09-23T16:00:00.000Z')
  })
})

describe('kissWeekRange', () => {
  it('starts the week on Monday in KL', () => {
    // Wednesday 23 Sep 2026, 09:00 KL
    const { from, to } = kissWeekRange(new Date('2026-09-23T01:00:00Z'))
    expect(from.toISOString()).toBe('2026-09-20T16:00:00.000Z') // Mon 21 Sep, 00:00 KL
    expect(to.toISOString()).toBe('2026-09-27T16:00:00.000Z') // the following Monday
  })
})

describe('buildKissStats', () => {
  // Wednesday 23 Sep 2026, 09:00 KL — mid-week, so Sunday is the old edge.
  const now = new Date('2026-09-23T01:00:00Z')

  const rows = [
    row('2026-09-22T17:00:00.000Z', 'a'), // Wed 01:00 KL — today
    row('2026-09-23T00:30:00.000Z', 'b'), // Wed 08:30 KL — today, newest
    row('2026-09-20T17:00:00.000Z', 'a'), // Mon 01:00 KL — this week
    row('2026-09-19T04:00:00.000Z', 'b'), // Sat 19 Sep — last week, must be ignored
  ]

  it('counts today and the week from the rows it is given', () => {
    const stats = buildKissStats(rows, 1204, now)
    expect(stats.today).toBe(2)
    expect(stats.week).toBe(3)
    expect(stats.total).toBe(1204)
  })

  it('buckets the seven-day strip oldest-first, ending today', () => {
    const stats = buildKissStats(rows, 1204, now)
    expect(stats.days).toHaveLength(7)
    expect(stats.days[6].key).toBe('2026-09-23') // today
    expect(stats.days[0].key).toBe('2026-09-17')
    expect(stats.days[6].count).toBe(2)
    expect(stats.days[4].key).toBe('2026-09-21') // Monday — this week's first day
    expect(stats.days[4].count).toBe(1)
    expect(stats.days[2].key).toBe('2026-09-19') // Saturday — last week, ignored
    expect(stats.days[2].count).toBe(0)
    expect(stats.days.reduce((sum, day) => sum + day.count, 0)).toBe(stats.week)
  })

  it('reports the newest kiss as the last one', () => {
    expect(buildKissStats(rows, 1204, now).last).toEqual({
      at: '2026-09-23T00:30:00.000Z',
      by: 'b',
    })
  })

  it('survives an empty week', () => {
    const stats = buildKissStats([], 0, now)
    expect(stats).toMatchObject({ available: true, today: 0, week: 0, total: 0, last: null })
    expect(stats.days).toHaveLength(7)
  })
})
