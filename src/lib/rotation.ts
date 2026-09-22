/**
 * Turn & multi-step rotation engine.
 *
 * Pure functions only — no I/O, no Supabase, no Date.now() unless injected.
 * Route Handlers call these, persist `result.patch`, then fan out notifications.
 * The same functions run on the client to render "Next up: …" without a round trip.
 *
 * Core idea: a deal's turn is *sequential state*, not a calendar rule. Nothing
 * happens for three days? The state simply waits. The moment a turn is logged,
 * the next one is derived from who actually did the work.
 */

import type { Deal, DealStep, DealWithSteps, RotationType } from './types'

export interface Members {
  a: string
  b: string
}

export type TurnStatus = 'waiting' | 'due' | 'overdue' | 'open'

const HOUR_MS = 3_600_000

export function otherMember(members: Members, id: string | null): string | null {
  if (!id) return null
  if (id === members.a) return members.b
  if (id === members.b) return members.a
  return null
}

export function stepAt(deal: DealWithSteps, index: number): DealStep | null {
  return deal.steps.find((s) => s.step_index === index) ?? null
}

export function orderedSteps(deal: DealWithSteps): DealStep[] {
  return [...deal.steps].sort((x, y) => x.step_index - y.step_index)
}

/**
 * Who owns `stepIndex` right now.
 *
 * - alternating → whatever the live pointer says (it flips on each completion)
 * - paired      → the step's fixed owner, mirrored when the cycle parity is 1
 *                 and the deal swaps roles each cycle
 * - adhoc       → nobody in particular; either partner may log it
 */
export function resolveAssignee(
  deal: DealWithSteps,
  stepIndex: number,
  members: Members,
  parity: 0 | 1 = deal.cycle_parity,
): string | null {
  if (deal.rotation_type === 'adhoc') return null
  if (deal.rotation_type === 'alternating') return deal.current_assignee_id

  const step = stepAt(deal, stepIndex)
  if (!step?.assignee_id) return null
  return deal.swap_each_cycle && parity === 1
    ? otherMember(members, step.assignee_id)
    : step.assignee_id
}

/** When the current turn stops being polite and starts being overdue. */
export function turnDueAt(deal: Deal): Date | null {
  if (!deal.grace_hours || !deal.turn_started_at) return null
  return new Date(Date.parse(deal.turn_started_at) + deal.grace_hours * HOUR_MS)
}

export function turnStatus(deal: DealWithSteps, now: Date = new Date()): TurnStatus {
  if (deal.rotation_type === 'adhoc') return 'open'
  const due = turnDueAt(deal)
  if (!due) return 'waiting'
  const remaining = due.getTime() - now.getTime()
  if (remaining <= 0) return 'overdue'
  // Last fifth of the grace window reads as "due soon".
  if (deal.grace_hours && remaining <= (deal.grace_hours * HOUR_MS) / 5) return 'due'
  return 'waiting'
}

export function isOverdue(deal: DealWithSteps, now: Date = new Date()): boolean {
  return turnStatus(deal, now) === 'overdue'
}

// ---------------------------------------------------------------------------
// Completion
// ---------------------------------------------------------------------------

export interface CompleteInput {
  completedBy: string
  at?: Date
  note?: string | null
  source?: string
  /** Set when one partner covers a turn that was not theirs. */
  takeover?: boolean
}

export interface DealStatePatch {
  current_step_index: number
  current_assignee_id: string | null
  cycle_parity: 0 | 1
  turn_started_at: string
  last_completed_at: string
}

export interface LogDraft {
  deal_id: string
  step_index: number
  step_label: string
  assigned_to: string | null
  completed_by: string
  completed_at: string
  cycle_completed: boolean
  was_takeover: boolean
  note: string | null
  source: string
}

export interface CompleteResult {
  log: LogDraft
  patch: DealStatePatch
  cycleCompleted: boolean
  /** Mid-cycle hand-off: the partner now owes the next step. Drives trigger #2. */
  handoff: {
    to: string
    fromStepLabel: string
    toStepLabel: string
    dueAt: string | null
  } | null
  /** Set when a full cycle closed and the turn moved to the other person. */
  turnAdvancedTo: string | null
  next: {
    stepIndex: number
    stepLabel: string
    assigneeId: string | null
  }
}

export function completeCurrentStep(
  deal: DealWithSteps,
  members: Members,
  input: CompleteInput,
): CompleteResult {
  const at = input.at ?? new Date()
  const steps = orderedSteps(deal)
  if (steps.length === 0) {
    throw new Error(`Deal "${deal.title}" has no steps to complete.`)
  }

  const index = clampIndex(deal.current_step_index, steps.length)
  const step = steps[index]
  const assignedTo = resolveAssignee(deal, step.step_index, members)

  const isLastStep = index + 1 >= steps.length
  // Alternating deals are single-step by construction, so every tap closes a cycle.
  const cycleCompleted = deal.rotation_type === 'alternating' ? true : isLastStep

  const nextIndex = cycleCompleted ? 0 : index + 1
  const nextParity: 0 | 1 =
    cycleCompleted && deal.swap_each_cycle ? flip(deal.cycle_parity) : deal.cycle_parity

  const nextAssignee = nextAssigneeFor(deal, members, {
    rotationType: deal.rotation_type,
    completedBy: input.completedBy,
    nextIndex,
    nextParity,
    cycleCompleted,
  })

  const nextStep = steps[nextIndex]
  const patch: DealStatePatch = {
    current_step_index: nextStep.step_index,
    current_assignee_id: nextAssignee,
    cycle_parity: nextParity,
    turn_started_at: at.toISOString(),
    last_completed_at: at.toISOString(),
  }

  const nextDueAt =
    deal.grace_hours != null ? new Date(at.getTime() + deal.grace_hours * HOUR_MS).toISOString() : null

  const handoff =
    !cycleCompleted && nextAssignee && nextAssignee !== input.completedBy && nextStep.notify_on_ready
      ? {
          to: nextAssignee,
          fromStepLabel: step.label,
          toStepLabel: nextStep.label,
          dueAt: nextDueAt,
        }
      : null

  const turnAdvancedTo =
    cycleCompleted && nextAssignee && nextAssignee !== input.completedBy ? nextAssignee : null

  return {
    log: {
      deal_id: deal.id,
      step_index: step.step_index,
      step_label: step.label,
      assigned_to: assignedTo,
      completed_by: input.completedBy,
      completed_at: at.toISOString(),
      cycle_completed: cycleCompleted,
      was_takeover:
        input.takeover ?? (assignedTo != null && assignedTo !== input.completedBy),
      note: input.note ?? null,
      source: input.source ?? 'dashboard',
    },
    patch,
    cycleCompleted,
    handoff,
    turnAdvancedTo,
    next: {
      stepIndex: nextStep.step_index,
      stepLabel: nextStep.label,
      assigneeId: nextAssignee,
    },
  }
}

function nextAssigneeFor(
  deal: DealWithSteps,
  members: Members,
  ctx: {
    rotationType: RotationType
    completedBy: string
    nextIndex: number
    nextParity: 0 | 1
    cycleCompleted: boolean
  },
): string | null {
  switch (ctx.rotationType) {
    case 'alternating':
      // Anchored on who *actually* did it, not on who was scheduled. If one
      // partner covers for the other, the covered partner is genuinely up next.
      return otherMember(members, ctx.completedBy)
    case 'adhoc':
      return null
    case 'paired': {
      const steps = orderedSteps(deal)
      const next = steps[ctx.nextIndex]
      if (!next?.assignee_id) return null
      return deal.swap_each_cycle && ctx.nextParity === 1
        ? otherMember(members, next.assignee_id)
        : next.assignee_id
    }
  }
}

// ---------------------------------------------------------------------------
// Deal-breaker actions
// ---------------------------------------------------------------------------

export type ClaimResolution = 'takeover' | 'rotate' | 'keep'

export interface ClaimInput {
  claimedBy: string
  resolution: ClaimResolution
  at?: Date
}

export interface ClaimResult {
  /** Who fell through on the turn — the one who ends up owing. */
  owedBy: string | null
  owedTo: string
  patch: Partial<DealStatePatch>
  log: LogDraft | null
  next: { stepIndex: number; assigneeId: string | null }
}

/**
 * The partner who was left hanging calls it out.
 *
 *  - `takeover` — they do the chore themselves. It logs as a completion by them,
 *    which (for alternating deals) puts the defaulter up next. Fair by construction.
 *  - `rotate`   — skip the missed turn and hand it to the other person without
 *    pretending the work was done.
 *  - `keep`     — record the forfeit but leave the turn exactly where it is.
 */
export function claimForfeit(
  deal: DealWithSteps,
  members: Members,
  input: ClaimInput,
): ClaimResult {
  const at = input.at ?? new Date()
  const defaulter = resolveAssignee(deal, deal.current_step_index, members)
  const owedBy = defaulter && defaulter !== input.claimedBy ? defaulter : otherMember(members, input.claimedBy)

  if (input.resolution === 'takeover') {
    const done = completeCurrentStep(deal, members, {
      completedBy: input.claimedBy,
      at,
      takeover: true,
      note: 'Covered after a missed turn',
      source: 'penalty',
    })
    return {
      owedBy,
      owedTo: input.claimedBy,
      patch: done.patch,
      log: done.log,
      next: { stepIndex: done.next.stepIndex, assigneeId: done.next.assigneeId },
    }
  }

  if (input.resolution === 'rotate') {
    const rotated = otherMember(members, deal.current_assignee_id) ?? input.claimedBy
    return {
      owedBy,
      owedTo: input.claimedBy,
      patch: { current_assignee_id: rotated, turn_started_at: at.toISOString() },
      log: null,
      next: { stepIndex: deal.current_step_index, assigneeId: rotated },
    }
  }

  return {
    owedBy,
    owedTo: input.claimedBy,
    patch: {},
    log: null,
    next: { stepIndex: deal.current_step_index, assigneeId: deal.current_assignee_id },
  }
}

/** Manual "not me this time" swap, no blame attached. */
export function rotateTurn(deal: DealWithSteps, members: Members, at: Date = new Date()) {
  const to = otherMember(members, deal.current_assignee_id)
  return {
    current_assignee_id: to,
    turn_started_at: at.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers — shared by the dashboard, the calendar badges and the
// WhatsApp templates so all three always say the same thing.
// ---------------------------------------------------------------------------

export interface TurnSummary {
  stepLabel: string
  assigneeId: string | null
  status: TurnStatus
  dueAt: Date | null
  /** e.g. "Next up: Noor" or "Hanging out — due by Ava" */
  headline: (nameOf: (id: string | null) => string) => string
  /** Compact form for a calendar day badge: "Dishes: Noor" */
  badge: (nameOf: (id: string | null) => string) => string
}

export function summarizeTurn(
  deal: DealWithSteps,
  members: Members,
  now: Date = new Date(),
): TurnSummary {
  const steps = orderedSteps(deal)
  const index = clampIndex(deal.current_step_index, Math.max(steps.length, 1))
  const step = steps[index]
  const stepLabel = step?.label ?? deal.title
  const assigneeId = resolveAssignee(deal, step?.step_index ?? 0, members)
  const status = turnStatus(deal, now)
  const dueAt = turnDueAt(deal)
  const multiStep = steps.length > 1

  return {
    stepLabel,
    assigneeId,
    status,
    dueAt,
    headline: (nameOf) => {
      if (deal.rotation_type === 'adhoc') return `Open — whoever gets to it`
      const who = nameOf(assigneeId)
      if (multiStep) {
        return status === 'overdue'
          ? `${stepLabel} — overdue, ${who}`
          : `${stepLabel} — due by ${who}`
      }
      return status === 'overdue' ? `Overdue: ${who}` : `Next up: ${who}`
    },
    badge: (nameOf) => {
      if (deal.rotation_type === 'adhoc') return `${deal.title}: open`
      return multiStep
        ? `${deal.title}: ${stepLabel} — ${nameOf(assigneeId)}`
        : `${deal.title}: ${nameOf(assigneeId)}`
    },
  }
}

/** Progress through the current cycle, for the step pips on a deal card. */
export function cycleProgress(deal: DealWithSteps): { index: number; total: number } {
  const steps = orderedSteps(deal)
  return { index: clampIndex(deal.current_step_index, Math.max(steps.length, 1)), total: steps.length }
}

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index) || index < 0) return 0
  return index >= length ? 0 : index
}

function flip(parity: 0 | 1): 0 | 1 {
  return parity === 0 ? 1 : 0
}
