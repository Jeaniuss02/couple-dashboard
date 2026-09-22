'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

import dynamic from 'next/dynamic'

import { HeartsBackground } from './HeartsBackground'
import { Avatar, cx, useViewer, ViewerProvider } from './ui'
import type { Profile, Viewer } from '@/lib/types'

// Browser-only: a realtime subscription has nothing to do during SSR.
const RealtimeSync = dynamic(() => import('./RealtimeSync'), { ssr: false })

const NAV = [
  { href: '/', label: 'Board', icon: HomeIcon },
  { href: '/calendar', label: 'Calendar', icon: CalendarIcon },
  { href: '/tasks', label: 'Tasks', icon: DealIcon },
  { href: '/compensation', label: 'Compensation', icon: LedgerIcon },
  { href: '/wishlist', label: 'Wishes', icon: WishIcon },
]

export function AppShell({
  viewer,
  members,
  openPenalties,
  children,
}: {
  viewer: Viewer
  members: Profile[]
  openPenalties: number
  children: ReactNode
}) {
  return (
    <ViewerProvider viewer={viewer}>
      <Shell members={members} openPenalties={openPenalties}>
        {children}
      </Shell>
    </ViewerProvider>
  )
}

function Shell({
  members,
  openPenalties,
  children,
}: {
  members: Profile[]
  openPenalties: number
  children: ReactNode
}) {
  const viewer = useViewer()
  const pathname = usePathname()

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-4 pb-24 sm:px-6 sm:pb-10">
      <HeartsBackground />
      <RealtimeSync />
      <header className="flex items-center justify-between gap-3 py-5 sm:py-7">
        <Link href="/" className="group flex items-baseline gap-2.5">
          <span className="font-display text-xl tracking-tight sm:text-2xl">Our Board</span>
          <span className="hidden h-px w-8 bg-gold-soft transition-all group-hover:w-12 sm:block" />
        </Link>

        <div className="flex items-center gap-2.5">
          <div className="flex -space-x-1.5">
            {members.map((m) => (
              <span
                key={m.id}
                title={m.display_name}
                className={cx(
                  'rounded-full ring-2 ring-linen',
                  viewer.id === m.id && 'ring-gold',
                )}
              >
                <Avatar profile={m} size={30} />
              </span>
            ))}
          </div>
          {viewer.isMember ? (
            <Link
              href="/settings"
              aria-label="Settings"
              className="rounded-full p-2 text-espresso-soft transition hover:bg-linen-deep hover:text-espresso"
            >
              <GearIcon />
            </Link>
          ) : (
            <Link
              href="/login"
              className="chip border border-linen-edge bg-white/70 text-espresso-soft hover:border-camel"
            >
              Viewing
            </Link>
          )}
        </div>
      </header>

      {/* Three distinct states. Signed-in-but-not-a-member used to look
          identical to signed-out, which made a setup step look like a bug. */}
      {!viewer.isMember &&
        (viewer.id ? (
          <div className="mb-4 rounded-2xl border border-terracotta/35 bg-terracotta-soft/50 px-4 py-3 text-xs">
            <p className="font-medium text-terracotta">
              Signed in, but not set up as a member yet.
            </p>
            <p className="mt-1 text-espresso-soft">
              That is why nothing is editable. Both of you need a row in{' '}
              <code className="rounded bg-white/70 px-1">profiles</code> with{' '}
              <code className="rounded bg-white/70 px-1">is_member = true</code> — run{' '}
              <code className="rounded bg-white/70 px-1">supabase/seed.sql</code> with your two
              emails in it, then reload.
            </p>
          </div>
        ) : (
          <p className="mb-4 rounded-2xl border border-linen-edge bg-white/60 px-4 py-2.5 text-xs text-espresso-soft">
            👀 You&apos;re viewing the public board.{' '}
            <Link href="/login" className="font-medium underline decoration-gold-soft underline-offset-2">
              Sign in
            </Link>{' '}
            to log turns, add plans and rate your day.
          </p>
        ))}

      <main className="flex-1">{children}</main>

      {/* Bottom bar on phones, inline rail on desktop. */}
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-linen-edge bg-linen/90 px-4 py-2
                   backdrop-blur-md sm:static sm:mt-10 sm:rounded-2xl sm:border sm:bg-white/60 sm:px-2"
      >
        <ul className="mx-auto flex max-w-3xl items-stretch justify-between sm:justify-start sm:gap-1">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href)
            return (
              <li key={href} className="flex-1 sm:flex-none">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'relative flex flex-col items-center gap-1 rounded-xl px-3 py-2 text-[11px] font-medium transition',
                    'sm:flex-row sm:gap-2 sm:px-4 sm:text-sm',
                    active
                      ? 'text-espresso'
                      : 'text-espresso-faint hover:text-espresso-soft',
                  )}
                >
                  <span className={cx('transition', active && 'text-gold-deep')}>
                    <Icon />
                  </span>
                  {label}
                  {href === '/compensation' && openPenalties > 0 && (
                    <span className="absolute right-2 top-1 grid h-4 min-w-4 place-items-center rounded-full
                                     bg-terracotta px-1 text-[10px] font-semibold text-white sm:static sm:ml-1">
                      {openPenalties}
                    </span>
                  )}
                  {active && (
                    <span className="absolute -bottom-0.5 h-0.5 w-6 rounded-full bg-gold sm:hidden" />
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

/* --- icons: 20px stroke set, kept inline so there is no icon dependency --- */
const svg = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

function HomeIcon() {
  return (
    <svg {...svg}>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    </svg>
  )
}

function CalendarIcon() {
  return (
    <svg {...svg}>
      <rect x="3" y="5" width="18" height="16" rx="2.5" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  )
}

function DealIcon() {
  return (
    <svg {...svg}>
      <path d="M4 7h7l2 2h7" />
      <path d="M20 9v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7" />
      <path d="M9 14h6" />
    </svg>
  )
}

function WishIcon() {
  return (
    <svg {...svg}>
      <path d="M12 20.5 4.8 13.6a4.4 4.4 0 0 1 6.2-6.2l1 1 1-1a4.4 4.4 0 0 1 6.2 6.2Z" />
    </svg>
  )
}

function LedgerIcon() {
  return (
    <svg {...svg}>
      <path d="M12 3v18M7 7h10M5 12h14M7 17h10" />
    </svg>
  )
}

function GearIcon() {
  return (
    <svg {...svg} width={18} height={18}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.35.44.62.8.75H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  )
}
