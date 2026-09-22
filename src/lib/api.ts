import 'server-only'
import { NextResponse } from 'next/server'
import { ForbiddenError } from '@/lib/auth'

export function ok<T>(data: T, init?: number) {
  return NextResponse.json({ ok: true, ...data }, { status: init ?? 200 })
}

export function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status })
}

/** Wraps a handler so auth + validation failures become tidy JSON. */
export async function guard<T>(run: () => Promise<T>): Promise<T | NextResponse> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof ForbiddenError) return fail(err.message, 403)
    if (err instanceof ValidationError) return fail(err.message, 422)
    const message = err instanceof Error ? err.message : 'Unexpected error'
    // eslint-disable-next-line no-console
    console.error('[api]', err)
    return fail(message, 500)
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export function requireString(value: unknown, field: string, max = 300): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${field} is required.`)
  }
  const trimmed = value.trim()
  if (trimmed.length > max) throw new ValidationError(`${field} must be under ${max} characters.`)
  return trimmed
}

export function optionalString(value: unknown, max = 2000): string | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new ValidationError('Expected a text value.')
  return value.trim().slice(0, max) || null
}

export function requireIso(value: unknown, field: string): string {
  const raw = requireString(value, field, 64)
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) throw new ValidationError(`${field} is not a valid date.`)
  return date.toISOString()
}

export function optionalIso(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null
  return requireIso(value, field)
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(', ')}.`)
  }
  return value as T
}
