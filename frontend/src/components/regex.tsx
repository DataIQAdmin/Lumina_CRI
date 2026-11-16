import { useEffect, useState } from 'react'

import { api } from '../api/client'
import type { ReadyRegex, RegexCheck, RegexLibrary, RulePreview } from '../api/types'
import { Icon } from './Icon'
import { n, Pill, Split } from './Lx'

// Tells whether what is typed is a proper regular expression, shortly after typing stops.
export function useRegexCheck(pattern: string) {
  const [check, setCheck] = useState<RegexCheck | null>(null)
  useEffect(() => {
    setCheck(null)
    if (!pattern.trim()) return
    const timer = setTimeout(() => {
      api.regexCheck(pattern).then(setCheck, () => setCheck(null))
    }, 300)
    return () => clearTimeout(timer)
  }, [pattern])
  return check
}

export function RegexVerdict({ check }: { check: RegexCheck | null }) {
  if (!check) return null
  return (
    <p className={`regex-verdict ${check.valid ? 'is-good' : 'is-bad'}`} role="status">
      <Icon name={check.valid ? 'check' : 'alert'} size={14} />
      {check.valid ? 'This is a proper regular expression.' : check.error}
    </p>
  )
}

// A regex someone could use, from the AI or the library, with made-up values it lets through and values it stops
// (each checked against the regex).
export interface Offer {
  source: 'ai' | 'library'
  title: string
  pattern: string
  matching: string[]
  failing: { value: string; why: string }[]
  passed?: number
  total?: number
}

export function OfferCard({
  offer,
  chosen,
  onUse,
  onRetry,
  busy,
}: {
  offer: Offer
  chosen: boolean
  onUse: () => void
  onRetry?: () => void
  busy?: boolean
}) {
  return (
    <div className={`lx-offer${chosen ? ' is-on' : ''}`} role="status">
      <div className="lx-offer-h">
        <Pill tone="plain">{offer.source === 'ai' ? 'Suggested by AI' : 'From the library'}</Pill>
        {offer.total !== undefined && (
          <span className="text-sm muted">
            {n(offer.passed ?? 0)} of {n(offer.total)} rows pass
          </span>
        )}
      </div>
      {offer.title && <b>{offer.title}</b>}
      <code className="lx-code">{offer.pattern}</code>
      {(offer.matching.length > 0 || offer.failing.length > 0) && (
        <div className="lx-examples">
          <div>
            <span className="lx-cap is-good">Accepted</span>
            {offer.matching.map((v) => (
              <span key={v} className="lx-example">
                {v}
              </span>
            ))}
          </div>
          <div>
            <span className="lx-cap is-bad">Stopped</span>
            {offer.failing.map((f) => (
              <span key={f.value} className="lx-example">
                {f.value === '' ? '(empty)' : f.value}
                {f.why && <small>{f.why}</small>}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="lx-row">
        <button type="button" className={`btn btn-sm${chosen ? '' : ' btn-primary'}`} disabled={chosen} onClick={onUse}>
          {chosen ? 'Chosen' : 'Use this'}
        </button>
        {onRetry && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

// The ready-made regexes that fit a column name: "AlternatePhoneNumber" has the words alternate, phone, number.
export function suggested(column: string, ready: ReadyRegex[]) {
  const words = column
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
  return ready.filter((r) => r.hints.some((hint) => words.includes(hint)))
}

export function LibrarySelect({
  library,
  column,
  onPick,
}: {
  library: RegexLibrary | null
  column: string
  onPick: (pattern: string) => void
}) {
  if (!library) return null
  const fits = suggested(column, library.ready)
  return (
    <select
      className="select lx-select"
      aria-label="Choose from the library"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value)
      }}
    >
      <option value="">From the library</option>
      {fits.length > 0 && (
        <optgroup label="Suggested for this column">
          {fits.map((r) => (
            <option key={r.pattern} value={r.pattern}>
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
      {library.saved.length > 0 && (
        <optgroup label="Saved by your team">
          {library.saved.map((r) => (
            <option key={r.id} value={r.pattern}>
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="All ready-made">
        {library.ready.map((r) => (
          <option key={r.pattern} value={r.pattern}>
            {r.name}
          </option>
        ))}
      </optgroup>
    </select>
  )
}

export function PreviewResult({ result, column }: { result: RulePreview; column: string }) {
  const total = result.passed + result.failed
  return (
    <div className="lx-stack">
      <div className="sx-kv">
        <div>
          <b className="is-good-text">{n(result.passed)}</b>
          <span>rows pass</span>
        </div>
        <div>
          <b className="is-bad-text">{n(result.failed)}</b>
          <span>held back</span>
        </div>
        <div>
          <b>{n(total)}</b>
          <span>rows checked</span>
        </div>
      </div>
      <Split
        thick
        parts={[
          { label: 'Pass', count: result.passed, tone: 'ok' },
          { label: 'Held back', count: result.failed, tone: 'bad' },
        ]}
      />
      <table className="lx-mini">
        <thead>
          <tr>
            <th className="num">Row</th>
            <th>{column}</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {result.sample.map((s) => (
            <tr key={s.position}>
              <td className="num muted">{s.position + 1}</td>
              <td>
                <code>{s.value === null || s.value === '' ? <span className="muted">Empty</span> : String(s.value)}</code>
              </td>
              <td>
                <Pill tone={s.passed ? 'ok' : 'bad'}>{s.passed ? 'Passes' : 'Held back'}</Pill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
