import { Calendar } from '@/components/Calendar'
import { getDeals, getEvents, getMembers, membersPair } from '@/lib/data'
import { rangeFor } from '@/lib/dates'

export const dynamic = 'force-dynamic'

export default async function CalendarPage() {
  const now = new Date()
  const { from, to } = rangeFor('month', now)

  const [members, deals, events] = await Promise.all([getMembers(), getDeals(), getEvents(from, to)])

  return (
    <Calendar
      initialEvents={events}
      deals={deals}
      members={members}
      pair={membersPair(members)}
    />
  )
}
