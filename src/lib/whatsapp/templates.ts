/**
 * Template rendering for WhatsApp copy.
 *
 * Bodies live in the `message_templates` table so either partner can reword
 * them in Settings without a deploy. Placeholders are `{{snake_case}}`.
 */

export type TemplateKey =
  | 'event_created'
  | 'handoff'
  | 'turn_advanced'
  | 'nudge'
  | 'penalty_claimed'
  | 'penalty_settled'

export type TemplateVars = Record<string, string | number | null | undefined>

/** Shipped copy — used when the DB has no row (or it has been disabled). */
export const DEFAULT_TEMPLATES: Record<TemplateKey, { label: string; body: string }> = {
  event_created: {
    label: 'New calendar event',
    body:
      '📅 *New plan on the board*\n{{event_name}}\n🕘 {{date_time}}{{location_line}}\n' +
      'Added by {{actor}}\n\n— Couple Board',
  },
  handoff: {
    label: 'Routine hand-off',
    body:
      '🔄 *{{deal_name}}* — your turn\n{{previous_step}} is done ({{actor}}).\n' +
      'Next: *{{step_name}}* — {{assigned_to}}{{due_line}}\n\n— Couple Board',
  },
  turn_advanced: {
    label: 'Turn advanced',
    body: '✅ *{{deal_name}}* done by {{actor}}.\nNext up: *{{assigned_to}}*\n\n— Couple Board',
  },
  nudge: {
    label: 'Gentle nudge',
    body:
      '🫶 Gentle nudge: *{{deal_name}}* — {{step_name}} is waiting on ' +
      '{{assigned_to}}.{{due_line}}\n\n— Couple Board',
  },
  penalty_claimed: {
    label: 'Penalty claimed',
    body:
      '⚖️ *Deal breaker!*\n{{actor}} claimed a forfeit on *{{deal_name}}*.\n' +
      '{{owed_by}} owes {{owed_to}}: _{{penalty}}_\n\n— Couple Board',
  },
  penalty_settled: {
    label: 'Penalty settled',
    body: '🎉 Settled: _{{penalty}}_\n{{owed_by}} is square with {{owed_to}}.\n\n— Couple Board',
  },
}

/** Placeholders offered in the Settings template editor. */
export const TEMPLATE_VARIABLES: Record<TemplateKey, string[]> = {
  event_created: ['event_name', 'date_time', 'location_line', 'actor', 'kind'],
  handoff: ['deal_name', 'step_name', 'previous_step', 'assigned_to', 'actor', 'due_line'],
  turn_advanced: ['deal_name', 'assigned_to', 'actor'],
  nudge: ['deal_name', 'step_name', 'assigned_to', 'actor', 'due_line'],
  penalty_claimed: ['deal_name', 'penalty', 'owed_by', 'owed_to', 'actor'],
  penalty_settled: ['penalty', 'owed_by', 'owed_to', 'actor'],
}

const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi

export function render(body: string, vars: TemplateVars): string {
  return body
    .replace(PLACEHOLDER, (_match, name: string) => {
      const value = vars[name.toLowerCase()]
      return value === null || value === undefined ? '' : String(value)
    })
    // An unfilled optional line (e.g. {{due_line}}) leaves a blank line behind.
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function previewTemplate(key: TemplateKey, body: string): string {
  const sample: TemplateVars = {
    event_name: 'Dinner at Kenny Hills',
    date_time: 'Fri 26 Sep, 7:30 PM',
    location_line: '\n📍 Kenny Hills Bakers',
    actor: 'Ava',
    kind: 'shared',
    deal_name: 'Laundry Routine',
    step_name: 'Hang / dry the load',
    previous_step: 'Wash the clothes',
    assigned_to: 'Noor',
    due_line: '\n⏰ by 9:15 PM',
    penalty: '15-minute massage',
    owed_by: 'Noor',
    owed_to: 'Ava',
  }
  return render(body || DEFAULT_TEMPLATES[key].body, sample)
}
