import { type ReactNode, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { ColumnCounts, CountProof } from '../api/types'
import { useApi } from '../api/useApi'
import { ConnectorPicker } from '../components/ConnectorPicker'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { useToast } from '../components/Toasts'
import { Card, EmptyState, ErrorAlert, PageHeader } from '../components/ui'
import { formatDateTime } from '../format'

const n = (v: number) => v.toLocaleString('en-IN')

// Bronze layer: pick a connector, tick the tables to profile, and see plain counts for each column of those
// tables. Only ticked tables are read. The chosen connector and table live in the address.
export function ProfilingPage() {
  const sources = useApi(() => api.rawSources(), [])
  const [params, setParams] = useSearchParams()
  const list = sources.data?.sources ?? []
  const chosen = list.find((s) => s.code === params.get('source')) ?? list[0]

  return (
    <>
      <PageHeader
        title="Data profiling"
        description="Choose a connector, choose its tables, and see the counts for each column."
      />
      {sources.error && <ErrorAlert message={sources.error} />}
      {!sources.data && !sources.error && (
        <div className="card">
          <Loader kind="scan" label="Loading connectors" />
        </div>
      )}
      {sources.data && !chosen && (
        <Card>
          <EmptyState icon="connectors" title="No connectors yet">
            Add a connector first. Its tables will appear here.
          </EmptyState>
        </Card>
      )}
      {chosen && (
        <>
          <ConnectorPicker sources={list} chosen={chosen.code} onChoose={(code) => setParams({ source: code })} />
          <ConnectorTables
            key={chosen.code}
            code={chosen.code}
            canRead={sources.data?.can_read ?? false}
            canViewRows={sources.data?.can_view_rows ?? false}
            onProfiled={sources.reload}
          />
        </>
      )}
    </>
  )
}

function ConnectorTables({
  code,
  canRead,
  canViewRows,
  onProfiled,
}: {
  code: string
  canRead: boolean
  canViewRows: boolean
  onProfiled: () => void
}) {
  const toast = useToast()
  const profiled = useApi(() => api.rawTables(code), [code])
  const [params, setParams] = useSearchParams()
  const [names, setNames] = useState<string[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number; table: string } | null>(null)
  const [failed, setFailed] = useState<{ table: string; error: string }[]>([])
  const results = useRef<HTMLDivElement>(null)
  const [changing, setChanging] = useState(false) // the table list folds away once something is profiled

  useEffect(() => {
    if (!canRead) return
    api
      .rawDiscover(code)
      .then((found) => setNames(found.tables))
      .catch((e: Error) => setListError(e.message))
  }, [code, canRead])

  const done = profiled.data?.tables ?? []
  const open = done.find((t) => t.name === params.get('table')) ?? done[0]
  const all = names ?? done.map((t) => t.name)
  const when = (name: string) => done.find((t) => t.name === name)?.read_at

  const toggle = (name: string) =>
    setTicked((old) => {
      const next = new Set(old)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  // One table at a time, so each request stays short.
  const profile = async () => {
    const chosen = all.filter((name) => ticked.has(name))
    const problems: { table: string; error: string }[] = []
    setFailed([])
    for (const [i, name] of chosen.entries()) {
      setProgress({ done: i, total: chosen.length, table: name })
      try {
        await api.rawRead(code, name)
      } catch {
        // One more try: the hosted server may have restarted halfway; reading a table again is safe.
        try {
          await api.rawRead(code, name)
        } catch (e) {
          problems.push({ table: name, error: (e as Error).message })
        }
      }
    }
    setProgress(null)
    setFailed(problems)
    setTicked(new Set())
    setChanging(false)
    const read = chosen.length - problems.length
    toast(problems.length ? 'error' : 'success', `Profiled ${read} of ${chosen.length} tables.`)
    profiled.reload()
    onProfiled()
    if (chosen[0]) setParams({ source: code, table: chosen[0] })
    setTimeout(() => results.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
  }

  const folded = done.length > 0 && !changing && !progress && failed.length === 0

  return (
    <>
      <Card
        flush
        title={folded ? `${done.length} of ${all.length} tables profiled` : 'Choose tables'}
        description={
          canRead
            ? folded
              ? 'Open the list to profile more tables.'
              : 'Only the tables you tick are profiled.'
            : 'A data steward or administrator profiles tables.'
        }
        actions={
          canRead &&
          (folded ? (
            <button type="button" className="btn btn-sm" onClick={() => setChanging(true)}>
              Change tables
            </button>
          ) : (
            <div className="row" style={{ gap: 8 }}>
              {done.length > 0 && (
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={progress !== null}
                  onClick={() => {
                    setChanging(false)
                    setTicked(new Set())
                  }}
                >
                  Cancel
                </button>
              )}
              <button
                type="button"
                className="btn btn-sm"
                disabled={!all.length || progress !== null}
                onClick={() => setTicked(ticked.size === all.length ? new Set() : new Set(all))}
              >
                {ticked.size === all.length && all.length ? 'Clear all' : 'Select all'}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!ticked.size || progress !== null}
                onClick={profile}
              >
                <Icon name="search" size={14} /> Profile selected{ticked.size ? ` (${ticked.size})` : ''}
              </button>
            </div>
          ))
        }
      >
        {progress && (
          <div className="raw-progress" role="status" aria-live="polite">
            <span>
              Profiling {progress.done + 1} of {progress.total}: <strong>{progress.table}</strong>
            </span>
            <span className="raw-progress-bar" aria-hidden="true">
              <i style={{ width: `${(100 * progress.done) / progress.total}%` }} />
            </span>
          </div>
        )}
        {listError && <ErrorAlert message={listError} />}
        {failed.map((f) => (
          <ErrorAlert key={f.table} message={`${f.table}: ${f.error}`} />
        ))}
        {canRead && names === null && !listError && <Loader kind="scan" label="Asking the connector for its tables" />}
        {names !== null && all.length === 0 && (
          <EmptyState icon="search" title="No tables found">
            This connector has no tables yet.
          </EmptyState>
        )}
        {all.length > 0 && !folded && (
          <ul className="pick-tables">
            {all.map((name) => (
              <li key={name}>
                <label>
                  {canRead && (
                    <input
                      type="checkbox"
                      checked={ticked.has(name)}
                      disabled={progress !== null}
                      onChange={() => toggle(name)}
                    />
                  )}
                  <span className="pick-text">
                    <span className="pick-name">{name}</span>
                    <span className="text-xs muted">
                      {when(name) ? `Profiled ${formatDateTime(when(name)!)}` : 'Not profiled'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {profiled.error && <ErrorAlert message={profiled.error} />}
      {open && (
        <div ref={results} className="pick-results">
          {done.length > 1 && (
            <div className="pick-pills" role="group" aria-label="Profiled table">
              {done.map((t) => (
                <button
                  key={t.name}
                  type="button"
                  className={`pick-pill${t.name === open.name ? ' is-on' : ''}`}
                  aria-pressed={t.name === open.name}
                  onClick={() => setParams({ source: code, table: t.name })}
                >
                  {t.name}
                </button>
              ))}
            </div>
          )}
          <Counts key={`${open.name}:${open.read_at}`} code={code} table={open.name} canViewRows={canViewRows} />
        </div>
      )}
    </>
  )
}

type Filter = 'all' | 'empty' | 'mixed'

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All columns' },
  { value: 'empty', label: 'Has empty values' },
  { value: 'mixed', label: 'Mixed lengths' },
]

const isMixed = (c: ColumnCounts) => c.counts.filter((x) => x.count > 0).length > 1
const percent = (part: number, whole: number) => (whole ? Math.round((100 * part) / whole) : 0)

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bronze-tile">
      <span className="text-sm muted">{label}</span>
      <strong>{value}</strong>
      {note && <span className="text-xs muted">{note}</span>}
    </div>
  )
}

function Counts({ code, table, canViewRows }: { code: string; table: string; canViewRows: boolean }) {
  const result = useApi(() => api.rawProfile(code, table), [code, table])
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  if (result.error) return <ErrorAlert message={result.error} />
  if (!result.data) {
    return (
      <div className="card">
        <Loader kind="scan" label="Loading the counts" />
      </div>
    )
  }
  const { rows, columns } = result.data.profile
  const cells = rows * columns.length
  const filled = columns.reduce((sum, c) => sum + c.filled, 0)
  const withEmpty = columns.filter((c) => c.empty > 0).length
  const mixed = columns.filter(isMixed).length
  const term = search.trim().toLowerCase()
  const shown = columns.filter(
    (c) =>
      c.name.toLowerCase().includes(term) &&
      (filter === 'all' || (filter === 'empty' ? c.empty > 0 : isMixed(c))),
  )

  return (
    <>
      <div className="bronze-tiles">
        <Tile label="Rows" value={n(rows)} />
        <Tile label="Columns" value={n(columns.length)} />
        <Tile label="Values filled" value={`${percent(filled, cells)}%`} note={`${n(cells - filled)} empty`} />
        <Tile label="Columns with empty values" value={n(withEmpty)} note={`of ${n(columns.length)}`} />
        <Tile label="Columns with mixed lengths" value={n(mixed)} note="Check these first" />
      </div>
      <Card
        flush
        title={table}
        description={
          canViewRows
            ? `Showing ${shown.length} of ${columns.length} columns. Click any count to see the rows behind it.`
            : `Showing ${shown.length} of ${columns.length} columns`
        }
      >
        <div className="bronze-tools">
          <div className="pick-pills" role="group" aria-label="Filter columns">
            {FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                className={`pick-pill${f.value === filter ? ' is-on' : ''}`}
                aria-pressed={f.value === filter}
                onClick={() => setFilter(f.value)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            className="input"
            aria-label="Search columns"
            placeholder="Search columns"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {shown.length === 0 ? (
          <EmptyState icon="search" title="No column matches" />
        ) : (
          <div className="table-wrap">
            <table className="table counts-table">
              <thead>
                <tr>
                  <th>Column</th>
                  <th>Filled</th>
                  <th className="num">Empty</th>
                  <th className="num">Unique</th>
                  <th>What is inside</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <CountsRow key={c.name} code={code} table={table} column={c} rows={rows} canViewRows={canViewRows} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}

function Bar({ share, title }: { share: number; title: string }) {
  return (
    <span className="bronze-bar" title={title}>
      <i style={{ width: `${share}%` }} />
    </span>
  )
}

// One count, clickable when the person may see values: it opens the rows behind it.
function CountButton({
  label,
  count,
  open,
  canViewRows,
  onOpen,
  children,
}: {
  label: string
  count: number
  open: boolean
  canViewRows: boolean
  onOpen: () => void
  children: ReactNode
}) {
  if (!canViewRows || count === 0) return <>{children}</>
  return (
    <button
      type="button"
      className={`count-button${open ? ' is-on' : ''}`}
      aria-expanded={open}
      title={`See the ${n(count)} rows: ${label}`}
      onClick={onOpen}
    >
      {children}
    </button>
  )
}

function CountsRow({
  code,
  table,
  column,
  rows,
  canViewRows,
}: {
  code: string
  table: string
  column: ColumnCounts
  rows: number
  canViewRows: boolean
}) {
  const [open, setOpen] = useState<string | null>(null)
  const inside = column.counts.length ? column.counts : (column.values ?? [])
  const share = percent(column.filled, rows)
  const toggle = (label: string) => setOpen(open === label ? null : label)
  return (
    <>
      <tr className={open ? 'is-open' : undefined}>
        <td>
          <strong>{column.name}</strong>
        </td>
        <td>
          <span className="bronze-filled">
            <Bar share={share} title={`${n(column.filled)} of ${n(rows)} rows filled`} />
            <span className="text-sm">{share}%</span>
          </span>
        </td>
        <td className={`num${column.empty ? '' : ' muted'}`}>
          <CountButton
            label="Empty"
            count={column.empty}
            open={open === 'Empty'}
            canViewRows={canViewRows}
            onOpen={() => toggle('Empty')}
          >
            {n(column.empty)}
          </CountButton>
        </td>
        <td className="num">{n(column.unique)}</td>
        <td>
          {inside.length ? (
            <ul className="bronze-inside">
              {inside.map((c) => (
                <li key={c.label}>
                  <CountButton
                    label={c.label}
                    count={c.count}
                    open={open === c.label}
                    canViewRows={canViewRows}
                    onOpen={() => toggle(c.label)}
                  >
                    <span className="bronze-inside-row">
                      <span>{c.label}</span>
                      <Bar
                        share={percent(c.count, column.filled)}
                        title={`${c.label}: ${n(c.count)} of ${n(column.filled)} filled values`}
                      />
                      <strong>{n(c.count)}</strong>
                    </span>
                  </CountButton>
                </li>
              ))}
            </ul>
          ) : (
            <span className="text-sm muted">Free text</span>
          )}
        </td>
      </tr>
      {open && (
        <tr className="proof-row">
          <td colSpan={5}>
            <Proof code={code} table={table} column={column.name} label={open} onClose={() => setOpen(null)} />
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
  const shown = (v: unknown) => (v === null || v === undefined || v === '' ? <span className="muted">Empty</span> : String(v))

  return (
    <div className="proof">
      <div className="proof-head">
        <div className="stack" style={{ gap: 2 }}>
          <strong>
            {data ? n(data.count) : '...'} rows: {column} is {label === 'Empty' ? 'empty' : <q>{label}</q>}
          </strong>
          <span className="text-xs muted">Real rows from the table, so you can check the count yourself.</span>
        </div>
        <button type="button" className="btn btn-sm" onClick={onClose}>
          Close
        </button>
      </div>
      {error && <ErrorAlert message={error} />}
      {!data && !error && <Loader kind="scan" label="Finding the rows" />}
      {data && (
        <>
          <div className="table-wrap">
            <table className="table proof-table">
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
                    <td className="proof-key">{shown(r.key)}</td>
                    <td>
                      <code>{shown(r.value)}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="proof-pages">
              <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span className="text-sm muted">
                Page {page} of {pages}
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
