'use client'

import { useState } from 'react'

import type { DealBadge } from './Calendar'
import { DealCard } from './DealCard'
import { useAction } from './hooks'
import { Avatar, Button, Chip, MemberOnly, Sheet, Toast } from './ui'
import { format, formatEventTime } from '@/lib/dates'
import type { Members } from '@/lib/rotation'
import type { BoardEvent, Profile } from '@/lib/types'

/**
 * Everything happening on one day, with the same one-tap deal controls as the
 * dashboard — so a routine can be completed straight from the calendar.
 */
export function DayDrawer({
  day,
  events,
  badges,
  members,
  pair,
  onClose,
  onAdd,
  onChanged,
}: {
  day: Date
  events: BoardEvent[]
  badges: DealBadge[]
  members: Profile[]
  pair: Members
  onClose: () => void
  onAdd: () => void
  onChanged: () => void
}) {
  const { run, pending, toast, dismissToast } = useAction()
  const [confirming, setConfirming] = useState<BoardEvent | null>(null)

  const remove = async (event: BoardEvent) => {
    // A recurring occurrence is ambiguous — ask which one they meant.
    if (event.series_id) {
      setConfirming(event)
      return
    }
    const done = await run(
      `delete-${event.id}`,
      { url: `/api/events/${event.id}`, method: 'DELETE' },
      { success: () => 'Removed from the calendar' },
    )
    if (done) onChanged()
  }

  const removeScope = async (event: BoardEvent, scope: 'one' | 'following' | 'all') => {
    const request =
      scope === 'one'
        ? {
            url: `/api/series/${event.series_id}/occurrence`,
            method: 'POST',
            body: { occurrence_start: event.occurrence_start, cancelled: true },
          }
        : scope === 'following'
          ? {
              url: `/api/series/${event.series_id}?from=${encodeURIComponent(event.occurrence_start!)}`,
              method: 'DELETE',
            }
          : { url: `/api/series/${event.series_id}`, method: 'DELETE' }

    const done = await run(`delete-${event.id}`, request, {
      success: () =>
        scope === 'one'
          ? 'Just this one removed'
          : scope === 'following'
            ? 'This and all later ones removed'
            : 'Whole series removed',
    })

    setConfirming(null)
    if (done) onChanged()
  }

  // De-duplicate: a deal can appear twice (live state + a deadline badge).
  const deals = Array.from(new Map(badges.map((b) => [b.deal.id, b.deal])).values())

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={format(day, 'EEEE d MMMM')}
        footer={
          <MemberOnly>
            <Button variant="primary" onClick={onAdd} className="w-full">
              + Add a plan for this day
            </Button>
          </MemberOnly>
        }
      >
        <section>
          <h3 className="label mb-2">Plans</h3>
          {events.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-linen-edge px-4 py-5 text-center text-sm text-espresso-faint">
              Nothing scheduled.
            </p>
          ) : (
            <ul className="grid gap-2">
              {events.map((event) => {
                const owner = members.find((m) => m.id === event.owner_id)
                return (
                  <li key={event.id} className="card flex items-start gap-3 px-4 py-3">
                    <span
                      aria-hidden
                      className="mt-0.5 h-10 w-1 shrink-0 rounded-full"
                      style={{ background: owner?.color ?? '#D4AF37' }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{event.title}</p>
                      <p className="mt-0.5 text-xs text-espresso-faint">
                        {formatEventTime(event)}
                        {event.location ? ` · ${event.location}` : ''}
                      </p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {owner ? (
                          <Avatar profile={owner} size={20} showName />
                        ) : (
                          <Chip tone="gold">together</Chip>
                        )}
                        {event.series_id && <Chip tone="camel">🔁 repeats</Chip>}
                        {event.moved && (
                          <Chip tone="neutral" className="opacity-70">
                            moved
                          </Chip>
                        )}
                        {event.notified_at && (
                          <Chip tone="neutral" className="opacity-70">
                            ✓ sent
                          </Chip>
                        )}
                      </div>
                      {event.description && (
                        <p className="mt-2 text-xs text-espresso-soft">{event.description}</p>
                      )}
                    </div>
                    <MemberOnly>
                      <button
                        onClick={() => remove(event)}
                        disabled={pending === `delete-${event.id}`}
                        aria-label={`Delete ${event.title}`}
                        className="shrink-0 rounded-lg p-1.5 text-espresso-faint transition
                                   hover:bg-terracotta-soft hover:text-terracotta disabled:opacity-50"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                        </svg>
                      </button>
                    </MemberOnly>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {deals.length > 0 && (
          <section className="mt-6">
            <h3 className="label mb-2">Turns & routines</h3>
            <div className="grid gap-2">
              {deals.map((deal) => (
                <DealCard key={deal.id} deal={deal} members={members} pair={pair} compact />
              ))}
            </div>
          </section>
        )}
      </Sheet>

      {confirming && (
        <Sheet
          open
          onClose={() => setConfirming(null)}
          title="Remove which?"
          footer={
            <Button variant="quiet" onClick={() => setConfirming(null)} className="w-full">
              Keep it
            </Button>
          }
        >
          <p className="text-sm text-espresso-soft">
            <span className="font-medium text-espresso">{confirming.title}</span> repeats.
            Removing one occurrence leaves the rest of the series untouched.
          </p>
          <div className="mt-4 grid gap-2">
            {(
              [
                ['one', 'Just this one', 'Cancels this date only.'],
                ['following', 'This and all later ones', 'Ends the series here. Past ones stay on the record.'],
                ['all', 'The whole series', 'Removes every occurrence, past and future.'],
              ] as const
            ).map(([scope, label, hint]) => (
              <button
                key={scope}
                onClick={() => removeScope(confirming, scope)}
                disabled={pending === `delete-${confirming.id}`}
                className="rounded-2xl border border-linen-edge bg-white/60 p-3 text-left transition
                           hover:border-terracotta disabled:opacity-50"
              >
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-xs text-espresso-faint">{hint}</span>
              </button>
            ))}
          </div>
        </Sheet>
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  )
}
