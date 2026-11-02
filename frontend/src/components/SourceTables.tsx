import { useState } from 'react'

import { api } from '../api/client'
import type { RawTable } from '../api/types'
import { useApi } from '../api/useApi'
import { formatDateTime } from '../format'
import { Icon } from './Icon'
import { Loader } from './Loader'
import { useToast } from './Toasts'
import { Card, EmptyState, ErrorAlert, StatusBadge } from './ui'

// Data profiling, raw layer: pick a connector, read all its tables, then open a table to see its rows exactly as
// the system holds them. Identity numbers (PAN, Aadhaar, passport...) arrive already masked from the server.
export function SourceTables() {
  const sources = useApi(() => api.rawSources(), [])
  const [code, setCode] = useState<string | null>(null)
  const list = sources.data?.sources ?? []
  const chosen = list.find((s) => s.code === code) ?? list.find((s) => s.tables > 0) ?? list[0]

  if (sources.error) return <ErrorAlert message={sources.error} />
  if (!sources.data) {
    return (
      <div className="card">
        <Loader kind="scan" label="Loading connectors" />
      </div>
    )
  }
  if (!chosen) {
    return (
      <Card>
        <EmptyState icon="connectors" title="No connectors yet">
          Add a connector first. Its tables will appear here.
        </EmptyState>
      </Card>
    )
  }
  return (
    <>
      <div className="raw-sources" role="group" aria-label="Connector">
        {list.map((s) => (
          <button
            key={s.code}
            type="button"
            className={`raw-source${s.code === chosen.code ? ' is-on' : ''}`}
            aria-pressed={s.code === chosen.code}
            onClick={() => setCode(s.code)}
          >
            <strong>{s.name}</strong>
            <span className="text-xs muted">
              {s.tables ? `${s.tables} table${s.tables === 1 ? '' : 's'} read` : 'Not read yet'}
            </span>
          </button>
        ))}
      </div>
      <ConnectorTables
        key={chosen.code}
        code={chosen.code}
        canRead={sources.data.can_read}
        canViewRows={sources.data.can_view_rows}
        onRead={sources.reload}
      />
    </>
  )
}

function ConnectorTables({
  code,
  canRead,
  canViewRows,
  onRead,
}: {
  code: string
  canRead: boolean
  canViewRows: boolean
  onRead: () => void
}) {
  const toast = useToast()
  const tables = useApi(() => api.rawTables(code), [code])
  const [open, setOpen] = useState<string | null>(null)
  const [progress, setProgress] = useState<{
    done: number
    total: number
    table: string
  } | null>(null)
  const [failed, setFailed] = useState<{ table: string; error: string }[]>([])

  // Ask the system which tables it has, then read them one by one so each request stays short.
  const readAll = async () => {
    setFailed([])
    try {
      const { tables: names } = await api.rawDiscover(code)
      const problems: { table: string; error: string }[] = []
      for (const [i, name] of names.entries()) {
        setProgress({ done: i, total: names.length, table: name })
        try {
          await api.rawRead(code, name)
        } catch (e) {
          problems.push({ table: name, error: (e as Error).message })
        }
      }
      setFailed(problems)
      const read = names.length - problems.length
      toast(problems.length ? 'error' : 'success', `Read ${read} of ${names.length} tables.`)
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setProgress(null)
      tables.reload()
      onRead()
    }
  }

  const rows = tables.data?.tables ?? []
  const totalRows = rows.reduce((n, t) => n + t.rows, 0)
  const shown = rows.find((t) => t.name === open)

  return (
    <>
      <Card
        flush
        title="Tables"
        description={
          rows.length
            ? `${rows.length} tables · ${totalRows.toLocaleString('en-IN')} rows, as the system holds them`
            : 'Every table of this connector, read whole, before any cleaning.'
        }
        actions={
          canRead && (
            <button type="button" className="btn btn-primary btn-sm" onClick={readAll} disabled={progress !== null}>
              <Icon name="refresh" size={14} /> {rows.length ? 'Read all tables again' : 'Read all tables'}
            </button>
          )
        }
      >
        {progress && (
          <div className="raw-progress" role="status" aria-live="polite">
            <span>
              Reading {progress.done + 1} of {progress.total}: <strong>{progress.table}</strong>
            </span>
            <span className="raw-progress-bar" aria-hidden="true">
              <i style={{ width: `${(100 * progress.done) / progress.total}%` }} />
            </span>
          </div>
        )}
        {failed.length > 0 && (
          <div className="card-body stack" style={{ gap: 6 }}>
            {failed.map((f) => (
              <ErrorAlert key={f.table} message={`${f.table}: ${f.error}`} />
            ))}
          </div>
        )}
        {tables.error && <ErrorAlert message={tables.error} />}
        {tables.data && rows.length === 0 && !progress && (
          <EmptyState icon="search" title="No tables read yet">
            {canRead
              ? 'Click Read all tables. Lumina reads every table of this connector, up to 50,000 rows each.'
              : 'A data steward or administrator reads the tables.'}
          </EmptyState>
        )}
        {rows.length > 0 && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Table</th>
                  <th className="num">Rows</th>
                  <th className="num">Columns</th>
                  <th>Identity numbers</th>
                  <th>Read</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => (
                  <tr
                    key={t.name}
                    className={`raw-table-row${t.name === open ? ' is-on' : ''}`}
                    onClick={() => setOpen(t.name === open ? null : t.name)}
                  >
                    <td>
                      <button type="button" className="link" aria-expanded={t.name === open}>
                        {t.name}
                      </button>
                      {!t.complete && (
                        <StatusBadge tone="warn">First {t.rows.toLocaleString('en-IN')} rows only</StatusBadge>
                      )}
                    </td>
                    <td className="num">{t.rows.toLocaleString('en-IN')}</td>
                    <td className="num">{t.columns}</td>
                    <td className="text-sm muted">{t.sensitive.length ? `${t.sensitive.join(', ')} (masked)` : '—'}</td>
                    <td className="text-sm muted">{formatDateTime(t.read_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {shown && <TablePreview key={shown.name} code={code} table={shown} canViewRows={canViewRows} />}
    </>
  )
}

function TablePreview({ code, table, canViewRows }: { code: string; table: RawTable; canViewRows: boolean }) {
  const [page, setPage] = useState(1)
  const rows = useApi(
    () => (canViewRows ? api.rawRows(code, table.name, page) : Promise.resolve(null)),
    [code, table.name, page, canViewRows],
  )
  const pages = Math.max(1, Math.ceil(table.rows / 50))
  const sensitive = new Set(table.sensitive)

  return (
    <Card
      flush
      title={table.name}
      description={`${table.rows.toLocaleString('en-IN')} rows · ${table.columns} columns · values exactly as the system sent them`}
      actions={
        canViewRows &&
        pages > 1 && (
          <div className="row" style={{ gap: 6 }}>
            <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Previous
            </button>
            <span className="text-sm muted num">
              Page {page} of {pages}
            </span>
            <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        )
      }
    >
      {!canViewRows && (
        <EmptyState icon="lock" title="Rows hidden for your role">
          Your role sees table sizes only.
        </EmptyState>
      )}
      {rows.error && <ErrorAlert message={rows.error} />}
      {canViewRows && !rows.data && !rows.error && <Loader kind="scan" label="Loading rows" />}
      {rows.data && (
        <div className="table-wrap raw-preview">
          <table className="table">
            <thead>
              <tr>
                <th className="num">#</th>
                {rows.data.column_names.map((c) => (
                  <th key={c}>
                    {c}
                    {sensitive.has(c) && <Icon name="lock" size={12} className="raw-lock" />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.data.results.map((r, i) => (
                <tr key={i}>
                  <td className="num muted">{(page - 1) * 50 + i + 1}</td>
                  {r.map((v, j) => (
                    <td key={j} title={v === null ? 'Empty' : String(v)}>
                      {v === null || v === '' ? <span className="raw-empty">empty</span> : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
