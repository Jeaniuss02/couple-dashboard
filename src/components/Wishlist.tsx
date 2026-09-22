'use client'

import { useMemo, useState } from 'react'

import { useAction } from './hooks'
import {
  Avatar,
  Button,
  Chip,
  cx,
  EmptyState,
  MemberOnly,
  SectionHeading,
  SegmentedControl,
  Sheet,
  Toast,
  useViewer,
} from './ui'
import { format, relative, toDate } from '@/lib/dates'
import type { Profile, WishlistItem } from '@/lib/types'

type Filter = 'open' | 'done' | 'all'

export function Wishlist({ items, members }: { items: WishlistItem[]; members: Profile[] }) {
  const viewer = useViewer()
  const { run, pending, toast, dismissToast } = useAction()
  const [filter, setFilter] = useState<Filter>('open')
  const [composing, setComposing] = useState(false)
  const [editing, setEditing] = useState<WishlistItem | null>(null)

  const open = items.filter((i) => i.status === 'open')
  const visible = items.filter((i) =>
    filter === 'all' ? true : filter === 'open' ? i.status === 'open' : i.status === 'done',
  )

  const toggle = (item: WishlistItem) =>
    run(
      `toggle-${item.id}`,
      {
        url: `/api/wishlist/${item.id}`,
        method: 'PATCH',
        body: { status: item.status === 'done' ? 'open' : 'done' },
      },
      { success: () => (item.status === 'done' ? 'Back on the list' : 'Ticked off 🎉') },
    )

  const remove = (item: WishlistItem) =>
    run(
      `del-${item.id}`,
      { url: `/api/wishlist/${item.id}`, method: 'DELETE' },
      { success: () => 'Removed' },
    )

  return (
    <div className="space-y-5">
      <SectionHeading
        title="Wishes"
        hint="Things you want to do, and roughly when."
        action={
          <MemberOnly>
            <Button variant="primary" size="sm" onClick={() => setComposing(true)}>
              + Add wish
            </Button>
          </MemberOnly>
        }
      />

      <SegmentedControl
        ariaLabel="Wishlist filter"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'open', label: `Open${open.length ? ` (${open.length})` : ''}` },
          { value: 'done', label: 'Done' },
          { value: 'all', label: 'All' },
        ]}
      />

      {visible.length === 0 ? (
        <EmptyState
          emoji="🌠"
          title={filter === 'done' ? 'Nothing ticked off yet' : 'No wishes yet'}
          hint={filter === 'done' ? undefined : 'Somewhere to go, something to try, someday.'}
        />
      ) : (
        <ul className="grid gap-2">
          {visible.map((item) => {
            const owner = members.find((m) => m.id === item.owner_id)
            const done = item.status === 'done'
            const overdue =
              !done && item.target_date && new Date(`${item.target_date}T23:59`) < new Date()

            return (
              <li key={item.id} className={cx('card flex items-start gap-3 p-4', done && 'opacity-60')}>
                <MemberOnly
                  fallback={
                    <span
                      aria-hidden
                      className={cx(
                        'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs',
                        done ? 'bg-olive-soft text-olive' : 'bg-linen-deep',
                      )}
                    >
                      {done ? '✓' : '○'}
                    </span>
                  }
                >
                  <button
                    onClick={() => toggle(item)}
                    disabled={pending === `toggle-${item.id}`}
                    aria-label={done ? `Reopen ${item.title}` : `Mark ${item.title} done`}
                    className={cx(
                      'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs transition',
                      done
                        ? 'border-transparent bg-olive text-white'
                        : 'border-linen-edge hover:border-olive hover:bg-olive-soft',
                    )}
                  >
                    {done ? '✓' : ''}
                  </button>
                </MemberOnly>

                <div className="min-w-0 flex-1">
                  <p className={cx('text-sm font-medium', done && 'line-through decoration-espresso-faint')}>
                    {item.title}
                  </p>
                  {item.note && <p className="mt-0.5 text-xs text-espresso-soft">{item.note}</p>}

                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {owner ? <Avatar profile={owner} size={18} showName /> : <Chip tone="gold">together</Chip>}
                    {item.target_date && (
                      <Chip tone={overdue ? 'terracotta' : 'camel'}>
                        {overdue ? '⏳ ' : '🗓 '}
                        {format(toDate(`${item.target_date}T12:00:00`), 'd MMM yyyy')}
                      </Chip>
                    )}
                    {done && item.done_at && (
                      <Chip tone="olive">done {relative(item.done_at)}</Chip>
                    )}
                  </div>
                </div>

                <MemberOnly>
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      onClick={() => setEditing(item)}
                      aria-label={`Edit ${item.title}`}
                      className="rounded-lg p-1.5 text-espresso-faint transition hover:bg-linen-deep hover:text-espresso"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => remove(item)}
                      disabled={pending === `del-${item.id}`}
                      aria-label={`Delete ${item.title}`}
                      className="rounded-lg p-1.5 text-espresso-faint transition hover:bg-terracotta-soft hover:text-terracotta disabled:opacity-50"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                      </svg>
                    </button>
                  </div>
                </MemberOnly>
              </li>
            )
          })}
        </ul>
      )}

      {(composing || editing) && (
        <WishForm
          members={members}
          existing={editing}
          onClose={() => {
            setComposing(false)
            setEditing(null)
          }}
        />
      )}

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </div>
  )
}

function WishForm({
  members,
  existing,
  onClose,
}: {
  members: Profile[]
  existing: WishlistItem | null
  onClose: () => void
}) {
  const viewer = useViewer()
  const { run, pending, toast, dismissToast } = useAction()

  const [title, setTitle] = useState(existing?.title ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [targetDate, setTargetDate] = useState(existing?.target_date ?? '')
  const [owner, setOwner] = useState<string | null>(existing?.owner_id ?? null)

  const submit = async () => {
    const body = { title, note, target_date: targetDate || null, owner_id: owner }
    const done = existing
      ? await run('save-wish', { url: `/api/wishlist/${existing.id}`, method: 'PATCH', body }, { success: () => 'Updated' })
      : await run('save-wish', { url: '/api/wishlist', body }, { success: () => 'Added to the wishlist' })
    if (done) onClose()
  }

  return (
    <>
      <Sheet
        open
        onClose={onClose}
        title={existing ? 'Edit wish' : 'New wish'}
        footer={
          <Button
            variant="primary"
            onClick={submit}
            loading={pending === 'save-wish'}
            disabled={!title.trim()}
            className="w-full"
          >
            {existing ? 'Save changes' : 'Add to wishlist'}
          </Button>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="label mb-1.5" htmlFor="wish-title">
              What do you want to do?
            </label>
            <input
              id="wish-title"
              className="field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="See the northern lights"
              autoFocus
            />
          </div>

          <div>
            <span className="label mb-1.5">Whose wish</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setOwner(null)}
                className={cx(
                  'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition',
                  owner === null ? 'border-transparent bg-gold/20' : 'border-linen-edge hover:border-camel',
                )}
              >
                🤍 Both of us
              </button>
              {members.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setOwner(m.id)}
                  className={cx(
                    'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition',
                    owner === m.id ? 'border-transparent' : 'border-linen-edge hover:border-camel',
                  )}
                  style={owner === m.id ? { background: `${m.color}26` } : undefined}
                >
                  <Avatar profile={m} size={18} />
                  {m.display_name}
                  {m.id === viewer.id && <span className="text-[10px] opacity-60">(you)</span>}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="wish-date">
              By when <span className="font-normal normal-case tracking-normal">(optional)</span>
            </label>
            <input
              id="wish-date"
              type="date"
              className="field"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-espresso-faint">
              Leave it blank — a wish without a date is still a wish.
            </p>
          </div>

          <div>
            <label className="label mb-1.5" htmlFor="wish-note">
              Notes <span className="font-normal normal-case tracking-normal">(optional)</span>
            </label>
            <textarea
              id="wish-note"
              className="field min-h-[80px] resize-y"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tromsø in winter? Check flight prices around Feb."
            />
          </div>
        </div>
      </Sheet>

      {toast && <Toast message={toast.message} tone={toast.tone} onDismiss={dismissToast} />}
    </>
  )
}
