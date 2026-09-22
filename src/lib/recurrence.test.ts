import { TZDate } from '@date-fns/tz'
import { describe, expect, it } from 'vitest'

import {
  describeRecurrence,
  expandSeries,
  occurrenceId,
  parseOccurrenceId,
} from './recurrence'
import type { EventException, EventSeries } from './types'

const KL = 'Asia/Kuala_Lumpur' // no DST
const LONDON = 'Europe/London' // DST: BST → GMT on 25 Oct 2026

function series(over: Partial<EventSeries> & Pick<EventSeries, 'freq'>): EventSeries {
  return {
    id: 'series-1',
    title: 'Date night',
    description: null,
    location: null,
    starts_at: '2026-09-22T11:30:00.000Z', // Tue 22 Sep, 19:30 in KL
    duration_minutes: 90,
    all_day: false,
    kind: 'shared',
    owner_id: null,
    created_by: 'ava',
    timezone: KL,
    interval: 1,
    byweekday: null,
    until: null,
    count: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    ...over,
  }
}

const window = (from: string, to: string) => ({ from: new Date(from), to: new Date(to) })

/** Local wall-clock rendering, for asserting DST behaviour readably. */
const localTime = (iso: string, tz: string) => {
  const d = new TZDate(Date.parse(iso), tz)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
const localDate = (iso: string, tz: string) => {
  const d = new TZDate(Date.parse(iso), tz)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('daily', () => {
  it('generates one occurrence per day inside the window', () => {
    const out = expandSeries(series({ freq: 'daily' }), [], window('2026-09-22', '2026-09-27'))
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual([
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
    ])
  })

  it('honours an interval', () => {
    const out = expandSeries(
      series({ freq: 'daily', interval: 3 }),
      [],
      window('2026-09-22', '2026-10-05'),
    )
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual([
      '2026-09-22',
      '2026-09-25',
      '2026-09-28',
      '2026-10-01',
      '2026-10-04',
    ])
  })

  it('never yields anything before the series starts', () => {
    const out = expandSeries(series({ freq: 'daily' }), [], window('2026-09-01', '2026-09-24'))
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual(['2026-09-22', '2026-09-23'])
  })

  it('fast-forwards into a distant window without losing alignment', () => {
    // Starting from the series would take ~370 iterations; the engine skips ahead.
    const out = expandSeries(
      series({ freq: 'daily', interval: 7 }),
      [],
      window('2027-09-20', '2027-09-30'),
    )
    // 2026-09-22 + 7n lands on 2027-09-21.
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual(['2027-09-21', '2027-09-28'])
  })
})

describe('weekly', () => {
  it('repeats on the start weekday when no days are chosen', () => {
    const out = expandSeries(series({ freq: 'weekly' }), [], window('2026-09-22', '2026-10-14'))
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual([
      '2026-09-22',
      '2026-09-29',
      '2026-10-06',
      '2026-10-13',
    ])
  })

  it('generates every chosen weekday, in calendar order', () => {
    // Mon, Wed, Fri — series starts on a Tuesday.
    const out = expandSeries(
      series({ freq: 'weekly', byweekday: [4, 0, 2] }),
      [],
      window('2026-09-21', '2026-10-03'),
    )
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual([
      '2026-09-23', // Wed — Monday 21st precedes the Tue 22nd start
      '2026-09-25', // Fri
      '2026-09-28', // Mon
      '2026-09-30', // Wed
      '2026-10-02', // Fri
    ])
  })

  it('keeps the start time on every generated weekday', () => {
    const out = expandSeries(
      series({ freq: 'weekly', byweekday: [0, 3] }),
      [],
      window('2026-09-22', '2026-10-01'),
    )
    expect(out.every((e) => localTime(e.starts_at, KL) === '19:30')).toBe(true)
  })

  it('applies the interval to whole weeks', () => {
    const out = expandSeries(
      series({ freq: 'weekly', interval: 2 }),
      [],
      window('2026-09-22', '2026-11-01'),
    )
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual([
      '2026-09-22',
      '2026-10-06',
      '2026-10-20',
    ])
  })
})

describe('monthly', () => {
  it('repeats on the same day each month', () => {
    const out = expandSeries(series({ freq: 'monthly' }), [], window('2026-09-01', '2027-01-01'))
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual([
      '2026-09-22',
      '2026-10-22',
      '2026-11-22',
      '2026-12-22',
    ])
  })

  it('skips months without the day rather than clamping', () => {
    // The 31st: February and April have no 31st. Clamping would produce a
    // 28 Feb occurrence and collapse the rule onto the wrong days.
    const out = expandSeries(
      series({ freq: 'monthly', starts_at: '2026-01-31T04:00:00.000Z' }), // 31 Jan, 12:00 KL
      [],
      window('2026-01-01', '2026-07-01'),
    )
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ])
  })
})

describe('daylight saving', () => {
  it('holds the wall-clock time across a DST transition', () => {
    // 09:00 London on Tue 20 Oct 2026 (BST). Clocks go back on 25 Oct.
    // Adding 7×24h would drag the 27th to 08:00; calendar arithmetic must not.
    const weekly = series({
      freq: 'weekly',
      timezone: LONDON,
      starts_at: '2026-10-20T08:00:00.000Z', // 09:00 BST
    })

    const out = expandSeries(weekly, [], window('2026-10-19', '2026-11-11'))
    expect(out.map((e) => localDate(e.starts_at, LONDON))).toEqual([
      '2026-10-20',
      '2026-10-27',
      '2026-11-03',
      '2026-11-10',
    ])
    expect(out.every((e) => localTime(e.starts_at, LONDON) === '09:00')).toBe(true)

    // And the underlying instant really did shift by an hour, which is the
    // whole point — same local time, different UTC offset.
    expect(out[0].starts_at).toBe('2026-10-20T08:00:00.000Z')
    expect(out[2].starts_at).toBe('2026-11-03T09:00:00.000Z')
  })
})

describe('end rules', () => {
  it('stops at `until`', () => {
    const out = expandSeries(
      series({ freq: 'daily', until: '2026-09-24T23:59:59.000Z' }),
      [],
      window('2026-09-22', '2026-10-01'),
    )
    expect(out).toHaveLength(3)
  })

  it('stops after `count` occurrences', () => {
    const out = expandSeries(
      series({ freq: 'weekly', count: 3 }),
      [],
      window('2026-09-22', '2027-01-01'),
    )
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual([
      '2026-09-22',
      '2026-09-29',
      '2026-10-06',
    ])
  })

  it('counts from the series start, not from the window', () => {
    // Occurrences 1–3 are 22/29 Sep and 6 Oct. A window opening later must
    // still see the series as exhausted rather than restarting the count.
    const out = expandSeries(
      series({ freq: 'weekly', count: 3 }),
      [],
      window('2026-10-10', '2026-12-01'),
    )
    expect(out).toEqual([])
  })
})

describe('exceptions', () => {
  const base = series({ freq: 'weekly' })

  const exception = (over: Partial<EventException>): EventException => ({
    id: 'exc-1',
    series_id: base.id,
    occurrence_start: '2026-09-29T11:30:00.000Z',
    cancelled: false,
    title: null,
    starts_at: null,
    ends_at: null,
    location: null,
    description: null,
    ...over,
  })

  it('drops a cancelled occurrence and leaves the rest alone', () => {
    const out = expandSeries(base, [exception({ cancelled: true })], window('2026-09-22', '2026-10-14'))
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual([
      '2026-09-22',
      '2026-10-06',
      '2026-10-13',
    ])
  })

  it('matches an exception written with a different timezone offset', () => {
    // '+08:00' and 'Z' are the same instant; matching on the string would miss.
    const out = expandSeries(
      base,
      [exception({ occurrence_start: '2026-09-29T19:30:00+08:00', cancelled: true })],
      window('2026-09-22', '2026-10-01'),
    )
    expect(out.map((e) => localDate(e.starts_at, KL))).toEqual(['2026-09-22'])
  })

  it('applies a moved occurrence and keeps its original identity', () => {
    const moved = exception({ starts_at: '2026-09-30T13:00:00.000Z', title: 'Moved to Wednesday' })
    const out = expandSeries(base, [moved], window('2026-09-22', '2026-10-01'))

    const instance = out.find((e) => e.occurrence_start === '2026-09-29T11:30:00.000Z')
    expect(instance?.title).toBe('Moved to Wednesday')
    expect(localDate(instance!.starts_at, KL)).toBe('2026-09-30')
    expect(instance?.moved).toBe(true)
  })

  it('ignores exceptions belonging to another series', () => {
    const out = expandSeries(
      base,
      [exception({ series_id: 'someone-else', cancelled: true })],
      window('2026-09-22', '2026-10-01'),
    )
    expect(out).toHaveLength(2)
  })
})

describe('materialized occurrences', () => {
  it('derives the end time from the duration', () => {
    const [first] = expandSeries(series({ freq: 'daily' }), [], window('2026-09-22', '2026-09-23'))
    expect(first.ends_at).toBe('2026-09-22T13:00:00.000Z') // +90 min
  })

  it('leaves all-day occurrences without an end time', () => {
    const [first] = expandSeries(
      series({ freq: 'daily', all_day: true, duration_minutes: null }),
      [],
      window('2026-09-22', '2026-09-23'),
    )
    expect(first.ends_at).toBeNull()
    expect(first.all_day).toBe(true)
  })

  it('round-trips a synthetic occurrence id', () => {
    const id = occurrenceId('abc-123', new Date('2026-09-22T11:30:00.000Z'))
    expect(parseOccurrenceId(id)).toEqual({
      seriesId: 'abc-123',
      occurrenceStart: '2026-09-22T11:30:00.000Z',
    })
  })

  it('rejects ids that are not occurrences', () => {
    expect(parseOccurrenceId('c0ffee-plain-event-uuid')).toBeNull()
    expect(parseOccurrenceId('series:abc:not-a-date')).toBeNull()
  })
})

describe('descriptions', () => {
  it('reads the way a person would say it', () => {
    expect(describeRecurrence(series({ freq: 'daily' }))).toBe('Every day')
    expect(describeRecurrence(series({ freq: 'daily', interval: 3 }))).toBe('Every 3 days')
    expect(describeRecurrence(series({ freq: 'weekly' }))).toBe('Every Tue')
    expect(describeRecurrence(series({ freq: 'weekly', interval: 2 }))).toBe(
      'Every other week on Tue',
    )
    expect(describeRecurrence(series({ freq: 'weekly', byweekday: [0, 2, 4] }))).toBe(
      'Every week on Mon, Wed, Fri',
    )
    expect(describeRecurrence(series({ freq: 'monthly' }))).toBe('Monthly on the 22nd')
  })

  it('mentions the end rule', () => {
    expect(describeRecurrence(series({ freq: 'weekly', count: 6 }))).toBe('Every Tue, 6 times')
    expect(describeRecurrence(series({ freq: 'daily', until: '2026-12-25T00:00:00.000Z' }))).toBe(
      'Every day, until 25/12/2026',
    )
  })
})
