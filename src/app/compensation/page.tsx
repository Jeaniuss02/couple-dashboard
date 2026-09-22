import { PenaltyLedger } from '@/components/PenaltyLedger'
import { getDeals, getMembers, getPenalties } from '@/lib/data'

export const dynamic = 'force-dynamic'

export default async function LedgerPage() {
  const [members, penalties, deals] = await Promise.all([
    getMembers(),
    getPenalties(),
    getDeals(true),
  ])

  return <PenaltyLedger penalties={penalties} members={members} deals={deals} />
}
