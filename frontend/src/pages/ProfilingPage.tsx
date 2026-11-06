import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { ColumnCounts } from '../api/types'
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
            onProfiled={sources.reload}
          />
        </>
      )}
    </>
  )
}

function ConnectorTables({ code, canRead, onProfiled }: { code: string; canRead: boolean; onProfiled: () => void }) {
  const toast = useToast()
  const profiled = useApi(() => api.rawTables(code), [code])
  const [params, setParams] = useSearchParams()
  const [names, setNames] = useState<string[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<{ done: number; total: number; table: string } | null>(null)
  const [failed, setFailed] = useState<{ table: string; error: string }[]>([])
  const results = useRef<HTMLDivElement>(null)

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
    const read = chosen.length - problems.length
    toast(problems.length ? 'error' : 'success', `Profiled ${read} of ${chosen.length} tables.`)
    profiled.reload()
    onProfiled()
    if (chosen[0]) setParams({ source: code, table: chosen[0] })
    setTimeout(() => results.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300)
  }

  return (
    <>
      <Card
        flush
        title="Choose tables"
        description={canRead ? 'Only the tables you tick are profiled.' : 'A data steward or administrator profiles tables.'}
        actions={
          canRead && (
            <div className="row" style={{ gap: 8 }}>
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
          )
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
        {all.length > 0 && (
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
                  <span className="pick-name">{name}</span>
                  <span className="text-xs muted">
                    {when(name) ? `Profiled ${formatDateTime(when(name)!)}` : 'Not profiled'}
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
          <Counts key={`${open.name}:${open.read_at}`} code={code} table={open.name} />
        </div>
      )}
    </>
  )
}

function Counts({ code, table }: { code: string; table: string }) {
  const result = useApi(() => api.rawProfile(code, table), [code, table])
  if (result.error) return <ErrorAlert message={result.error} />
  if (!result.data) {
    return (
      <div className="card">
        <Loader kind="scan" label="Loading the counts" />
      </div>
    )
  }
  const { rows, columns } = result.data.profile
  return (
    <Card flush title={table} description={`${n(rows)} rows · ${columns.length} columns`}>
      <div className="table-wrap">
        <table className="table counts-table">
          <thead>
            <tr>
              <th>Column</th>
              <th className="num">Filled</th>
              <th className="num">Empty</th>
              <th className="num">Unique</th>
              <th>Length</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((c) => (
              <CountsRow key={c.name} column={c} />
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function CountsRow({ column }: { column: ColumnCounts }) {
  return (
    <tr>
      <td>
        <strong>{column.name}</strong>
      </td>
      <td className="num">{n(column.filled)}</td>
      <td className={`num${column.empty ? '' : ' muted'}`}>{n(column.empty)}</td>
      <td className="num">{n(column.unique)}</td>
      <td>
        {column.counts.length ? (
          <span className="count-list">
            {column.counts.map((c) => (
              <span key={c.label}>
                {c.label} <strong>{n(c.count)}</strong>
              </span>
            ))}
          </span>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    </tr>
  )
}
