'use client'

import { useState } from 'react'

import { WhatsAppGlyph } from './DealCard'
import { useAction } from './hooks'
import { PhoneVerification, type PhoneState } from './PhoneVerification'
import { Avatar, Button, Card, Chip, cx, SectionHeading, Toast } from './ui'
import { DEFAULT_TEMPLATES, previewTemplate, TEMPLATE_VARIABLES, type TemplateKey } from '@/lib/whatsapp/templates'
import type { AppSettings, MessageTemplate, Profile } from '@/lib/types'

export function SettingsPanel({
  me,
  phoneState,
  myPrefs,
  settings,
  templates,
  provider,
}: {
  me: Profile
  phoneState: PhoneState
  myPrefs: Record<string, boolean>
  settings: AppSettings | null
  templates: MessageTemplate[]
  provider: string
}) {
  const { run, pending, toast, dismissToast } = useAction()

  const [displayName, setDisplayName] = useState(me.display_name)
  const [emoji, setEmoji] = useState(me.emoji)
  const [prefs, setPrefs] = useState(myPrefs)
  const [notificationsOn, setNotificationsOn] = useState(settings?.notifications_on ?? true)
  const [quietStart, setQuietStart] = useState(settings?.quiet_hours_start?.toString() ?? '')
  const [quietEnd, setQuietEnd] = useState(settings?.quiet_hours_end?.toString() ?? '')

  const [bodies, setBodies] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      (Object.keys(DEFAULT_TEMPLATES) as TemplateKey[]).map((key) => [
        key,
        templates.find((t) => t.key === key)?.body ?? DEFAULT_TEMPLATES[key].body,
      ]),
    ),
  )
  const [openTemplate, setOpenTemplate] = useState<TemplateKey | null>(null)

  const saveProfile = () =>
    run(
      'save-profile',
      {
        url: '/api/settings',
        method: 'PATCH',
        // The phone number is deliberately absent — it is owned by the
        // verification flow and the API rejects it here.
        body: { profile: { display_name: displayName, emoji, notify_prefs: prefs } },
      },
      { success: () => 'Saved' },
    )

  const saveApp = () =>
    run(
      'save-app',
      {
        url: '/api/settings',
        method: 'PATCH',
        body: {
          settings: {
            notifications_on: notificationsOn,
            quiet_hours_start: quietStart === '' ? null : Number(quietStart),
            quiet_hours_end: quietEnd === '' ? null : Number(quietEnd),
          },
        },
      },
      { success: () => 'Saved' },
    )

  const saveTemplates = () =>
    run(
      'save-templates',
      {
        url: '/api/settings',
        method: 'PATCH',
        body: {
          templates: (Object.keys(bodies) as TemplateKey[]).map((key) => ({
            key,
            label: DEFAULT_TEMPLATES[key].label,
            body: bodies[key],
          })),
        },
      },
      { success: () => 'Templates saved' },
    )

  const sendTest = (audience: 'me' | 'both') =>
    run(
      `test-${audience}`,
      { url: '/api/whatsapp/test', body: { audience } },
      { success: () => 'Test dispatched' },
    )

  return (
    <div className="space-y-8">
      {/* --- You --- */}
      <section>
        <SectionHeading title="You" hint="Only you can change your own number." />
        <Card className="space-y-4">
          <div className="flex gap-3">
            <div className="w-16 shrink-0">
              <label className="label mb-1.5" htmlFor="me-emoji">
                Icon
              </label>
              <input
                id="me-emoji"
                className="field text-center text-lg"
                value={emoji}
                onChange={(e) => setEmoji(e.target.value.slice(0, 4))}
              />
            </div>
            <div className="flex-1">
              <label className="label mb-1.5" htmlFor="me-name">
                Name
              </label>
              <input
                id="me-name"
                className="field"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          </div>

          <PhoneVerification initial={phoneState} />

          <fieldset>
            <legend className="label mb-2">Send me a WhatsApp when…</legend>
            <div className="space-y-1.5">
              {[
                ['event_created', 'A plan is added to the calendar'],
                ['handoff', 'A routine hands off to me'],
                ['nudge', 'I get nudged'],
                ['penalty', 'A penalty is claimed or settled'],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center gap-2.5 text-sm">
                  <input
                    type="checkbox"
                    checked={prefs[key] !== false}
                    onChange={(e) => setPrefs({ ...prefs, [key]: e.target.checked })}
                    className="h-4 w-4 accent-[#25D366]"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          <Button variant="primary" onClick={saveProfile} loading={pending === 'save-profile'}>
            Save
          </Button>
        </Card>
      </section>

      {/* --- WhatsApp --- */}
      <section>
        <SectionHeading title="WhatsApp" hint="Credentials live in server env vars, never in the browser." />
        <Card className="space-y-4">
          <div className="flex items-center gap-2">
            <Chip tone={provider === 'console' ? 'neutral' : 'olive'}>
              provider: {provider}
            </Chip>
            {provider === 'console' && (
              <span className="text-[11px] text-espresso-faint">
                Messages print to the server log.
              </span>
            )}
          </div>

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              checked={notificationsOn}
              onChange={(e) => setNotificationsOn(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[#25D366]"
            />
            <span>
              <span className="block text-sm font-medium">Notifications on</span>
              <span className="block text-xs text-espresso-faint">
                Master switch for both of you.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label mb-1.5" htmlFor="quiet-start">
                Quiet from
              </label>
              <input
                id="quiet-start"
                type="number"
                min={0}
                max={23}
                className="field"
                value={quietStart}
                onChange={(e) => setQuietStart(e.target.value)}
                placeholder="23"
              />
            </div>
            <div>
              <label className="label mb-1.5" htmlFor="quiet-end">
                Quiet until
              </label>
              <input
                id="quiet-end"
                type="number"
                min={0}
                max={23}
                className="field"
                value={quietEnd}
                onChange={(e) => setQuietEnd(e.target.value)}
                placeholder="7"
              />
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-espresso-faint">
            Automatic messages hold during these hours. Nudges and penalty call-outs still go through —
            those are deliberate taps.
          </p>

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={saveApp} loading={pending === 'save-app'}>
              Save
            </Button>
            <Button variant="whatsapp" onClick={() => sendTest('me')} loading={pending === 'test-me'}>
              <WhatsAppGlyph /> Test to me
            </Button>
            <Button variant="ghost" onClick={() => sendTest('both')} loading={pending === 'test-both'}>
              Test to both
            </Button>
          </div>
        </Card>
      </section>

      {/* --- Templates --- */}
      <section>
        <SectionHeading
          title="Message templates"
          hint="Use {{variables}} — they fill in when the message is sent."
        />
        <div className="grid gap-2">
          {(Object.keys(DEFAULT_TEMPLATES) as TemplateKey[]).map((key) => {
            const expanded = openTemplate === key
            return (
              <Card key={key} className="p-0">
                <button
                  onClick={() => setOpenTemplate(expanded ? null : key)}
                  aria-expanded={expanded}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="text-sm font-medium">{DEFAULT_TEMPLATES[key].label}</span>
                  <span className={cx('text-espresso-faint transition', expanded && 'rotate-180')}>
                    ⌄
                  </span>
                </button>

                {expanded && (
                  <div className="space-y-3 border-t border-linen-edge px-4 py-4">
                    <textarea
                      className="field min-h-[120px] resize-y font-mono text-[12px] leading-relaxed"
                      value={bodies[key]}
                      onChange={(e) => setBodies({ ...bodies, [key]: e.target.value })}
                    />

                    <div className="flex flex-wrap gap-1.5">
                      {TEMPLATE_VARIABLES[key].map((variable) => (
                        <button
                          key={variable}
                          type="button"
                          onClick={() =>
                            setBodies({ ...bodies, [key]: `${bodies[key]}{{${variable}}}` })
                          }
                          className="rounded-md bg-linen-deep px-2 py-0.5 font-mono text-[11px] text-espresso-soft hover:bg-gold/20"
                        >
                          {`{{${variable}}}`}
                        </button>
                      ))}
                    </div>

                    <div>
                      <span className="label mb-1.5">Preview</span>
                      <pre className="whitespace-pre-wrap rounded-xl bg-[#DCF8C6] px-3 py-2.5 font-sans text-[13px] leading-snug text-[#111b21]">
                        {previewTemplate(key, bodies[key])}
                      </pre>
                    </div>
                  </div>
                )}
              </Card>
            )
          })}
        </div>
        <Button
          variant="primary"
          onClick={saveTemplates}
          loading={pending === 'save-templates'}
          className="mt-3"
        >
          Save templates
        </Button>
      </section>

      <section>
        <SectionHeading title="Session" />
        <Card className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-2 text-sm">
            <Avatar profile={me} size={26} /> Signed in as {me.display_name}
          </span>
          <form action="/auth/signout" method="post">
            <Button type="submit" variant="quiet" size="sm">
              Sign out
            </Button>
          </form>
        </Card>
      </section>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </div>
  )
}
