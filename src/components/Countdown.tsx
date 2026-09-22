'use client'

import { useTicker } from './hooks'
import { cx } from './ui'

/**
 * Days until the next anniversary.
 *
 * Counts in whole *calendar* days from local midnight, not in 24-hour blocks —
 * "3 days left" should tick over when the date changes, not at some arbitrary
 * hour of the afternoon. It also rolls forward a year automatically once the
 * date passes, so nobody has to edit anything each October.
 */
export function Countdown({
  date,
  label = 'Our anniversary',
}: {
  date: string | null
  label?: string
}) {
  const now = useTicker(60_000)
  if (!date) return null

  const target = nextOccurrence(date, now)
  if (!target) return null

  const days = wholeDaysBetween(now, target.when)
  const isToday = days === 0

  return (
    <div
      className={cx(
        'card relative overflow-hidden px-4 py-3.5',
        isToday && 'border-gold/50',
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: isToday ? '#D4AF37' : '#D9A6A0' }}
      />
      <div className="flex items-center justify-between gap-3 pl-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">
            {target.ordinal ? `${ordinal(target.ordinal)} ${label.toLowerCase()}` : label}
          </p>
          <p className="mt-0.5 text-xs text-espresso-faint">
            {target.when.toLocaleDateString(undefined, {
              weekday: 'short',
              day: 'numeric',
              month: 'long',
              year: 'numeric',
            })}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {isToday ? (
            <p className="font-display text-xl text-gold-deep">Today 🎉</p>
          ) : (
            <>
              <p className="font-display text-2xl leading-none tabular-nums">{days}</p>
              <p className="text-[11px] uppercase tracking-wider text-espresso-faint">
                {days === 1 ? 'day left' : 'days left'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/**
 * The next time this anniversary comes round, plus which one it is.
 * `date` is the original date (the first one), so ordinal counts from there.
 */
function nextOccurrence(date: string, now: Date): { when: Date; ordinal: number } | null {
  const origin = new Date(`${date.slice(0, 10)}T00:00:00`)
  if (Number.isNaN(origin.getTime())) return null

  const today = startOfLocalDay(now)
  let year = today.getFullYear()
  let when = new Date(year, origin.getMonth(), origin.getDate())

  // Already gone this year — roll to next.
  if (when < today) {
    year += 1
    when = new Date(year, origin.getMonth(), origin.getDate())
  }

  return { when, ordinal: year - origin.getFullYear() }
}

function startOfLocalDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Calendar-day difference, immune to DST shifting the clock by an hour. */
function wholeDaysBetween(from: Date, to: Date): number {
  const a = startOfLocalDay(from)
  const b = startOfLocalDay(to)
  return Math.round((b.getTime() - a.getTime()) / 86_400_000)
}

function ordinal(n: number): string {
  if (n % 100 >= 11 && n % 100 <= 13) return `${n}th`
  return `${n}${['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
}
