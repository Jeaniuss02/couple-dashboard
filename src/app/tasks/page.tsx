import { DealsManager } from '@/components/DealsManager'
import { getDeals, getMembers, membersPair } from '@/lib/data'

export const dynamic = 'force-dynamic'

export default async function DealsPage() {
  const [members, all] = await Promise.all([getMembers(), getDeals(true)])

  return (
    <DealsManager
      active={all.filter((d) => d.is_active)}
      archived={all.filter((d) => !d.is_active)}
      members={members}
      pair={membersPair(members)}
    />
  )
}
