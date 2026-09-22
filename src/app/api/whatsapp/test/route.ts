import { NextRequest } from 'next/server'

import { guard, ok } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { activeProvider } from '@/lib/whatsapp/providers'
import { notify } from '@/lib/whatsapp/notify'

export const dynamic = 'force-dynamic'

/** "Send a test message" in Settings — proves the whole chain end to end. */
export async function POST(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const body = await req.json().catch(() => ({}))
    const toBoth = body.audience === 'both'

    const outcome = await notify({
      key: 'turn_advanced',
      audience: toBoth ? 'both' : { only: me.id },
      urgent: true,
      vars: {
        deal_name: 'Couple Board test',
        assigned_to: me.display_name,
        actor: me.display_name,
      },
    })

    return ok({ provider: activeProvider(), notification: outcome })
  })
}
