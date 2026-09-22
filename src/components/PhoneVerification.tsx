'use client'

import { useEffect, useRef, useState } from 'react'

import { WhatsAppGlyph } from './DealCard'
import { useAction } from './hooks'
import { Button, Chip, Toast } from './ui'

export interface PhoneState {
  phone: string | null
  verified: boolean
  pending: { phone: string; expiresAt: string; sentAt: string } | null
}

type Stage = 'idle' | 'entering' | 'code'

/**
 * Three-stage flow: show the verified number, take a new one, take the code.
 *
 * The number on screen is always masked — the server only ever returns
 * `+6012••••6789`, so a shoulder-surfer (or a screenshot) gets nothing.
 */
export function PhoneVerification({ initial }: { initial: PhoneState }) {
  const { run, pending, toast, dismissToast } = useAction()
  const [state, setState] = useState(initial)
  const [stage, setStage] = useState<Stage>(initial.pending ? 'code' : 'idle')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000)
    return () => clearInterval(id)
  }, [cooldown])

  useEffect(() => {
    if (stage === 'code') codeRef.current?.focus()
  }, [stage])

  const refresh = async () => {
    const res = await fetch('/api/phone', { cache: 'no-store' })
    const data = (await res.json()) as { ok: boolean } & PhoneState
    if (data.ok) setState({ phone: data.phone, verified: data.verified, pending: data.pending })
  }

  const sendCode = async () => {
    const result = await run<{ ok: boolean; sentTo?: string; resendAfterSeconds?: number }>(
      'send-code',
      { url: '/api/phone/start', body: { phone } },
      { success: (d) => `Code sent to ${d.sentTo}`, refresh: false },
    )
    if (result) {
      setCooldown(result.resendAfterSeconds ?? 60)
      setCode('')
      setStage('code')
      await refresh()
    }
  }

  const confirm = async () => {
    const result = await run(
      'confirm-code',
      { url: '/api/phone/confirm', body: { code } },
      { success: () => 'Number verified', refresh: false },
    )
    if (result) {
      setCode('')
      setStage('idle')
      await refresh()
    }
  }

  const abandon = async () => {
    await run('abandon', { url: '/api/phone?pending=1', method: 'DELETE' }, {
      success: () => 'Cancelled',
      refresh: false,
    })
    setStage('idle')
    setCode('')
    await refresh()
  }

  const remove = async () => {
    await run('remove-phone', { url: '/api/phone', method: 'DELETE' }, {
      success: () => 'Number removed',
      refresh: false,
    })
    setStage('idle')
    await refresh()
  }

  return (
    <>
      <div>
        <span className="label mb-1.5">WhatsApp number</span>

        {/* --- verified, nothing in flight --- */}
        {stage === 'idle' && (
          <div className="flex flex-wrap items-center gap-2">
            {state.verified && state.phone ? (
              <>
                <span className="font-mono text-sm tabular-nums">{state.phone}</span>
                <Chip tone="olive">✓ verified</Chip>
                <div className="ml-auto flex gap-1">
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={() => {
                      setPhone('')
                      setStage('entering')
                    }}
                  >
                    Change
                  </Button>
                  <Button
                    variant="quiet"
                    size="sm"
                    onClick={remove}
                    loading={pending === 'remove-phone'}
                  >
                    Remove
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Chip tone="terracotta">no number yet</Chip>
                <span className="text-xs text-espresso-faint">
                  You won&apos;t get any WhatsApp alerts until this is verified.
                </span>
                <Button
                  variant="whatsapp"
                  size="sm"
                  className="ml-auto"
                  onClick={() => setStage('entering')}
                >
                  <WhatsAppGlyph /> Add number
                </Button>
              </>
            )}
          </div>
        )}

        {/* --- entering a number --- */}
        {stage === 'entering' && (
          <div className="space-y-2">
            <input
              className="field font-mono"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+60123456789"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && phone.trim() && sendCode()}
            />
            <p className="text-[11px] text-espresso-faint">
              Include the country code. We&apos;ll send a 6-digit code to this number on WhatsApp.
            </p>
            <div className="flex gap-2">
              <Button
                variant="whatsapp"
                size="sm"
                onClick={sendCode}
                loading={pending === 'send-code'}
                disabled={!phone.trim()}
              >
                <WhatsAppGlyph /> Send code
              </Button>
              <Button variant="quiet" size="sm" onClick={() => setStage('idle')}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* --- entering the code --- */}
        {stage === 'code' && (
          <div className="space-y-2">
            <p className="text-xs text-espresso-soft">
              Code sent to{' '}
              <span className="font-mono">{state.pending?.phone ?? 'your number'}</span>. It expires
              in 10 minutes.
            </p>
            <input
              ref={codeRef}
              className="field text-center font-mono text-xl tracking-[0.5em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="······"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              onKeyDown={(e) => e.key === 'Enter' && code.length === 6 && confirm()}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={confirm}
                loading={pending === 'confirm-code'}
                disabled={code.length !== 6}
              >
                Verify
              </Button>
              <Button
                variant="quiet"
                size="sm"
                onClick={sendCode}
                loading={pending === 'send-code'}
                disabled={cooldown > 0}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
              </Button>
              <Button
                variant="quiet"
                size="sm"
                className="ml-auto"
                onClick={abandon}
                loading={pending === 'abandon'}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  )
}
