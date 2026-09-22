import { Calendar } from '@/components/Calendar'
import {
  getDeals,
  getEvents,
  getLogsInRange,
  getMembers,
  getMoods,
  membersPair,
} from '@/lib/data'
import { rangeFor } from '@/lib/dates'

export const dynamic = 'force-dynamic'

export default async function CalendarPage() {
  const now = new Date()
  const { from, to } = rangeFor('month', now)

  // A generous window so moving a month either way still has history to show
  // before the client refetches.
  const historyFrom = new Date(from.getTime() - 62 * 24 * 3600_000)
  const historyTo = new Date(to.getTime() + 62 * 24 * 3600_000)

  const [members, deals, events, logs, moods] = await Promise.all([
    getMembers(),
    getDeals(),
    getEvents(from, to),
    getLogsInRange(historyFrom, historyTo),
    getMoods(historyFrom, historyTo),
  ])

  return (
    <Calendar
      initialEvents={events}
      deals={deals}
      members={members}
      pair={membersPair(members)}
      logs={logs}
      moods={moods}
    />
  )
}
