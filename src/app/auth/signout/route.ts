import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  await createClient().auth.signOut()
  return NextResponse.redirect(new URL('/', req.nextUrl.origin), { status: 303 })
}
