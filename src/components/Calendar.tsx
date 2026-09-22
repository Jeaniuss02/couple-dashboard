'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { addDays, addMonths, isSameDay, isSameMonth, isToday } from 'date-fns'

import { DayDrawer } from './DayDrawer'
import { EventForm } from './EventForm'
import { useTicker } from './hooks'
import { Button, cx, SegmentedControl, useViewer } from './ui'
import { format, monthGrid, rangeFor, toDate, weekGrid } from '@/lib/dates'
import { summarizeTurn, turnDueAt, type Members } from '@/lib/rotation'
import type { BoardEvent, DealWithSteps, Profile } from '@/lib/types'

export type CalendarView = 'month' | 'week' | 'day'

export interface DealBadge {
  deal: DealWithSteps
  text: string
  overdue: boolean
  /** true when the badge marks a deadline rather than just today's state */
  isDeadline: boolean
}

export function Calendar({
  initialEvents,
  deals,
  members,
  pair,
}: {
  initialEvents: BoardEvent[]
  deals: DealWithSteps[]
  members: Profile[]
  pair: Members
}) {
  const viewer = useViewer()
  const now = useTicker()
  const [view, setView] = useState<CalendarView>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [events, setEvents] = useState(initialEvents)
  const [selected, setSelected] = useState<Date | null>(null)
  const [composing, setComposing] = useState<Date | null>(null)

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor])

  // Refetch whenever the visible window moves. Server components stay the
  // source of truth on first paint; this covers navigation.
  const reload = useCallback(async () => {
    const params = new URLSearchParams({
      from: range.from.toISOString(),
      to: range.to.toISOString(),
    })
    const res = await fetch(`/api/events?${params}`, { cache: 'no-store' })
    const data = (await res.json()) as { ok: boolean; events?: BoardEvent[] }
    if (data.ok && data.events) setEvents(data.events)
  }, [range.from, range.to])

  useEffect(() => {
    void reload()
  }, [reload])

  const days = view === 'month' ? monthGrid(anchor) : view === 'week' ? weekGrid(anchor) : [anchor]

  const eventsByDay = useMemo(() => {
    const map = new Map<string, BoardEvent[]>()
    for (const event of events) {
      const key = dayKey(toDate(event.starts_at))
      const list = map.get(key) ?? []
      list.push(event)
      map.set(key, list)
    }
    return map
  }, [events])

  const badgesByDay = useMemo(() => {
    const map = new Map<string, DealBadge[]>()
    const nameOf = (id: string | null) =>
      id ? members.find((m) => m.id === id)?.display_name ?? 'someone' : 'anyone'

    for (const deal of deals) {
      const turn = summarizeTurn(deal, pair, now)
      const due = turnDueAt(deal)

      // Today always carries the live state — that is the board's job.
      push(map, dayKey(now), {
        deal,
        text: turn.badge(nameOf),
        overdue: turn.status === 'overdue',
        isDeadline: false,
      })

      // A grace window turns into a real deadline you can see coming.
      if (due && !isSameDay(due, now)) {
        push(map, dayKey(due), {
          deal,
          text: `${deal.title}: due ${nameOf(turn.assigneeId)}`,
          overdue: due < now,
          isDeadline: true,
        })
      }
    }
    return map
  }, [deals, pair, members, now])

  const step = (direction: -1 | 1) => {
    setAnchor((current) =>
      view === 'month'
        ? addMonths(current, direction)
        : addDays(current, direction * (view === 'week' ? 7 : 1)),
    )
  }

  const heading =
    view === 'month'
      ? format(anchor, 'MMMM yyyy')
      : view === 'week'
        ? `${format(weekGrid(anchor)[0], 'd MMM')} – ${format(weekGrid(anchor)[6], 'd MMM')}`
        : format(anchor, 'EEEE d MMMM')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <IconButton label="Previous" onClick={() => step(-1)}>
            ‹
          </IconButton>
          <h1 className="min-w-[9.5rem] text-center text-lg sm:text-xl">{heading}</h1>
          <IconButton label="Next" onClick={() => step(1)}>
            ›
          </IconButton>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="quiet" size="sm" onClick={() => setAnchor(new Date())}>
            Today
          </Button>
          <SegmentedControl
            ariaLabel="Calendar view"
            value={view}
            onChange={setView}
            options={[
              { value: 'month', label: 'Month' },
              { value: 'week', label: 'Week' },
              { value: 'day', label: 'Day' },
            ]}
          />
        </div>
      </div>

      {view === 'month' ? (
        <MonthGrid
          days={days}
          anchor={anchor}
          eventsByDay={eventsByDay}
          badgesByDay={badgesByDay}
          members={members}
          onPick={setSelected}
        />
      ) : (
        <AgendaList
          days={days}
          eventsByDay={eventsByDay}
          badgesByDay={badgesByDay}
          members={members}
          onPick={setSelected}
        />
      )}

      {viewer.isMember && (
        <Button
          variant="primary"
          className="fixed bottom-20 right-4 z-30 shadow-lift sm:static sm:w-auto"
          onClick={() => setComposing(selected ?? anchor)}
        >
          + Add plan
        </Button>
      )}

      {selected && (
        <DayDrawer
          day={selected}
          events={eventsByDay.get(dayKey(selected)) ?? []}
          badges={badgesByDay.get(dayKey(selected)) ?? []}
          members={members}
          pair={pair}
          onClose={() => setSelected(null)}
          onAdd={() => {
            setComposing(selected)
            setSelected(null)
          }}
          onChanged={reload}
        />
      )}

      {composing && (
        <EventForm
          day={composing}
          members={members}
          onClose={() => setComposing(null)}
          onSaved={reload}
        />
      )}
    </div>
  )
}

function MonthGrid({
  days,
  anchor,
  eventsByDay,
  badgesByDay,
  members,
  onPick,
}: {
  days: Date[]
  anchor: Date
  eventsByDay: Map<string, BoardEvent[]>
  badgesByDay: Map<string, DealBadge[]>
  members: Profile[]
  onPick: (day: Date) => void
}) {
  return (
    <div className="card overflow-hidden p-0">
      <div className="grid grid-cols-7 border-b border-linen-edge bg-linen-deep/60">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((label) => (
          <div
            key={label}
            className="py-2 text-center text-[10px] font-semibold uppercase tracking-[0.1em] text-espresso-faint"
          >
            {label.slice(0, 1)}
            <span className="hidden sm:inline">{label.slice(1)}</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7">
        {days.map((day) => {
          const key = dayKey(day)
          const dayEvents = eventsByDay.get(key) ?? []
          const badges = badgesByDay.get(key) ?? []
          const outside = !isSameMonth(day, anchor)
          const hasOverdue = badges.some((b) => b.overdue)

          return (
            <button
              key={key}
              onClick={() => onPick(day)}
              className={cx(
                'group relative min-h-[4.75rem] border-b border-r border-linen-edge p-1.5 text-left transition sm:min-h-[6rem]',
                'hover:bg-gold/[0.06] focus-visible:bg-gold/10',
                outside && 'bg-linen-deep/30',
              )}
            >
              <span
                className={cx(
                  'grid h-6 w-6 place-items-center rounded-full text-xs font-medium tabular-nums',
                  isToday(day) && 'bg-espresso text-linen',
                  !isToday(day) && outside && 'text-espresso-faint',
                  !isToday(day) && !outside && 'text-espresso-soft',
                )}
              >
                {format(day, 'd')}
              </span>

              {hasOverdue && (
                <span
                  aria-hidden
                  className="absolute right-1.5 top-2 h-1.5 w-1.5 rounded-full bg-terracotta"
                />
              )}

              <div className="mt-1 space-y-0.5">
                {dayEvents.slice(0, 2).map((event) => {
                  const owner = members.find((m) => m.id === event.owner_id)
                  return (
                    <span
                      key={event.id}
                      className="flex items-center gap-1 truncate rounded-md px-1 py-[1px] text-[10px] leading-tight"
                      style={{
                        background: `${owner?.color ?? '#D4AF37'}1F`,
                        color: '#2B2625',
                      }}
                    >
                      <span
                        aria-hidden
                        className="h-1 w-1 shrink-0 rounded-full"
                        style={{ background: owner?.color ?? '#D4AF37' }}
                      />
                      <span className="truncate">{event.title}</span>
                      {event.series_id && (
                        <span aria-hidden className="shrink-0 opacity-50">
                          ↻
                        </span>
                      )}
                    </span>
                  )
                })}

                {badges.slice(0, 1).map((badge) => (
                  <span
                    key={badge.deal.id}
                    className={cx(
                      'block truncate rounded-md px-1 py-[1px] text-[10px] leading-tight',
                      badge.overdue
                        ? 'bg-terracotta-soft text-terracotta'
                        : 'bg-olive-soft text-[#5c6348]',
                    )}
                  >
                    {badge.deal.emoji} {badge.text}
                  </span>
                ))}

                {dayEvents.length + badges.length > 3 && (
                  <span className="block px-1 text-[10px] text-espresso-faint">
                    +{dayEvents.length + badges.length - 3} more
                  </span>
                )}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function AgendaList({
  days,
  eventsByDay,
  badgesByDay,
  members,
  onPick,
}: {
  days: Date[]
  eventsByDay: Map<string, BoardEvent[]>
  badgesByDay: Map<string, DealBadge[]>
  members: Profile[]
  onPick: (day: Date) => void
}) {
  return (
    <div className="grid gap-2">
      {days.map((day) => {
        const key = dayKey(day)
        const dayEvents = eventsByDay.get(key) ?? []
        const badges = badgesByDay.get(key) ?? []
        return (
          <button
            key={key}
            onClick={() => onPick(day)}
            className={cx(
              'card flex items-start gap-3 p-4 text-left transition hover:shadow-lift',
              isToday(day) && 'border-gold/45',
            )}
          >
            <span className="w-11 shrink-0 text-center">
              <span className="block text-[10px] uppercase tracking-wider text-espresso-faint">
                {format(day, 'EEE')}
              </span>
              <span
                className={cx(
                  'mt-0.5 grid h-7 w-7 place-items-center rounded-full text-sm font-medium tabular-nums',
                  isToday(day) ? 'mx-auto bg-espresso text-linen' : 'mx-auto text-espresso',
                )}
              >
                {format(day, 'd')}
              </span>
            </span>

            <span className="min-w-0 flex-1 space-y-1.5">
              {dayEvents.length === 0 && badges.length === 0 && (
                <span className="block text-sm text-espresso-faint">Nothing scheduled</span>
              )}
              {dayEvents.map((event) => {
                const owner = members.find((m) => m.id === event.owner_id)
                return (
                  <span key={event.id} className="flex items-center gap-2 text-sm">
                    <span
                      aria-hidden
                      className="h-3.5 w-1 shrink-0 rounded-full"
                      style={{ background: owner?.color ?? '#D4AF37' }}
                    />
                    <span className="truncate font-medium">{event.title}</span>
                    {event.series_id && (
                      <span aria-hidden className="shrink-0 text-xs opacity-45" title="Repeats">
                        ↻
                      </span>
                    )}
                    <span className="shrink-0 text-xs text-espresso-faint">
                      {event.all_day ? 'all day' : format(toDate(event.starts_at), 'h:mm a')}
                    </span>
                  </span>
                )
              })}
              {badges.map((badge) => (
                <span
                  key={`${badge.deal.id}-${badge.isDeadline}`}
                  className={cx(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]',
                    badge.overdue
                      ? 'bg-terracotta-soft text-terracotta'
                      : 'bg-olive-soft text-[#5c6348]',
                  )}
                >
                  {badge.deal.emoji} {badge.text}
                </span>
              ))}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function IconButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      aria-label={label}
      onClick={onClick}
      className="grid h-9 w-9 place-items-center rounded-full text-xl text-espresso-soft
                 transition hover:bg-linen-deep hover:text-espresso"
    >
      {children}
    </button>
  )
}

/** Local-calendar key. Must not go through toISOString(), which shifts to UTC
 *  and would file an 8am Kuala Lumpur event under the previous day. */
function dayKey(date: Date): string {
  return format(date, 'yyyy-MM-dd')
}

function push<T>(map: Map<string, T[]>, key: string, value: T) {
  const list = map.get(key) ?? []
  list.push(value)
  map.set(key, list)
}

