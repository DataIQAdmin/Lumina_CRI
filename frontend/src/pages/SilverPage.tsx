import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { SilverTable } from '../api/types'
import { useApi } from '../api/useApi'
import { ConnectorPicker } from '../components/ConnectorPicker'
import { PipelineBar } from '../components/PipelineBar'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { Card, EmptyState, ErrorAlert, PageHeader } from '../components/ui'

const n = (v: number) => v.toLocaleString('en-IN')

// The silver layer: only rows that pass every regex applied to their table. The rest stay in rejected, with the
// failed cells marked. A table without rules has no silver rows.
export function SilverPage() {
  const sources = useApi(() => api.rawSources(), [])
  const [params, setParams] = useSearchParams()
  const list = (sources.data?.sources ?? []).filter((s) => s.tables > 0)
  const chosen = list.find((s) => s.code === params.get('source')) ?? list[0]
  const table = params.get('table')

  return (
    <>
      <PageHeader title="Silver layer" description="Only the rows that pass your rules. All other rows stay in rejected." />
      <PipelineBar />
      {sources.error && <ErrorAlert message={sources.error} />}
      {!sources.data && !sources.error && (
        <div className="card">
          <Loader kind="scan" label="Loading connectors" />
        </div>
      )}
      {sources.data && !chosen && (
        <Card>
          <EmptyState icon="layers" title="Nothing here yet">
            Profile a table on <Link to="/profiling">Data profiling</Link>, then add rules on{' '}
            <Link to="/rules">Rules</Link>.
          </EmptyState>
        </Card>
      )}
      {chosen && (
        <>
          <ConnectorPicker sources={list} chosen={chosen.code} onChoose={(code) => setParams({ source: code })} />
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
  if (tables.error) return <ErrorAlert message={tables.error} />
  if (!tables.data) {
    return (
      <div className="card">
        <Loader kind="scan" label="Checking rows against the rules" />
      </div>
    )
  }
  return (
    <Card flush title="Tables" description="Click a table to see its rows.">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Table</th>
              <th className="num">Rules</th>
              <th className="num">Rows</th>
              <th className="num">Passed</th>
              <th className="num">Rejected</th>
            </tr>
          </thead>
          <tbody>
            {tables.data.tables.map((t: SilverTable) => (
              <tr key={t.name} className="raw-table-row" onClick={() => onOpen(t.name)}>
                <td>
                  <button type="button" className="link">
                    {t.name}
                  </button>
                </td>
                <td className="num">{t.rules}</td>
                <td className="num">{n(t.rows)}</td>
                {t.rules ? (
                  <>
                    <td className="num">{n(t.passed)}</td>
                    <td className="num">{n(t.rejected)}</td>
                  </>
                ) : (
                  <td className="num muted" colSpan={2}>
                    No rules yet
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function SilverTableDetail({ code, table, onBack }: { code: string; table: string; onBack: () => void }) {
  const [show, setShow] = useState<'passed' | 'rejected'>('passed')
  const [page, setPage] = useState(1)
  const [only, setOnly] = useState('') // show only rows that failed this column
  const rows = useApi(() => api.silverRows(code, table, show, page, only), [code, table, show, page, only])
  const d = rows.data
  const pages = Math.max(1, Math.ceil((d?.count ?? 0) / 50))
  const hasRules = d ? Object.keys(d.rules).length > 0 : true
  const choose = (next: 'passed' | 'rejected') => {
    setShow(next)
    setPage(1)
    setOnly('')
  }
  const failing = (column: string) => {
    setShow('rejected')
    setPage(1)
    setOnly(only === column ? '' : column)
  }

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
                {n(d.passed)} passed · {n(d.rejected)} rejected · {Object.keys(d.rules).length}{' '}
                {Object.keys(d.rules).length === 1 ? 'rule' : 'rules'}
              </span>
            )}
          </div>
        </div>
      </section>

      <div className="pick-pills" role="group" aria-label="Rows to show">
        {(['passed', 'rejected'] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`pick-pill${v === show ? ' is-on' : ''}`}
            aria-pressed={v === show}
            onClick={() => choose(v)}
          >
            {v === 'passed' ? 'Silver rows' : 'Rejected rows'}
            {d ? ` (${n(v === 'passed' ? d.passed : d.rejected)})` : ''}
          </button>
        ))}
      </div>

      {d && d.reasons.length > 0 && (
        <Card title="Why rows were rejected" description="Rows that failed each rule. A row can fail more than one. Click one to see its rows.">
          <ul className="reasons">
            {d.reasons.map((r) => (
              <li key={r.column}>
                <button
                  type="button"
                  className={`count-button${only === r.column ? ' is-on' : ''}`}
                  aria-pressed={only === r.column}
                  onClick={() => failing(r.column)}
                >
                  <span className="reason-row">
                    <strong>{r.column}</strong>
                    <span className="bronze-bar">
                      <i style={{ width: `${Math.round((100 * r.rows) / Math.max(d.rejected, 1))}%` }} />
                    </span>
                    <span className="num">
                      {n(r.rows)} row{r.rows === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rows.error && <ErrorAlert message={rows.error} />}
      {!hasRules ? (
        <Card>
          <EmptyState icon="sliders" title="No rules on this table">
            Silver forms only from rules. <Link to={`/rules?source=${code}&table=${encodeURIComponent(table)}`}>Add a rule</Link>{' '}
            first.
          </EmptyState>
        </Card>
      ) : (
        <Card
          flush
          title={show === 'passed' ? 'Silver rows' : 'Rejected rows'}
          description={
            show === 'rejected'
              ? only
                ? `Only rows that failed ${only}. Red cells failed their rule.`
                : 'Red cells failed their rule.'
              : 'These rows passed every rule.'
          }
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
          {!d && !rows.error && <Loader kind="scan" label="Loading rows" />}
          {d && d.results.length === 0 && (
            <EmptyState icon="check" title={show === 'passed' ? 'No row passed every rule' : 'No rejected rows'} />
          )}
          {d && d.results.length > 0 && (
            <div className="table-wrap raw-preview">
              <table className="table">
                <thead>
                  <tr>
                    {d.column_names.map((c) => (
                      <th key={c}>{c}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {d.results.map((r) => (
                    <tr key={r.position}>
                      {d.column_names.map((c, i) => (
                        <td key={c} className={r.failed.includes(c) ? 'silver-failed' : undefined}>
                          {r.values[i] === null || r.values[i] === '' ? (
                            <span className="muted">Empty</span>
                          ) : (
                            String(r.values[i])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  )
}
