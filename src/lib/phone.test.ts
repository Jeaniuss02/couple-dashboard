import { beforeAll, describe, expect, it } from 'vitest'

import {
  canSend,
  checkCode,
  codeMatches,
  generateCode,
  hashCode,
  isValidE164,
  maskPhone,
  MAX_ATTEMPTS,
  MAX_SENDS_PER_WINDOW,
  normalizeE164,
  type ChallengeRecord,
} from './phone'

beforeAll(() => {
  process.env.PHONE_VERIFICATION_SECRET = 'test-pepper-not-a-real-secret'
})

const PHONE = '+60123456789'

describe('E.164 handling', () => {
  it('accepts well-formed international numbers', () => {
    expect(isValidE164('+60123456789')).toBe(true)
    expect(isValidE164('+14155238886')).toBe(true)
  })

  it('rejects malformed ones', () => {
    expect(isValidE164('0123456789')).toBe(false) // no country code
    expect(isValidE164('+0123456789')).toBe(false) // country code cannot start with 0
    expect(isValidE164('+6012')).toBe(false) // too short
    expect(isValidE164('+60 12 345 6789')).toBe(false) // spaces are not E.164
    expect(isValidE164(null)).toBe(false)
  })

  it('normalizes what people actually type', () => {
    expect(normalizeE164('+60 12-345 6789')).toBe(PHONE)
    expect(normalizeE164('  +60 (12) 345.6789 ')).toBe(PHONE)
    expect(normalizeE164('0060123456789')).toBe(PHONE) // 00 trunk prefix
  })

  it('refuses to guess a country for a bare local number', () => {
    // Silently picking the wrong country is worse than asking again.
    expect(normalizeE164('0123456789')).toBeNull()
    expect(normalizeE164('123456789')).toBeNull()
    expect(normalizeE164('')).toBeNull()
  })

  it('masks all but the country code and last four', () => {
    // +60123456789 is 12 chars: 5 shown, 3 hidden, 4 shown.
    expect(maskPhone(PHONE)).toBe('+6012•••6789')
    expect(maskPhone('+14155238886')).toBe('+1415•••8886')
    expect(maskPhone('nonsense')).toBe('••••')
  })
})

describe('code hashing', () => {
  it('generates six digits, zero-padded', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateCode()).toMatch(/^\d{6}$/)
    }
  })

  it('matches the right code and rejects the wrong one', () => {
    const hash = hashCode('123456', PHONE)
    expect(codeMatches('123456', PHONE, hash)).toBe(true)
    expect(codeMatches('123457', PHONE, hash)).toBe(false)
  })

  it('binds the hash to the phone number', () => {
    // A hash captured for one number must not verify against another.
    const hash = hashCode('123456', PHONE)
    expect(codeMatches('123456', '+60198765432', hash)).toBe(false)
  })

  it('does not throw on a malformed stored hash', () => {
    expect(codeMatches('123456', PHONE, 'deadbeef')).toBe(false)
    expect(codeMatches('123456', PHONE, '')).toBe(false)
  })
})

describe('send rate limiting', () => {
  const base = (over: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
    phone_e164: PHONE,
    expires_at: '2026-09-22T10:10:00.000Z',
    attempts: 0,
    sent_at: '2026-09-22T10:00:00.000Z',
    send_count: 1,
    window_started_at: '2026-09-22T10:00:00.000Z',
    ...over,
  })

  it('allows a first send', () => {
    expect(canSend(null)).toEqual({ allowed: true, windowReset: true })
  })

  it('holds a resend inside the cooldown', () => {
    const result = canSend(base(), new Date('2026-09-22T10:00:30Z'))
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.retryAfterSeconds).toBe(30)
  })

  it('allows a resend once the cooldown passes', () => {
    expect(canSend(base(), new Date('2026-09-22T10:02:00Z')).allowed).toBe(true)
  })

  it('caps sends within the hour', () => {
    const maxed = base({ send_count: MAX_SENDS_PER_WINDOW })
    const result = canSend(maxed, new Date('2026-09-22T10:30:00Z'))
    expect(result.allowed).toBe(false)
    if (!result.allowed) expect(result.reason).toMatch(/too many/i)
  })

  it('reopens the budget once the window rolls over', () => {
    const maxed = base({ send_count: MAX_SENDS_PER_WINDOW })
    const result = canSend(maxed, new Date('2026-09-22T11:05:00Z'))
    expect(result).toEqual({ allowed: true, windowReset: true })
  })
})

describe('code checking', () => {
  const challenge = (over: Partial<ChallengeRecord & { code_hash: string }> = {}) => ({
    phone_e164: PHONE,
    code_hash: hashCode('123456', PHONE),
    expires_at: '2026-09-22T10:10:00.000Z',
    attempts: 0,
    sent_at: '2026-09-22T10:00:00.000Z',
    send_count: 1,
    window_started_at: '2026-09-22T10:00:00.000Z',
    ...over,
  })

  const inWindow = new Date('2026-09-22T10:05:00Z')

  it('accepts the right code', () => {
    expect(checkCode(challenge(), '123456', inWindow)).toEqual({ status: 'ok' })
  })

  it('tolerates spaces and dashes the user pasted in', () => {
    expect(checkCode(challenge(), '123-456', inWindow)).toEqual({ status: 'ok' })
  })

  it('counts down remaining attempts on a miss', () => {
    expect(checkCode(challenge({ attempts: 2 }), '000000', inWindow)).toEqual({
      status: 'mismatch',
      attemptsLeft: MAX_ATTEMPTS - 3,
    })
  })

  it('expires strictly, even for the correct code', () => {
    expect(checkCode(challenge(), '123456', new Date('2026-09-22T10:10:01Z'))).toEqual({
      status: 'expired',
    })
  })

  it('locks out after too many attempts, without checking the code', () => {
    // Correct code, but the challenge is already burnt — it must not succeed.
    expect(checkCode(challenge({ attempts: MAX_ATTEMPTS }), '123456', inWindow)).toEqual({
      status: 'locked',
    })
  })

  it('checks expiry before the attempt cap', () => {
    const both = challenge({ attempts: MAX_ATTEMPTS })
    expect(checkCode(both, '123456', new Date('2026-09-22T11:00:00Z'))).toEqual({
      status: 'expired',
    })
  })
})
