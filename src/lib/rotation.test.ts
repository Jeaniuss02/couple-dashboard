import { describe, expect, it } from 'vitest'

import {
  claimForfeit,
  completeCurrentStep,
  cycleProgress,
  isOverdue,
  resolveAssignee,
  summarizeTurn,
  turnStatus,
  type Members,
} from './rotation'
import type { DealStep, DealWithSteps, RotationType } from './types'

const AVA = 'ava'
const NOOR = 'noor'
const pair: Members = { a: AVA, b: NOOR }
const nameOf = (id: string | null) => (id === AVA ? 'Ava' : id === NOOR ? 'Noor' : 'anyone')

function step(index: number, label: string, assignee: string | null = null, notify = true): DealStep {
  return {
    id: `step-${index}`,
    deal_id: 'deal',
    step_index: index,
    label,
    assignee_id: assignee,
    notify_on_ready: notify,
  }
}

function makeDeal(overrides: Partial<DealWithSteps> & { rotation_type: RotationType }): DealWithSteps {
  return {
    id: 'deal',
    title: 'Test Deal',
    emoji: '🫧',
    description: null,
    swap_each_cycle: false,
    grace_hours: null,
    penalty_title: null,
    penalty_description: null,
    current_step_index: 0,
    current_assignee_id: AVA,
    cycle_parity: 0,
    turn_started_at: null,
    last_completed_at: null,
    is_active: true,
    sort_order: 0,
    created_by: AVA,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    steps: [step(0, 'Do the thing')],
    ...overrides,
  }
}

describe('alternating deals', () => {
  it('hands the next turn to the other person', () => {
    const deal = makeDeal({ rotation_type: 'alternating', current_assignee_id: AVA })
    const result = completeCurrentStep(deal, pair, { completedBy: AVA })

    expect(result.cycleCompleted).toBe(true)
    expect(result.patch.current_assignee_id).toBe(NOOR)
    expect(result.turnAdvancedTo).toBe(NOOR)
    expect(result.handoff).toBeNull()
  })

  it('carries state across idle days rather than resetting on a schedule', () => {
    // Ava washes on Friday. Nothing happens all weekend.
    const friday = makeDeal({ rotation_type: 'alternating', current_assignee_id: AVA })
    const after = completeCurrentStep(friday, pair, {
      completedBy: AVA,
      at: new Date('2026-09-18T20:00:00Z'),
    })

    const monday = makeDeal({
      rotation_type: 'alternating',
      current_assignee_id: after.patch.current_assignee_id,
      turn_started_at: after.patch.turn_started_at,
    })

    expect(summarizeTurn(monday, pair, new Date('2026-09-21T19:00:00Z')).headline(nameOf)).toBe(
      'Next up: Noor',
    )
  })

  it('anchors the next turn on who actually did it, not who was scheduled', () => {
    // It was Noor's turn, but Ava covered. Noor is genuinely up next.
    const deal = makeDeal({ rotation_type: 'alternating', current_assignee_id: NOOR })
    const result = completeCurrentStep(deal, pair, { completedBy: AVA })

    expect(result.patch.current_assignee_id).toBe(NOOR)
    expect(result.log.was_takeover).toBe(true)
    expect(result.log.assigned_to).toBe(NOOR)
  })
})

describe('paired multi-step routines', () => {
  const laundry = () =>
    makeDeal({
      rotation_type: 'paired',
      title: 'Laundry Routine',
      current_step_index: 0,
      current_assignee_id: AVA,
      grace_hours: 6,
      steps: [step(0, 'Wash the clothes', AVA, false), step(1, 'Hang / dry the load', NOOR, true)],
    })

  it('assigns step 2 to the partner and flags the hand-off', () => {
    const result = completeCurrentStep(laundry(), pair, {
      completedBy: AVA,
      at: new Date('2026-09-22T10:00:00Z'),
    })

    expect(result.cycleCompleted).toBe(false)
    expect(result.patch.current_step_index).toBe(1)
    expect(result.patch.current_assignee_id).toBe(NOOR)
    expect(result.handoff).toMatchObject({
      to: NOOR,
      fromStepLabel: 'Wash the clothes',
      toStepLabel: 'Hang / dry the load',
    })
    // Grace window rolls forward from the hand-off, not the cycle start.
    expect(result.handoff?.dueAt).toBe('2026-09-22T16:00:00.000Z')
  })

  it('closes the cycle and returns to step 1 after the last step', () => {
    const atStep2 = { ...laundry(), current_step_index: 1, current_assignee_id: NOOR }
    const result = completeCurrentStep(atStep2, pair, { completedBy: NOOR })

    expect(result.cycleCompleted).toBe(true)
    expect(result.patch.current_step_index).toBe(0)
    expect(result.patch.current_assignee_id).toBe(AVA)
    expect(result.handoff).toBeNull()
  })

  it('respects notify_on_ready when a step opts out of the ping', () => {
    const quiet = {
      ...laundry(),
      steps: [step(0, 'Wash', AVA, false), step(1, 'Hang', NOOR, false)],
    }
    expect(completeCurrentStep(quiet, pair, { completedBy: AVA }).handoff).toBeNull()
  })

  it('swaps the roles on the next cycle when asked to', () => {
    const deal = { ...laundry(), swap_each_cycle: true, current_step_index: 1, current_assignee_id: NOOR }
    const result = completeCurrentStep(deal, pair, { completedBy: NOOR })

    expect(result.patch.cycle_parity).toBe(1)
    // Step 0 is normally Ava's; with parity 1 it belongs to Noor.
    expect(result.patch.current_assignee_id).toBe(NOOR)

    const swapped = { ...deal, ...result.patch, cycle_parity: 1 as const }
    expect(resolveAssignee(swapped, 0, pair)).toBe(NOOR)
    expect(resolveAssignee(swapped, 1, pair)).toBe(AVA)
  })

  it('reports progress through the cycle', () => {
    expect(cycleProgress(laundry())).toEqual({ index: 0, total: 2 })
    expect(cycleProgress({ ...laundry(), current_step_index: 1 })).toEqual({ index: 1, total: 2 })
  })
})

describe('ad-hoc deals', () => {
  it('leaves the next turn open to either partner', () => {
    const deal = makeDeal({ rotation_type: 'adhoc', current_assignee_id: null })
    const result = completeCurrentStep(deal, pair, { completedBy: AVA })

    expect(result.patch.current_assignee_id).toBeNull()
    expect(summarizeTurn(deal, pair).headline(nameOf)).toBe('Open — whoever gets to it')
  })
})

describe('due windows', () => {
  const started = '2026-09-22T10:00:00.000Z'

  it('is waiting inside the grace window and overdue past it', () => {
    const deal = makeDeal({ rotation_type: 'alternating', grace_hours: 10, turn_started_at: started })

    expect(turnStatus(deal, new Date('2026-09-22T12:00:00Z'))).toBe('waiting')
    expect(turnStatus(deal, new Date('2026-09-22T19:30:00Z'))).toBe('due')
    expect(isOverdue(deal, new Date('2026-09-22T21:00:00Z'))).toBe(true)
  })

  it('never nags when no grace window is set', () => {
    const deal = makeDeal({ rotation_type: 'alternating', turn_started_at: started })
    expect(isOverdue(deal, new Date('2027-01-01T00:00:00Z'))).toBe(false)
  })
})

describe('claiming a forfeit', () => {
  const missed = () =>
    makeDeal({
      rotation_type: 'alternating',
      current_assignee_id: NOOR,
      grace_hours: 2,
      turn_started_at: '2026-09-22T10:00:00.000Z',
    })

  it('takeover logs the work and puts the defaulter up next', () => {
    const result = claimForfeit(missed(), pair, { claimedBy: AVA, resolution: 'takeover' })

    expect(result.owedBy).toBe(NOOR)
    expect(result.owedTo).toBe(AVA)
    expect(result.log?.was_takeover).toBe(true)
    expect(result.patch.current_assignee_id).toBe(NOOR)
  })

  it('rotate hands the turn over without logging phantom work', () => {
    const result = claimForfeit(missed(), pair, { claimedBy: AVA, resolution: 'rotate' })

    expect(result.log).toBeNull()
    expect(result.patch.current_assignee_id).toBe(AVA)
    expect(result.owedBy).toBe(NOOR)
  })

  it('keep records the debt but leaves the turn alone', () => {
    const result = claimForfeit(missed(), pair, { claimedBy: AVA, resolution: 'keep' })

    expect(result.log).toBeNull()
    expect(result.patch).toEqual({})
    expect(result.next.assigneeId).toBe(NOOR)
  })
})

describe('turn summaries', () => {
  it('names the step for multi-step routines and the person for single ones', () => {
    const single = makeDeal({ rotation_type: 'alternating', current_assignee_id: NOOR })
    expect(single === null ? '' : summarizeTurn(single, pair).badge(nameOf)).toBe('Test Deal: Noor')

    const multi = makeDeal({
      rotation_type: 'paired',
      title: 'Laundry',
      current_step_index: 1,
      steps: [step(0, 'Wash', AVA), step(1, 'Hang out', NOOR)],
    })
    expect(summarizeTurn(multi, pair).badge(nameOf)).toBe('Laundry: Hang out — Noor')
  })

  it('reads as overdue once the window has passed', () => {
    const deal = makeDeal({
      rotation_type: 'alternating',
      current_assignee_id: NOOR,
      grace_hours: 1,
      turn_started_at: '2026-09-22T10:00:00.000Z',
    })
    expect(summarizeTurn(deal, pair, new Date('2026-09-22T14:00:00Z')).headline(nameOf)).toBe(
      'Overdue: Noor',
    )
  })
})
