'use client'

import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import type { Profile, Viewer } from '@/lib/types'

// ---------------------------------------------------------------------------
// Viewer context — one source of truth for "can this person act?"
// ---------------------------------------------------------------------------
const ViewerContext = createContext<Viewer>({ id: null, isMember: false, profile: null })

export function ViewerProvider({ viewer, children }: { viewer: Viewer; children: ReactNode }) {
  return <ViewerContext.Provider value={viewer}>{children}</ViewerContext.Provider>
}

export function useViewer() {
  return useContext(ViewerContext)
}

/** Renders `children` only for the two members; visitors see `fallback`. */
export function MemberOnly({ children, fallback = null }: { children: ReactNode; fallback?: ReactNode }) {
  return useViewer().isMember ? <>{children}</> : <>{fallback}</>
}

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ')
}

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type ButtonVariant = 'primary' | 'ghost' | 'quiet' | 'whatsapp' | 'danger'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-espresso text-linen hover:bg-espresso/90 active:scale-[0.98] shadow-card disabled:bg-espresso/40',
  ghost:
    'border border-linen-edge bg-white/70 text-espresso hover:border-camel hover:bg-white active:scale-[0.98]',
  quiet: 'text-espresso-soft hover:text-espresso hover:bg-linen-deep',
  // WhatsApp green is reserved for exactly this — messages leaving the app.
  whatsapp: 'bg-whatsapp text-white hover:bg-whatsapp-deep active:scale-[0.98] shadow-card',
  danger:
    'border border-terracotta/40 bg-terracotta-soft text-terracotta hover:bg-terracotta hover:text-white active:scale-[0.98]',
}

export function Button({
  variant = 'ghost',
  size = 'md',
  className,
  loading,
  children,
  ...props
}: {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3 text-sm',
  }
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-60 disabled:active:scale-100',
        sizes[size],
        VARIANTS[variant],
        className,
      )}
    >
      {loading && <Spinner />}
      {children}
    </button>
  )
}

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70"
    />
  )
}

// ---------------------------------------------------------------------------
// Chips & avatars
// ---------------------------------------------------------------------------
export function Chip({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: 'neutral' | 'gold' | 'olive' | 'terracotta' | 'camel'
  children: ReactNode
  className?: string
}) {
  const tones = {
    neutral: 'bg-linen-deep text-espresso-soft',
    gold: 'bg-gold/15 text-[#8a6d12]',
    olive: 'bg-olive-soft text-[#5c6348]',
    terracotta: 'bg-terracotta-soft text-terracotta',
    camel: 'bg-camel-soft text-[#8a6742]',
  }
  return <span className={cx('chip', tones[tone], className)}>{children}</span>
}

export function Avatar({
  profile,
  size = 28,
  showName = false,
}: {
  profile: Profile | null | undefined
  size?: number
  showName?: boolean
}) {
  if (!profile) {
    return (
      <span className="chip bg-linen-deep text-espresso-faint" title="Unassigned">
        ✨ anyone
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className="grid shrink-0 place-items-center rounded-full ring-1 ring-inset ring-black/5"
        style={{
          width: size,
          height: size,
          background: `${profile.color}26`,
          fontSize: size * 0.5,
        }}
      >
        {profile.emoji}
      </span>
      {showName && <span className="text-sm font-medium">{profile.display_name}</span>}
      <span className="sr-only">{profile.display_name}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------
// Card + section heading
// ---------------------------------------------------------------------------
export function Card({
  children,
  className,
  as: Tag = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'section' | 'article' | 'li'
}) {
  return <Tag className={cx('card p-4 sm:p-5', className)}>{children}</Tag>
}

export function SectionHeading({
  title,
  hint,
  action,
}: {
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-lg sm:text-xl">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-espresso-faint">{hint}</p>}
      </div>
      {action}
    </div>
  )
}

export function EmptyState({ emoji, title, hint }: { emoji: string; title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-linen-edge px-5 py-8 text-center">
      <div className="text-2xl" aria-hidden>
        {emoji}
      </div>
      <p className="mt-2 text-sm font-medium">{title}</p>
      {hint && <p className="mt-1 text-xs text-espresso-faint">{hint}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sheet — a bottom sheet on phones, a centred dialog on wider screens
// ---------------------------------------------------------------------------
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-espresso/35 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative z-10 max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-linen
                   shadow-lift animate-rise-in sm:max-w-lg sm:rounded-3xl"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-linen-edge
                        bg-linen/95 px-5 py-4 backdrop-blur">
          <h2 className="text-lg">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1.5 text-espresso-faint transition hover:bg-linen-deep hover:text-espresso"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-5">{children}</div>
        {footer && (
          <div className="sticky bottom-0 border-t border-linen-edge bg-linen/95 px-5 py-4 backdrop-blur">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Toast — confirmation for micro-logging, including what WhatsApp did
// ---------------------------------------------------------------------------
export function Toast({
  message,
  tone = 'olive',
  onDismiss,
}: {
  message: string
  tone?: 'olive' | 'terracotta' | 'gold'
  onDismiss: () => void
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4200)
    return () => clearTimeout(timer)
  }, [message, onDismiss])

  const tones = {
    olive: 'bg-olive text-white',
    terracotta: 'bg-terracotta text-white',
    gold: 'bg-gold-deep text-white',
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'fixed inset-x-4 bottom-20 z-50 mx-auto max-w-sm rounded-2xl px-4 py-3 text-sm shadow-lift',
        'animate-rise-in sm:bottom-6',
        tones[tone],
      )}
    >
      {message}
    </div>
  )
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  ariaLabel: string
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="inline-flex rounded-xl border border-linen-edge bg-white/70 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-[10px] px-3 py-1.5 text-xs font-medium transition',
            value === option.value
              ? 'bg-espresso text-linen shadow-sm'
              : 'text-espresso-soft hover:text-espresso',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
