'use client'

import { useState } from 'react'

import { useAction } from './hooks'
import { Avatar, Button, cx, Sheet, Toast } from './ui'
import type { Profile, RotationType } from '@/lib/types'

interface StepDraft {
  label: string
  assignee_id: string | null
  notify_on_ready: boolean
}

const ROTATIONS: { value: RotationType; label: string; blurb: string; example: string }[] = [
  {
    value: 'alternating',
    label: 'Strictly alternating',
    blurb: 'One job, taking turns. Whoever did it last is off the hook.',
    example: 'Dish duty — state carries over weekends.',
  },
  {
    value: 'paired',
    label: 'Paired steps',
    blurb: 'A chain of steps with fixed owners. Finishing one hands off the next.',
    example: 'You wash → they hang out the laundry.',
  },
  {
    value: 'adhoc',
    label: 'Ad-hoc',
    blurb: 'No rotation. Either of you logs it whenever it happens.',
    example: 'Watering the plants.',
  },
]

const GRACE_PRESETS = [
  { label: 'No deadline', value: '' },
  { label: '2 hours', value: '2' },
  { label: '6 hours', value: '6' },
  { label: 'Same day', value: '12' },
  { label: 'Next day', value: '24' },
]

export function DealBuilder({
  members,
  onClose,
  onSaved,
}: {
  members: Profile[]
  onClose: () => void
  onSaved?: () => void
}) {
  const { run, pending, toast, dismissToast } = useAction()

  const [rotation, setRotation] = useState<RotationType>('alternating')
  const [title, setTitle] = useState('')
  const [emoji, setEmoji] = useState('🫧')
  const [description, setDescription] = useState('')
  const [graceHours, setGraceHours] = useState('')
  const [swapEachCycle, setSwapEachCycle] = useState(true)
  const [firstAssignee, setFirstAssignee] = useState(members[0]?.id ?? '')
  const [penaltyTitle, setPenaltyTitle] = useState('')
  const [penaltyDescription, setPenaltyDescription] = useState('')
  const [steps, setSteps] = useState<StepDraft[]>([
    { label: '', assignee_id: members[0]?.id ?? null, notify_on_ready: false },
    { label: '', assignee_id: members[1]?.id ?? null, notify_on_ready: true },
  ])
  const [singleStep, setSingleStep] = useState('')

  const paired = rotation === 'paired'

  const submit = async () => {
    const payload = {
      title,
      emoji,
      description,
      rotation_type: rotation,
      swap_each_cycle: paired && swapEachCycle,
      grace_hours: graceHours || null,
      penalty_title: penaltyTitle,
      penalty_description: penaltyDescription,
      first_assignee_id: rotation === 'alternating' ? firstAssignee : null,
      steps: paired
        ? steps.filter((s) => s.label.trim())
        : [{ label: singleStep.trim() || title, assignee_id: null, notify_on_ready: true }],
    }

    const result = await run('create-deal', { url: '/api/deals', body: payload }, {
      success: () => 'Deal created',
    })
    if (result) {
      onSaved?.()
      onClose()
    }
  }

  const updateStep = (index: number, patch: Partial<StepDraft>) =>
    setSteps((current) => current.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  const valid = title.trim() && (!paired || steps.filter((s) => s.label.trim()).length >= 2)

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title="New deal"
        footer={
          <Button
            variant="primary"
            onClick={submit}
            loading={pending === 'create-deal'}
            disabled={!valid}
            className="w-full"
          >
            Create deal
          </Button>
        }
      >
        <div className="space-y-6">
          {/* --- 1. How it rotates --- */}
          <fieldset>
            <legend className="label mb-2">How does it rotate?</legend>
            <div className="space-y-2">
              {ROTATIONS.map((option) => (
                <label
                  key={option.value}
                  className={cx(
                    'block cursor-pointer rounded-2xl border p-3 transition',
                    rotation === option.value
                      ? 'border-gold-deep bg-gold/10'
                      : 'border-linen-edge bg-white/60 hover:border-camel',
                  )}
                >
                  <span className="flex items-start gap-3">
                    <input
                      type="radio"
                      name="rotation"
                      checked={rotation === option.value}
                      onChange={() => setRotation(option.value)}
                      className="mt-1 accent-[#C5A059]"
                    />
                    <span>
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="block text-xs text-espresso-soft">{option.blurb}</span>
                      <span className="mt-0.5 block text-[11px] italic text-espresso-faint">
                        {option.example}
                      </span>
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <hr className="rule" />

          {/* --- 2. Identity --- */}
          <div className="flex gap-3">
            <div className="w-20 shrink-0">
              <label className="label mb-1.5" htmlFor="deal-emoji">
                Icon
              </label>
              <input
                id="deal-emoji"
                className="field text-center text-xl"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
                maxLength={4}
              />
            </div>
            <div className="flex-1">
              <label className="label mb-1.5" htmlFor="deal-title">
                Name it
              </label>
              <input
                id="deal-title"
                className="field"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={paired ? 'Laundry Routine' : 'Dish Duty'}
              />
            </div>
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="deal-desc">
              The agreement <span className="font-normal normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              id="deal-desc"
              className="field min-h-[60px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What exactly did you two agree to?"
            />
          </div>

          {/* --- 3. Steps --- */}
          {paired ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="label">The chain</span>
                <button
                  type="button"
                  onClick={() =>
                    setSteps((s) => [...s, { label: '', assignee_id: members[0]?.id ?? null, notify_on_ready: true }])
                  }
                  className="text-xs font-medium text-espresso-soft hover:text-espresso"
                >
                  + Add step
                </button>
              </div>

              <ol className="space-y-2">
                {steps.map((step, index) => (
                  <li key={index} className="rounded-2xl border border-linen-edge bg-white/60 p-3">
                    <div className="flex items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-linen-deep text-[11px] font-semibold">
                        {index + 1}
                      </span>
                      <input
                        className="field flex-1 py-1.5"
                        value={step.label}
                        onChange={(e) => updateStep(index, { label: e.target.value })}
                        placeholder={index === 0 ? 'Wash the clothes' : 'Hang / dry the load'}
                      />
                      {steps.length > 2 && (
                        <button
                          type="button"
                          aria-label={`Remove step ${index + 1}`}
                          onClick={() => setSteps((s) => s.filter((_, i) => i !== index))}
                          className="shrink-0 rounded-lg p-1.5 text-espresso-faint hover:text-terracotta"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                      {members.map((member) => (
                        <button
                          key={member.id}
                          type="button"
                          onClick={() => updateStep(index, { assignee_id: member.id })}
                          className={cx(
                            'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
                            step.assignee_id === member.id
                              ? 'border-transparent'
                              : 'border-linen-edge hover:border-camel',
                          )}
                          style={
                            step.assignee_id === member.id
                              ? { background: `${member.color}26` }
                              : undefined
                          }
                        >
                          <Avatar profile={member} size={16} />
                          {member.display_name}
                        </button>
                      ))}
                      {index > 0 && (
                        <label className="ml-auto flex items-center gap-1.5 text-[11px] text-espresso-faint">
                          <input
                            type="checkbox"
                            checked={step.notify_on_ready}
                            onChange={(e) => updateStep(index, { notify_on_ready: e.target.checked })}
                            className="h-3.5 w-3.5 accent-[#25D366]"
                          />
                          WhatsApp on hand-off
                        </label>
                      )}
                    </div>
                  </li>
                ))}
              </ol>

              <label className="mt-3 flex cursor-pointer items-start gap-2.5 rounded-2xl border border-linen-edge bg-white/60 p-3">
                <input
                  type="checkbox"
                  checked={swapEachCycle}
                  onChange={(e) => setSwapEachCycle(e.target.checked)}
                  className="mt-0.5 h-4 w-4 accent-[#C5A059]"
                />
                <span>
                  <span className="block text-sm font-medium">Swap roles each cycle</span>
                  <span className="block text-xs text-espresso-faint">
                    Once the chain finishes, the two of you trade steps. Keeps it even.
                  </span>
                </span>
              </label>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label className="label mb-1.5" htmlFor="deal-step">
                  The job <span className="font-normal normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="deal-step"
                  className="field"
                  value={singleStep}
                  onChange={(e) => setSingleStep(e.target.value)}
                  placeholder="Wash the dishes — defaults to the deal name"
                />
              </div>

              {rotation === 'alternating' && (
                <div>
                  <span className="label mb-1.5">Who&apos;s up first?</span>
                  <div className="flex flex-wrap gap-2">
                    {members.map((member) => (
                      <button
                        key={member.id}
                        type="button"
                        onClick={() => setFirstAssignee(member.id)}
                        className={cx(
                          'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition',
                          firstAssignee === member.id
                            ? 'border-transparent'
                            : 'border-linen-edge hover:border-camel',
                        )}
                        style={
                          firstAssignee === member.id ? { background: `${member.color}26` } : undefined
                        }
                      >
                        <Avatar profile={member} size={18} />
                        {member.display_name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <hr className="rule" />

          {/* --- 4. Deadline --- */}
          <div>
            <span className="label mb-1.5">Grace window</span>
            <div className="flex flex-wrap gap-2">
              {GRACE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setGraceHours(preset.value)}
                  className={cx(
                    'rounded-full border px-3 py-1.5 text-xs transition',
                    graceHours === preset.value
                      ? 'border-transparent bg-gold/20'
                      : 'border-linen-edge bg-white/60 hover:border-camel',
                  )}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] text-espresso-faint">
              After this, the turn shows as overdue and the other person can call it out.
            </p>
          </div>

          {/* --- 5. Stakes --- */}
          <div className="space-y-3 rounded-2xl border border-linen-edge bg-linen-deep/40 p-3">
            <div>
              <label className="label mb-1.5" htmlFor="deal-penalty">
                ⚖️ If someone flakes <span className="font-normal normal-case tracking-normal">(optional)</span>
              </label>
              <input
                id="deal-penalty"
                className="field"
                value={penaltyTitle}
                onChange={(e) => setPenaltyTitle(e.target.value)}
                placeholder="15-minute massage · weekend coffee · ₹50 in the jar"
              />
            </div>
            <div>
              <label className="label mb-1.5" htmlFor="deal-penalty-desc">
                Fine print
              </label>
              <input
                id="deal-penalty-desc"
                className="field"
                value={penaltyDescription}
                onChange={(e) => setPenaltyDescription(e.target.value)}
                placeholder="Redeemable any time, no takebacks"
              />
            </div>
          </div>
        </div>
      </Sheet>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  )
}
