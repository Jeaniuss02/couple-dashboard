'use client'

import { useState } from 'react'

import { DealBuilder } from './DealBuilder'
import { DealCard } from './DealCard'
import { useAction } from './hooks'
import { Button, Chip, EmptyState, MemberOnly, SectionHeading, Toast } from './ui'
import type { Members } from '@/lib/rotation'
import type { DealWithSteps, Profile } from '@/lib/types'

export function DealsManager({
  active,
  archived,
  members,
  pair,
}: {
  active: DealWithSteps[]
  archived: DealWithSteps[]
  members: Profile[]
  pair: Members
}) {
  const [building, setBuilding] = useState(false)
  const { run, pending, toast, dismissToast } = useAction()

  const setActive = (deal: DealWithSteps, isActive: boolean) =>
    run(
      `archive-${deal.id}`,
      { url: `/api/deals/${deal.id}`, method: 'PATCH', body: { is_active: isActive } },
      { success: () => (isActive ? 'Back on the board' : 'Archived') },
    )

  const rotate = (deal: DealWithSteps) =>
    run(
      `rotate-${deal.id}`,
      { url: `/api/deals/${deal.id}`, method: 'PATCH', body: { action: 'rotate' } },
      { success: () => 'Turn swapped' },
    )

  return (
    <div className="space-y-8">
      <SectionHeading
        title="Your deals"
        hint="Custom agreements, rotation rules and stakes."
        action={
          <MemberOnly>
            <Button variant="primary" size="sm" onClick={() => setBuilding(true)}>
              + New deal
            </Button>
          </MemberOnly>
        }
      />

      {active.length === 0 ? (
        <EmptyState
          emoji="🤝"
          title="No deals yet"
          hint="Start with the one you argue about most."
        />
      ) : (
        <div className="grid gap-3">
          {active.map((deal) => (
            <div key={deal.id}>
              <DealCard deal={deal} members={members} pair={pair} />
              <MemberOnly>
                <div className="mt-1.5 flex items-center gap-3 px-2 text-[11px] text-espresso-faint">
                  <span className="capitalize">{deal.rotation_type.replace('adhoc', 'ad-hoc')}</span>
                  <span aria-hidden>·</span>
                  <span>
                    {deal.grace_hours ? `${deal.grace_hours}h grace` : 'no deadline'}
                  </span>
                  <button
                    onClick={() => rotate(deal)}
                    disabled={pending === `rotate-${deal.id}` || deal.rotation_type === 'adhoc'}
                    className="ml-auto hover:text-espresso disabled:opacity-40"
                  >
                    Swap turn
                  </button>
                  <button
                    onClick={() => setActive(deal, false)}
                    disabled={pending === `archive-${deal.id}`}
                    className="hover:text-terracotta disabled:opacity-40"
                  >
                    Archive
                  </button>
                </div>
              </MemberOnly>
            </div>
          ))}
        </div>
      )}

      {archived.length > 0 && (
        <section>
          <SectionHeading title="Archived" />
          <ul className="grid gap-2">
            {archived.map((deal) => (
              <li
                key={deal.id}
                className="card flex items-center justify-between gap-3 px-4 py-3 opacity-70"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <span aria-hidden>{deal.emoji}</span>
                  <span className="truncate">{deal.title}</span>
                  <Chip tone="neutral">{deal.rotation_type}</Chip>
                </span>
                <MemberOnly>
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => setActive(deal, true)}
                    loading={pending === `archive-${deal.id}`}
                  >
                    Restore
                  </Button>
                </MemberOnly>
              </li>
            ))}
          </ul>
        </section>
      )}

      {building && <DealBuilder members={members} onClose={() => setBuilding(false)} />}
      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </div>
  )
}
