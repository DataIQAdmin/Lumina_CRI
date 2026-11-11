import { useEffect, useState, useSyncExternalStore } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { ColumnCounts, CountProof, RawTable } from '../api/types'
import { useApi } from '../api/useApi'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { Legend, n, PanelHead, pct, Pill, Ring, Seg, Split, type Part } from '../components/Lx'
import { EmptyState, ErrorAlert, PageHeader } from '../components/ui'
import { formatDateTime } from '../format'
import { profileJob } from '../profileJob'

// Bronze layer: tables on the left, the chosen table's columns on the right. Tables are profiled only when chosen
// (ChooseTables), as a job with its own progress (ProfileJobPanel). Connector and table live in the address.
export function ProfilingPage() {
  const sources = useApi(() => api.rawSources(), [])
  const [params, setParams] = useSearchParams()
  const list = sources.data?.sources ?? []
  const chosen = list.find((s) => s.code === params.get('source')) ?? list[0]

  if (sources.error) return <ErrorAlert message={sources.error} />
  if (!sources.data) {
    return (
      <div className="lx-panel">
        <Loader kind="scan" label="Loading connectors" />
      </div>
    )
  }
  if (!chosen) {
    return (
      <>
        <PageHeader title="Data profiling" />
        <div className="lx-panel">
          <EmptyState icon="connectors" title="No connectors yet">
            Add a connector first.
          </EmptyState>
        </div>
      </>
    )
  }
  return (
    <Connector
      key={chosen.code}
      code={chosen.code}
      name={chosen.name}
      sources={list.map((s) => ({ value: s.code, label: s.name }))}
      onSource={(code) => setParams({ source: code })}
      canRead={sources.data.can_read}
      canViewRows={sources.data.can_view_rows}
      onProfiled={sources.reload}
    />
  )
}

function Connector({
  code,
  name,
  sources,
  onSource,
  canRead,
  canViewRows,
  onProfiled,
}: {
  code: string
  name: string
  sources: { value: string; label: string }[]
  onSource: (code: string) => void
  canRead: boolean
  canViewRows: boolean
  onProfiled: () => void
}) {
  const profiled = useApi(() => api.rawTables(code), [code])
  const [params, setParams] = useSearchParams()
  const [names, setNames] = useState<string[] | null>(null)
  const [choosing, setChoosing] = useState(false)
  const job = useSyncExternalStore(profileJob.subscribe, profileJob.get)

  useEffect(() => {
    if (!canRead) return
    api.rawDiscover(code).then((found) => setNames(found.tables), () => setNames([]))
  }, [code, canRead])

  // When a job on this connector ends, show what it profiled.
  const ended = job && job.code === code ? job.finished : null
  useEffect(() => {
    if (!ended) return
    profiled.reload()
    onProfiled()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended])

  const done = profiled.data?.tables ?? []
  const open = done.find((t) => t.name === params.get('table')) ?? done[0]
  const all = names ?? done.map((t) => t.name)

  return (
    <>
      <PageHeader
        title="Data profiling"
        description={`${name} · ${done.length} of ${all.length || done.length} tables profiled`}
        actions={
          <>
            {sources.length > 1 && <Seg label="Connector" value={code} options={sources} onChange={onSource} />}
            {canRead && (
              <button type="button" className="btn btn-primary" onClick={() => setChoosing(true)}>
                <Icon name="search" size={15} /> Choose tables
              </button>
            )}
          </>
        }
      />
      {profiled.error && <ErrorAlert message={profiled.error} />}
      {profiled.data && !open && (
        <div className="lx-panel">
          <EmptyState icon="search" title="Nothing profiled yet">
            {canRead ? 'Choose the tables to profile.' : 'A data steward or administrator profiles tables.'}
          </EmptyState>
        </div>
      )}
      {open && (
        <div className="lx-two">
          <div className="lx-panel">
            <PanelHead title="Tables" aside={<span className="muted text-sm">{done.length}</span>} />
            <div className="lx-list lx-scroll">
              {done.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={t.name === open.name ? 'is-on' : undefined}
                  aria-pressed={t.name === open.name}
                  onClick={() => setParams({ source: code, table: t.name })}
                >
                  <Ring value={t.filled ?? 100} label={String(t.filled ?? 100)} />
                  <span className="lx-grow">
                    <strong>{t.name}</strong>
                    <small>{t.to_check ? `${t.to_check} to check` : 'All fine'}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <TableView key={`${open.name}:${open.read_at}`} code={code} table={open} canViewRows={canViewRows} />
        </div>
      )}
      {choosing && (
        <ChooseTables
          code={code}
          name={name}
          tables={all}
          profiledAt={(t) => done.find((d) => d.name === t)?.read_at}
          loading={names === null}
          onClose={() => setChoosing(false)}
        />
      )}
    </>
  )
}

function ChooseTables({
  code,
  name,
  tables,
  profiledAt,
  loading,
  onClose,
}: {
  code: string
  name: string
  tables: string[]
  profiledAt: (table: string) => string | undefined
  loading: boolean
  onClose: () => void
}) {
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const busy = useSyncExternalStore(profileJob.subscribe, profileJob.running)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const toggle = (t: string) =>
    setTicked((old) => {
      const next = new Set(old)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  const start = () => {
    profileJob.start(code, name, tables.filter((t) => ticked.has(t)))
    onClose()
  }
  return (
    <div className="job-overlay" onClick={onClose}>
      <section
        className="job-dialog lx-choose"
        role="dialog"
        aria-modal="true"
        aria-labelledby="choose-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="job-head">
          <h2 id="choose-title">Choose tables</h2>
          <span className="text-sm muted">{name}</span>
        </header>
        {loading ? (
          <Loader kind="scan" label="Asking the connector for its tables" />
        ) : (
          <ul className="lx-checks">
            {tables.map((t) => (
              <li key={t}>
                <label>
                  <input type="checkbox" checked={ticked.has(t)} onChange={() => toggle(t)} />
                  <span>
                    <strong>{t}</strong>
                    <small>{profiledAt(t) ? `Profiled ${formatDateTime(profiledAt(t)!)}` : 'Not profiled'}</small>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <footer className="job-foot">
          <button
            type="button"
            className="btn"
            style={{ marginRight: 'auto' }}
            onClick={() => setTicked(ticked.size === tables.length ? new Set() : new Set(tables))}
          >
            {ticked.size === tables.length && tables.length ? 'Clear all' : 'Select all'}
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!ticked.size || busy} onClick={start}>
            Profile {ticked.size || ''} {ticked.size === 1 ? 'table' : 'tables'}
          </button>
        </footer>
      </section>
    </div>
  )
}

type Filter = 'all' | 'check' | 'fine'

const isEmail = (c: ColumnCounts) => !!c.counts[0]?.label.startsWith('Up to')
const isMixed = (c: ColumnCounts) => !isEmail(c) && c.counts.filter((x) => x.count > 0).length > 1
const tooLong = (c: ColumnCounts) => isEmail(c) && (c.counts[1]?.count ?? 0) > 0
const needsLook = (c: ColumnCounts) => c.empty > 0 || isMixed(c) || tooLong(c)

function status(c: ColumnCounts, rows: number): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (c.empty > 0) return { tone: 'bad', text: `${pct(c.empty, rows)}% empty` }
  if (tooLong(c)) return { tone: 'warn', text: 'Too long' }
  if (isMixed(c)) return { tone: 'warn', text: 'Mixed lengths' }
  return { tone: 'ok', text: 'Looks fine' }
}

// The parts of a column for its split bar: its lengths or its values. The rarer lengths and too-long emails show
// as warnings.
function partsOf(c: ColumnCounts): Part[] {
  if (c.counts.length) {
    return c.counts.map((x, i) => ({
      label: x.label,
      count: x.count,
      tone: (isEmail(c) ? i === 1 : i > 0) ? ('warn' as const) : undefined,
    }))
  }
  return (c.values ?? []).map((x) => ({ label: x.label, count: x.count }))
}

function TableView({ code, table, canViewRows }: { code: string; table: RawTable; canViewRows: boolean }) {
  const result = useApi(() => api.rawProfile(code, table.name), [code, table.name])
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState<{ column: string; label: string } | null>(null)
  if (result.error) return <ErrorAlert message={result.error} />
  if (!result.data) {
    return (
      <div className="lx-panel">
        <Loader kind="scan" label="Loading the counts" />
      </div>
    )
  }
  const { rows, columns } = result.data.profile
  const empty = columns.reduce((sum, c) => sum + c.empty, 0)
  const check = columns.filter(needsLook)
  const term = search.trim().toLowerCase()
  const shown = columns.filter(
    (c) =>
      c.name.toLowerCase().includes(term) && (filter === 'all' || (filter === 'check' ? needsLook(c) : !needsLook(c))),
  )

  return (
    <div className="lx-panel">
      <div className="lx-summary">
        <Ring big value={table.filled ?? 100} />
        <div className="lx-grow">
          <h2>{table.name}</h2>
          <span className="muted">Profiled {formatDateTime(table.read_at)}</span>
        </div>
        <dl className="lx-facts">
          <div>
            <dt>Rows</dt>
            <dd>{n(rows)}</dd>
          </div>
          <div>
            <dt>Columns</dt>
            <dd>{n(columns.length)}</dd>
          </div>
          <div>
            <dt>Empty values</dt>
            <dd className={empty ? 'is-warn' : undefined}>{n(empty)}</dd>
          </div>
          <div>
            <dt>To check</dt>
            <dd className={check.length ? 'is-warn' : undefined}>{n(check.length)}</dd>
          </div>
        </dl>
      </div>
      <div className="lx-filters">
        <Seg
          label="Filter columns"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: `All ${columns.length}` },
            { value: 'check', label: `To check · ${check.length}` },
            { value: 'fine', label: `Looks fine · ${columns.length - check.length}` },
          ]}
        />
        <label className="lx-search">
          <Icon name="search" size={15} />
          <input
            aria-label="Search columns"
            placeholder="Search columns"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon="search" title="No column matches" />
      ) : (
        <div className="lx-scroll">
          <table className="lx-table">
            <thead>
              <tr>
                <th>Column</th>
                <th style={{ width: 150 }}>Filled</th>
                <th className="num" style={{ width: 80 }}>
                  Unique
                </th>
                <th>What is inside</th>
                <th style={{ width: 130 }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <ColumnRow
                  key={c.name}
                  code={code}
                  table={table.name}
                  column={c}
                  rows={rows}
                  canViewRows={canViewRows}
                  open={open?.column === c.name ? open.label : null}
                  onOpen={(label) => setOpen(label === null ? null : { column: c.name, label })}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function ColumnRow({
  code,
  table,
  column,
  rows,
  canViewRows,
  open,
  onOpen,
}: {
  code: string
  table: string
  column: ColumnCounts
  rows: number
  canViewRows: boolean
  open: string | null
  onOpen: (label: string | null) => void
}) {
  const parts = partsOf(column)
  const st = status(column, rows)
  // Clicking a row opens the rows behind its problem: the empty ones, or the first rarer length.
  const problem = column.empty > 0 ? 'Empty' : (parts.find((p) => p.tone === 'warn' && p.count > 0)?.label ?? null)
  const toggle = (label: string) => onOpen(open === label ? null : label)
  const clickable = canViewRows && problem
  return (
    <>
      <tr
        className={`${open ? 'is-open' : ''}${clickable ? ' is-clickable' : ''}`}
        onClick={clickable ? () => toggle(problem) : undefined}
      >
        <td>
          <strong>{column.name}</strong>
        </td>
        <td>
          <span className="lx-filled">
            <span className="lx-bar">
              <i style={{ width: `${pct(column.filled, rows)}%` }} />
            </span>
            <span className="num muted">{pct(column.filled, rows)}%</span>
          </span>
        </td>
        <td className="num">{n(column.unique)}</td>
        <td>
          {parts.length ? (
            <span className="lx-inside">
              <Split parts={parts} />
              <Legend parts={parts} open={open} onPick={canViewRows ? toggle : undefined} />
            </span>
          ) : (
            <span className="muted text-sm">Free text</span>
          )}
        </td>
        <td>
          <Pill tone={st.tone}>{st.text}</Pill>
        </td>
      </tr>
      {open && (
        <tr className="lx-detail">
          <td colSpan={5}>
            <Proof code={code} table={table} column={column.name} label={open} onClose={() => onOpen(null)} />
          </td>
        </tr>
      )}
    </>
  )
}

// The rows behind one count: row number, the table's ID and the value itself, 20 at a time.
function Proof({
  code,
  table,
  column,
  label,
  onClose,
}: {
  code: string
  table: string
  column: string
  label: string
  onClose: () => void
}) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<CountProof | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setError(null)
    api.rawProof(code, table, column, label, page).then(
      (got) => live && setData(got),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [code, table, column, label, page])
  const pages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1
  const shown = (v: unknown) =>
    v === null || v === undefined || v === '' ? <span className="muted">Empty</span> : String(v)
  return (
    <div className="lx-proof">
      <div className="lx-proof-h">
        <strong>
          {data ? n(data.count) : '…'} rows · {column}: {label === 'Empty' ? 'empty' : label}
        </strong>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <ErrorAlert message={error} />}
      {!data && !error && <Loader kind="scan" label="Finding the rows" />}
      {data && (
        <>
          <table className="lx-mini">
            <thead>
              <tr>
                <th className="num">Row</th>
                <th>{data.key}</th>
                <th>{column}</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.row}>
                  <td className="num muted">{r.row}</td>
                  <td className="muted lx-key">{shown(r.key)}</td>
                  <td>
                    <code>{shown(r.value)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="lx-pages">
              <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span className="text-sm muted">
                {page} of {pages}
              </span>
              <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
