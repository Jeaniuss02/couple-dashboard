import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/** Magic-link landing: swaps the code for a session cookie. */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code')
  const next = req.nextUrl.searchParams.get('next') ?? '/'

  if (code) {
    const { error } = await createClient().auth.exchangeCodeForSession(code)
    if (!error) return NextResponse.redirect(new URL(next, req.nextUrl.origin))
  }

  return NextResponse.redirect(new URL('/login?error=link', req.nextUrl.origin))
}
