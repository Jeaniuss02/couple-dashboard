'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { cx, Toast, useViewer } from './ui'
import type { ToastState } from './hooks'
import type { KissStats } from '@/lib/types'

/**
 * The raised button in the middle of the bottom bar.
 *
 * Tap = one kiss. Hold = undo the last one, because the mistake you actually
 * make with a counter is a double tap, and hunting for a delete button on a
 * phone at 11pm is worse than just holding the same button.
 */
const HOLD_MS = 550

export function KissButton({ stats }: { stats: KissStats }) {
  const router = useRouter()
  const viewer = useViewer()

  const [count, setCount] = useState(stats.today)
  const [burst, setBurst] = useState(0)
  const [toast, setToast] = useState<ToastState | null>(null)

  // Requests in flight own the number; a refresh that lands mid-flight would
  // otherwise yank the optimistic value back to the last server value.
  const inFlight = useRef(0)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longFired = useRef(false)

  useEffect(() => {
    if (inFlight.current === 0) setCount(stats.today)
  }, [stats.today])

  useEffect(() => () => clearTimeout(holdTimer.current ?? undefined), [])

  if (!stats.available) return null

  async function hit(method: 'POST' | 'DELETE') {
    if (!viewer.isMember) {
      setToast({ message: 'Sign in to log kisses — this is a members-only button.', tone: 'terracotta' })
      return
    }

    inFlight.current += 1
    setCount((current) => Math.max(0, current + (method === 'POST' ? 1 : -1)))
    if (method === 'POST') {
      setBurst((n) => n + 1)
      if (typeof navigator.vibrate === 'function') navigator.vibrate(12)
    }

    try {
      const res = await fetch('/api/kisses', { method })
      const data = (await res.json()) as { ok: boolean; error?: string; stats?: KissStats }
      if (!data.ok) {
        setToast({ message: data.error ?? 'That did not stick.', tone: 'terracotta' })
      } else if (data.stats) {
        setCount(data.stats.today)
        if (method === 'DELETE') setToast({ message: 'Removed one 💔', tone: 'gold' })
      }
      router.refresh()
    } catch {
      setToast({ message: 'Network hiccup — try again.', tone: 'terracotta' })
    } finally {
      inFlight.current -= 1
    }
  }

  const start = () => {
    longFired.current = false
    clearTimeout(holdTimer.current ?? undefined)
    holdTimer.current = setTimeout(() => {
      longFired.current = true
      void hit('DELETE')
    }, HOLD_MS)
  }

  const end = () => clearTimeout(holdTimer.current ?? undefined)

  return (
    <>
      <div className="relative flex flex-col items-center sm:flex-row sm:gap-2">
        <button
          type="button"
          aria-label={`Log a kiss — ${count} today. Hold to undo the last one.`}
          onPointerDown={start}
          onPointerUp={end}
          onPointerLeave={end}
          onPointerCancel={end}
          onClick={() => {
            // A completed hold already fired; don't also count it as a tap.
            if (longFired.current) {
              longFired.current = false
              return
            }
            void hit('POST')
          }}
          className={cx(
            'relative grid h-16 w-16 place-items-center rounded-full text-2xl transition',
            'bg-gradient-to-b from-gold to-gold-deep text-white shadow-lift ring-4 ring-linen',
            'hover:from-gold-soft hover:to-gold active:scale-95 sm:h-12 sm:w-12 sm:text-xl',
            !viewer.isMember && 'opacity-70',
          )}
        >
          <span aria-hidden>💋</span>
          <span
            className="absolute -right-1.5 -top-1.5 grid h-6 min-w-6 place-items-center rounded-full
                       border-2 border-linen bg-espresso px-1 text-[11px] font-semibold text-linen sm:h-5 sm:min-w-5 sm:text-[10px]"
          >
            {count}
          </span>
        </button>

        {burst > 0 && viewer.isMember && (
          <span
            key={burst}
            aria-hidden
            className="pointer-events-none absolute -top-5 animate-float-up text-sm font-semibold text-gold-deep"
          >
            +1
          </span>
        )}

        <span className="mt-1 text-[10px] font-medium text-espresso-faint sm:mt-0 sm:text-sm sm:text-espresso">
          Kisses
        </span>
      </div>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={() => setToast(null)} />}
    </>
  )
}
