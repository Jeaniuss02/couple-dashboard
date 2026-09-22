'use client'

import { useState } from 'react'

import { useAction } from './hooks'
import { WhatsAppGlyph } from './DealCard'
import { Avatar, Button, cx, Sheet, Toast, useViewer } from './ui'
import { format } from '@/lib/dates'
import { WEEKDAY_LABELS } from '@/lib/recurrence'
import type { Profile } from '@/lib/types'

type Freq = 'none' | 'daily' | 'weekly' | 'monthly'
type EndMode = 'never' | 'until' | 'count'

const FREQ_OPTIONS: { value: Freq; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const END_OPTIONS: { value: EndMode; label: string }[] = [
  { value: 'never', label: 'Never' },
  { value: 'until', label: 'On a date' },
  { value: 'count', label: 'After N times' },
]

/**
 * Add a plan. Saving fans out to BOTH partners over WhatsApp (trigger #1) —
 * the button says so, because a message leaving the app should never surprise you.
 */
export function EventForm({
  day,
  members,
  onClose,
  onSaved,
}: {
  day: Date
  members: Profile[]
  onClose: () => void
  onSaved: () => void
}) {
  const viewer = useViewer()
  const { run, pending, toast, dismissToast } = useAction()

  const [title, setTitle] = useState('')
  const [owner, setOwner] = useState<string | null>(null) // null = shared
  const [allDay, setAllDay] = useState(false)
  const [date, setDate] = useState(format(day, 'yyyy-MM-dd'))
  const [startTime, setStartTime] = useState(format(roundToNextHalfHour(day), 'HH:mm'))
  const [endTime, setEndTime] = useState('')
  const [location, setLocation] = useState('')
  const [description, setDescription] = useState('')

  const [freq, setFreq] = useState<Freq>('none')
  const [interval, setInterval] = useState('1')
  const [byweekday, setByweekday] = useState<number[]>([])
  const [endMode, setEndMode] = useState<EndMode>('never')
  const [untilDate, setUntilDate] = useState('')
  const [count, setCount] = useState('10')

  const submit = async () => {
    const result = await run(
      'create-event',
      {
        url: '/api/events',
        body: {
          title,
          description,
          location,
          all_day: allDay,
          // Local wall-clock strings; the browser converts to the right instant.
          starts_at: allDay ? `${date}T00:00` : `${date}T${startTime}`,
          ends_at: !allDay && endTime ? `${date}T${endTime}` : null,
          kind: owner ? 'personal' : 'shared',
          owner_id: owner,
          recurrence:
            freq === 'none'
              ? null
              : {
                  freq,
                  interval: Number(interval) || 1,
                  byweekday: freq === 'weekly' && byweekday.length ? byweekday : null,
                  until: endMode === 'until' && untilDate ? `${untilDate}T23:59` : null,
                  count: endMode === 'count' ? Number(count) || null : null,
                  // The rule belongs to the viewer's zone, which is what keeps
                  // the time stable across a daylight-saving change.
                  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                },
        },
      },
      {
        success: (d) => {
          const rule = (d as { recurrence?: string }).recurrence
          return rule ? `Added — ${rule.toLowerCase()}` : 'Added to the calendar'
        },
      },
    )
    if (result) {
      onSaved()
      onClose()
    }
  }

  const toggleWeekday = (day: number) =>
    setByweekday((current) =>
      current.includes(day) ? current.filter((d) => d !== day) : [...current, day].sort((a, b) => a - b),
    )

  // The weekday the chosen date falls on, so "Weekly" can say which day it means.
  const startWeekday = (new Date(`${date}T12:00`).getDay() + 6) % 7

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title="New plan"
        footer={
          <div className="space-y-2">
            <Button
              variant="primary"
              onClick={submit}
              loading={pending === 'create-event'}
              disabled={!title.trim()}
              className="w-full"
            >
              Add plan
            </Button>
            <p className="flex items-center justify-center gap-1.5 text-[11px] text-espresso-faint">
              <span className="text-whatsapp">
                <WhatsAppGlyph />
              </span>
              Both of you get a WhatsApp confirmation
            </p>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label mb-1.5" htmlFor="event-title">
              What&apos;s the plan
            </label>
            <input
              id="event-title"
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Dinner at Kenny Hills"
              autoFocus
            />
          </div>

          <div>
            <span className="label mb-1.5">Whose plan</span>
            <div className="flex flex-wrap gap-2">
              <ChoiceChip active={owner === null} onClick={() => setOwner(null)}>
                🤍 Together
              </ChoiceChip>
              {members.map((member) => (
                <ChoiceChip
                  key={member.id}
                  active={owner === member.id}
                  onClick={() => setOwner(member.id)}
                  accent={member.color}
                >
                  <Avatar profile={member} size={18} />
                  {member.display_name}
                  {member.id === viewer.id && <span className="text-[10px] opacity-60">(you)</span>}
                </ChoiceChip>
              ))}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label mb-1.5" htmlFor="event-date">
                Date
              </label>
              <input
                id="event-date"
                type="date"
                className="field"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <label className="flex items-end gap-2 pb-2.5 text-sm">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(e) => setAllDay(e.target.checked)}
                className="h-4 w-4 accent-[#C5A059]"
              />
              All day
            </label>
          </div>

          {!allDay && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label mb-1.5" htmlFor="event-start">
                  Starts
                </label>
                <input
                  id="event-start"
                  type="time"
                  className="field"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
              </div>
              <div>
                <label className="label mb-1.5" htmlFor="event-end">
                  Ends <span className="font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="event-end"
                  type="time"
                  className="field"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}

          {/* --- repeat --- */}
          <div className="rounded-2xl border border-linen-edge bg-linen-deep/40 p-3">
            <span className="label mb-2">Repeats</span>
            <div className="flex flex-wrap gap-1.5">
              {FREQ_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setFreq(option.value)}
                  className={cx(
                    'rounded-full border px-3 py-1.5 text-xs transition',
                    freq === option.value
                      ? 'border-transparent bg-gold/20 font-medium'
                      : 'border-linen-edge bg-white/60 hover:border-camel',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {freq !== 'none' && (
              <div className="mt-3 space-y-3 border-t border-linen-edge pt-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-espresso-soft">Every</span>
                  <input
                    type="number"
                    min={1}
                    max={52}
                    className="field w-16 py-1.5 text-center"
                    value={interval}
                    onChange={(e) => setInterval(e.target.value)}
                    aria-label="Repeat interval"
                  />
                  <span className="text-espresso-soft">
                    {freq === 'daily' ? 'day(s)' : freq === 'weekly' ? 'week(s)' : 'month(s)'}
                  </span>
                </div>

                {freq === 'weekly' && (
                  <div>
                    <span className="label mb-1.5">On</span>
                    <div className="flex flex-wrap gap-1">
                      {WEEKDAY_LABELS.map((label, day) => {
                        const active = byweekday.includes(day)
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() => toggleWeekday(day)}
                            aria-pressed={active}
                            className={cx(
                              'h-8 w-9 rounded-lg border text-xs transition',
                              active
                                ? 'border-transparent bg-gold/25 font-semibold'
                                : 'border-linen-edge bg-white/60 hover:border-camel',
                            )}
                          >
                            {label.slice(0, 1)}
                          </button>
                        )
                      })}
                    </div>
                    <p className="mt-1 text-[11px] text-espresso-faint">
                      {byweekday.length === 0
                        ? `Defaults to ${WEEKDAY_LABELS[startWeekday]}, matching the date above.`
                        : `Repeats on ${byweekday.map((d) => WEEKDAY_LABELS[d]).join(', ')}.`}
                    </p>
                  </div>
                )}

                <div>
                  <span className="label mb-1.5">Ends</span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {END_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setEndMode(option.value)}
                        className={cx(
                          'rounded-full border px-3 py-1.5 text-xs transition',
                          endMode === option.value
                            ? 'border-transparent bg-gold/20 font-medium'
                            : 'border-linen-edge bg-white/60 hover:border-camel',
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>

                  {endMode === 'until' && (
                    <input
                      type="date"
                      className="field mt-2"
                      value={untilDate}
                      min={date}
                      onChange={(e) => setUntilDate(e.target.value)}
                      aria-label="Repeat until"
                    />
                  )}
                  {endMode === 'count' && (
                    <div className="mt-2 flex items-center gap-2 text-sm">
                      <span className="text-espresso-soft">After</span>
                      <input
                        type="number"
                        min={1}
                        max={500}
                        className="field w-20 py-1.5 text-center"
                        value={count}
                        onChange={(e) => setCount(e.target.value)}
                        aria-label="Number of repeats"
                      />
                      <span className="text-espresso-soft">times</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="event-location">
              Where <span className="font-normal normal-case tracking-normal">(optional)</span>
            </label>
            <input
              id="event-location"
              className="field"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Kenny Hills Bakers"
            />
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="event-notes">
              Notes <span className="font-normal normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              id="event-notes"
              className="field min-h-[64px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      </Sheet>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  )
}

function ChoiceChip({
  active,
  accent,
  onClick,
  children,
}: {
  active: boolean
  accent?: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition',
        active ? 'border-transparent text-espresso' : 'border-linen-edge bg-white/60 hover:border-camel',
      )}
      style={active ? { background: `${accent ?? '#D4AF37'}26` } : undefined}
    >
      {children}
    </button>
  )
}

function roundToNextHalfHour(day: Date): Date {
  const date = new Date(day)
  const now = new Date()
  // Picking a future day should not inherit "now" — default those to 7pm.
  if (date.toDateString() !== now.toDateString()) {
    date.setHours(19, 0, 0, 0)
    return date
  }
  date.setHours(now.getHours(), now.getMinutes() < 30 ? 30 : 0, 0, 0)
  if (now.getMinutes() >= 30) date.setHours(date.getHours() + 1)
  return date
}
