import Link from 'next/link'

import { BoardCharts } from '@/components/BoardCharts'
import { Countdown } from '@/components/Countdown'
import { DealList } from '@/components/DealList'
import { SectionHeading } from '@/components/ui'
import { getViewer } from '@/lib/auth'
import {
  getDeals,
  getLogsInRange,
  getMembers,
  getMoods,
  getPenalties,
  getRecentLogs,
  getSettings,
  getUpcomingEvents,
  membersPair,
  nameLookup,
} from '@/lib/data'
import { format, formatEventTime, relative, toDate } from '@/lib/dates'
import { isOverdue } from '@/lib/rotation'
import { LABEL_HEX } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const now = new Date()
  const chartFrom = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 30)

  const [viewer, members, deals, events, logs, penalties, chartLogs, moods, settings] =
    await Promise.all([
      getViewer(),
      getMembers(),
      getDeals(),
      getUpcomingEvents(4),
      getRecentLogs(8),
      getPenalties(),
      getLogsInRange(chartFrom, new Date(now.getTime() + 86_400_000)),
      getMoods(chartFrom, now),
      getSettings(),
    ])

  const pair = membersPair(members)
  const nameOf = nameLookup(members)
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

      <Countdown
        date={settings?.anniversary_date ?? null}
        label={settings?.anniversary_label ?? 'Our anniversary'}
      />

      <section>
        <SectionHeading
          title="Turns & routines"
          hint="One tap logs it and moves the state on."
          action={
            <Link href="/tasks" className="text-xs font-medium text-espresso-soft hover:text-espresso">
              Manage →
            </Link>
          }
        />
        <DealList deals={deals} members={members} pair={pair} viewerId={viewer.id} />
      </section>

      <BoardCharts logs={chartLogs} moods={moods} members={members} />

      {openPenalties.length > 0 && (
        <section>
          <SectionHeading
            title="Compensation"
            hint={`${openPenalties.length} outstanding`}
            action={
              <Link
                href="/compensation"
                className="text-xs font-medium text-espresso-soft hover:text-espresso"
              >
                See all →
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
                    style={{ background: LABEL_HEX[event.label] ?? '#C19A6B' }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{event.title}</span>
                    <span className="text-xs text-espresso-faint">
                      {format(toDate(event.starts_at), 'EEE d MMM')} · {formatEventTime(event)}
                      {owner ? ` · ${owner.display_name}` : ' · together'}
                      {event.series_id ? ' · repeats' : ''}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* History — who did what, when. */}
      <section>
        <SectionHeading title="History" hint="Every turn that got logged" />
        {logs.length === 0 ? (
          <p className="text-sm text-espresso-faint">No activity yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-linen-edge pl-4">
            {logs.map((log) => {
              const who = members.find((m) => m.id === log.completed_by)
              return (
                <li key={log.id} className="text-sm">
                  <span
                    aria-hidden
                    className="absolute -left-[4.5px] mt-1.5 h-2 w-2 rounded-full"
                    style={{ background: who?.color ?? '#8F9779' }}
                  />
                  <span className="font-medium">{nameOf(log.completed_by)}</span>{' '}
                  <span className="text-espresso-soft">did {log.step_label.toLowerCase()}</span>
                  {log.was_takeover && (
                    <span className="ml-1.5 text-xs text-terracotta">(covered)</span>
                  )}
                  <span className="block text-xs text-espresso-faint">
                    {format(toDate(log.completed_at), 'EEE d MMM, h:mm a')} ·{' '}
                    {relative(log.completed_at, now)}
                  </span>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}
