'use client'

import { useState } from 'react'

import { useAction } from './hooks'
import { Button, cx, Sheet, Toast } from './ui'
import type { DealWithSteps, Profile } from '@/lib/types'

type Resolution = 'takeover' | 'rotate' | 'keep'

const RESOLUTIONS: { value: Resolution; label: string; hint: string }[] = [
  {
    value: 'takeover',
    label: 'I did it myself',
    hint: 'Logs it as done by you — which puts them up next.',
  },
  {
    value: 'rotate',
    label: 'Skip their turn',
    hint: 'Hands the turn over without pretending the work happened.',
  },
  {
    value: 'keep',
    label: 'Leave the turn',
    hint: 'Record the forfeit, but it is still on them.',
  },
]

/**
 * "Call out / claim penalty". Writes to the ledger and WhatsApps both partners,
 * so the stakes stay lighthearted and out in the open.
 */
export function ClaimPenaltySheet({
  deal,
  defaulter,
  onClose,
}: {
  deal: DealWithSteps
  defaulter: Profile | null
  onClose: () => void
}) {
  const { run, pending, toast, dismissToast } = useAction()
  const [resolution, setResolution] = useState<Resolution>('takeover')
  const [title, setTitle] = useState(deal.penalty_title ?? '')
  const [description, setDescription] = useState(deal.penalty_description ?? '')

  const submit = async () => {
    const result = await run(
      'claim',
      { url: `/api/deals/${deal.id}/claim`, body: { resolution, title, description } },
      { success: () => 'Forfeit logged to the ledger' },
    )
    if (result) onClose()
  }

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title="Claim a forfeit"
        footer={
          <div className="flex gap-2">
            <Button variant="quiet" onClick={onClose} className="flex-1">
              Never mind
            </Button>
            <Button variant="danger" onClick={submit} loading={pending === 'claim'} className="flex-1">
              Claim it
            </Button>
          </div>
        }
      >
        <p className="text-sm text-espresso-soft">
          <span className="font-medium text-espresso">{defaulter?.display_name ?? 'Your partner'}</span>{' '}
          missed their turn on <span className="font-medium text-espresso">{deal.title}</span>.
          Both of you get a playful WhatsApp about it.
        </p>

        <fieldset className="mt-5">
          <legend className="label mb-2">What happens to the chore</legend>
          <div className="space-y-2">
            {RESOLUTIONS.map((option) => (
              <label
                key={option.value}
                className={cx(
                  'flex cursor-pointer items-start gap-3 rounded-2xl border p-3 transition',
                  resolution === option.value
                    ? 'border-gold-deep bg-gold/10'
                    : 'border-linen-edge bg-white/60 hover:border-camel',
                )}
              >
                <input
                  type="radio"
                  name="resolution"
                  value={option.value}
                  checked={resolution === option.value}
                  onChange={() => setResolution(option.value)}
                  className="mt-1 accent-[#C5A059]"
                />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="block text-xs text-espresso-faint">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 space-y-3">
          <div>
            <label className="label mb-1.5" htmlFor="penalty-title">
              The forfeit
            </label>
            <input
              id="penalty-title"
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Weekend coffee run"
            />
            {deal.penalty_title && (
              <p className="mt-1 text-[11px] text-espresso-faint">
                Pre-agreed on this deal — edit if you are feeling merciful.
              </p>
            )}
          </div>
          <div>
            <label className="label mb-1.5" htmlFor="penalty-note">
              Note (optional)
            </label>
            <textarea
              id="penalty-note"
              className="field min-h-[72px] resize-y"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Terms and conditions apply 😄"
            />
          </div>
        </div>
      </Sheet>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  )
}
