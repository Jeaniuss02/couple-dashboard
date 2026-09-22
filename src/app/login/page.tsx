'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { Button, Card } from '@/components/ui'
import { getSupabaseBrowser } from '@/lib/supabase/client'

type Mode = 'password' | 'magic'
type State = 'idle' | 'working' | 'sent' | 'error'

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<State>('idle')
  const [message, setMessage] = useState('')

  async function signInWithPassword(e: React.FormEvent) {
    e.preventDefault()
    setState('working')

    const { error } = await getSupabaseBrowser().auth.signInWithPassword({ email, password })

    if (error) {
      setState('error')
      setMessage(
        /invalid login credentials/i.test(error.message)
          ? 'That email and password combination does not match an account.'
          : error.message,
      )
      return
    }

    // Cookies are set by the browser client, so the server components pick the
    // session up on the very next render.
    router.replace('/')
    router.refresh()
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setState('working')

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
      setMessage(
        /email address not authorized/i.test(error.message)
          ? 'This project is still on the built-in email service, which only delivers to the owner’s address. Set up custom SMTP in Supabase, or sign in with a password.'
          : error.message,
      )
    } else {
      setState('sent')
    }
  }

  return (
    <div className="mx-auto max-w-sm py-10">
      <h1 className="text-center text-2xl">Welcome back</h1>
      <p className="mt-1.5 text-center text-sm text-espresso-soft">
        {mode === 'password'
          ? 'Just the two of you. Same email you were set up with.'
          : 'A magic link lands in your inbox.'}
      </p>

      <Card className="mt-6">
        {state === 'sent' ? (
          <div className="py-4 text-center">
            <p className="text-2xl" aria-hidden>
              📬
            </p>
            <p className="mt-2 text-sm font-medium">Check {email}</p>
            <p className="mt-1 text-xs text-espresso-faint">The link signs you straight in.</p>
          </div>
        ) : mode === 'password' ? (
          <form onSubmit={signInWithPassword} className="space-y-3">
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

            <div>
              <label className="label mb-1.5" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                className="field"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {state === 'error' && <p className="text-xs text-terracotta">{message}</p>}

            <Button
              type="submit"
              variant="primary"
              loading={state === 'working'}
              className="w-full"
            >
              Sign in
            </Button>
          </form>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-3">
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
              loading={state === 'working'}
              className="w-full"
            >
              Send magic link
            </Button>
          </form>
        )}
      </Card>

      <p className="mt-4 text-center text-xs text-espresso-faint">
        <button
          type="button"
          className="underline decoration-gold-soft underline-offset-2 hover:text-espresso"
          onClick={() => {
            setMode(mode === 'password' ? 'magic' : 'password')
            setState('idle')
            setMessage('')
          }}
        >
          {mode === 'password' ? 'Send me a magic link instead' : 'Sign in with a password instead'}
        </button>
      </p>

      <p className="mt-5 text-center text-xs text-espresso-faint">
        Just looking?{' '}
        <Link href="/" className="underline decoration-gold-soft underline-offset-2 hover:text-espresso">
          View the public board
        </Link>
      </p>
    </div>
  )
}
