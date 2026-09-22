import Link from 'next/link'

import { DealList } from '@/components/DealList'
import { SectionHeading } from '@/components/ui'
import { getViewer } from '@/lib/auth'
import {
  getDeals,
  getPenalties,
  getRecentLogs,
  getMembers,
  getUpcomingEvents,
  membersPair,
  nameLookup,
} from '@/lib/data'
import { format, formatEventTime, relative, toDate } from '@/lib/dates'
import { isOverdue } from '@/lib/rotation'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const [viewer, members, deals, events, logs, penalties] = await Promise.all([
    getViewer(),
    getMembers(),
    getDeals(),
    getUpcomingEvents(4),
    getRecentLogs(6),
    getPenalties(),
  ])

  const pair = membersPair(members)
  const nameOf = nameLookup(members)
  const now = new Date()
  const overdueCount = deals.filter((d) => isOverdue(d, now)).length
  const openPenalties = penalties.filter((p) => p.status === 'open')

  return (
    <div className="space-y-8">
      <section>
        <p className="text-xs uppercase tracking-[0.14em] text-espresso-faint">
          {format(now, 'EEEE d MMMM')}
        </p>
        <h1 className="mt-1 text-2xl sm:text-3xl">
          {overdueCount > 0 ? (
            <>
              <span className="text-terracotta">{overdueCount}</span> thing
              {overdueCount === 1 ? '' : 's'} slipped
            </>
          ) : (
            'Everything’s square.'
          )}
        </h1>
        <p className="mt-1.5 text-sm text-espresso-soft">
          {overdueCount > 0
            ? 'Tap to log it, nudge them, or call it out.'
            : 'Nothing overdue. Log a turn whenever it happens.'}
        </p>
      </section>

      <section>
        <SectionHeading
          title="Turns & routines"
          hint="One tap logs it and moves the state on."
          action={
            <Link href="/deals" className="text-xs font-medium text-espresso-soft hover:text-espresso">
              Manage →
            </Link>
          }
        />
        <DealList deals={deals} members={members} pair={pair} viewerId={viewer.id} />
      </section>

      {openPenalties.length > 0 && (
        <section>
          <SectionHeading
            title="Owed"
            hint={`${openPenalties.length} outstanding`}
            action={
              <Link href="/ledger" className="text-xs font-medium text-espresso-soft hover:text-espresso">
                Ledger →
              </Link>
            }
          />
          <ul className="grid gap-2">
            {openPenalties.slice(0, 3).map((penalty) => (
              <li
                key={penalty.id}
                className="card flex items-center justify-between gap-3 px-4 py-3 text-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{penalty.title}</span>
                  <span className="text-xs text-espresso-faint">
                    {nameOf(penalty.owed_by)} → {nameOf(penalty.owed_to)}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-espresso-faint">
                  {relative(penalty.claimed_at, now)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionHeading
          title="Coming up"
          action={
            <Link href="/calendar" className="text-xs font-medium text-espresso-soft hover:text-espresso">
              Calendar →
            </Link>
          }
        />
        {events.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-linen-edge px-4 py-6 text-center text-sm text-espresso-faint">
            Nothing on the books. Add a plan from the calendar.
          </p>
        ) : (
          <ul className="grid gap-2">
            {events.map((event) => {
              const owner = members.find((m) => m.id === event.owner_id)
              return (
                <li key={event.id} className="card flex items-center gap-3 px-4 py-3">
                  <span
                    aria-hidden
                    className="h-8 w-1 shrink-0 rounded-full"
                    style={{ background: owner?.color ?? '#D4AF37' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{event.title}</span>
                    <span className="text-xs text-espresso-faint">
                      {format(toDate(event.starts_at), 'EEE d MMM')} · {formatEventTime(event)}
                      {owner ? ` · ${owner.display_name}` : ' · together'}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section>
        <SectionHeading title="Recently logged" />
        {logs.length === 0 ? (
          <p className="text-sm text-espresso-faint">No activity yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-linen-edge pl-4">
            {logs.map((log) => (
              <li key={log.id} className="text-sm">
                <span
                  aria-hidden
                  className="absolute -left-[4.5px] mt-1.5 h-2 w-2 rounded-full bg-olive"
                />
                <span className="font-medium">{nameOf(log.completed_by)}</span>{' '}
                <span className="text-espresso-soft">did {log.step_label.toLowerCase()}</span>
                {log.was_takeover && (
                  <span className="ml-1.5 text-xs text-terracotta">(covered)</span>
                )}
                <span className="block text-xs text-espresso-faint">
                  {relative(log.completed_at, now)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  )
}
