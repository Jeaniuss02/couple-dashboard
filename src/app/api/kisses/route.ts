import { fail, guard, ok } from '@/lib/api'
import { requireMember } from '@/lib/auth'
import { getKissStats } from '@/lib/data'
import { kissDayRange } from '@/lib/kisses'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** Public: the bottom bar and the dashboard both read this. */
export async function GET() {
  return guard(async () => ok({ stats: await getKissStats() }))
}

/**
 * +1. One tap in the bottom bar lands here; the row carries who tapped and
 * when, which is the whole history.
 */
export async function POST() {
  return guard(async () => {
    const me = await requireMember()
    const supabase = createClient()

    const { error } = await supabase.from('kisses').insert({ logged_by: me.id })
    if (error) return fail(error.message, 400)

    return ok({ stats: await getKissStats() }, 201)
  })
}

/**
 * Undo — removes the most recent kiss of today, so a mis-tap costs one tap to
 * fix rather than an apology. The result is "the last one is gone", which is
 * what holding the button should mean to someone who just double-tapped.
 */
export async function DELETE() {
  return guard(async () => {
    await requireMember()
    const supabase = createClient()
    const { from, to } = kissDayRange()

    const { data: latest, error: readError } = await supabase
      .from('kisses')
      .select('id')
      .gte('kissed_at', from.toISOString())
      .lt('kissed_at', to.toISOString())
      .order('kissed_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (readError) return fail(readError.message, 400)
    if (!latest) return fail('Nothing logged today to undo.', 422)

    const { error } = await supabase.from('kisses').delete().eq('id', latest.id)
    if (error) return fail(error.message, 400)

    return ok({ stats: await getKissStats() })
  })
}
