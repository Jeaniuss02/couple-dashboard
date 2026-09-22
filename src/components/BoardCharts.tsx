'use client'

import { useMemo, useState } from 'react'

import { Card, cx, SectionHeading } from './ui'
import { format } from '@/lib/dates'
import { MOOD_SCALE, type DealLog, type MoodEntry, type Profile } from '@/lib/types'

/**
 * Two charts, never one.
 *
 * "Tasks completed" is a count and "mood" is a 1-5 rating — different units on
 * different scales. Overlaying them on a shared axis (a dual-axis chart) would
 * invite comparisons between numbers that have no relationship. Two stacked
 * panels, one axis each.
 *
 * Both are plain SVG: no chart library, no client-side data fetching, and they
 * render identically on the server.
 */

const FALLBACK = ['#B5842B', '#0F6E96']

export function BoardCharts({
  logs,
  moods,
  members,
  days = 14,
}: {
  logs: DealLog[]
  moods: MoodEntry[]
  members: Profile[]
  days?: number
}) {
  const [range, setRange] = useState(days)

  // Colour follows the person, not their position in the list, so filtering or
  // reordering can never repaint someone.
  const colorOf = (id: string | null) => {
    if (!id) return '#C4B5A0'
    const i = members.findIndex((m) => m.id === id)
    return members[i]?.color ?? FALLBACK[i] ?? '#C4B5A0'
  }

  const buckets = useMemo(() => buildDays(range), [range])

  const completions = useMemo(() => {
    const byDay = new Map<string, Map<string, number>>()
    for (const log of logs) {
      const key = format(new Date(log.completed_at), 'yyyy-MM-dd')
      const row = byDay.get(key) ?? new Map<string, number>()
      const who = log.completed_by ?? 'unknown'
      row.set(who, (row.get(who) ?? 0) + 1)
      byDay.set(key, row)
    }
    return buckets.map((d) => ({
      key: d.key,
      date: d.date,
      perPerson: members.map((m) => ({
        id: m.id,
        name: m.display_name,
        count: byDay.get(d.key)?.get(m.id) ?? 0,
      })),
      total: members.reduce((sum, m) => sum + (byDay.get(d.key)?.get(m.id) ?? 0), 0),
    }))
  }, [logs, buckets, members])

  const maxTotal = Math.max(1, ...completions.map((c) => c.total))
  const totalDone = completions.reduce((s, c) => s + c.total, 0)

  const moodSeries = useMemo(
    () =>
      members.map((m) => ({
        id: m.id,
        name: m.display_name,
        color: colorOf(m.id),
        points: buckets.map((d) => {
          const entry = moods.find(
            (x) => x.profile_id === m.id && x.scope === 'day' && x.entry_date === d.key,
          )
          return { key: d.key, date: d.date, score: entry?.score ?? null }
        }),
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [moods, buckets, members],
  )

  const anyMood = moodSeries.some((s) => s.points.some((p) => p.score !== null))

  return (
    <section className="space-y-3">
      <SectionHeading
        title="How it's going"
        hint={`Last ${range} days`}
        action={
          <div className="inline-flex rounded-xl border border-linen-edge bg-white/70 p-0.5">
            {[7, 14, 30].map((n) => (
              <button
                key={n}
                onClick={() => setRange(n)}
                aria-pressed={range === n}
                className={cx(
                  'rounded-[10px] px-2.5 py-1 text-xs font-medium transition',
                  range === n ? 'bg-espresso text-linen' : 'text-espresso-soft hover:text-espresso',
                )}
              >
                {n}d
              </button>
            ))}
          </div>
        }
      />

      {/* ---- Chart 1: completions ---------------------------------------- */}
      <Card>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Turns &amp; routines completed</p>
            <p className="text-xs text-espresso-faint">Who logged what, by day</p>
          </div>
          <p className="shrink-0 font-display text-2xl tabular-nums">{totalDone}</p>
        </div>

        {totalDone === 0 ? (
          <p className="py-6 text-center text-xs text-espresso-faint">
            Nothing logged yet — tap “Mark done” on a task and it shows up here.
          </p>
        ) : (
          <>
            <StackedBars data={completions} max={maxTotal} colorOf={colorOf} />
            <Legend
              items={members.map((m) => ({ name: m.display_name, color: colorOf(m.id) }))}
            />
          </>
        )}
      </Card>

      {/* ---- Chart 2: mood ------------------------------------------------ */}
      <Card>
        <div className="mb-3">
          <p className="text-sm font-medium">Mood</p>
          <p className="text-xs text-espresso-faint">
            Rate a day from the calendar — tap any date
          </p>
        </div>

        {!anyMood ? (
          <p className="py-6 text-center text-xs text-espresso-faint">
            No moods recorded yet.
          </p>
        ) : (
          <>
            <MoodLines series={moodSeries} />
            <Legend items={moodSeries.map((s) => ({ name: s.name, color: s.color }))} />
          </>
        )}
      </Card>
    </section>
  )
}

// ---------------------------------------------------------------------------
// Chart 1 — stacked bars
// ---------------------------------------------------------------------------
function StackedBars({
  data,
  max,
  colorOf,
}: {
  data: { key: string; date: Date; perPerson: { id: string; name: string; count: number }[]; total: number }[]
  max: number
  colorOf: (id: string | null) => string
}) {
  const H = 132
  const gap = 2 // surface gap between stacked segments

  return (
    <div className="relative">
      <div
        className="flex items-end gap-[3px]"
        style={{ height: H }}
        role="img"
        aria-label={`Completions per day. ${data.reduce((s, d) => s + d.total, 0)} in total.`}
      >
        {data.map((d) => {
          const barH = (d.total / max) * (H - 18)
          return (
            <div key={d.key} className="group relative flex flex-1 flex-col justify-end">
              {/* hover tooltip */}
              <div
                className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-1 hidden -translate-x-1/2
                           whitespace-nowrap rounded-lg bg-espresso px-2 py-1.5 text-[11px] text-linen
                           shadow-lift group-hover:block"
              >
                <span className="font-medium">{format(d.date, 'EEE d MMM')}</span>
                {d.total === 0 ? (
                  <span className="block opacity-70">nothing logged</span>
                ) : (
                  d.perPerson
                    .filter((p) => p.count > 0)
                    .map((p) => (
                      <span key={p.id} className="block opacity-90">
                        {p.name}: {p.count}
                      </span>
                    ))
                )}
              </div>

              <div className="flex flex-col-reverse" style={{ height: Math.max(barH, 2) }}>
                {d.perPerson.map((p) =>
                  p.count === 0 ? null : (
                    <div
                      key={p.id}
                      style={{
                        height: `${(p.count / d.total) * 100}%`,
                        background: colorOf(p.id),
                        marginTop: gap,
                      }}
                      className="first:rounded-t-[4px]"
                    />
                  ),
                )}
                {d.total === 0 && <div className="h-[2px] w-full rounded bg-linen-edge" />}
              </div>
            </div>
          )
        })}
      </div>

      {/* Sparse axis: only the ends and the middle, so labels never collide. */}
      <div className="mt-1.5 flex justify-between text-[10px] text-espresso-faint">
        <span>{format(data[0].date, 'd MMM')}</span>
        <span>{format(data[Math.floor(data.length / 2)].date, 'd MMM')}</span>
        <span>{format(data[data.length - 1].date, 'd MMM')}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chart 2 — mood lines
// ---------------------------------------------------------------------------
function MoodLines({
  series,
}: {
  series: { id: string; name: string; color: string; points: { key: string; date: Date; score: number | null }[] }[]
}) {
  const W = 320
  const H = 120
  const padY = 10
  const n = series[0]?.points.length ?? 0
  if (n === 0) return null

  const x = (i: number) => (n === 1 ? W / 2 : (i / (n - 1)) * W)
  const y = (score: number) => padY + (1 - (score - 1) / 4) * (H - padY * 2)

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[130px] w-full overflow-visible"
        role="img"
        aria-label="Mood over time, 1 rough to 5 wonderful"
        preserveAspectRatio="none"
      >
        {/* recessive gridlines at each mood step */}
        {MOOD_SCALE.map((m) => (
          <line
            key={m.score}
            x1={0}
            x2={W}
            y1={y(m.score)}
            y2={y(m.score)}
            stroke="#E7DFD2"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {series.map((s) => {
          // Gaps are gaps: unrated days break the line rather than being
          // interpolated, which would invent a mood nobody recorded.
          const segments: { i: number; score: number }[][] = []
          let current: { i: number; score: number }[] = []
          s.points.forEach((p, i) => {
            if (p.score === null) {
              if (current.length) segments.push(current)
              current = []
            } else {
              current.push({ i, score: p.score })
            }
          })
          if (current.length) segments.push(current)

          return (
            <g key={s.id}>
              {segments.map((seg, si) => (
                <polyline
                  key={si}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  points={seg.map((p) => `${x(p.i)},${y(p.score)}`).join(' ')}
                />
              ))}
              {s.points.map((p, i) =>
                p.score === null ? null : (
                  <circle
                    key={p.key}
                    cx={x(i)}
                    cy={y(p.score)}
                    r={4}
                    fill={s.color}
                    stroke="#FAF7F2"
                    strokeWidth={2}
                    vectorEffect="non-scaling-stroke"
                  >
                    <title>
                      {s.name} · {format(p.date, 'EEE d MMM')} ·{' '}
                      {MOOD_SCALE.find((m) => m.score === p.score)?.label}
                    </title>
                  </circle>
                ),
              )}
            </g>
          )
        })}
      </svg>

      <div className="mt-1 flex justify-between text-[10px] text-espresso-faint">
        <span>{MOOD_SCALE[0].emoji} rough</span>
        <span>{MOOD_SCALE[4].emoji} wonderful</span>
      </div>
    </div>
  )
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-linen-edge pt-2.5">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5 text-[11px] text-espresso-soft">
          <span
            aria-hidden
            className="h-2.5 w-2.5 rounded-[3px]"
            style={{ background: i.color }}
          />
          {i.name}
        </span>
      ))}
    </div>
  )
}

function buildDays(count: number): { key: string; date: Date }[] {
  const out: { key: string; date: Date }[] = []
  const today = new Date()
  for (let i = count - 1; i >= 0; i -= 1) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i)
    out.push({ key: format(d, 'yyyy-MM-dd'), date: d })
  }
  return out
}
