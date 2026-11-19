import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { RawSource, Source } from '../api/types'
import { useApi } from '../api/useApi'
import { useCan } from '../auth/AuthContext'
import { ConnectorLogo } from '../components/ConnectorLogo'
import { Bar, Head, PER_PAGE, Pager } from '../components/dq/kit'
import { WorkStep } from '../components/dq/WorkStep'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { n, Pill } from '../components/Lx'
import { EmptyState, ErrorAlert } from '../components/ui'
import { profileJob } from '../profileJob'

type Stage = 'profiling' | 'rules' | 'silver'
type View = 'connectors' | 'workspace' | 'tables' | 'detail'
type Step = 'tables' | Stage

// Each destination owns its own source and table selection. Selection state stays in the URL so links and browser
// history keep the user's place inside that destination.
export function DataQualityPage({ stage }: { stage: Stage }) {
  const raw = useApi(() => api.rawSources(), [])
  const all = useApi(() => api.sources(), [])
  const [params, setParams] = useSearchParams()
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
  const view: View = !src ? 'connectors' : params.get('step') === 'tables' ? 'tables' : list.length ? 'detail' : 'workspace'
  const at = view === 'tables' ? 1 : 2
  const current = list.includes(single ?? '') ? single! : list[0]
  const column = params.get('column')
  const ask = column ? { column, regex: params.get('regex') ?? '' } : null

  const go = (next: Step, extra: Record<string, string> = {}, tables = list) => {
    const p = new URLSearchParams({ source: src!.code, step: next })
    tables.forEach((t) => p.append('t', t))
    Object.entries(extra).forEach(([k, v]) => p.set(k, v))
    setParams(p)
  }
  const stageName = stage === 'profiling' ? 'Data profiling' : stage === 'rules' ? 'Rules' : 'Silver layer'
  const steps = [
    { title: 'Source', detail: src?.name ?? 'Where the data lives' },
    { title: 'Tables', detail: list.length ? `${list.length} chosen` : 'Choose tables to inspect' },
    { title: stageName, detail: current ?? (stage === 'profiling' ? 'Inspect column values' : stage === 'rules' ? 'Validate each column' : 'Review processed rows') },
  ]
  const flow = (
    <nav className="dq-flow" aria-label={`${stageName} workflow`}>
      {steps.map((s, i) => (
        <div key={s.title} className={i < at ? 'is-done' : i === at ? 'is-now' : undefined} aria-current={i === at ? 'step' : undefined}>
          <i>{i < at ? <Icon name="check" size={13} /> : i + 1}</i>
          <span>
            <b>{s.title}</b>
            <small>{s.detail}</small>
          </span>
        </div>
      ))}
    </nav>
  )
  const trail = src && (
    <nav className="dq-trail" aria-label="You are here">
      <button type="button" onClick={() => setParams({})}>
        {stageName}
      </button>
      <Icon name="chevron-right" size={13} />
      <b>{src.name}</b>
    </nav>
  )
  const info = (code: string) => all.data?.results.find((s) => s.code === code)

  let page: ReactNode
  if (view === 'connectors') {
    page = (
      <>
        <Head title={stageName} text={stage === 'profiling' ? 'Explore column completeness, distinct values, and the rows behind every count.' : stage === 'rules' ? 'Choose tables and apply regular expression rules to individual columns.' : 'Review rows that passed column rules and rows held back.'} />
        {sources.length === 0 ? (
          <section className="card">
            <EmptyState icon="connectors" title="No sources yet">
              <Link to="/sources">Add a source</Link> first.
            </EmptyState>
          </section>
        ) : (
          <div className="dq-srcgrid">
            {sources.map((s) => (
              <SourceCard key={`${s.code}:${ended ?? ''}`} source={s} info={info(s.code)} stage={stage} canManage={canManage} onOpen={() => setParams({ source: s.code })} />
            ))}
          </div>
        )}
      </>
    )
  } else if (view === 'workspace' && src) {
    page = (
      <>
        {trail}
        <ConnectorWorkspace
          key={`${src.code}:${stage}:${ended ?? ''}`}
          source={src}
          stage={stage}
          canManage={canManage}
          onSelectTables={() => setParams({ source: src.code, step: 'tables' })}
          onOpenTable={(table, tables) => {
            const p = new URLSearchParams({ source: src.code, step: stage, table })
            tables.forEach((name) => p.append('t', name))
            setParams(p)
          }}
        />
      </>
    )
  } else if (view === 'tables' && src) {
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
          onContinue={(tables) => go(stage, { table: tables[0] }, tables)}
        />
      </>
    )
  } else if (src) {
    page = (
      <>
        {trail}
        <Head title={stageName} text={stage === 'profiling' ? 'Review completeness, uniqueness, value patterns, and the source rows behind each count.' : stage === 'rules' ? 'Apply and manage regular expression rules on each selected table and column.' : 'Inspect rows that passed the rules and rows held back for review.'} />
        <WorkStep
          key={`${src.code}:${ended ?? ''}`}
          source={src}
          list={list}
          current={current}
          stage={stage}
          canRead={raw.data.can_read}
          canViewRows={raw.data.can_view_rows}
          canManage={canManage}
          ask={ask}
          onOpen={(t) => go(stage, { table: t })}
          onTables={() => setParams({ source: src.code })}
        />
      </>
    )
  } else {
    page = <ErrorAlert message="This connector is unavailable. Choose a connector to continue." />
  }

  return <>{page}</>
}

// ---------------- step 1: sources ----------------

function SourceCard({ source, info, stage, canManage, onOpen }: { source: RawSource; info?: Source; stage: Stage; canManage: boolean; onOpen: () => void }) {
  const tables = useApi(() => api.rawTables(source.code), [source.code])
  const list = tables.data?.tables ?? []
  const silver = useApi(() => (canManage && stage !== 'profiling' ? api.silverTables(source.code) : Promise.resolve(null)), [source.code, stage, canManage])
  const clean = silver.data?.tables.filter((t) => t.rules > 0) ?? []
  const ruleCount = clean.reduce((sum, table) => sum + table.rules, 0)
  const summaryReady = !!tables.data && (stage === 'profiling' || !canManage || !!silver.data || !!silver.error)
  const status = !tables.data || (stage !== 'profiling' && canManage && !silver.data && !silver.error) ? 'Loading status…' : stage === 'profiling'
    ? list.length ? `${n(list.length)} profiled` : 'Not profiled yet'
    : !canManage ? 'Access restricted'
      : !list.length ? 'Not profiled yet'
        : stage === 'rules' ? clean.length ? `${n(clean.length)} tables with rules` : 'No rules applied'
          : clean.length ? `${n(clean.length)} silver tables` : 'Apply rules first'
  const facts = stage === 'profiling'
    ? [{ value: n(list.length), label: 'profiled tables' }, { value: n(list.reduce((sum, table) => sum + table.rows, 0)), label: 'source rows' }]
    : stage === 'rules'
      ? [{ value: n(clean.length), label: 'tables with rules' }, { value: n(ruleCount), label: 'column rules' }]
      : [{ value: n(clean.reduce((sum, table) => sum + table.passed, 0)), label: 'silver rows' }, { value: n(clean.reduce((sum, table) => sum + table.rejected, 0)), label: 'held back' }]
  return (
    <button type="button" className="card dq-srccard" disabled={!source.enabled} onClick={onOpen}>
      <span className="sx-src">
        <ConnectorLogo type={source.connector_type} size={36} />
        <span>
          <b>{source.name}</b>
          <small>{info?.connector_label ?? ''}</small>
        </span>
      </span>
      <span className="dq-facts">
        {facts.map((fact) => <span key={fact.label}><b>{!summaryReady ? '…' : stage !== 'profiling' && !canManage ? '—' : fact.value}</b>{fact.label}</span>)}
      </span>
      <Pill tone={status === 'Loading status…' ? 'plain' : stage === 'profiling' ? list.length ? 'ok' : 'plain' : clean.length ? 'ok' : 'warn'}>{status}</Pill>
      <span className="dq-card-action">{stage === 'profiling' ? list.length ? 'View profiles' : 'Profile tables' : stage === 'rules' ? 'Configure rules' : clean.length ? 'View silver tables' : 'Apply rules'} <Icon name="chevron-right" size={15} /></span>
      {!source.enabled && <Pill tone="warn">Switched off</Pill>}
    </button>
  )
}

function ConnectorWorkspace({ source, stage, canManage, onSelectTables, onOpenTable }: {
  source: RawSource
  stage: Stage
  canManage: boolean
  onSelectTables: () => void
  onOpenTable: (table: string, tables: string[]) => void
}) {
  const raw = useApi(() => api.rawTables(source.code), [source.code])
  const silver = useApi(() => (canManage && stage !== 'profiling' ? api.silverTables(source.code) : Promise.resolve(null)), [source.code, stage, canManage])
  const tables = raw.data?.tables ?? []
  const layer = new Map((silver.data?.tables ?? []).map((table) => [table.name, table]))
  const stageName = stage === 'profiling' ? 'Profiled tables' : stage === 'rules' ? 'Rules by table' : 'Silver layer tables'
  const action = stage === 'profiling' ? 'Profile new tables' : 'Apply rules'
  const hasRules = [...layer.values()].some((table) => table.rules > 0)
  const rulesTarget = `/rules?source=${encodeURIComponent(source.code)}`
  const allTables = tables.map((table) => table.name)
  const openTable = (name: string) => onOpenTable(name, allTables.length ? allTables : [name])

  return (
    <>
      <Head title={source.name} text={stage === 'profiling' ? 'Review completed profiles or profile additional tables from this connector.' : stage === 'rules' ? 'Review rule coverage or apply rules to additional tables and columns.' : 'Review silver output or apply rules to add more tables to this layer.'} />
      <section className="card dq-connector-workspace">
        <div className="dq-workspace-head">
          <div className="sx-src">
            <ConnectorLogo type={source.connector_type} size={38} />
            <span><b>{source.name}</b><small>{stageName}</small></span>
          </div>
          {stage === 'silver' && canManage ? (
            <Link className="btn btn-primary" to={rulesTarget}>{hasRules ? 'Apply more rules' : 'Apply rules'} <Icon name="chevron-right" size={15} /></Link>
          ) : stage === 'silver' ? (
            <button type="button" className="btn btn-primary" disabled>Apply rules</button>
          ) : (
            <button type="button" className="btn btn-primary" disabled={!canManage} onClick={onSelectTables}>{action} <Icon name="chevron-right" size={15} /></button>
          )}
        </div>
        {stage !== 'profiling' && !canManage && <p className="dq-access-note">Ask a data steward or administrator to view rule and silver status for this connector.</p>}
        {raw.error && <ErrorAlert message={raw.error} />}
        {silver.error && <ErrorAlert message={silver.error} />}
        {!raw.data && !raw.error && <Loader kind="scan" label="Loading connector tables" />}
        {stage !== 'profiling' && canManage && !silver.data && !silver.error && <Loader kind="scan" label="Loading rules and silver status" />}
        {raw.data && (stage === 'profiling' || silver.data || !canManage) && (
          <>
            {tables.length === 0 ? (
              <div className="dq-workspace-empty">
                <EmptyState icon={stage === 'profiling' ? 'search' : 'layers'} title={stage === 'profiling' ? 'Not profiled yet' : stage === 'rules' ? 'No rules applied yet' : 'No silver tables yet'}>
                  {stage === 'profiling' ? 'Profile tables from this connector to get started.' : stage === 'rules' ? 'Select a profiled table or add a new table to profile before setting rules.' : 'Apply rules to profiled tables to create silver rows.'}
                </EmptyState>
              </div>
            ) : (
              <>
                <div className="dq-workspace-table-title"><h2>{stageName}</h2><span className="muted text-sm">{n(tables.length)} profiled tables</span></div>
                <div className="table-wrap">
                  <table className="sx-table dq-connector-table">
                    <thead><tr><th>Table</th><th>Rows</th><th>{stage === 'profiling' ? 'Profile status' : stage === 'rules' ? 'Rules applied' : 'Silver output'}</th><th className="num">{stage === 'profiling' ? 'Filled' : stage === 'rules' ? 'Rules' : 'Held back'}</th><th /></tr></thead>
                    <tbody>{tables.map((table) => {
                      const output = layer.get(table.name)
                      const hasRules = canManage && !!output?.rules
                      const restricted = stage !== 'profiling' && !canManage
                      const available = stage === 'profiling' || (!restricted && (stage === 'rules' || hasRules))
                      const status = restricted ? 'Restricted' : stage === 'profiling' ? 'Profiled' : stage === 'rules' ? hasRules ? 'Rules applied' : 'No rules yet' : hasRules ? 'Available' : 'Apply rules first'
                      return (
                        <tr key={table.name} className={available ? 'clickable' : undefined} tabIndex={available ? 0 : undefined} onClick={() => available && openTable(table.name)} onKeyDown={(event) => available && (event.key === 'Enter' || event.key === ' ') && openTable(table.name)}>
                          <td className="is-main"><b className="dq-name">{table.name}</b></td>
                          <td className="num muted">{n(table.rows)}</td>
                          <td><Pill tone={hasRules || stage === 'profiling' ? 'ok' : 'plain'}>{status}</Pill></td>
                          <td className="num">{restricted ? '—' : stage === 'profiling' ? `${table.filled ?? 0}%` : stage === 'rules' ? n(output?.rules ?? 0) : n(output?.rejected ?? 0)}</td>
                          <td className="dq-go">{available && <Icon name="chevron-right" size={16} />}</td>
                        </tr>
                      )
                    })}</tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
        {stage !== 'profiling' && canManage && tables.length > 0 && silver.data?.tables.every((table) => table.rules === 0) && (
          <p className="dq-access-note">No rules have been applied on this connector yet. Use <b>Apply rules</b> to choose tables and columns.</p>
        )}
      </section>
    </>
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
