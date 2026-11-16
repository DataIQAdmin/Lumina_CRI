import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../../api/client'
import type { PersonDetail, TrustBand } from '../../api/types'
import { useApi } from '../../api/useApi'
import { Bar, Pager } from '../dq/kit'
import { Explain } from '../Explain'
import { Icon } from '../Icon'
import { Loader } from '../Loader'
import { n, Pill } from '../Lx'
import { ErrorAlert } from '../ui'

const BANDS: { band: TrustBand; label: string; range: string; tone: 'ok' | 'warn' | 'bad' | 'plain' }[] = [
  { band: 'High', label: 'High', range: '90–100', tone: 'ok' },
  { band: 'Good', label: 'Good', range: '75–89', tone: 'ok' },
  { band: 'Review', label: 'Review', range: '50–74', tone: 'warn' },
  { band: 'Low', label: 'Low (quarantine)', range: 'below 50', tone: 'bad' },
]
const toneOf = (band: string) => BANDS.find((b) => b.band === band)?.tone ?? 'plain'
export const BAND_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'plain'> = { High: 'ok', Good: 'ok', Review: 'warn', Low: 'bad' }
const barTone = (score: number | null) => (score === null ? undefined : score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad')
const RULES: { key: keyof PersonDetail['records'][number]['parts']; label: string; how: string }[] = [
  { key: 'uniqueness', label: 'Uniqueness', how: '100 no duplicate · 50 waiting for review · 0 duplicate in the same system' },
  { key: 'recency', label: 'Recency', how: 'Last updated: 0–30 days 100 · 31–90 80 · 91–180 60 · 181–365 40 · older 20' },
  { key: 'completeness', label: 'Completeness', how: 'Needed fields filled, out of 7' },
  { key: 'consistency', label: 'Consistency', how: 'Name, date of birth, PAN and Aadhaar agree with the other systems' },
  { key: 'accuracy', label: 'Accuracy', how: "The customer's rows that pass every format rule" },
]
const HOW = 'Five rules, each worth 20%: uniqueness, recency, completeness, consistency and accuracy. A person scores the average of their records. A high score never overrides an unresolved match, conflicting identity details or a PAN or Aadhaar that failed its rule: these keep the band at Review.'

// Trust scores: every person, lowest first, with the five rules behind each score.
export function TrustTab() {
  const [band, setBand] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const navigate = useNavigate()
  const open = (person: string) => navigate(`/customers/${encodeURIComponent(person)}`)
  const data = useApi(() => api.people(band, q.trim(), page), [band, q, page])
  const d = data.data
  const pages = d ? Math.max(1, Math.ceil(d.count / d.page_size)) : 1
  const pick = (b: string) => {
    setBand(b === band ? '' : b)
    setPage(1)
  }

  if (data.error) return <ErrorAlert message={data.error} />
  if (!d) return <Loader kind="scan" label="Loading trust scores" />
  const total = Object.values(d.bands).reduce((a, x) => a + x, 0)

  return (
    <>
      <div className="hm-stats tr-bands">
        {BANDS.map((b) => (
          <button key={b.band} type="button" className={`card hm-stat tr-band is-${b.tone}${band === b.band ? ' is-on' : ''}`} aria-pressed={band === b.band} onClick={() => pick(b.band)}>
            <span className="muted">
              {b.label} <small>{b.range}</small>
            </span>
            <b>{n(d.bands[b.band] ?? 0)}</b>
            <span className="muted text-sm">{total ? `${Math.round((100 * (d.bands[b.band] ?? 0)) / total)}% of people` : '—'}</span>
          </button>
        ))}
      </div>

      <section className="card">
        <div className="hm-h">
          <span className="dq-summary">
            <Explain title="Trust score" text={HOW} calc={RULES.map((r) => `${r.label} × 20%`).join('\n') + `\nAverage now: ${d.average ?? '—'}`}>
              <b>How the trust score works</b>
            </Explain>
            {band && (
              <button type="button" className="btn btn-sm tr-clear" onClick={() => pick(band)}>
                {band} only <Icon name="x" size={13} />
              </button>
            )}
          </span>
          <label className="lx-search">
            <Icon name="search" size={15} />
            <input
              placeholder="Search name or ID"
              aria-label="Search name or ID"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </label>
        </div>
        <div className="table-wrap">
          <table className="sx-table">
            <thead>
              <tr>
                <th>Person</th>
                <th style={{ width: 190 }}>Trust score</th>
                <th>Found in</th>
                <th>Holds it back</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {d.results.map((x) => (
                <tr key={x.person} tabIndex={0} onClick={() => open(x.person)} onKeyDown={(e) => e.key === 'Enter' && open(x.person)}>
                  <td>
                    <span className="cu-side">
                      <b>
                        {x.name || 'No name'} {x.approved && <Pill tone="ok">Approved</Pill>}
                      </b>
                      <small>{x.person}</small>
                    </span>
                  </td>
                  <td>
                    <span className="dq-filled">
                      <Bar value={x.score ?? 0} tone={barTone(x.score)} />
                      <b className="num">{x.score ?? '—'}</b>
                      <Pill tone={toneOf(x.band)}>{x.band}</Pill>
                    </span>
                  </td>
                  <td>
                    <span className="tr-chips">
                      {x.sources.map((s) => (
                        <span key={`${s.source}:${s.key}`} className="tr-chip" title={`${s.source} · ${s.key}`}>
                          {s.source} <b>{s.score ?? '—'}</b>
                        </span>
                      ))}
                    </span>
                  </td>
                  <td>{x.holds.length ? <span className="is-bad-text text-sm">{x.holds.join('; ')}</span> : <span className="muted text-sm">—</span>}</td>
                  <td className="dq-go">
                    <Icon name="chevron-right" size={16} />
                  </td>
                </tr>
              ))}
              {d.results.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted sx-empty">
                    No person matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={pages} onPage={setPage} text={`${n(d.count)} people · lowest score first`} />
      </section>
    </>
  )
}

// The five rules of one record: score, its 20% share, and why.
export function RulesTable({ record: r }: { record: PersonDetail['records'][number] }) {
  return (
    <div className="table-wrap">
      <table className="lx-mini tr-rules">
        <thead>
          <tr>
            <th>Rule</th>
            <th className="num">Score</th>
            <th className="num">× 20%</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          {RULES.map((rule) => {
            const part = r.parts[rule.key]
            return (
              <tr key={rule.key}>
                <td>
                  <Explain title={rule.label} text={rule.how}>
                    {rule.label}
                  </Explain>
                </td>
                <td className="num">
                  <b className={part.score >= 75 ? 'is-good-text' : part.score >= 50 ? undefined : 'is-bad-text'}>{part.score}</b>
                </td>
                <td className="num">{(part.score * 0.2).toFixed(1).replace(/\.0$/, '')}</td>
                <td className="text-sm">{part.why}</td>
              </tr>
            )
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>
              <b>Trust score</b>
            </td>
            <td className="num">
              <b>{r.trust}</b>
            </td>
            <td className="muted text-sm">{RULES.map((rule) => (r.parts[rule.key].score * 0.2).toFixed(1).replace(/\.0$/, '')).join(' + ')}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

