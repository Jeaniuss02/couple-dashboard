export type RotationType = 'alternating' | 'paired' | 'adhoc'
export type PenaltyStatus = 'open' | 'settled' | 'waived'
export type EventKind = 'personal' | 'shared'

export interface Profile {
  id: string
  display_name: string
  emoji: string
  color: string
  is_member: boolean
}

/** Only ever assembled server-side; phone numbers never reach the client. */
export interface MemberContact extends Profile {
  phone_e164: string | null
  phone_verified: boolean
  notify_prefs: {
    event_created: boolean
    handoff: boolean
    nudge: boolean
    penalty: boolean
  }
}

export interface DealStep {
  id: string
  deal_id: string
  step_index: number
  label: string
  assignee_id: string | null
  notify_on_ready: boolean
}

export interface Deal {
  id: string
  title: string
  emoji: string
  description: string | null
  rotation_type: RotationType
  swap_each_cycle: boolean
  grace_hours: number | null
  penalty_title: string | null
  penalty_description: string | null
  current_step_index: number
  current_assignee_id: string | null
  cycle_parity: 0 | 1
  turn_started_at: string | null
  last_completed_at: string | null
  is_active: boolean
  sort_order: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface DealWithSteps extends Deal {
  steps: DealStep[]
}

export interface DealLog {
  id: string
  deal_id: string
  step_index: number
  step_label: string
  assigned_to: string | null
  completed_by: string | null
  completed_at: string
  cycle_completed: boolean
  was_takeover: boolean
  note: string | null
  source: string
}

export interface CalendarEvent {
  id: string
  title: string
  description: string | null
  location: string | null
  starts_at: string
  ends_at: string | null
  all_day: boolean
  kind: EventKind
  owner_id: string | null
  created_by: string | null
  notified_at: string | null
  created_at: string
  updated_at: string
}

export type RecurrenceFreq = 'daily' | 'weekly' | 'monthly'

/** A recurrence rule. Occurrences are generated from it, never stored. */
export interface EventSeries {
  id: string
  title: string
  description: string | null
  location: string | null
  /** The first occurrence, as an instant. */
  starts_at: string
  duration_minutes: number | null
  all_day: boolean
  kind: EventKind
  owner_id: string | null
  created_by: string | null
  /** The zone the rule is expressed in — what keeps 9am at 9am across DST. */
  timezone: string
  freq: RecurrenceFreq
  interval: number
  /** Weekly only. 0 = Monday … 6 = Sunday. Null = same weekday as starts_at. */
  byweekday: number[] | null
  until: string | null
  count: number | null
  created_at: string
  updated_at: string
}

/** A deviation for one occurrence: cancelled, or moved/retitled. */
export interface EventException {
  id: string
  series_id: string
  /** The ORIGINAL generated instant — the key the engine matches on. */
  occurrence_start: string
  cancelled: boolean
  title: string | null
  starts_at: string | null
  ends_at: string | null
  location: string | null
  description: string | null
}

/**
 * What the calendar actually renders: a stored one-off event, or an occurrence
 * expanded from a series. The extra fields are absent on one-off events, which
 * is how the UI tells them apart.
 */
export interface BoardEvent extends CalendarEvent {
  series_id?: string
  /** Present only on generated occurrences; identifies which one. */
  occurrence_start?: string
  /** True when an exception moved this occurrence off its generated slot. */
  moved?: boolean
}

export interface Penalty {
  id: string
  deal_id: string | null
  title: string
  description: string | null
  owed_by: string
  owed_to: string
  status: PenaltyStatus
  claimed_by: string | null
  claimed_at: string
  settled_at: string | null
  settled_note: string | null
}

export interface MessageTemplate {
  key: string
  label: string
  body: string
  enabled: boolean
}

export interface AppSettings {
  whatsapp_provider: string
  whatsapp_from: string | null
  notifications_on: boolean
  quiet_hours_start: number | null
  quiet_hours_end: number | null
  timezone: string
}

/** Who is looking at the board right now. */
export interface Viewer {
  id: string | null
  isMember: boolean
  profile: Profile | null
}

export const VISITOR: Viewer = { id: null, isMember: false, profile: null }
