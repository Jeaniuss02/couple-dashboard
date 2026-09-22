import type { Metadata, Viewport } from 'next'
import { Fraunces, Inter } from 'next/font/google'

import { AppShell } from '@/components/AppShell'
import { getViewer } from '@/lib/auth'
import { getMembers, getPenalties } from '@/lib/data'
import './globals.css'

// These feed the --font-display / --font-sans tokens declared in globals.css,
// so the variable names must not collide with the Tailwind token names.
const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display-family',
  axes: ['SOFT', 'WONK', 'opsz'],
  display: 'swap',
})

const body = Inter({ subsets: ['latin'], variable: '--font-body-family', display: 'swap' })

export const metadata: Metadata = {
  title: 'Our Board',
  description: 'A shared living log, calendar and deal tracker for two.',
}

// The layout reads cookies (via getViewer) and per-request data, so it can
// never be static. Every page declares this; the layout must too, or Next
// attempts a static pass first and bails out mid-render.
export const dynamic = 'force-dynamic'

export const viewport: Viewport = {
  themeColor: '#FAF7F2',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [viewer, members, penalties] = await Promise.all([getViewer(), getMembers(), getPenalties()])
  const openPenalties = penalties.filter((p) => p.status === 'open').length

  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <AppShell viewer={viewer} members={members} openPenalties={openPenalties}>
          {children}
        </AppShell>
      </body>
    </html>
  )
}
