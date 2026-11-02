import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { SilverTable } from '../api/types'
import { useApi } from '../api/useApi'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { Card, EmptyState, ErrorAlert, PageHeader } from '../components/ui'

const n = (v: number) => v.toLocaleString('en-IN')

const RULES = [
  'Extra spaces removed',
  'Dates as YYYY-MM-DD',
  'Yes / no as true / false',
  'Mobile numbers as 10 digits',
  'Emails in small letters',
  '% sign removed from numbers',
  'Values that cannot be used (an impossible date, an invalid email or mobile, a wrong PIN code, Aadhaar damaged by Excel) emptied',
  'Exact copies of a row left out',
]

// The silver layer: each table read on Data profiling, cleaned the same simple way. Raw data is never changed;
// this page shows what cleaning does, table by table, and the cleaned rows.
export function SilverPage() {
  const sources = useApi(() => api.rawSources(), [])
  const [params, setParams] = useSearchParams()
  const list = (sources.data?.sources ?? []).filter((s) => s.tables > 0)
  const chosen = list.find((s) => s.code === params.get('source')) ?? list[0]
  const table = params.get('table')

  return (
    <>
      <PageHeader
        title="Silver layer"
        description="Your tables after Lumina's standard cleaning. The raw data stays exactly as your systems sent it."
      />

      <details className="card silver-rules">
        <summary>
          <Icon name="info" size={16} /> What cleaning does
        </summary>
        <ul>
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </details>

      {sources.error && <ErrorAlert message={sources.error} />}
      {!sources.data && !sources.error && (
        <div className="card">
          <Loader kind="scan" label="Loading connectors" />
        </div>
      )}
      {sources.data && !chosen && (
        <Card>
          <EmptyState icon="layers" title="No tables read yet">
            Read a connector's tables on <Link to="/profiling?view=tables">Data profiling</Link> first. Their silver
            version appears here.
          </EmptyState>
        </Card>
      )}
      {chosen && (
        <>
          <div className="raw-sources" role="group" aria-label="Connector">
            {list.map((s) => (
              <button
                key={s.code}
                type="button"
                className={`raw-source${s.code === chosen.code ? ' is-on' : ''}`}
                aria-pressed={s.code === chosen.code}
                onClick={() => setParams({ source: s.code })}
              >
                <strong>{s.name}</strong>
                <span className="text-xs muted">
                  {s.tables} table{s.tables === 1 ? '' : 's'}
                </span>
              </button>
            ))}
          </div>
          {table ? (
            <SilverTableDetail
              key={`${chosen.code}:${table}`}
              code={chosen.code}
              table={table}
              onBack={() => setParams({ source: chosen.code })}
            />
          ) : (
            <SilverTables
              key={chosen.code}
              code={chosen.code}
              onOpen={(name) => setParams({ source: chosen.code, table: name })}
            />
          )}
        </>
      )}
    </>
  )
}

function SilverTables({ code, onOpen }: { code: string; onOpen: (table: string) => void }) {
  const tables = useApi(() => api.silverTables(code), [code])
  const rows = tables.data?.tables ?? []
  if (tables.error) return <ErrorAlert message={tables.error} />
  if (!tables.data) {
    return (
      <div className="card">
        <Loader kind="scan" label="Cleaning the tables" />
      </div>
    )
  }
  return (
    <Card flush title="Tables" description="Click a table to see what cleaning changed and its cleaned rows.">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Table</th>
              <th className="num">Raw rows</th>
              <th className="num">Silver rows</th>
              <th className="num">Values cleaned</th>
              <th className="num">Values emptied</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t: SilverTable) => (
              <tr key={t.name} className="raw-table-row" onClick={() => onOpen(t.name)}>
                <td>
                  <button type="button" className="link">
                    {t.name}
                  </button>
                </td>
                <td className="num">{n(t.rows_in)}</td>
                <td className="num">
                  {t.rows_out === null ? (
                    <span className="muted">Read again</span>
                  ) : (
                    <>
                      {n(t.rows_out)}
                      {t.rows_out < t.rows_in && (
                        <small className="muted"> ({n(t.rows_in - t.rows_out)} copies out)</small>
                      )}
                    </>
                  )}
                </td>
                <td className="num">{t.changed_cells === null ? '—' : n(t.changed_cells)}</td>
                <td className="num">
                  {t.emptied ? (
                    <strong className="raw-score is-fix">{n(t.emptied)}</strong>
                  ) : (
                    <span className="muted">0</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function SilverTableDetail({ code, table, onBack }: { code: string; table: string; onBack: () => void }) {
  const detail = useApi(() => api.silverTable(code, table), [code, table])
  const [page, setPage] = useState(1)
  const rows = useApi(() => api.silverRows(code, table, page), [code, table, page])
  const d = detail.data
  const changes = (d?.changes ?? []).flatMap((c) => c.changes.map((ch) => ({ column: c.name, ...ch })))
  const pages = Math.max(1, Math.ceil((rows.data?.count ?? 0) / 50))

  return (
    <>
      <section className="card raw-detail-head">
        <div className="raw-detail-title">
          <button type="button" className="btn btn-sm" onClick={onBack}>
            <Icon name="arrowLeft" size={14} /> All tables
          </button>
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <h2>{table}</h2>
            {d && (
              <span className="text-sm muted">
                {n(d.rows_in)} raw rows · {n(d.rows_out ?? d.rows_in)} silver rows
                {d.dropped > 0 && ` (${n(d.dropped)} exact copies left out)`} · {n(d.changed_cells ?? 0)} values cleaned
              </span>
            )}
          </div>
        </div>
      </section>

      {detail.error && <ErrorAlert message={detail.error} />}
      {d && (
        <Card
          flush
          title="What cleaning changed"
          description={changes.length ? `${changes.length} kinds of change` : 'Nothing needed cleaning.'}
        >
          {changes.length === 0 ? (
            <EmptyState icon="check" title="Already clean" />
          ) : (
            <div className="table-wrap">
              <table className="table silver-changes">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Change</th>
                    <th className="num">Values</th>
                    <th>Example</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.map((c) => (
                    <tr key={`${c.column}:${c.key}`}>
                      <td>
                        <strong>{c.column}</strong>
                      </td>
                      <td className={c.label.includes('emptied') ? 'silver-emptied' : undefined}>{c.label}</td>
                      <td className="num">{n(c.count)}</td>
                      <td>
                        {c.examples[0] ? (
                          <span className="silver-example">
                            <code>{String(c.examples[0].before ?? 'empty')}</code>
                            <Icon name="chevronRight" size={12} />
                            <code>{c.examples[0].after === null ? 'empty' : String(c.examples[0].after)}</code>
                          </span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card
        flush
        title="Silver rows"
        description="Cleaned values are tinted green, emptied ones amber. Point at one to see what it was."
        actions={
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
        {rows.error && <ErrorAlert message={rows.error} />}
        {!rows.data && !rows.error && <Loader kind="scan" label="Cleaning the rows" />}
        {rows.data && (
          <div className="table-wrap raw-preview">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Row</th>
                  {rows.data.column_names.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.data.results.map((r) => (
                  <tr key={r.position}>
                    <td className="num muted">{n(r.position + 1)}</td>
                    {r.values.map((v, j) => {
                      const change = r.changed[String(j)]
                      return (
                        <td
                          key={j}
                          className={
                            change ? `silver-cell${change.why.includes('emptied') ? ' is-emptied' : ''}` : undefined
                          }
                          title={
                            change ? `Was: ${change.was ?? 'empty'} · ${change.why}` : v === null ? 'Empty' : String(v)
                          }
                        >
                          {v === null || v === '' ? <span className="raw-empty">empty</span> : String(v)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
