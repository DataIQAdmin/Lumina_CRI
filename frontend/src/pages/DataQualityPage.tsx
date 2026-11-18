import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { RawSource, Source } from '../api/types'
import { useApi } from '../api/useApi'
import { useCan } from '../auth/AuthContext'
import { ConnectorLogo } from '../components/ConnectorLogo'
import { Dialog } from '../components/Dialog'
import { Bar, Head, PER_PAGE, Pager } from '../components/dq/kit'
import { WorkStep } from '../components/dq/WorkStep'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { n, Pill } from '../components/Lx'
import { EmptyState, ErrorAlert } from '../components/ui'
import { profileJob } from '../profileJob'

type Step = 'tables' | 'profiling' | 'rules' | 'silver'
const ORDER: Step[] = ['tables', 'profiling', 'rules', 'silver']

// Data quality as one straight line: choose a source and tables, then profile, apply rules, and inspect silver rows.
// Everything lives in the address (source, step, the chosen
// tables as t, the open table), so each step can be linked to and the browser's back button works.
export function DataQualityPage() {
  const raw = useApi(() => api.rawSources(), [])
  const all = useApi(() => api.sources(), [])
  const [params, setParams] = useSearchParams()
  const [notYet, setNotYet] = useState<'source' | 'tables' | null>(null)
  const job = useSyncExternalStore(profileJob.subscribe, profileJob.get)
  const canManage = useCan('manage_sources')

  // When a check ends, show what it found.
  const ended = job?.finished ?? null
  useEffect(() => {
    if (ended) raw.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended])

  if (raw.error) return <ErrorAlert message={raw.error} />
  if (!raw.data) return <Loader kind="scan" label="Loading sources" />

  const sources = raw.data.sources
  const src = sources.find((s) => s.code === params.get('source'))
  const single = params.get('table')
  let list = params.getAll('t')
  if (!list.length && single) list = [single] // links from Home, search and the regex library open one table
  const legacyTab = params.get('tab')
  const asked = (params.get('step') ?? (legacyTab === 'fix' ? 'rules' : legacyTab === 'clean' ? 'silver' : null)) as Step | null
  const step: Step = !src ? 'tables' : asked && ORDER.includes(asked) && (asked === 'tables' || list.length) ? asked : single ? 'profiling' : 'tables'
  const at = !src ? 0 : ORDER.indexOf(step) + 1
  const current = list.includes(single ?? '') ? single! : list[0]
  const column = params.get('column')
  const ask = column ? { column, regex: params.get('regex') ?? '' } : null

  const go = (next: Step, extra: Record<string, string> = {}, tables = list) => {
    const p = new URLSearchParams({ source: src!.code, step: next })
    tables.forEach((t) => p.append('t', t))
    Object.entries(extra).forEach(([k, v]) => p.set(k, v))
    setParams(p)
  }
  const toStep = (i: number) => {
    if (i === at) return
    if (i === 0) return setParams({})
    if (!src) return setNotYet('source')
    if (i > 1 && !list.length) return setNotYet('tables')
    go(ORDER[i - 1], i === 2 && current ? { table: current } : {})
  }

  const steps = [
    { title: 'Source', detail: src?.name ?? 'Where the data lives' },
    { title: 'Tables', detail: list.length ? `${list.length} chosen` : 'What to work on' },
    { title: 'Profiling', detail: step === 'profiling' && current ? current : 'Inspect column values' },
    { title: 'Rules', detail: step === 'rules' && current ? current : 'Validate each column' },
    { title: 'Silver layer', detail: step === 'silver' && current ? current : 'Review processed rows' },
  ]
  const flow = (
    <nav className="dq-flow is-five" aria-label="Steps">
      {steps.map((s, i) => (
        <button key={s.title} type="button" className={i < at ? 'is-done' : i === at ? 'is-now' : undefined} aria-current={i === at ? 'step' : undefined} onClick={() => toStep(i)}>
          <i>{i < at ? <Icon name="check" size={13} /> : i + 1}</i>
          <span>
            <b>{s.title}</b>
            <small>{s.detail}</small>
          </span>
        </button>
      ))}
    </nav>
  )
  const trail = src && (
    <nav className="dq-trail" aria-label="You are here">
      <button type="button" onClick={() => setParams({})}>
        Data quality
      </button>
      <Icon name="chevron-right" size={13} />
      <b>{src.name}</b>
    </nav>
  )
  const info = (code: string) => all.data?.results.find((s) => s.code === code)

  let page: ReactNode
  if (!src) {
    page = (
      <>
        <Head title="Data quality" text="Profile your source data, apply column rules, and review the resulting silver layer." />
        {flow}
        {sources.length === 0 ? (
          <section className="card">
            <EmptyState icon="connectors" title="No sources yet">
              <Link to="/sources">Add a source</Link> first.
            </EmptyState>
          </section>
        ) : (
          <div className="dq-srcgrid">
            {sources.map((s) => (
              <SourceCard key={s.code} source={s} info={info(s.code)} onOpen={() => setParams({ source: s.code, step: 'tables' })} />
            ))}
          </div>
        )}
      </>
    )
  } else if (step === 'tables') {
    page = (
      <>
        {trail}
        <Head title={src.name} text="Tick the tables to work on, in the order you want them. Tables not checked yet are checked when you continue." />
        {flow}
        <TablesStep
          key={`${src.code}:${ended ?? ''}`}
          source={src}
          chosen={list}
          canRead={raw.data.can_read}
          onContinue={(tables) => go('profiling', { table: tables[0] }, tables)}
        />
      </>
    )
  } else {
    page = (
      <>
        {trail}
        <Head title={step === 'profiling' ? 'Data profiling' : step === 'rules' ? 'Column rules' : 'Silver layer'} text={step === 'profiling' ? 'Review completeness, uniqueness, value patterns, and the source rows behind each count.' : step === 'rules' ? 'Apply and manage regular expression rules on each selected table and column.' : 'Inspect rows that passed the rules and rows held back for review.'} />
        {flow}
        <WorkStep
          key={`${src.code}:${ended ?? ''}`}
          source={src}
          list={list}
          current={current}
          stage={step}
          canRead={raw.data.can_read}
          canViewRows={raw.data.can_view_rows}
          canManage={canManage}
          ask={ask}
          onOpen={(t) => go(step, { table: t })}
          onTables={() => go('tables')}
          onDone={() => {
            if (step !== 'silver') go(step === 'profiling' ? 'rules' : 'silver', { table: current })
          }}
        />
      </>
    )
  }

  return (
    <>
      {page}
      {notYet && (
        <Dialog
          size="sm"
          title={notYet === 'source' ? 'Select a source first' : 'Choose tables first'}
          onClose={() => setNotYet(null)}
          footer={
            <button type="button" className="btn btn-primary" onClick={() => setNotYet(null)}>
              {notYet === 'source' ? 'Choose a source' : 'Choose tables'}
            </button>
          }
        >
          <p className="rd-lead">
            {notYet === 'source' ? 'Choose the source you want to work on. Its tables appear next.' : 'Tick one or more tables of this source and press Continue.'}
          </p>
        </Dialog>
      )}
    </>
  )
}

// ---------------- step 1: sources ----------------

function SourceCard({ source, info, onOpen }: { source: RawSource; info?: Source; onOpen: () => void }) {
  const tables = useApi(() => api.rawTables(source.code), [source.code])
  const list = tables.data?.tables ?? []
  const toFix = list.reduce((a, t) => a + (t.to_check ?? 0), 0)
  const quality = list.length ? Math.round(list.reduce((a, t) => a + (t.filled ?? 100), 0) / list.length) : null
  return (
    <button type="button" className="card dq-srccard" disabled={!source.enabled} onClick={onOpen}>
      <span className="sx-src">
        <ConnectorLogo type={source.connector_type} size={36} />
        <span>
          <b>{source.name}</b>
          <small>{info?.connector_label ?? ''}</small>
        </span>
      </span>
      <Bar value={quality ?? 0} tone={quality === null ? undefined : quality >= 90 ? 'good' : 'warn'} />
      <span className="dq-facts">
        <span>
          <b>{quality === null ? '—' : `${quality}%`}</b>filled
        </span>
        <span>
          <b>{tables.data ? n(list.length) : '…'}</b>tables checked
        </span>
        <span>
          <b className={toFix ? 'is-bad-text' : undefined}>{tables.data ? n(toFix) : '…'}</b>to fix
        </span>
      </span>
      {!source.enabled && <Pill tone="warn">Switched off</Pill>}
    </button>
  )
}

// ---------------- step 2: tables ----------------

function TablesStep({ source, chosen, canRead, onContinue }: { source: RawSource; chosen: string[]; canRead: boolean; onContinue: (tables: string[]) => void }) {
  const checked = useApi(() => api.rawTables(source.code), [source.code])
  const [names, setNames] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ticked, setTicked] = useState<string[]>(chosen)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const busy = useSyncExternalStore(profileJob.subscribe, profileJob.running)

  useEffect(() => {
    if (!canRead) return
    api.rawDiscover(source.code).then((f) => setNames(f.tables), (e: Error) => setError(e.message))
  }, [source.code, canRead])

  const done = checked.data?.tables ?? []
  const info = (t: string) => done.find((d) => d.name === t)
  const all = Array.from(new Set([...(names ?? []), ...done.map((t) => t.name)]))
  const shown = all.filter((t) => t.toLowerCase().includes(q.trim().toLowerCase()))
  const pages = Math.max(1, Math.ceil(shown.length / (PER_PAGE * 2)))
  const slice = shown.slice((page - 1) * PER_PAGE * 2, page * PER_PAGE * 2)
  const canTick = (t: string) => canRead || !!info(t)
  const toggle = (t: string) => canTick(t) && setTicked((old) => (old.includes(t) ? old.filter((x) => x !== t) : [...old, t]))
  const unchecked = ticked.filter((t) => !info(t))
  const go = () => {
    if (unchecked.length && canRead) profileJob.start(source.code, source.name, unchecked)
    onContinue(ticked)
  }

  return (
    <section className="card">
      <div className="hm-h">
        <label className="lx-search">
          <Icon name="search" size={15} />
          <input
            placeholder="Search tables"
            aria-label="Search tables"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </label>
        <div className="row">
          {ticked.length > 0 && (
            <button type="button" className="btn" onClick={() => setTicked([])}>
              Clear
            </button>
          )}
          <button type="button" className="btn btn-primary" disabled={!ticked.length || (unchecked.length > 0 && busy)} onClick={go}>
            Continue with {ticked.length || ''} {ticked.length === 1 ? 'table' : 'tables'} →
          </button>
        </div>
      </div>
      {unchecked.length > 0 && (
        <p className="muted text-sm dq-pad dq-note">
          {unchecked.length} ticked {unchecked.length === 1 ? 'table is' : 'tables are'} not checked yet and will be checked when you continue.
        </p>
      )}
      {error && <p className="sx-error hm-empty">{error}</p>}
      {!checked.data || (canRead && names === null && !error) ? (
        <Loader kind="scan" label="Asking the source for its tables" />
      ) : (
        <div className="table-wrap">
          <table className="sx-table">
            <thead>
              <tr>
                <th style={{ width: 56 }}>Order</th>
                <th>Table</th>
                <th>Rows</th>
                <th>Filled</th>
                <th>Needs attention</th>
              </tr>
            </thead>
            <tbody>
              {slice.map((t) => {
                const d = info(t)
                const at = ticked.indexOf(t)
                return (
                  <tr key={t} tabIndex={0} className={at >= 0 ? 'is-ticked' : undefined} aria-disabled={!canTick(t)} onClick={() => toggle(t)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(t)}>
                    <td>
                      <span className={`dq-order${at >= 0 ? ' is-on' : ''}`} aria-label={at >= 0 ? `Number ${at + 1}` : 'Not ticked'}>
                        {at >= 0 ? at + 1 : ''}
                      </span>
                    </td>
                    <td className="is-main">
                      <b className="dq-name">{t}</b>
                    </td>
                    <td data-label="Rows" className="num muted">{d ? n(d.rows) : '—'}</td>
                    <td data-label="Filled">
                      {d ? (
                        <span className="dq-filled">
                          <Bar value={d.filled ?? 100} tone={(d.filled ?? 100) >= 95 ? 'good' : 'warn'} />
                          <span className="num text-sm">{d.filled ?? 100}%</span>
                        </span>
                      ) : (
                        <span className="muted">Not checked</span>
                      )}
                    </td>
                    <td>{d ? d.to_check ? <Pill tone="warn">{d.to_check} column{d.to_check === 1 ? '' : 's'}</Pill> : <Pill tone="ok">All fine</Pill> : '—'}</td>
                  </tr>
                )
              })}
              {slice.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted sx-empty">
                    No table matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={pages} onPage={setPage} text={`${n(shown.length)} of ${n(all.length)} tables · ${ticked.length} ticked`} />
    </section>
  )
}
