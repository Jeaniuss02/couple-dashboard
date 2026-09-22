import { redirect } from 'next/navigation'

import { SettingsPanel } from '@/components/SettingsPanel'
import { getViewer } from '@/lib/auth'
import { getSettings, getTemplates } from '@/lib/data'
import { maskPhone } from '@/lib/phone'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export default async function SettingsPage() {
  const viewer = await getViewer()
  if (!viewer.isMember || !viewer.profile) redirect('/login')

  const supabase = createClient()
  const admin = createAdminClient()

  const [{ data: mine }, { data: pending }, settings, templates] = await Promise.all([
    // RLS lets a member read only their own row here.
    supabase
      .from('profiles')
      .select('phone_e164, phone_verified, notify_prefs')
      .eq('id', viewer.id!)
      .single(),
    // phone_verifications is service-role only, so this needs the admin client.
    // Scoped to the caller's own id — never the partner's.
    admin
      .from('phone_verifications')
      .select('phone_e164, expires_at, sent_at')
      .eq('profile_id', viewer.id!)
      .maybeSingle(),
    getSettings(),
    getTemplates(),
  ])

  return (
    <SettingsPanel
      me={viewer.profile}
      phoneState={{
        // Masked before it leaves the server; the raw number never ships to the client.
        phone: mine?.phone_e164 ? maskPhone(mine.phone_e164) : null,
        verified: !!mine?.phone_verified && !!mine?.phone_e164,
        pending: pending
          ? {
              phone: maskPhone(pending.phone_e164),
              expiresAt: pending.expires_at,
              sentAt: pending.sent_at,
            }
          : null,
      }}
      myPrefs={(mine?.notify_prefs as Record<string, boolean>) ?? {}}
      settings={settings}
      templates={templates}
      provider={process.env.WHATSAPP_PROVIDER ?? 'console'}
    />
  )
}
