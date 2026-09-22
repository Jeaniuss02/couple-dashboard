import { NextRequest } from 'next/server'

import { fail, guard, ok, oneOf, optionalString, requireString } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { WishlistItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function PATCH(req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const body = await req.json()

    const patch: Record<string, unknown> = {}
    if ('title' in body) patch.title = requireString(body.title, 'title', 160)
    if ('note' in body) patch.note = optionalString(body.note, 600)
    if ('target_date' in body) patch.target_date = optionalString(body.target_date, 10)
    if ('owner_id' in body) patch.owner_id = body.owner_id || null
    if ('sort_order' in body) patch.sort_order = Number(body.sort_order) || 0
    if ('status' in body) {
      const status = oneOf(body.status, ['open', 'done'] as const, 'status')
      patch.status = status
      patch.done_at = status === 'done' ? new Date().toISOString() : null
    }

    const supabase = createClient()
    const { data, error } = await supabase
      .from('wishlist_items')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()

    if (error) return fail(error.message, 400)
    return ok({ item: data as WishlistItem })
  })
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  return guard(async () => {
    const { id } = await params
    await requireMember()
    const supabase = createClient()
    const { error } = await supabase.from('wishlist_items').delete().eq('id', id)
    if (error) return fail(error.message, 400)
    return ok({ id })
  })
}
