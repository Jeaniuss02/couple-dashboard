'use client'

import { useMemo, useState } from 'react'

import { useAction, useTicker } from './hooks'
import { ClaimPenaltySheet } from './ClaimPenaltySheet'
import { Avatar, Button, Chip, cx, Toast, useViewer } from './ui'
import { format, relative } from '@/lib/dates'
import { cycleProgress, orderedSteps, summarizeTurn, type Members } from '@/lib/rotation'
import type { DealWithSteps, Profile } from '@/lib/types'

export function DealCard({
  deal,
  members,
  pair,
  compact = false,
}: {
  deal: DealWithSteps
  members: Profile[]
  pair: Members
  compact?: boolean
}) {
  const viewer = useViewer()
  const now = useTicker()
  const { run, pending, toast, dismissToast } = useAction()
  const [claiming, setClaiming] = useState(false)

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const nameOf = (id: string | null) => (id ? byId.get(id)?.display_name ?? 'someone' : 'anyone')

  const turn = summarizeTurn(deal, pair, now)
  const progress = cycleProgress(deal)
  const steps = orderedSteps(deal)
  const assignee = turn.assigneeId ? byId.get(turn.assigneeId) : null

  const isMine = turn.assigneeId === viewer.id
  const overdue = turn.status === 'overdue'
  const canClaim = viewer.isMember && overdue && turn.assigneeId != null && !isMine

  const complete = () =>
    run(
      `complete-${deal.id}`,
      { url: `/api/deals/${deal.id}/complete`, body: { source: compact ? 'calendar' : 'dashboard' } },
      {
        success: (data) => {
          const next = (data as { next?: { assigneeName?: string; stepLabel?: string } }).next
          if (!next) return 'Logged.'
          return deal.rotation_type === 'adhoc'
            ? 'Logged.'
            : `Logged — next up: ${next.assigneeName}`
        },
      },
    )

  const nudge = () =>
    run(
      `nudge-${deal.id}`,
      { url: `/api/deals/${deal.id}/nudge` },
      { success: (data) => `Nudged ${(data as { nudged?: string }).nudged ?? 'them'}` },
    )

  return (
    <>
      <article
        className={cx(
          'card relative overflow-hidden p-4 transition-shadow sm:p-5',
          overdue && 'border-terracotta/35 bg-terracotta-soft/40',
          isMine && !overdue && 'border-gold/40',
        )}
      >
        {/* Left edge stripe: whose turn it is, at a glance, from across the room. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{
            background: overdue ? '#C97A63' : assignee?.color ?? '#E7DFD2',
          }}
        />

        <div className="flex items-start justify-between gap-3 pl-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-base font-semibold sm:text-lg">
              <span aria-hidden className="text-lg">
                {deal.emoji}
              </span>
              <span className="truncate font-display">{deal.title}</span>
            </h3>

            <p
              className={cx(
                'mt-1 text-sm',
                overdue ? 'font-medium text-terracotta' : 'text-espresso-soft',
              )}
            >
              {turn.headline(nameOf)}
            </p>

            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {assignee && <Avatar profile={assignee} size={22} showName />}
              {isMine && !overdue && <Chip tone="gold">your turn</Chip>}
              {overdue && <Chip tone="terracotta">⚠ overdue</Chip>}
              {turn.status === 'due' && <Chip tone="camel">due {relative(turn.dueAt?.toISOString() ?? null, now)}</Chip>}
              {deal.rotation_type === 'paired' && steps.length > 1 && (
                <Chip tone="neutral">
                  step {progress.index + 1}/{progress.total}
                </Chip>
              )}
              {deal.swap_each_cycle && deal.cycle_parity === 1 && (
                <Chip tone="neutral" className="opacity-70">
                  roles swapped
                </Chip>
              )}
            </div>
          </div>

          {/* Step pips — the multi-step routine made visible. */}
          {steps.length > 1 && (
            <ol className="hidden shrink-0 gap-1.5 sm:flex sm:flex-col" aria-label="Routine steps">
              {steps.map((step, i) => {
                const done = i < progress.index
                const current = i === progress.index
                return (
                  <li
                    key={step.id}
                    className={cx(
                      'flex items-center gap-1.5 text-[11px]',
                      done ? 'text-olive' : current ? 'text-espresso' : 'text-espresso-faint',
                    )}
                  >
                    <span
                      aria-hidden
                      className={cx(
                        'h-1.5 w-1.5 rounded-full',
                        done ? 'bg-olive' : current ? 'bg-gold' : 'bg-linen-edge',
                      )}
                    />
                    {step.label}
                  </li>
                )
              })}
            </ol>
          )}
        </div>

        {deal.last_completed_at && (
          <p className="mt-3 pl-2 text-[11px] text-espresso-faint">
            Last logged {relative(deal.last_completed_at, now)} ·{' '}
            {format(new Date(deal.last_completed_at), 'EEE h:mm a')}
          </p>
        )}

        {viewer.isMember && (
          <div className="mt-4 flex flex-wrap items-center gap-2 pl-2">
            <Button
              variant="primary"
              size="sm"
              onClick={complete}
              loading={pending === `complete-${deal.id}`}
            >
              ✓ {steps.length > 1 ? turn.stepLabel : 'Mark done'}
            </Button>

            {turn.assigneeId && turn.assigneeId !== viewer.id && (
              <Button
                variant="whatsapp"
                size="sm"
                onClick={nudge}
                loading={pending === `nudge-${deal.id}`}
                title={`WhatsApp ${nameOf(turn.assigneeId)}`}
              >
                <WhatsAppGlyph /> Nudge
              </Button>
            )}

            {canClaim && (
              <Button variant="danger" size="sm" onClick={() => setClaiming(true)}>
                Call out
              </Button>
            )}
          </div>
        )}

        {deal.penalty_title && (
          <p className="mt-3 border-t border-linen-edge pt-3 pl-2 text-[11px] text-espresso-faint">
            ⚖️ Stakes: {deal.penalty_title}
          </p>
        )}
      </article>

      {claiming && (
        <ClaimPenaltySheet
          deal={deal}
          defaulter={assignee ?? null}
          onClose={() => setClaiming(false)}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  )
}

export function WhatsAppGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23 2.2 0 4.27.86 5.83 2.42a8.18 8.18 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.13-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.44.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.44-.06-.12-.56-1.34-.76-1.84-.2-.48-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.87.85-.87 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.08.15-1.18-.06-.11-.23-.17-.48-.29Z" />
    </svg>
  )
}
