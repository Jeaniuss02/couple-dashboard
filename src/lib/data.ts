import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type {
  AppSettings,
  BoardEvent,
  DealLog,
  DealStep,
  DealWithSteps,
  EventException,
  EventSeries,
  MessageTemplate,
  Penalty,
  Profile,
} from '@/lib/types'
import { expandAll } from '@/lib/recurrence'
import type { Members } from '@/lib/rotation'

/** The two member profiles, in stable order. Everything else keys off these. */
export async function getMembers(): Promise<Profile[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('public_profiles')
    .select('id, display_name, emoji, color, is_member')
    .eq('is_member', true)
    .order('display_name')
  return (data ?? []) as Profile[]
}

export function membersPair(profiles: Profile[]): Members {
  return { a: profiles[0]?.id ?? '', b: profiles[1]?.id ?? '' }
}

export async function getDeals(includeInactive = false): Promise<DealWithSteps[]> {
  const supabase = createClient()
  let query = supabase
    .from('deals')
    .select('*, steps:deal_steps(*)')
    .order('sort_order')
    .order('created_at')
  if (!includeInactive) query = query.eq('is_active', true)

  const { data } = await query
  return ((data ?? []) as (DealWithSteps & { steps: DealStep[] })[]).map((deal) => ({
    ...deal,
    steps: [...(deal.steps ?? [])].sort((x, y) => x.step_index - y.step_index),
  }))
}

export async function getRecentLogs(limit = 12): Promise<DealLog[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('deal_logs')
    .select('*')
    .order('completed_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as DealLog[]
}

/**
 * One-off events plus every series occurrence inside the window, merged and
 * sorted. Expansion runs here rather than in the browser so the dashboard and
 * the calendar cannot drift, and so it uses the series' own timezone instead
 * of whatever zone the server happens to run in.
 */
export async function getEvents(from: Date, to: Date): Promise<BoardEvent[]> {
  const supabase = createClient()

  const [{ data: singles }, { data: series }, { data: exceptions }] = await Promise.all([
    supabase
      .from('calendar_events')
      .select('*')
      .gte('starts_at', from.toISOString())
      .lt('starts_at', to.toISOString()),
    // A series that began years ago can still occur in this window, so these
    // cannot be filtered by start date — only by an end rule that has passed.
    supabase.from('event_series').select('*').lt('starts_at', to.toISOString()),
    supabase.from('event_exceptions').select('*'),
  ])

  const expanded = expandAll(
    (series ?? []) as EventSeries[],
    (exceptions ?? []) as EventException[],
    { from, to },
  )

  return [...((singles ?? []) as BoardEvent[]), ...expanded].sort(
    (a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at),
  )
}

export async function getUpcomingEvents(limit = 5): Promise<BoardEvent[]> {
  // Look back a few hours so something starting earlier today still shows,
  // and forward far enough that a monthly series is not missed.
  const from = new Date(Date.now() - 6 * 3600_000)
  const to = new Date(Date.now() + 62 * 24 * 3600_000)
  return (await getEvents(from, to)).slice(0, limit)
}

export async function getSeries(): Promise<EventSeries[]> {
  const supabase = createClient()
  const { data } = await supabase.from('event_series').select('*').order('starts_at')
  return (data ?? []) as EventSeries[]
}

export async function getPenalties(): Promise<Penalty[]> {
  const supabase = createClient()
  const { data } = await supabase
    .from('penalties')
    .select('*')
    .order('status')
    .order('claimed_at', { ascending: false })
  return (data ?? []) as Penalty[]
}

export async function getTemplates(): Promise<MessageTemplate[]> {
  const supabase = createClient()
  const { data } = await supabase.from('message_templates').select('*').order('key')
  return (data ?? []) as MessageTemplate[]
}

export async function getSettings(): Promise<AppSettings | null> {
  const supabase = createClient()
  const { data } = await supabase.from('app_settings').select('*').eq('id', true).maybeSingle()
  return (data ?? null) as AppSettings | null
}

/** Name lookup shared by the UI and the message templates. */
export function nameLookup(profiles: Profile[]) {
  const byId = new Map(profiles.map((p) => [p.id, p]))
  return (id: string | null | undefined): string => {
    if (!id) return 'whoever’s free'
    return byId.get(id)?.display_name ?? 'someone'
  }
}
