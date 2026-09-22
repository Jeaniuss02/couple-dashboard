'use client'

import { useMemo, useState } from 'react'

import { useAction } from './hooks'
import {
  Avatar,
  Button,
  Card,
  Chip,
  cx,
  EmptyState,
  MemberOnly,
  SectionHeading,
  SegmentedControl,
  Sheet,
  Toast,
  useViewer,
} from './ui'
import { format, relative, toDate } from '@/lib/dates'
import type { DealWithSteps, Penalty, Profile } from '@/lib/types'

type Filter = 'open' | 'settled' | 'all'

export function PenaltyLedger({
  penalties,
  members,
  deals,
}: {
  penalties: Penalty[]
  members: Profile[]
  deals: DealWithSteps[]
}) {
  const viewer = useViewer()
  const { run, pending, toast, dismissToast } = useAction()
  const [filter, setFilter] = useState<Filter>('open')
  const [adding, setAdding] = useState(false)

  const byId = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])
  const dealById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals])
  const nameOf = (id: string | null) => (id ? byId.get(id)?.display_name ?? 'someone' : 'someone')

  const open = penalties.filter((p) => p.status === 'open')
  const visible = penalties.filter((p) =>
    filter === 'all' ? true : filter === 'open' ? p.status === 'open' : p.status !== 'open',
  )

  // Net balance — who is ahead, in favours.
  const balance = useMemo(() => {
    const tally = new Map<string, number>()
    for (const p of open) {
      tally.set(p.owed_to, (tally.get(p.owed_to) ?? 0) + 1)
      tally.set(p.owed_by, (tally.get(p.owed_by) ?? 0) - 1)
    }
    return members
      .map((m) => ({ member: m, score: tally.get(m.id) ?? 0 }))
      .sort((a, b) => b.score - a.score)
  }, [open, members])

  const settle = (penalty: Penalty) =>
    run(
      `settle-${penalty.id}`,
      { url: `/api/penalties/${penalty.id}`, method: 'PATCH', body: { status: 'settled' } },
      { success: () => 'Settled — square again' },
    )

  const reopen = (penalty: Penalty) =>
    run(
      `reopen-${penalty.id}`,
      { url: `/api/penalties/${penalty.id}`, method: 'PATCH', body: { status: 'open' } },
      { success: () => 'Back on the ledger' },
    )

  return (
    <div className="space-y-6">
      <SectionHeading
        title="Owed"
        hint="Treats, favours and forfeits — tracked so nobody has to remember."
        action={
          <MemberOnly>
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              + Add IOU
            </Button>
          </MemberOnly>
        }
      />

      {open.length > 0 && (
        <Card className="flex items-center justify-around gap-4 bg-gradient-to-br from-gold/[0.08] to-transparent">
          {balance.map(({ member, score }) => (
            <div key={member.id} className="text-center">
              <Avatar profile={member} size={34} />
              <p className="mt-1.5 text-sm font-medium">{member.display_name}</p>
              <p
                className={cx(
                  'font-display text-2xl tabular-nums',
                  score > 0 ? 'text-olive' : score < 0 ? 'text-terracotta' : 'text-espresso-faint',
                )}
              >
                {score > 0 ? `+${score}` : score}
              </p>
              <p className="text-[11px] text-espresso-faint">
                {score > 0 ? 'owed to them' : score < 0 ? 'they owe' : 'square'}
              </p>
            </div>
          ))}
        </Card>
      )}

      <SegmentedControl
        ariaLabel="Ledger filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: `Open${open.length ? ` (${open.length})` : ''}` },
          { value: 'settled', label: 'Settled' },
          { value: 'all', label: 'All' },
        ]}
      />

      {visible.length === 0 ? (
        <EmptyState
          emoji={filter === 'open' ? '🕊️' : '📜'}
          title={filter === 'open' ? 'Nothing outstanding' : 'Nothing here yet'}
          hint={filter === 'open' ? 'All square. Suspiciously so.' : undefined}
        />
      ) : (
        <ul className="grid gap-2">
          {visible.map((penalty) => {
            const settled = penalty.status !== 'open'
            const deal = penalty.deal_id ? dealById.get(penalty.deal_id) : null
            const iOwe = penalty.owed_by === viewer.id

            return (
              <li
                key={penalty.id}
                className={cx(
                  'card flex items-start gap-3 p-4',
                  settled && 'opacity-60',
                  !settled && iOwe && 'border-terracotta/30',
                )}
              >
                <span
                  aria-hidden
                  className={cx(
                    'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm',
                    settled ? 'bg-olive-soft' : 'bg-terracotta-soft',
                  )}
                >
                  {settled ? '✓' : '⚖️'}
                </span>

                <div className="min-w-0 flex-1">
                  <p
                    className={cx(
                      'text-sm font-medium',
                      settled && 'line-through decoration-espresso-faint',
                    )}
                  >
                    {penalty.title}
                  </p>
                  <p className="mt-0.5 text-xs text-espresso-soft">
                    <span className="font-medium">{nameOf(penalty.owed_by)}</span> owes{' '}
                    <span className="font-medium">{nameOf(penalty.owed_to)}</span>
                    {deal && ` · ${deal.emoji} ${deal.title}`}
                  </p>
                  {penalty.description && (
                    <p className="mt-1 text-xs text-espresso-faint">{penalty.description}</p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-espresso-faint">
                      {relative(penalty.claimed_at)} ·{' '}
                      {format(toDate(penalty.claimed_at), 'd MMM')}
                    </span>
                    {settled && penalty.settled_at && (
                      <Chip tone="olive">settled {relative(penalty.settled_at)}</Chip>
                    )}
                    {!settled && iOwe && <Chip tone="terracotta">you owe this</Chip>}
                  </div>
                </div>

                <MemberOnly>
                  {settled ? (
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => reopen(penalty)}
                      loading={pending === `reopen-${penalty.id}`}
                    >
                      Undo
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => settle(penalty)}
                      loading={pending === `settle-${penalty.id}`}
                    >
                      Mark settled
                    </Button>
                  )}
                </MemberOnly>
              </li>
            )
          })}
        </ul>
      )}

      {adding && (
        <AddIouSheet members={members} deals={deals} onClose={() => setAdding(false)} />
      )}
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </div>
  )
}

function AddIouSheet({
  members,
  deals,
  onClose,
}: {
  members: Profile[]
  deals: DealWithSteps[]
  onClose: () => void
}) {
  const viewer = useViewer()
  const { run, pending, toast, dismissToast } = useAction()
  const other = members.find((m) => m.id !== viewer.id)

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [owedBy, setOwedBy] = useState(other?.id ?? members[0]?.id ?? '')
  const [dealId, setDealId] = useState('')

  const owedTo = members.find((m) => m.id !== owedBy)?.id ?? ''

  const submit = async () => {
    const result = await run(
      'add-iou',
      {
        url: '/api/penalties',
        body: {
          title,
          description,
          owed_by: owedBy,
          owed_to: owedTo,
          deal_id: dealId || null,
          deal_name: deals.find((d) => d.id === dealId)?.title,
        },
      },
      { success: () => 'Added to the ledger' },
    )
    if (result) onClose()
  }

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title="Add an IOU"
        footer={
          <Button
            variant="primary"
            onClick={submit}
            loading={pending === 'add-iou'}
            disabled={!title.trim() || !owedBy || !owedTo}
            className="w-full"
          >
            Add to ledger
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label mb-1.5" htmlFor="iou-title">
              What&apos;s owed
            </label>
            <input
              id="iou-title"
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="One coffee run"
              autoFocus
            />
          </div>

          <div>
            <span className="label mb-1.5">Who owes it</span>
            <div className="flex flex-wrap gap-2">
              {members.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setOwedBy(member.id)}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition',
                    owedBy === member.id ? 'border-transparent' : 'border-linen-edge hover:border-camel',
                  )}
                  style={owedBy === member.id ? { background: `${member.color}26` } : undefined}
                >
                  <Avatar profile={member} size={18} />
                  {member.display_name}
                  {member.id === viewer.id && <span className="text-[10px] opacity-60">(you)</span>}
                </button>
              ))}
            </div>
          </div>

          {deals.length > 0 && (
            <div>
              <label className="label mb-1.5" htmlFor="iou-deal">
                Related deal{' '}
                <span className="font-normal normal-case tracking-normal">(optional)</span>
              </label>
              <select
                id="iou-deal"
                className="field"
                value={dealId}
                onChange={(e) => setDealId(e.target.value)}
              >
                <option value="">None</option>
                {deals.map((deal) => (
                  <option key={deal.id} value={deal.id}>
                    {deal.emoji} {deal.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="label mb-1.5" htmlFor="iou-note">
              Note <span className="font-normal normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              id="iou-note"
              className="field min-h-[60px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <p className="text-[11px] text-espresso-faint">
            Both of you get a WhatsApp when this lands on the ledger.
          </p>
        </div>
      </Sheet>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  )
}
