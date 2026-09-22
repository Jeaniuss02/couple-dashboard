'use client'

import { useMemo } from 'react'

/**
 * Drifting, twinkling hearts behind the board.
 *
 * Deliberately restrained: it sits behind everything at low opacity and must
 * never compete with the content or hurt legibility. Pure CSS animation on a
 * fixed layer, so it costs no JavaScript per frame.
 *
 * Honours prefers-reduced-motion — globals.css collapses every animation to
 * ~0ms, which leaves the hearts as a still, faint scatter rather than removing
 * them outright.
 */

const HEART_COUNT = 18

export function HeartsBackground() {
  // Seeded once per mount rather than per render, and never re-randomised —
  // hearts that jump on every state change would be maddening.
  const hearts = useMemo(
    () =>
      Array.from({ length: HEART_COUNT }, (_, i) => {
        // Spread deterministically so they never clump in one corner.
        const left = ((i * 37) % 100) + (i % 3) - 1
        return {
          id: i,
          left: Math.min(Math.max(left, 1), 97),
          size: 8 + ((i * 13) % 14),
          delay: (i * 1.7) % 18,
          duration: 22 + ((i * 7) % 16),
          drift: ((i % 5) - 2) * 14,
          // Faint enough to read straight through; the twinkle scales it down
          // further at the trough, never up beyond this.
          opacity: 0.1 + ((i * 3) % 7) / 60,
        }
      }),
    [],
  )

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {hearts.map((h) => (
        <span
          key={h.id}
          className="heart absolute"
          style={
            {
              left: `${h.left}%`,
              width: h.size,
              height: h.size,
              // Base opacity stays on the wrapper; the twinkle multiplies it.
              opacity: h.opacity,
              '--drift': `${h.drift}px`,
              '--rise': `${h.duration}s`,
              '--delay': `-${h.delay}s`,
              '--twinkle': `${2.8 + (h.id % 4) * 0.6}s`,
            } as React.CSSProperties
          }
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-full w-full text-[#C97A63]">
            <path d="M12 21s-7.5-4.7-9.6-9A5.4 5.4 0 0 1 12 6.2 5.4 5.4 0 0 1 21.6 12c-2.1 4.3-9.6 9-9.6 9Z" />
          </svg>
        </span>
      ))}
    </div>
  )
}
