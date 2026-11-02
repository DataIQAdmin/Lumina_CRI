import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { ProfileCheck } from '../api/types'
import { useApi } from '../api/useApi'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { QualityRing } from '../components/QualityRing'
import { SourceTables } from '../components/SourceTables'
import { Card, EmptyState, ErrorAlert, PageHeader } from '../components/ui'

// A chosen bar: "<check key>:<value>", the form the API takes.
type Pick = string
type Tone = 'good' | 'info' | 'fix' | 'bad' | 'empty'

// How serious each kind of value is. Good: nothing to do. Info: worth knowing (a title). Fixable: Lumina's
// cleaning or a simple rule can correct it. Invalid: a person has to fix it at the source. Empty: missing.
const GOOD = new Set([
  'Valid', '10 digits', 'Plain digits', '10 characters', 'Normal', 'M / F', 'Filled', 'No title', 'Full name',
  'Resident / NRI / Foreign national',
])
const BAD = new Set([
  'Invalid', 'Wrong pattern', 'Missing @', 'Missing domain', 'In the future', 'Over 100 years', 'Unreadable',
  'Contains letters', 'Other length', '9 digits', 'No digits', '9 characters', '11 characters', 'Contains digits',
  'Other', 'Unknown',
])
const INFO = new Set(['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Shri', 'Smt', 'Kumari'])
const TONE_ORDER: Tone[] = ['bad', 'fix', 'empty', 'info', 'good']
const TONE_LABEL: Record<Tone, string> = {
  bad: 'Invalid',
  fix: 'Fixable',
  empty: 'Empty',
  info: 'Worth knowing',
  good: 'Good',
}

function toneOf(value: string): Tone {
  if (value === 'Empty') return 'empty'
  if (GOOD.has(value)) return 'good'
  if (BAD.has(value)) return 'bad'
  if (INFO.has(value)) return 'info'
  return 'fix'
}

// Share of records whose value needs nothing (good or worth knowing), for one check.
function cleanShare(check: ProfileCheck) {
  const ok = check.values.filter((v) => ['good', 'info'].includes(toneOf(v.value))).reduce((n, v) => n + v.count, 0)
  return check.records ? (100 * ok) / check.records : 0
}

function needsAttention(check: ProfileCheck) {
  return check.values.filter((v) => ['bad', 'fix', 'empty'].includes(toneOf(v.value))).reduce((n, v) => n + v.count, 0)
}

type Column = { name: string; checks: ProfileCheck[]; score: number; issues: number }

const SHOWN: { field: 'name' | 'mobile' | 'pan' | 'email' | 'dob' | 'gender' | 'country' | 'residency'; label: string }[] = [
  { field: 'name', label: 'Name' },
  { field: 'mobile', label: 'Mobile' },
  { field: 'pan', label: 'PAN' },
  { field: 'email', label: 'Email' },
  { field: 'dob', label: 'Date of birth' },
  { field: 'gender', label: 'Gender' },
  { field: 'country', label: 'Country' },
  { field: 'residency', label: 'Residency' },
]

type View = 'tables' | 'fields'

// Data profiling. Source tables: every table of a connector, read whole as the system holds it (the raw layer).
// Customer fields: the checks on the columns each connector maps to Lumina's customer fields.
export function ProfilingPage() {
  const [params, setParams] = useSearchParams()
  const view: View = params.get('view') === 'fields' ? 'fields' : 'tables'
  const setView = (next: View) => setParams({ view: next })
  const switcher = (
    <div className="segmented" role="group" aria-label="Profile by">
      <button type="button" aria-pressed={view === 'tables'} onClick={() => setView('tables')}>
        Source tables
      </button>
      <button type="button" aria-pressed={view === 'fields'} onClick={() => setView('fields')}>
        Customer fields
      </button>
    </div>
  )
  if (view === 'fields') return <CustomerFieldsProfile switcher={switcher} />
  return (
    <>
      <PageHeader
        title="Data profiling"
        description="Pick a connector, read its tables, then open a table to see its rows as the system holds them."
        actions={switcher}
      />
      <SourceTables />
    </>
  )
}

// How each mapped column looks as the bank's systems send it, before Lumina cleans it.
// The scorecard picks a column; bars inside it filter the records, which open in a side panel.
function CustomerFieldsProfile({ switcher }: { switcher: ReactNode }) {
  const [source, setSource] = useState('all')
  const [column, setColumn] = useState<string | null>(null)
  const [picks, setPicks] = useState<Pick[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const summary = useApi(() => api.profiling(source), [source])

  const columns = useMemo<Column[]>(() => {
    const byName = new Map<string, ProfileCheck[]>()
    for (const c of summary.data?.checks ?? []) byName.set(c.column, [...(byName.get(c.column) ?? []), c])
    return [...byName.entries()].map(([name, checks]) => ({
      name,
      checks,
      score: checks.reduce((s, c) => s + cleanShare(c), 0) / checks.length,
      issues: Math.max(...checks.map(needsAttention)),
    }))
  }, [summary.data])

  const overall = columns.length ? columns.reduce((s, c) => s + c.score, 0) / columns.length : 0
  // Problems found, counted per check, and the biggest ones across every column.
  const { totals, topIssues } = useMemo(() => {
    const sum: Record<Tone, number> = { bad: 0, fix: 0, empty: 0, info: 0, good: 0 }
    const issues: { pick: Pick; column: string; label: string; value: string; count: number; tone: Tone }[] = []
    for (const c of summary.data?.checks ?? []) {
      for (const v of c.values) {
        const tone = toneOf(v.value)
        sum[tone] += v.count
        if (tone === 'bad' || tone === 'fix' || tone === 'empty') {
          issues.push({ pick: `${c.key}:${v.value}`, column: c.column, label: c.label, value: v.value, count: v.count, tone })
        }
      }
    }
    issues.sort((a, b) => b.count - a.count || TONE_ORDER.indexOf(a.tone) - TONE_ORDER.indexOf(b.tone))
    return { totals: sum, topIssues: issues.slice(0, 5) }
  }, [summary.data])
  const active = columns.find((c) => c.name === column) ?? columns[0]

  const toggle = (pick: Pick) => {
    const adding = !picks.includes(pick)
    setPicks((p) => (adding ? [...p, pick] : p.filter((x) => x !== pick)))
    if (adding) setPanelOpen(true)
  }
  const labelOf = (pick: Pick) => {
    const key = pick.slice(0, pick.indexOf(':'))
    const value = pick.slice(pick.indexOf(':') + 1)
    const check = summary.data?.checks.find((c) => c.key === key)
    return check ? `${check.column} ${check.label.toLowerCase()}: ${value}` : value
  }

  const data = summary.data

  return (
    <>
      <PageHeader
        title="Data profiling"
        description="How each column looks as your systems send it, before Lumina cleans it."
        actions={
          <>
            {switcher}
            <select
              className="select"
              aria-label="Systems to profile"
              value={source}
              onChange={(e) => {
                setSource(e.target.value)
                setPicks([])
                setPanelOpen(false)
              }}
            >
              <option value="all">All connected systems</option>
              {data?.sources.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
          </>
        }
      />

      {summary.error && <ErrorAlert message={summary.error} />}
      {!data && !summary.error && (
        <div className="card">
          <Loader kind="scan" label="Profiling the records" />
        </div>
      )}

      {data && data.profiled === 0 && (
        <Card>
          <EmptyState icon="search" title="Nothing profiled yet">
            Records are profiled when a connector syncs. Open Connectors and click Sync now once on each system.
          </EmptyState>
        </Card>
      )}

      {data && data.profiled > 0 && active && (
        <>
          <section className="dq-health card" aria-label="Data health">
            <div className="dq-health-score">
              <QualityRing score={overall} size={128} />
              <div className="stack" style={{ gap: 6, minWidth: 0 }}>
                <span className="dq-eyebrow">Data health</span>
                <strong className="dq-health-title">
                  {overall >= 85 ? 'In good shape' : overall >= 60 ? 'Needs some attention' : 'Needs attention'}
                </strong>
                <span className="text-sm muted">
                  {data.records.toLocaleString('en-IN')} records across {columns.length} columns
                  {data.profiled < data.records && ` · ${data.records - data.profiled} not profiled yet`}
                </span>
                <div className="dq-totals">
                  {(['bad', 'fix', 'empty'] as Tone[]).map((t) => (
                    <span key={t} className={`dq-total is-${t}`}>
                      <strong className="num">{totals[t].toLocaleString('en-IN')}</strong> {TONE_LABEL[t].toLowerCase()}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="dq-top">
              <span className="dq-eyebrow">Top issues</span>
              <ol className="dq-top-list">
                {topIssues.map((i) => (
                  <li key={i.pick}>
                    <button type="button" className={`dq-top-item${picks.includes(i.pick) ? ' is-on' : ''}`} onClick={() => { setColumn(i.column); toggle(i.pick) }}>
                      <i className={`dq-dot is-${i.tone}`} aria-label={TONE_LABEL[i.tone]} />
                      <span className="dq-top-text">
                        <strong>{i.column}</strong> <span className="muted">{i.label.toLowerCase()}:</span> {i.value}
                      </span>
                      <span className="num dq-top-count">{i.count.toLocaleString('en-IN')}</span>
                      <Icon name="chevronRight" size={14} />
                    </button>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="dq-scorecard" aria-label="Data quality by column">
            <div className="dq-tiles" role="tablist" aria-label="Columns">
              {columns.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  role="tab"
                  aria-selected={c.name === active.name}
                  className={`dq-tile${c.name === active.name ? ' is-active' : ''}`}
                  onClick={() => setColumn(c.name)}
                >
                  <QualityRing score={c.score} size={52} />
                  <span className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <span className="dq-tile-name">{c.name}</span>
                    <span className="text-xs muted">
                      {c.issues ? `${c.issues.toLocaleString('en-IN')} issue${c.issues === 1 ? '' : 's'}` : 'All clean'}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>

          <div className="dq-legend" aria-label="Colour key">
            {TONE_ORDER.map((t) => (
              <span key={t}>
                <i className={`dq-dot is-${t}`} /> {TONE_LABEL[t]}
              </span>
            ))}
            {picks.length > 0 && (
              <button type="button" className="btn btn-primary btn-sm dq-open" onClick={() => setPanelOpen(true)}>
                <Icon name="search" size={14} /> Show matching records ({picks.length} filter{picks.length === 1 ? '' : 's'})
              </button>
            )}
          </div>

          <div className="dq-checks" role="tabpanel" aria-label={active.name}>
            {active.checks.map((check) => (
              <CheckCard key={check.key} check={check} picks={picks} onToggle={toggle} />
            ))}
          </div>
        </>
      )}

      {panelOpen && picks.length > 0 && (
        <RecordsPanel
          source={source}
          picks={picks}
          labelOf={labelOf}
          onRemove={(p) => toggle(p)}
          onClear={() => {
            setPicks([])
            setPanelOpen(false)
          }}
          onClose={() => setPanelOpen(false)}
        />
      )}
    </>
  )
}

function CheckCard({ check, picks, onToggle }: { check: ProfileCheck; picks: Pick[]; onToggle: (p: Pick) => void }) {
  const values = [...check.values].sort(
    (a, b) => TONE_ORDER.indexOf(toneOf(a.value)) - TONE_ORDER.indexOf(toneOf(b.value)) || b.count - a.count,
  )
  return (
    <Card
      title={check.label}
      description={`${check.records.toLocaleString('en-IN')} records · ${Math.round(cleanShare(check))}% clean`}
    >
      <div className="dq-stack" aria-hidden="true">
        {values.map((v) => (
          <i key={v.value} className={`is-${toneOf(v.value)}`} style={{ width: `${v.share}%` }} title={`${v.value}: ${v.share}%`} />
        ))}
      </div>
      <ul className="profile-bars">
        {values.map((v) => {
          const pick = `${check.key}:${v.value}`
          const on = picks.includes(pick)
          const tone = toneOf(v.value)
          return (
            <li key={v.value}>
              <button type="button" className={`profile-bar${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => onToggle(pick)}>
                <span className="profile-bar-label">
                  <i className={`dq-dot is-${tone}`} aria-label={TONE_LABEL[tone]} /> {v.value}
                </span>
                <span className="profile-bar-track" aria-hidden="true">
                  <i className={`is-${tone}`} style={{ width: `${Math.max(v.share, 1.5)}%` }} />
                </span>
                <span className="profile-bar-count num">
                  {v.count.toLocaleString('en-IN')} <span className="muted">· {v.share}%</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function RecordsPanel({
  source,
  picks,
  labelOf,
  onRemove,
  onClear,
  onClose,
}: {
  source: string
  picks: Pick[]
  labelOf: (p: Pick) => string
  onRemove: (p: Pick) => void
  onClear: () => void
  onClose: () => void
}) {
  const key = picks.join('|')
  const [view, setView] = useState({ key, all: false, page: 1 })
  // A different set of filters starts again at the first 10.
  const current = view.key === key ? view : { key, all: false, page: 1 }
  const setAll = (all: boolean) => setView({ key, all, page: 1 })
  const setPage = (page: number) => setView({ ...current, page })
  const records = useApi(
    () => api.profilingRecords(source, picks, current.page, current.all ? 50 : 10),
    [source, key, current.all, current.page],
  )
  const r = records.data
  const pages = r ? Math.max(1, Math.ceil(r.count / r.page_size)) : 1
  // The fields the chosen checks are about ("mobile.digits" is about mobile), with how serious the pick is.
  const flagged: Partial<Record<string, Tone>> = {}
  for (const p of picks) flagged[p.slice(0, p.indexOf('.'))] = toneOf(p.slice(p.indexOf(':') + 1))

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      <div className="dq-backdrop" onClick={onClose} aria-hidden="true" />
      <aside className="dq-panel" role="dialog" aria-label="Matching records">
        <header className="dq-panel-head">
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <h2>Matching records</h2>
            <span className="text-sm muted">
              {r
                ? `Showing ${r.results.length} of ${r.count.toLocaleString('en-IN')}${r.masked ? ' · contact details masked for your role' : ''}`
                : 'Finding the records'}
            </span>
          </div>
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close">
            <Icon name="x" size={14} />
          </button>
        </header>
        <div className="dq-panel-chips">
          {picks.map((p) => (
            <button key={p} type="button" className="filter-chip" onClick={() => onRemove(p)}>
              {labelOf(p)} <Icon name="x" size={12} />
            </button>
          ))}
          <button type="button" className="link" onClick={onClear}>
            Clear all
          </button>
        </div>
        <div className="dq-panel-body">
          {records.error && <ErrorAlert message={records.error} />}
          {!r && !records.error && <Loader kind="scan" label="Finding the records" size={44} />}
          {r && r.count === 0 && (
            <EmptyState icon="search" title="No record matches all of these">
              Remove a filter to widen the search.
            </EmptyState>
          )}
          {r && r.count > 0 && (
            <ul className="dq-records">
              {r.results.map((row) => (
                <li key={row.id} className="dq-record">
                  <div className="dq-record-head">
                    <span className="mono text-sm">{row.record_id}</span>
                    <span className="text-xs muted">{row.source_name}</span>
                    {row.customer && (
                      <Link to={`/customers/${row.customer.id}`} className="link mono text-sm">
                        {row.customer.code}
                      </Link>
                    )}
                  </div>
                  <dl className="dq-record-values">
                    {SHOWN.filter((s) => row.values[s.field] || flagged[s.field]).map((s) => (
                      <div key={s.field} className={flagged[s.field] ? `is-flagged is-${flagged[s.field]}` : undefined}>
                        <dt>{s.label}</dt>
                        <dd className={s.field === 'name' ? undefined : 'mono'}>
                          {row.values[s.field] || <span className="muted">(empty)</span>}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </li>
              ))}
            </ul>
          )}
        </div>
        {r && r.count > 10 && (
          <footer className="dq-panel-foot">
            {current.all ? (
              <>
                <button type="button" className="btn btn-sm" onClick={() => setAll(false)}>
                  Show first 10
                </button>
                {pages > 1 && (
                  <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <button type="button" className="btn btn-sm" disabled={current.page <= 1} onClick={() => setPage(current.page - 1)}>
                      Previous
                    </button>
                    <span className="text-sm muted">
                      {current.page} / {pages}
                    </span>
                    <button type="button" className="btn btn-sm" disabled={current.page >= pages} onClick={() => setPage(current.page + 1)}>
                      Next
                    </button>
                  </div>
                )}
              </>
            ) : (
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setAll(true)}>
                See all {r.count.toLocaleString('en-IN')} records
              </button>
            )}
          </footer>
        )}
      </aside>
    </>
  )
}
