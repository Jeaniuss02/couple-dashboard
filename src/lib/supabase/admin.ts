import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Service-role client. Bypasses RLS, so it is used for exactly one thing:
 * reading both partners' phone numbers during notification fan-out, plus
 * writing delivery receipts.
 *
 * Never pass this into a component tree.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
