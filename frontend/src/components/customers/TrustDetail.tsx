import { useState } from 'react'

import type { PersonDetail, TrustPart } from '../../api/types'
import { formatDate } from '../../format'
import { Icon } from '../Icon'
import { Pill } from '../Lx'
import { BAND_TONE } from './TrustTab'

type Record_ = PersonDetail['records'][number]
type Key = keyof Record_['parts']

const CHECKS: { key: Key; label: string; question: string; colour: string }[] = [
  { key: 'uniqueness', label: 'Uniqueness', question: 'Is it a duplicate?', colour: 'var(--tx-1)' },
  { key: 'recency', label: 'Recency', question: 'How fresh is it?', colour: 'var(--tx-2)' },
  { key: 'completeness', label: 'Completeness', question: 'Are the needed fields filled?', colour: 'var(--tx-3)' },
  { key: 'consistency', label: 'Consistency', question: 'Does it agree with the other systems?', colour: 'var(--tx-4)' },
  { key: 'accuracy', label: 'Accuracy', question: 'Do the values pass their rules?', colour: 'var(--tx-5)' },
]
const LABELS: Record<string, string> = { name: 'Name', dob: 'Date of birth', pan: 'PAN', aadhaar: 'Aadhaar', mobile: 'Mobile', email: 'Email', address: 'Address' }
const two = (x: number) => x.toFixed(2)

// One record's trust score as the client sees it: the score, where its points came from, and for each check a plain
// answer that opens the exact evidence saved when the score was worked out.
export function TrustDetail({ record: r, weights }: { record: Record_; weights?: Record<string, number> }) {
  const [open, setOpen] = useState<Key | null>(null)
  const weight = (k: Key) => r.parts[k].weight ?? weights?.[k] ?? 20
  const points = (k: Key) => r.parts[k].points ?? (r.parts[k].score * weight(k)) / 100
  const total = CHECKS.reduce((a, c) => a + points(c.key), 0)
  const score = r.trust ?? 0

  return (
    <div className="tx">
      <div className="tx-head">
        <div className={`tx-ring is-${BAND_TONE[r.band] ?? 'plain'}`} style={{ ['--v' as string]: score }}>
          <b>{r.trust ?? '—'}</b>
        </div>
        <div className="tx-head-text">
          <span className="tx-band">
            <Pill tone={BAND_TONE[r.band] ?? 'plain'}>{r.band || 'Not scored'}</Pill>
            {r.holds.length > 0 && <Pill tone="warn">Held</Pill>}
          </span>
          <span className="muted text-sm">
            {r.holds.length > 0 ? `${r.holds.join('. ')}. This keeps the band at Review at best, whatever the score.` : 'Five checks, each worth its share of 100 points.'}
          </span>
        </div>
      </div>

      <div className="tx-stack" role="img" aria-label={`Points: ${CHECKS.map((c) => `${c.label} ${two(points(c.key))}`).join(', ')}`}>
        {CHECKS.map((c) => (
          <i key={c.key} style={{ width: `${points(c.key)}%`, background: c.colour }} title={`${c.label}: ${two(points(c.key))} points`} />
        ))}
      </div>
      <div className="tx-legend">
        {CHECKS.map((c) => (
          <span key={c.key}>
            <i style={{ background: c.colour }} />
            {c.label} {two(points(c.key))}
          </span>
        ))}
        {total < 99.995 && (
          <span>
            <i className="is-lost" />
            Points lost {two(100 - total)}
          </span>
        )}
      </div>

      <ul className="tx-checks">
        {CHECKS.map((c) => {
          const part = r.parts[c.key]
          const isOpen = open === c.key
          return (
            <li key={c.key} className={isOpen ? 'is-open' : undefined}>
              <button type="button" className="tx-check" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : c.key)}>
                <i style={{ background: c.colour }} aria-hidden="true" />
                <span className="tx-check-text">
                  <b>{c.label}</b>
                  <span className="muted text-sm">{part.why}</span>
                </span>
                <span className="tx-points">
                  <b>{two(points(c.key))}</b>
                  <small>of {weight(c.key)}</small>
                </span>
                <Icon name="chevron-right" size={15} />
              </button>
              {isOpen && (
                <div className="tx-evidence">
                  <p className="muted text-sm">{c.question}</p>
                  <Evidence k={c.key} part={part} />
                  <code className="tx-calc">
                    {formatScore(part.score)} × {weight(c.key)}% = {two(points(c.key))} points
                  </code>
                </div>
              )}
            </li>
          )
        })}
      </ul>

      <code className="tx-calc is-total">
        {CHECKS.map((c) => two(points(c.key))).join(' + ')} = {two(total)}, shown as {r.trust ?? '—'}
      </code>
    </div>
  )
}

const formatScore = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(2))

function Evidence({ k, part }: { k: Key; part: TrustPart }) {
  const e = part.evidence
  if (!e) return <p className="text-sm">{part.why}</p>
  if (k === 'uniqueness') {
    if (e.twins?.length) return <p className="text-sm">The same system also holds {e.twins.join(', ')}: a duplicate scores 0.</p>
    if (e.pending?.length) return <p className="text-sm">Waiting for a person to decide on {e.pending.join(', ')}. A possible duplicate scores 50 until then.</p>
    return <p className="text-sm">No duplicate found in the same system and nothing waiting for review, so it scores 100.</p>
  }
  if (k === 'recency') {
    return (
      <p className="text-sm">
        {e.date ? `Last updated ${formatDate(e.date)}, ${e.days} days ago. That is in the "${e.band}" band.` : 'This record has no last-updated date, so it scores 20.'}
        <span className="tx-bands muted"> 0–30 days 100 · 31–90 80 · 91–180 60 · 181–365 40 · older 20</span>
      </p>
    )
  }
  if (k === 'completeness') {
    return (
      <div className="tx-chips">
        {(e.filled ?? []).map((f) => (
          <span key={f} className="tx-chip is-good">
            <Icon name="check" size={12} /> {LABELS[f] ?? f}
          </span>
        ))}
        {(e.missing ?? []).map((f) => (
          <span key={f} className="tx-chip is-bad">
            <Icon name="x" size={12} /> {LABELS[f] ?? f}
          </span>
        ))}
      </div>
    )
  }
  const fields = e.fields ?? []
  if (fields.length === 0) return <p className="text-sm">{part.why}</p>
  if (k === 'consistency') {
    return (
      <table className="lx-mini tx-table">
        <thead>
          <tr>
            <th>Field</th>
            <th>This record</th>
            <th>Most records say</th>
            <th aria-label="Agrees" />
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.field} className={f.agree ? undefined : 'is-diff'}>
              <td>{f.label}</td>
              <td>
                <code>{f.mine}</code>
              </td>
              <td>{f.majority ? <code>{f.majority}</code> : <span className="muted text-sm">No majority</span>}</td>
              <td>{f.agree ? <Pill tone="ok">Agrees</Pill> : <Pill tone="bad">Differs</Pill>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  return (
    <table className="lx-mini tx-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Value</th>
          <th aria-label="Rule" />
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f.field} className={f.passed ? undefined : 'is-diff'}>
            <td>{f.label}</td>
            <td>
              <code>{f.value}</code>
            </td>
            <td>{f.passed ? <Pill tone="ok">Passes its rule</Pill> : <Pill tone="bad">Fails its rule</Pill>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
