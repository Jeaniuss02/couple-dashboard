import {
  addDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

export const WEEK_STARTS_ON = 1 // Monday

export function monthGrid(anchor: Date): Date[] {
  return eachDayOfInterval({
    start: startOfWeek(startOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON }),
    end: endOfWeek(endOfMonth(anchor), { weekStartsOn: WEEK_STARTS_ON }),
  })
}

export function weekGrid(anchor: Date): Date[] {
  const start = startOfWeek(anchor, { weekStartsOn: WEEK_STARTS_ON })
  return Array.from({ length: 7 }, (_, i) => addDays(start, i))
}

/** Inclusive-start / exclusive-end range covering the visible grid. */
export function rangeFor(view: 'month' | 'week' | 'day', anchor: Date): { from: Date; to: Date } {
  if (view === 'day') return { from: startOfDay(anchor), to: addDays(startOfDay(anchor), 1) }
  const days = view === 'month' ? monthGrid(anchor) : weekGrid(anchor)
  return { from: startOfDay(days[0]), to: addDays(startOfDay(days[days.length - 1]), 1) }
}

export function toDate(iso: string): Date {
  return parseISO(iso)
}

export function sameDay(iso: string, day: Date): boolean {
  return isSameDay(parseISO(iso), day)
}

export function formatEventTime(event: { starts_at: string; ends_at: string | null; all_day: boolean }): string {
  if (event.all_day) return 'All day'
  const start = parseISO(event.starts_at)
  if (!event.ends_at) return format(start, 'h:mm a')
  return `${format(start, 'h:mm a')} – ${format(parseISO(event.ends_at), 'h:mm a')}`
}

/** "Fri 26 Sep, 7:30 PM" — the shape used in WhatsApp messages. */
export function formatForMessage(event: {
  starts_at: string
  ends_at: string | null
  all_day: boolean
}): string {
  const start = parseISO(event.starts_at)
  if (event.all_day) return `${format(start, 'EEE d MMM')} · all day`
  const head = format(start, 'EEE d MMM, h:mm a')
  return event.ends_at ? `${head} – ${format(parseISO(event.ends_at), 'h:mm a')}` : head
}

/** "in 3 h" / "2 h ago" — compact enough for a chip. */
export function relative(iso: string | null, now: Date = new Date()): string {
  if (!iso) return ''
  const diff = parseISO(iso).getTime() - now.getTime()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  const unit = mins < 60 ? `${mins} min` : mins < 1440 ? `${Math.round(mins / 60)} h` : `${Math.round(mins / 1440)} d`
  return diff >= 0 ? `in ${unit}` : `${unit} ago`
}

export { format, isSameDay, startOfDay, addDays }
