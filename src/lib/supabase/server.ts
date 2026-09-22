import 'server-only'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

type CookieToSet = { name: string; value: string; options: CookieOptions }

/**
 * Request-scoped client that carries the visitor's session (or no session at
 * all, for the public board). RLS does the enforcing.
 *
 * Next 15+ made `cookies()` async. Rather than make this function async — which
 * would push `await` into every one of its ~30 call sites — the cookie methods
 * themselves are async. @supabase/ssr awaits them, so callers are unaffected.
 */
export function createClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: async () => (await cookies()).getAll(),
        setAll: async (toSet: CookieToSet[]) => {
          try {
            const store = await cookies()
            toSet.forEach(({ name, value, options }) => store.set(name, value, options))
          } catch {
            // Server Components cannot set cookies; middleware refreshes the
            // session instead, so swallowing this is safe.
          }
        },
      },
    },
  )
}
