import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../../api/client'
import type { PersonDetail, TrustBand } from '../../api/types'
import { useApi } from '../../api/useApi'
import { Bar, Pager } from '../dq/kit'
import { Explain } from '../Explain'
import { Icon } from '../Icon'
import { Loader } from '../Loader'
import { n, Pill, Seg } from '../Lx'
import { Avatar, ErrorAlert } from '../ui'

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
  { key: 'consistency', label: 'Consistency', how: "Needed fields agreeing with the value most of the customer's records hold" },
  { key: 'accuracy', label: 'Accuracy', how: 'Filled fields passing their column rule' },
]
const HOW = 'Five rules, weighted as set on Settings (the trust score document uses 20% each): uniqueness, recency, completeness, consistency and accuracy. An empty value lowers completeness only. A person scores the average of their records. A high score never overrides an unresolved match, conflicting identity details or a PAN or Aadhaar that failed its rule: these keep the band at Review.'

// Trust scores: every person, lowest first, with the five rules behind each score.
export function TrustTab() {
  const [band, setBand] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [sort, setSort] = useState<'name' | 'low' | 'high'>('name')
  const navigate = useNavigate()
  const open = (person: string) => navigate(`/customers/${encodeURIComponent(person)}`)
  const data = useApi(() => api.people(band, q.trim(), page, sort), [band, q, page, sort])
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
            <Explain title="Trust score" text={HOW} calc={RULES.map((r) => `${r.label} × ${d.weights?.[r.key] ?? 20}%`).join('\n') + `\nAverage now: ${d.average ?? '—'}`}>
              <b>How the trust score works</b>
            </Explain>
            {band && (
              <button type="button" className="btn btn-sm tr-clear" onClick={() => pick(band)}>
                {band} only <Icon name="x" size={13} />
              </button>
            )}
          </span>
          <span className="cu-tools">
          <Seg
            label="Sort"
            value={sort}
            onChange={(v) => {
              setSort(v)
              setPage(1)
            }}
            options={[
              { value: 'name', label: 'Name A–Z' },
              { value: 'low', label: 'Lowest trust' },
              { value: 'high', label: 'Highest trust' },
            ]}
          />
          <label className="lx-search">
            <Icon name="search" size={15} />
            <input
              placeholder="Search name or customer ID"
              aria-label="Search name or customer ID"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </label>
          </span>
        </div>
        <div className="table-wrap">
          <table className="sx-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th style={{ width: 200 }}>Trust score</th>
                <th>Found in</th>
                <th>Status</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {d.results.map((x) => (
                <tr key={x.person} tabIndex={0} onClick={() => open(x.person)} onKeyDown={(e) => e.key === 'Enter' && open(x.person)}>
                  <td className="is-main">
                    <span className="cu-person">
                      <Avatar name={x.name_from === 'id' ? '#' : x.name} />
                      <span className="cu-side">
                        <b className={x.name_from === 'id' ? 'cu-noname' : undefined}>{x.name}</b>
                        <small>
                          {x.sources.length} system{x.sources.length === 1 ? '' : 's'}
                          {x.name_from === 'raw' && ' · name fails its rule'}
                          {x.name_from === 'id' && ' · no name in any system'}
                        </small>
                      </span>
                    </span>
                  </td>
                  <td data-label="Trust score">
                    <span className="dq-filled">
                      <Bar value={x.score ?? 0} tone={barTone(x.score)} />
                      <b className="num">{x.score ?? '—'}</b>
                      <Pill tone={toneOf(x.band)}>{x.band}</Pill>
                    </span>
                  </td>
                  <td data-label="Found in">
                    <span className="tr-chips">
                      {x.sources.map((s) => (
                        <span key={`${s.source}:${s.key}`} className="tr-chip" title={`${s.source} · ${s.key}`}>
                          {s.source} <b>{s.score ?? '—'}</b>
                        </span>
                      ))}
                    </span>
                  </td>
                  <td data-label="Status">
                    {x.holds.length ? (
                      <span title={x.holds.join('. ')}>
                        <Pill tone="warn">Needs review</Pill>
                      </span>
                    ) : x.approved ? (
                      <Pill tone="ok">Approved</Pill>
                    ) : (
                      <Pill tone="plain">Proposed</Pill>
                    )}
                  </td>
                  <td className="dq-go">
                    <Icon name="chevron-right" size={16} />
                  </td>
                </tr>
              ))}
              {d.results.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted sx-empty">
                    No customer matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={pages} onPage={setPage} text={`${n(d.count)} customers`} />
      </section>
    </>
  )
}
