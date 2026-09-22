'use client'

import { useState } from 'react'

import { useAction } from './hooks'
import { Avatar, Button, cx, Toast, useViewer } from './ui'
import { format } from '@/lib/dates'
import { MOOD_SCALE, type MoodEntry, type MoodScope, type Profile } from '@/lib/types'

/**
 * Rate how a day (or the week) felt.
 *
 * You may only set your own — the API never accepts a profile_id, and RLS
 * enforces it besides. Your partner's rating shows read-only alongside yours,
 * which is the point of putting it on a shared board.
 */
export function MoodPicker({
  day,
  scope = 'day',
  entries,
  members,
  onChanged,
}: {
  day: Date
  scope?: MoodScope
  entries: MoodEntry[]
  members: Profile[]
  onChanged?: () => void
}) {
  const viewer = useViewer()
  const { run, pending, toast, dismissToast } = useAction()

  const entryDate = scope === 'week' ? format(mondayOf(day), 'yyyy-MM-dd') : format(day, 'yyyy-MM-dd')
  const forPeriod = entries.filter((e) => e.scope === scope && e.entry_date === entryDate)
  const mine = forPeriod.find((e) => e.profile_id === viewer.id)
  const theirs = forPeriod.filter((e) => e.profile_id !== viewer.id)

  const [note, setNote] = useState(mine?.note ?? '')
  const [showNote, setShowNote] = useState(false)

  const setScore = async (score: number) => {
    const done = await run(
      'mood',
      { url: '/api/mood', body: { entry_date: entryDate, scope, score, note } },
      { success: () => 'Saved', refresh: true },
    )
    if (done) onChanged?.()
  }

  const clear = async () => {
    const done = await run(
      'mood-clear',
      { url: `/api/mood?entry_date=${entryDate}&scope=${scope}`, method: 'DELETE' },
      { success: () => 'Cleared' },
    )
    if (done) onChanged?.()
  }

  if (!viewer.isMember) {
    // Mood is members-only at the database level; say so rather than showing
    // an empty widget that looks broken.
    return null
  }

  return (
    <>
      <div className="rounded-2xl border border-linen-edge bg-white/60 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="label">
            {scope === 'week' ? 'How was the week?' : 'How was today?'}
          </span>
          {mine && (
            <button
              onClick={clear}
              disabled={pending === 'mood-clear'}
              className="text-[11px] text-espresso-faint hover:text-terracotta disabled:opacity-50"
            >
              clear
            </button>
          )}
        </div>

        <div className="mt-2 flex items-center justify-between gap-1">
          {MOOD_SCALE.map((m) => {
            const active = mine?.score === m.score
            return (
              <button
                key={m.score}
                onClick={() => setScore(m.score)}
                disabled={pending === 'mood'}
                aria-pressed={active}
                aria-label={m.label}
                title={m.label}
                className={cx(
                  'flex flex-1 flex-col items-center gap-1 rounded-xl border px-1 py-2 transition',
                  active
                    ? 'border-transparent shadow-card'
                    : 'border-transparent hover:bg-linen-deep',
                  pending === 'mood' && 'opacity-60',
                )}
                style={active ? { background: `${m.hex}2e` } : undefined}
              >
                <span className="text-xl leading-none">{m.emoji}</span>
                <span
                  className={cx(
                    'text-[10px]',
                    active ? 'font-semibold text-espresso' : 'text-espresso-faint',
                  )}
                >
                  {m.label}
                </span>
              </button>
            )
          })}
        </div>

        {mine && (
          <div className="mt-2">
            {showNote || mine.note ? (
              <div className="flex gap-2">
                <input
                  className="field flex-1 py-1.5 text-xs"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="A word about why (optional)"
                />
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setScore(mine.score)}
                  loading={pending === 'mood'}
                >
                  Save
                </Button>
              </div>
            ) : (
              <button
                onClick={() => setShowNote(true)}
                className="text-[11px] text-espresso-faint hover:text-espresso"
              >
                + add a note
              </button>
            )}
          </div>
        )}

        {theirs.length > 0 && (
          <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-linen-edge pt-2.5">
            {theirs.map((entry) => {
              const who = members.find((m) => m.id === entry.profile_id)
              const mood = MOOD_SCALE.find((m) => m.score === entry.score)
              return (
                <span key={entry.id} className="inline-flex items-center gap-1.5 text-xs">
                  <Avatar profile={who} size={18} />
                  <span className="text-base leading-none">{mood?.emoji}</span>
                  <span className="text-espresso-faint">
                    {who?.display_name} felt {mood?.label.toLowerCase()}
                  </span>
                  {entry.note && (
                    <span className="text-espresso-faint">— {entry.note}</span>
                  )}
                </span>
              )
            })}
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  )
}

function mondayOf(date: Date): Date {
  const d = new Date(date)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}
