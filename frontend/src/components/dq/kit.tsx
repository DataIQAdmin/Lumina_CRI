import type { ReactNode } from 'react'

import type { ColumnCounts } from '../../api/types'
import { Icon } from '../Icon'
import { n, type Part } from '../Lx'
import { useToast } from '../Toasts'

// Small pieces shared by the data quality steps.

export const PER_PAGE = 10

export function Head({ title, text, actions }: { title: ReactNode; text: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  )
}

export function Pager({ page, pages, onPage, text }: { page: number; pages: number; onPage: (p: number) => void; text: ReactNode }) {
  return (
    <div className="sx-foot">
      <span>{text}</span>
      {pages > 1 && (
        <span className="lx-pages">
          <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </button>
          <span className="text-sm muted">
            Page {page} of {pages}
          </span>
          <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next
          </button>
        </span>
      )}
    </div>
  )
}

export function Bar({ value, tone }: { value: number; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <span className={`dq-bar${tone ? ` is-${tone}` : ''}`}>
      <i style={{ width: `${value}%` }} />
    </span>
  )
}

// A value with a button that copies it, to paste into a regex or the AI box.
export function Copyable({ value, note }: { value: string; note?: string }) {
  const toast = useToast()
  const copy = () =>
    navigator.clipboard.writeText(value).then(
      () => toast('success', `Copied ${value}`),
      () => toast('error', 'Could not copy. Select the value and copy it instead.'),
    )
  return (
    <div className="dq-v dq-copy">
      <span className="dq-copy-text">
        <code>{value === '' ? <span className="muted">(empty)</span> : value}</code>
        {note && <small>{note}</small>}
      </span>
      {value !== '' && (
        <button type="button" className="btn btn-ghost btn-icon" title="Copy" aria-label={`Copy ${value}`} onClick={copy}>
          <Icon name="copy" size={14} />
        </button>
      )}
    </div>
  )
}

export const isEmail = (c: ColumnCounts) => !!c.counts[0]?.label.startsWith('Up to')
export const isMixed = (c: ColumnCounts) => !isEmail(c) && c.counts.filter((x) => x.count > 0).length > 1
export const tooLong = (c: ColumnCounts) => isEmail(c) && (c.counts[1]?.count ?? 0) > 0
export const needsLook = (c: ColumnCounts) => c.empty > 0 || isMixed(c) || tooLong(c)

export function status(c: ColumnCounts, rows: number): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (c.empty > 0) return { tone: 'bad', text: `${n(c.empty)} empty` }
  if (tooLong(c)) return { tone: 'warn', text: 'Too long' }
  if (isMixed(c)) return { tone: 'warn', text: 'Mixed lengths' }
  return { tone: 'ok', text: rows ? 'Looks fine' : 'Empty table' }
}

// The parts of a column for its split bar: its lengths or its values. The rarer lengths and too-long emails show
// as warnings.
export function partsOf(c: ColumnCounts): Part[] {
  if (c.counts.length) {
    return c.counts.map((x, i) => ({ label: x.label, count: x.count, tone: (isEmail(c) ? i === 1 : i > 0) ? ('warn' as const) : undefined }))
  }
  return (c.values ?? []).map((x) => ({ label: x.label, count: x.count }))
}

// Why a value of this label needs a look, in plain words.
export function reasonOf(c: ColumnCounts, label: string) {
  if (label === 'Empty') return 'Empty'
  if (isEmail(c)) return 'Longer than most emails'
  return `${label}; most values have ${c.counts[0]?.label.toLowerCase()}`
}
