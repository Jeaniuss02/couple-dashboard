'use client'

import { useRealtimeRefresh } from './hooks'

/**
 * Subscribes the page to board changes. Renders nothing.
 *
 * Split out so the app shell can mount it with
 * `next/dynamic(..., { ssr: false })`: a realtime websocket subscription has
 * nothing to do during a server render, so keeping it off the server saves
 * pointless SSR work and shrinks the shell's server-rendered module graph.
 */
export default function RealtimeSync() {
  useRealtimeRefresh()
  return null
}
