'use client'

import { useMemo } from 'react'

import { DealCard } from './DealCard'
import { useTicker } from './hooks'
import { EmptyState } from './ui'
import { summarizeTurn, type Members } from '@/lib/rotation'
import type { DealWithSteps, Profile } from '@/lib/types'

/**
 * Deals sorted so the card you need is the card you see first:
 * overdue → due soon → your turn → everything else.
 */
export function DealList({
  deals,
  members,
  pair,
  viewerId,
}: {
  deals: DealWithSteps[]
  members: Profile[]
  pair: Members
  viewerId: string | null
}) {
  const now = useTicker()

  const sorted = useMemo(() => {
    const rank = (deal: DealWithSteps) => {
      const turn = summarizeTurn(deal, pair, now)
      if (turn.status === 'overdue') return 0
      if (turn.status === 'due') return 1
      if (viewerId && turn.assigneeId === viewerId) return 2
      if (turn.status === 'open') return 4
      return 3
    }
    return [...deals].sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order)
  }, [deals, pair, viewerId, now])

  if (sorted.length === 0) {
    return (
      <EmptyState
        emoji="🫧"
        title="No tasks yet"
        hint="Create one and the board starts keeping score for you."
      />
    )
  }

  return (
    <div className="grid gap-3">
      {sorted.map((deal) => (
        <DealCard key={deal.id} deal={deal} members={members} pair={pair} />
      ))}
    </div>
  )
}
