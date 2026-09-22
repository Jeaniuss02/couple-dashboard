'use client'

import Link from 'next/link'
import { useState } from 'react'

import { Button, Card } from '@/components/ui'
import { getSupabaseBrowser } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [message, setMessage] = useState('')

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setState('sending')

    const { error } = await getSupabaseBrowser().auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // Only the two seeded accounts should ever exist.
        shouldCreateUser: false,
      },
    })

    if (error) {
      setState('error')
      setMessage(error.message)
    } else {
      setState('sent')
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-center text-2xl">Welcome back</h1>
      <p className="mt-1.5 text-center text-sm text-espresso-soft">
        A magic link lands in your inbox. No passwords to forget.
      </p>

      <Card className="mt-6">
        {state === 'sent' ? (
          <div className="py-4 text-center">
            <p className="text-2xl" aria-hidden>
              📬
            </p>
            <p className="mt-2 text-sm font-medium">Check {email}</p>
            <p className="mt-1 text-xs text-espresso-faint">
              The link signs you straight in.
            </p>
          </div>
        ) : (
          <form onSubmit={signIn} className="space-y-3">
            <div>
              <label className="label mb-1.5" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                className="field"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>

            {state === 'error' && <p className="text-xs text-terracotta">{message}</p>}

            <Button
              type="submit"
              variant="primary"
              loading={state === 'sending'}
              className="w-full"
            >
              Send magic link
            </Button>
          </form>
        )}
      </Card>

      <p className="mt-5 text-center text-xs text-espresso-faint">
        Just looking?{' '}
        <Link href="/" className="underline decoration-gold-soft underline-offset-2 hover:text-espresso">
          View the public board
        </Link>
      </p>
    </div>
  )
}
