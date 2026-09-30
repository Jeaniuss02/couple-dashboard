'use client'

import Link from 'next/link'
import { useMemo } from 'react'

import { useAction, useTicker } from './hooks'
import { Avatar, Button, Chip, cx, MemberOnly, Toast, useViewer } from './ui'
import { WhatsAppGlyph } from './DealCard'
import { format } from '@/lib/dates'
import { cycleProgress, isOverdue, orderedSteps, summarizeTurn, type Members } from '@/lib/rotation'
import type { DealWithSteps, KissStats, Profile } from '@/lib/types'

/**
 * The one thing you look at on a phone: today's date, whose turn it is, and a
 * button big enough to hit with a thumb. Everything else on the dashboard is
 * detail — this card is the ritual.
 */
export function TodayCard({
  deals,
  members,
  pair,
  stats,
}: {
  deals: DealWithSteps[]
  members: Profile[]
  pair: Members
  stats: KissStats
}) {
  const viewer = useViewer()
  const now = useTicker()
  const { run, pending, toast, dismissToast } = useAction()

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const nameOf = (id: string | null | undefined) =>
    id ? (byId.get(id)?.display_name ?? 'someone') : 'either of you'

  const overdue = deals.filter((deal) => isOverdue(deal, now)).length

  // Overdue first, then nearly due, then the rest — the same order the list
  // below uses, but trimmed to the top three so the card stays phone-height.
  const top = useMemo(() => {
    const rank = (deal: DealWithSteps) => {
      const turn = summarizeTurn(deal, pair, now)
      if (turn.status === 'overdue') return 0
      if (turn.status === 'due') return 1
      if (viewer.id && turn.assigneeId === viewer.id) return 2
      return 3
    }
    return [...deals].sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order).slice(0, 3)
  }, [deals, pair, now, viewer.id])

  const weekMax = Math.max(1, ...stats.days.map((day) => day.count))

  return (
    <>
      <section className="card overflow-hidden p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-espresso-faint">
              {format(now, 'EEEE d MMMM')}
            </p>
            <h1 className="mt-1 font-display text-xl leading-tight sm:text-2xl">
              {overdue > 0 ? (
                <>
                  <span className="text-terracotta">{overdue}</span> waiting to be logged
                </>
              ) : (
                'All square today 🤍'
              )}
            </h1>
          </div>

          {stats.available && (
            <div className="shrink-0 text-right">
              <p className="text-lg font-semibold leading-none text-gold-deep">💋 {stats.today}</p>
              <p className="mt-1 text-[11px] text-espresso-faint">today</p>
            </div>
          )}
        </div>

        {/* Whose turn — the headline the whole app exists for. */}
        <div className="mt-4 space-y-3">
          {top.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-linen-edge px-4 py-5 text-center text-sm text-espresso-faint">
              No routines yet.{' '}
              <Link href="/tasks" className="underline decoration-gold-soft underline-offset-2">
                Add the first one
              </Link>
              .
            </p>
          ) : (
            top.map((deal) => {
              const turn = summarizeTurn(deal, pair, now)
              const steps = orderedSteps(deal)
              const progress = cycleProgress(deal)
              const assignee = turn.assigneeId ? byId.get(turn.assigneeId) : null
              const isMine = turn.assigneeId != null && turn.assigneeId === viewer.id
              const late = turn.status === 'overdue'
              const key = `today-${deal.id}`

              return (
                <div
                  key={deal.id}
                  className={cx(
                    'rounded-2xl border p-3',
                    late ? 'border-terracotta/40 bg-terracotta-soft/40' : 'border-linen-edge bg-white/60',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span aria-hidden className="text-lg">
                      {deal.emoji}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-display text-base font-semibold">
                      {deal.title}
                    </span>
                    {isMine && !late && <Chip tone="gold">yours</Chip>}
                    {late && <Chip tone="terracotta">overdue</Chip>}
                    {steps.length > 1 && (
                      <Chip tone="neutral">
                        {progress.index + 1}/{progress.total}
                      </Chip>
                    )}
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                    {assignee ? (
                      <Avatar profile={assignee} size={22} showName />
                    ) : (
                      <span className="text-espresso-soft">either of you</span>
                    )}
                    <span className="text-espresso-soft">{turn.headline(nameOf)}</span>
                  </div>

                  <MemberOnly
                    fallback={
                      <p className="mt-2 text-[11px] text-espresso-faint">
                        Sign in to log this turn.
                      </p>
                    }
                  >
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Button
                        variant="primary"
                        size="lg"
                        className="w-full sm:w-auto"
                        onClick={() =>
                          run(
                            key,
                            {
                              url: `/api/deals/${deal.id}/complete`,
                              body: { source: 'dashboard' },
                            },
                            {
                              success: (data) => {
                                const next = (
                                  data as { next?: { assigneeName?: string } }
                                ).next
                                if (!next?.assigneeName) return 'Logged ✓'
                                return `Logged ✓ — next up: ${next.assigneeName}`
                              },
                            },
                          )
                        }
                        loading={pending === key}
                      >
                        ✓ Done
                      </Button>

                      {turn.assigneeId && !isMine && (
                        <Button
                          variant="whatsapp"
                          size="sm"
                          onClick={() =>
                            run(
                              `nudge-${deal.id}`,
                              { url: `/api/deals/${deal.id}/nudge` },
                              {
                                success: (data) =>
                                  `Nudged ${(data as { nudged?: string }).nudged ?? 'them'}`,
                              },
                            )
                          }
                          loading={pending === `nudge-${deal.id}`}
                          title={`WhatsApp ${nameOf(turn.assigneeId)}`}
                        >
                          <WhatsAppGlyph /> Nudge
                        </Button>
                      )}
                    </div>
                  </MemberOnly>
                </div>
              )
            })
          )}
        </div>

        {/* Kisses — the payoff for the button in the bottom bar. */}
        {stats.available && (
          <div className="mt-4 border-t border-linen-edge pt-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-sm font-medium">
                  💋 {stats.today} today
                  <span className="text-espresso-faint"> · {stats.week} this week</span>
                </p>
                <p className="mt-0.5 text-[11px] text-espresso-faint">
                  {stats.last
                    ? `Last one ${format(new Date(stats.last.at), 'h:mm a')} by ${nameOf(stats.last.by)}`
                    : 'Tap the button in the middle to start counting.'}
                </p>
              </div>
              <p className="shrink-0 text-[11px] text-espresso-faint">
                {stats.total.toLocaleString()} all time
              </p>
            </div>

            <ol className="mt-3 flex items-end gap-1.5" aria-label="Kisses in the last seven days">
              {stats.days.map((day, index) => (
                <li key={day.key} className="flex flex-1 flex-col items-center gap-1">
                  <span
                    aria-hidden
                    className={cx(
                      'w-full rounded-full transition-all',
                      index === stats.days.length - 1 ? 'bg-gold' : 'bg-gold-soft',
                    )}
                    style={{ height: `${8 + Math.round((day.count / weekMax) * 22)}px` }}
                  />
                  <span className="text-[10px] text-espresso-faint">
                    {index === stats.days.length - 1 ? 'today' : day.label}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </section>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  )
}
