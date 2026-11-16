import { useState } from 'react'

import { api } from '../../api/client'
import type { PersonDetail, TrustBand } from '../../api/types'
import { useApi } from '../../api/useApi'
import { formatRelative } from '../../format'
import { Dialog } from '../Dialog'
import { Bar, Pager } from '../dq/kit'
import { Explain } from '../Explain'
import { Icon } from '../Icon'
import { Loader } from '../Loader'
import { n, Pill, Seg } from '../Lx'
import { ErrorAlert } from '../ui'

const BANDS: { band: TrustBand; label: string; range: string; tone: 'ok' | 'warn' | 'bad' | 'plain' }[] = [
  { band: 'High', label: 'High', range: '90–100', tone: 'ok' },
  { band: 'Good', label: 'Good', range: '75–89', tone: 'ok' },
  { band: 'Review', label: 'Review', range: '50–74', tone: 'warn' },
  { band: 'Low', label: 'Low (quarantine)', range: 'below 50', tone: 'bad' },
]
const toneOf = (band: string) => BANDS.find((b) => b.band === band)?.tone ?? 'plain'
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
  const [open, setOpen] = useState<string | null>(null)
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
                <tr key={x.person} tabIndex={0} onClick={() => setOpen(x.person)} onKeyDown={(e) => e.key === 'Enter' && setOpen(x.person)}>
                  <td>
                    <span className="cu-side">
                      <b>{x.name || 'No name'}</b>
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
      {open && <PersonDialog id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

// One person: their score, then each of their records with the five rules, the points and why.
function PersonDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const data = useApi(() => api.person(id), [id])
  const p = data.data
  const [record, setRecord] = useState(0)
  const r = p?.records[record]

  return (
    <Dialog size="lg" title={p ? p.name || 'No name' : 'Person'} subtitle={p ? `${p.person} · found in ${p.records.length} record${p.records.length === 1 ? '' : 's'}` : undefined} onClose={onClose}>
      {data.error && <ErrorAlert message={data.error} />}
      {!p && !data.error && <Loader kind="scan" label="Loading" />}
      {p && r && (
        <>
          <div className="tr-head">
            <div className={`tr-big is-${toneOf(p.band)}`}>
              <b>{p.score ?? '—'}</b>
              <span>{p.band}</span>
            </div>
            <p className="dq-summary">
              {p.records.length > 1 ? (
                <Explain title="Person's score" text="The average of their records' scores." calc={`(${p.records.map((x) => x.trust).join(' + ')}) ÷ ${p.records.length} = ${p.score}`}>
                  <b>Average of {p.records.length} records</b>
                </Explain>
              ) : (
                <b>From one record</b>
              )}
              . Each record is scored on five rules worth 20% each.
            </p>
          </div>
          {p.holds.length > 0 && <p className="dq-why is-bad">{p.holds.join('. ')}. This keeps the band at Review at best, whatever the score.</p>}
          {p.records.length > 1 && (
            <Seg
              label="Record"
              value={String(record)}
              onChange={(v) => setRecord(Number(v))}
              options={p.records.map((x, i) => ({ value: String(i), label: `${x.source} · ${x.trust ?? '—'}` }))}
            />
          )}
          <div className="tr-record">
            <span className="cu-side">
              <b>{r.source}</b>
              <small>
                {r.key}
                {r.updated_at ? ` · updated ${formatRelative(r.updated_at)}` : ''}
              </small>
            </span>
            <Pill tone={toneOf(r.band)}>
              {r.trust ?? '—'} · {r.band}
            </Pill>
          </div>
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
          {Object.keys(r.values).length > 1 && (
            <div className="tr-values">
              {Object.entries(r.values).map(([k, v]) => (
                <span key={k}>
                  <small>{LABEL[k] ?? k}</small>
                  <code>{v}</code>
                </span>
              ))}
            </div>
          )}
        </>
      )}
    </Dialog>
  )
}

const LABEL: Record<string, string> = { name: 'Name', dob: 'Date of birth', pan: 'PAN', aadhaar: 'Aadhaar', gender: 'Gender', mobile: 'Mobile', email: 'Email', address: 'Address', city: 'City', state: 'State', pincode: 'Pincode', cross_ref: 'ID in another system' }
