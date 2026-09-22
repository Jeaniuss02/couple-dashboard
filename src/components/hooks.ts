'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export interface ToastState {
  message: string
  tone: 'olive' | 'terracotta' | 'gold'
}

interface ApiEnvelope {
  ok: boolean
  error?: string
  notification?: { sent: number; attempted: number; skipped: string[] } | null
}

/**
 * One hook behind every action button: posts, refreshes the server components,
 * and turns the response (including the WhatsApp outcome) into a toast.
 */
export function useAction() {
  const router = useRouter()
  const [pending, setPending] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)

  const run = useCallback(
    async <T extends ApiEnvelope>(
      key: string,
      request: { url: string; method?: string; body?: unknown },
      options?: { success?: (data: T) => string; refresh?: boolean },
    ): Promise<T | null> => {
      setPending(key)
      try {
        const res = await fetch(request.url, {
          method: request.method ?? 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: request.body === undefined ? undefined : JSON.stringify(request.body),
        })
        const data = (await res.json()) as T

        if (!res.ok || !data.ok) {
          setToast({ message: data.error ?? 'Something went wrong.', tone: 'terracotta' })
          return null
        }

        const base = options?.success?.(data) ?? 'Done.'
        setToast({ message: base + describeNotification(data.notification), tone: 'olive' })
        if (options?.refresh !== false) router.refresh()
        return data
      } catch {
        setToast({ message: 'Network hiccup — try again.', tone: 'terracotta' })
        return null
      } finally {
        setPending(null)
      }
    },
    [router],
  )

  return { run, pending, toast, dismissToast: useCallback(() => setToast(null), []) }
}

function describeNotification(n: ApiEnvelope['notification']): string {
  if (!n) return ''
  if (n.sent > 0) return ` · WhatsApp sent to ${n.sent}`
  if (n.skipped.length > 0) return ` · WhatsApp skipped (${n.skipped[0]})`
  if (n.attempted > 0) return ' · WhatsApp failed'
  return ''
}

/**
 * Keeps both phones and the public board in sync. Any write to a watched table
 * re-runs the Server Components, which is cheap and always correct.
 */
export function useRealtimeRefresh(
  tables: string[] = [
    'deals',
    'deal_logs',
    'calendar_events',
    'penalties',
    'event_series',
    'event_exceptions',
  ],
) {
  const router = useRouter()

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let teardown: (() => void) | undefined

    // Loaded here rather than at module scope so the realtime client is only
    // fetched once a subscriber actually mounts.
    void import('@/lib/supabase/client').then(({ getSupabaseBrowser }) => {
      if (cancelled) return

      const supabase = getSupabaseBrowser()
      const channel = supabase.channel('couple-board')

      for (const table of tables) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
          // Coalesce bursts (a completion writes a log *and* patches the deal).
          clearTimeout(timer)
          timer = setTimeout(() => router.refresh(), 250)
        })
      }

      channel.subscribe()
      teardown = () => {
        void supabase.removeChannel(channel)
      }
    })

    return () => {
      cancelled = true
      clearTimeout(timer)
      teardown?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, tables.join(',')])
}

/** Re-renders on an interval so "overdue" appears without a page reload. */
export function useTicker(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
