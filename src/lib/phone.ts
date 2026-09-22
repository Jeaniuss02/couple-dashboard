import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'

/**
 * Phone verification primitives.
 *
 * Pure and dependency-light so the rules (expiry, attempt caps, cooldowns) are
 * testable without a database or a WhatsApp account. The Route Handlers own
 * the I/O; everything here just decides.
 */

export const CODE_LENGTH = 6
export const CODE_TTL_MINUTES = 10
export const MAX_ATTEMPTS = 5
export const RESEND_COOLDOWN_SECONDS = 60
export const MAX_SENDS_PER_WINDOW = 5
export const SEND_WINDOW_MINUTES = 60

/** E.164: `+`, a non-zero country digit, then 7–14 more. */
export function isValidE164(phone: string | null | undefined): phone is string {
  return !!phone && /^\+[1-9]\d{7,14}$/.test(phone)
}

/**
 * Accepts what people actually type — spaces, dashes, parens, a leading `00`
 * instead of `+` — and returns strict E.164, or null if it cannot.
 *
 * Deliberately does NOT guess a country for a bare local number: silently
 * turning `0123456789` into the wrong country's number is worse than refusing.
 */
export function normalizeE164(input: string): string | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  const compact = trimmed.replace(/[\s()\-.]/g, '')
  const candidate = compact.startsWith('00')
    ? `+${compact.slice(2)}`
    : compact.startsWith('+')
      ? compact
      : null

  if (!candidate) return null
  return isValidE164(candidate) ? candidate : null
}

/** `+60123456789` → `+6012••••6789`. Safe to show in UI and logs. */
export function maskPhone(phone: string): string {
  if (!isValidE164(phone)) return '••••'
  const head = phone.slice(0, 5)
  const tail = phone.slice(-4)
  const hidden = Math.max(phone.length - head.length - tail.length, 2)
  return `${head}${'•'.repeat(hidden)}${tail}`
}

/** Cryptographically random, uniformly distributed, zero-padded. */
export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, '0')
}

/**
 * HMAC rather than a bare hash: a 6-digit code has only a million
 * possibilities, so a plain digest would fall to an offline sweep the moment
 * the database leaked. The pepper lives in the server environment, never in
 * the database, so a database leak alone is not enough.
 */
export function hashCode(code: string, phone: string): string {
  return createHmac('sha256', verificationSecret())
    // Binding the phone in stops a hash captured for one number being replayed
    // against a challenge issued for another.
    .update(`${phone}:${code}`)
    .digest('hex')
}

export function codeMatches(code: string, phone: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashCode(code, phone), 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  // timingSafeEqual throws on a length mismatch, so guard first.
  if (actual.length !== expected.length) return false
  return timingSafeEqual(actual, expected)
}

function verificationSecret(): string {
  const explicit = process.env.PHONE_VERIFICATION_SECRET
  if (explicit) return explicit

  // The service-role key is already a high-entropy server-only secret, so
  // falling back to it keeps setup to one variable without weakening anything.
  const fallback = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (fallback) return fallback

  throw new Error(
    'Set PHONE_VERIFICATION_SECRET (or SUPABASE_SERVICE_ROLE_KEY) before verifying phone numbers.',
  )
}

// ---------------------------------------------------------------------------
// Rate limiting — decided here, enforced by the Route Handlers
// ---------------------------------------------------------------------------

export interface ChallengeRecord {
  phone_e164: string
  expires_at: string
  attempts: number
  sent_at: string
  send_count: number
  window_started_at: string
}

export type SendDecision =
  | { allowed: true; windowReset: boolean }
  | { allowed: false; reason: string; retryAfterSeconds: number }

/**
 * Two independent brakes: a short cooldown so a stuck button cannot spray
 * messages, and an hourly cap so nobody can be used to bill you for traffic.
 */
export function canSend(existing: ChallengeRecord | null, now: Date = new Date()): SendDecision {
  if (!existing) return { allowed: true, windowReset: true }

  const sinceLastSend = (now.getTime() - Date.parse(existing.sent_at)) / 1000
  if (sinceLastSend < RESEND_COOLDOWN_SECONDS) {
    return {
      allowed: false,
      reason: 'Hold on a moment before asking for another code.',
      retryAfterSeconds: Math.ceil(RESEND_COOLDOWN_SECONDS - sinceLastSend),
    }
  }

  const windowAgeMinutes = (now.getTime() - Date.parse(existing.window_started_at)) / 60_000
  if (windowAgeMinutes >= SEND_WINDOW_MINUTES) {
    return { allowed: true, windowReset: true }
  }

  if (existing.send_count >= MAX_SENDS_PER_WINDOW) {
    return {
      allowed: false,
      reason: 'Too many codes requested. Try again in a little while.',
      retryAfterSeconds: Math.ceil((SEND_WINDOW_MINUTES - windowAgeMinutes) * 60),
    }
  }

  return { allowed: true, windowReset: false }
}

export type CheckResult =
  | { status: 'ok' }
  | { status: 'expired' }
  | { status: 'locked' }
  | { status: 'mismatch'; attemptsLeft: number }
  | { status: 'wrong_phone' }

/**
 * Order matters. Expiry and the attempt cap are checked before the code is
 * compared, so a burnt challenge reveals nothing about whether a guess was close.
 */
export function checkCode(
  existing: ChallengeRecord & { code_hash: string },
  submitted: string,
  now: Date = new Date(),
): CheckResult {
  if (Date.parse(existing.expires_at) <= now.getTime()) return { status: 'expired' }
  if (existing.attempts >= MAX_ATTEMPTS) return { status: 'locked' }
  if (!isValidE164(existing.phone_e164)) return { status: 'wrong_phone' }

  const cleaned = submitted.replace(/\D/g, '')
  if (cleaned.length !== CODE_LENGTH) {
    return { status: 'mismatch', attemptsLeft: MAX_ATTEMPTS - existing.attempts - 1 }
  }

  return codeMatches(cleaned, existing.phone_e164, existing.code_hash)
    ? { status: 'ok' }
    : { status: 'mismatch', attemptsLeft: MAX_ATTEMPTS - existing.attempts - 1 }
}

export function expiryFrom(now: Date = new Date()): string {
  return new Date(now.getTime() + CODE_TTL_MINUTES * 60_000).toISOString()
}

/** Not user-editable, unlike the notification templates — a partner reworking
 *  this copy could strip the code out of their own login path. */
export function verificationMessage(code: string): string {
  return (
    `🔐 *${code}* is your Couple Board verification code.\n\n` +
    `It expires in ${CODE_TTL_MINUTES} minutes. If you didn't ask for this, ignore it.`
  )
}
