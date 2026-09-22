import { NextRequest } from 'next/server'

import { fail, guard, ok, optionalString, requireString } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { WishlistItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  return guard(async () => {
    const supabase = createClient()
    const { data, error } = await supabase
      .from('wishlist_items')
      .select('*')
      .order('status')
      .order('created_at', { ascending: false })
    if (error) return fail(error.message, 500)
    return ok({ items: data as WishlistItem[] })
  })
}

export async function POST(req: NextRequest) {
  return guard(async () => {
    const me = await requireMember()
    const body = await req.json()

    const supabase = createClient()
    const { data, error } = await supabase
      .from('wishlist_items')
      .insert({
        title: requireString(body.title, 'title', 160),
        note: optionalString(body.note, 600),
        // Left null when no date is given — a wish without a date is still a wish.
        target_date: optionalString(body.target_date, 10),
        owner_id: typeof body.owner_id === 'string' && body.owner_id ? body.owner_id : null,
        created_by: me.id,
      })
      .select('*')
      .single()

    if (error) return fail(error.message, 400)
    return ok({ item: data as WishlistItem }, 201)
  })
}
