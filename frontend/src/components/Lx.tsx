import type { ReactNode } from 'react'

// Small shared pieces of the data screens' look: fill rings, split bars with labels, status pills and the
// list-on-the-left / detail-on-the-right frame.

export const n = (v: number) => v.toLocaleString('en-IN')
export const pct = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : 0)

export function Ring({ value, label, big = false }: { value: number; label?: string; big?: boolean }) {
  return (
    <span className={`lx-ring${big ? ' is-big' : ''}`} style={{ '--p': value } as React.CSSProperties} aria-hidden="true">
      <span>{label ?? `${value}%`}</span>
    </span>
  )
}

export type Part = { label: string; count: number; tone?: 'warn' | 'bad' | 'ok' | 'empty' }

const SHADES = ['var(--lx-1)', 'var(--lx-2)', 'var(--lx-3)', 'var(--lx-4)', 'var(--lx-5)']
const TONES = { warn: 'var(--warn-dot)', bad: 'var(--bad-dot)', ok: 'var(--good-dot)', empty: 'var(--chart-track)' }
const colour = (p: Part, i: number) => (p.tone ? TONES[p.tone] : SHADES[Math.min(i, SHADES.length - 1)])

export function Split({ parts, thick = false }: { parts: Part[]; thick?: boolean }) {
  return (
    <span className={`lx-split${thick ? ' is-thick' : ''}`} aria-hidden="true">
      {parts.map((p, i) => (
        <i key={p.label} style={{ flex: p.count, background: colour(p, i) }} />
      ))}
    </span>
  )
}

// Labels for a split bar. With onPick, each label opens the rows behind it.
export function Legend({
  parts,
  max = 4,
  open,
  onPick,
}: {
  parts: Part[]
  max?: number
  open?: string | null
  onPick?: (label: string) => void
}) {
  return (
    <span className="lx-legend">
      {parts.slice(0, max).map((p, i) => {
        const body = (
          <>
            <em style={{ background: colour(p, i) }} />
            {p.label} <b>{n(p.count)}</b>
          </>
        )
        return onPick && p.count > 0 ? (
          <button
            key={p.label}
            type="button"
            className={open === p.label ? 'is-on' : undefined}
            onClick={(e) => {
              e.stopPropagation()
              onPick(p.label)
            }}
          >
            {body}
          </button>
        ) : (
          <span key={p.label}>{body}</span>
        )
      })}
      {parts.length > max && <span className="muted">+{parts.length - max}</span>}
    </span>
  )
}

export function Pill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'plain'; children: ReactNode }) {
  return <span className={`lx-pill is-${tone}`}>{children}</span>
}

// Choose one of a few things (connectors, tables), as a row of pills.
export function Seg<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  label: string
}) {
  return (
    <div className="lx-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'is-on' : undefined}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function PanelHead({ title, aside }: { title: ReactNode; aside?: ReactNode }) {
  return (
    <div className="lx-panel-h">
      <h3>{title}</h3>
      {aside}
    </div>
  )
}
