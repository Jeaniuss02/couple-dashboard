import 'server-only'

/**
 * WhatsApp transport adapters.
 *
 * Every credential is read from `process.env` inside this module, which is
 * `server-only` — importing it from a Client Component is a build error, so
 * keys can never be bundled for the browser.
 */

export interface SendArgs {
  /** E.164, e.g. +60123456789 (no `whatsapp:` prefix — adapters add it). */
  to: string
  body: string
}

export interface SendResult {
  ok: boolean
  provider: string
  providerId?: string
  error?: string
}

export type ProviderName = 'twilio' | 'meta' | 'webhook' | 'console'

export function activeProvider(): ProviderName {
  const p = (process.env.WHATSAPP_PROVIDER ?? 'console').toLowerCase()
  return (['twilio', 'meta', 'webhook', 'console'] as const).includes(p as ProviderName)
    ? (p as ProviderName)
    : 'console'
}

/** E.164 sanity check: `+` then 8–15 digits, no separators. */
export function isValidE164(phone: string | null | undefined): phone is string {
  return !!phone && /^\+[1-9]\d{7,14}$/.test(phone)
}

export async function send(args: SendArgs): Promise<SendResult> {
  const provider = activeProvider()

  if (!isValidE164(args.to)) {
    return { ok: false, provider, error: `Not a valid E.164 number: ${args.to}` }
  }

  try {
    switch (provider) {
      case 'twilio':
        return await sendTwilio(args)
      case 'meta':
        return await sendMeta(args)
      case 'webhook':
        return await sendWebhook(args)
      default:
        return sendConsole(args)
    }
  } catch (err) {
    return { ok: false, provider, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// Twilio WhatsApp API
// ---------------------------------------------------------------------------
async function sendTwilio({ to, body }: SendArgs): Promise<SendResult> {
  const sid = required('TWILIO_ACCOUNT_SID')
  const token = required('TWILIO_AUTH_TOKEN')
  const from = required('TWILIO_WHATSAPP_FROM')

  const form = new URLSearchParams({
    From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
    To: `whatsapp:${to}`,
    Body: body,
  })

  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
    cache: 'no-store',
  })

  const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string }
  return res.ok
    ? { ok: true, provider: 'twilio', providerId: json.sid }
    : { ok: false, provider: 'twilio', error: json.message ?? `HTTP ${res.status}` }
}

// ---------------------------------------------------------------------------
// Meta WhatsApp Business Cloud API
//
// Free-form text only reaches a number inside the 24-hour customer-service
// window. Outside it Meta returns error 131047, so we retry once with an
// approved template. Keep META_FALLBACK_TEMPLATE approved with one body
// parameter and the whole app keeps working at 3am.
// ---------------------------------------------------------------------------
async function sendMeta({ to, body }: SendArgs): Promise<SendResult> {
  const phoneId = required('META_WABA_PHONE_NUMBER_ID')
  const token = required('META_WABA_ACCESS_TOKEN')
  const version = process.env.META_GRAPH_VERSION ?? 'v21.0'
  const url = `https://graph.facebook.com/${version}/${phoneId}/messages`

  const post = async (payload: unknown) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
    const json = (await res.json().catch(() => ({}))) as {
      messages?: { id: string }[]
      error?: { message?: string; code?: number }
    }
    return { res, json }
  }

  const first = await post({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body },
  })

  if (first.res.ok) {
    return { ok: true, provider: 'meta', providerId: first.json.messages?.[0]?.id }
  }

  const outsideWindow = first.json.error?.code === 131047 || first.json.error?.code === 131026
  const fallback = process.env.META_FALLBACK_TEMPLATE
  if (!outsideWindow || !fallback) {
    return { ok: false, provider: 'meta', error: first.json.error?.message ?? `HTTP ${first.res.status}` }
  }

  const second = await post({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: fallback,
      language: { code: process.env.META_TEMPLATE_LANG ?? 'en' },
      // Template params cannot contain newlines — flatten for the fallback.
      components: [
        { type: 'body', parameters: [{ type: 'text', text: body.replace(/\s*\n+\s*/g, ' · ').slice(0, 1024) }] },
      ],
    },
  })

  return second.res.ok
    ? { ok: true, provider: 'meta', providerId: second.json.messages?.[0]?.id }
    : { ok: false, provider: 'meta', error: second.json.error?.message ?? `HTTP ${second.res.status}` }
}

// ---------------------------------------------------------------------------
// Generic HTTP bridge (self-hosted gateways, n8n, Make, etc.)
// ---------------------------------------------------------------------------
async function sendWebhook({ to, body }: SendArgs): Promise<SendResult> {
  const url = required('WHATSAPP_WEBHOOK_URL')
  const secret = process.env.WHATSAPP_WEBHOOK_SECRET

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(secret ? { 'X-Webhook-Secret': secret } : {}),
    },
    body: JSON.stringify({ to, body }),
    cache: 'no-store',
  })

  return res.ok
    ? { ok: true, provider: 'webhook' }
    : { ok: false, provider: 'webhook', error: `HTTP ${res.status}` }
}

// ---------------------------------------------------------------------------
// Local development — prints instead of sending, so the whole flow is testable
// without credentials.
// ---------------------------------------------------------------------------
function sendConsole({ to, body }: SendArgs): SendResult {
  // eslint-disable-next-line no-console
  console.log(`\n[whatsapp:console] → ${to}\n${body}\n`)
  return { ok: true, provider: 'console', providerId: `console-${Date.now()}` }
}

function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable ${name}`)
  return value
}
