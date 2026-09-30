import { DealsManager } from '@/components/DealsManager'
import { PenaltyLedger } from '@/components/PenaltyLedger'
import { getDeals, getMembers, getPenalties, membersPair } from '@/lib/data'

export const dynamic = 'force-dynamic'

/**
 * Tasks and compensation share one tab: what you owe is part of the same
 * bargain as the chore itself, so it does not need a button of its own in a
 * bottom bar that also has to fit the kiss counter.
 */
export default async function TasksPage() {
  const [members, all, penalties] = await Promise.all([
    getMembers(),
    getDeals(true),
    getPenalties(),
  ])

  return (
    <div className="space-y-10">
      <DealsManager
        active={all.filter((d) => d.is_active)}
        archived={all.filter((d) => !d.is_active)}
        members={members}
        pair={membersPair(members)}
      />

      <div className="border-t border-linen-edge pt-8">
        <PenaltyLedger penalties={penalties} members={members} deals={all} />
      </div>
    </div>
  )
}
