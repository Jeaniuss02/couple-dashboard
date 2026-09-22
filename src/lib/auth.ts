import 'server-only'

import { createClient } from '@/lib/supabase/server'
import type { Profile, Viewer } from '@/lib/types'
import { VISITOR } from '@/lib/types'

/** Resolves the current viewer. Anonymous visitors get read-only VISITOR. */
export async function getViewer(): Promise<Viewer> {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return VISITOR

  const { data } = await supabase
    .from('profiles')
    .select('id, display_name, emoji, color, is_member')
    .eq('id', user.id)
    .maybeSingle()

  const profile = (data ?? null) as Profile | null
  return { id: user.id, isMember: !!profile?.is_member, profile }
}

export class ForbiddenError extends Error {
  constructor(message = 'Members only — this board is read-only for visitors.') {
    super(message)
    this.name = 'ForbiddenError'
  }
}

/**
 * Server-side gate for every mutating Route Handler. RLS already blocks the
 * write, but checking here turns a confusing empty result into a clear 403.
 */
export async function requireMember(): Promise<Profile> {
  const viewer = await getViewer()
  if (!viewer.isMember || !viewer.profile) throw new ForbiddenError()
  return viewer.profile
}
