'use client'

import { createBrowserClient } from '@supabase/ssr'

let cached: ReturnType<typeof createBrowserClient> | null = null

/** Browser client — anon key only, used for auth and realtime subscriptions. */
export function getSupabaseBrowser() {
  cached ??= createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )
  return cached
}
