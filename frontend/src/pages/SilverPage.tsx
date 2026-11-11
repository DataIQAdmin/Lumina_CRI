import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { SilverTable } from '../api/types'
import { useApi } from '../api/useApi'
import { Loader } from '../components/Loader'
import { Legend, n, PanelHead, pct, Ring, Seg, Split } from '../components/Lx'
import { EmptyState, ErrorAlert, PageHeader } from '../components/ui'

// The silver layer: tables on the left, the chosen table on the right: how many rows passed every rule, why the
// others were rejected, and the rows themselves. A table without rules has no silver rows.
export function SilverPage() {
  const sources = useApi(() => api.rawSources(), [])
  const [params, setParams] = useSearchParams()
  const list = (sources.data?.sources ?? []).filter((s) => s.tables > 0)
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
        <PageHeader title="Silver layer" />
        <div className="lx-panel">
          <EmptyState icon="layers" title="Nothing here yet">
            Profile a table, then add rules on <Link to="/rules">Rules</Link>.
          </EmptyState>
        </div>
      </>
    )
  }
  return (
    <Tables
      key={chosen.code}
      code={chosen.code}
      sources={list.map((s) => ({ value: s.code, label: s.name }))}
      onSource={(code) => setParams({ source: code })}
    />
  )
}

function Tables({
  code,
  sources,
  onSource,
}: {
  code: string
  sources: { value: string; label: string }[]
  onSource: (code: string) => void
}) {
  const tables = useApi(() => api.silverTables(code), [code])
  const [params, setParams] = useSearchParams()
  const list = tables.data?.tables ?? []
  const open = list.find((t) => t.name === params.get('table')) ?? list.find((t) => t.rules) ?? list[0]
  const passed = list.reduce((sum, t) => sum + t.passed, 0)

  return (
    <>
      <PageHeader
        title="Silver layer"
        description={tables.data ? `${n(passed)} rows passed every rule` : undefined}
        actions={sources.length > 1 && <Seg label="Connector" value={code} options={sources} onChange={onSource} />}
      />
      {tables.error && <ErrorAlert message={tables.error} />}
      {!tables.data && !tables.error && (
        <div className="lx-panel">
          <Loader kind="scan" label="Checking rows against the rules" />
        </div>
      )}
      {open && (
        <div className="lx-two">
          <div className="lx-panel">
            <PanelHead title="Tables" aside={<span className="muted text-sm">{list.length}</span>} />
            <div className="lx-list lx-scroll">
              {list.map((t: SilverTable) => (
                <button
                  key={t.name}
                  type="button"
                  className={t.name === open.name ? 'is-on' : undefined}
                  aria-pressed={t.name === open.name}
                  onClick={() => setParams({ source: code, table: t.name })}
                >
                  {t.rules ? <Ring value={pct(t.passed, t.rows)} label={String(pct(t.passed, t.rows))} /> : <span className="lx-ring is-none" />}
                  <span className="lx-grow">
                    <strong>{t.name}</strong>
                    <small>{t.rules ? `${t.rules} ${t.rules === 1 ? 'rule' : 'rules'}` : 'No rules'}</small>
                  </span>
                </button>
              ))}
            </div>
          </div>
          <Detail key={open.name} code={code} table={open} />
        </div>
      )}
    </>
  )
}

function Detail({ code, table }: { code: string; table: SilverTable }) {
  const [show, setShow] = useState<'passed' | 'rejected'>('passed')
  const [page, setPage] = useState(1)
  const [only, setOnly] = useState('') // show only rows that failed this column
  const rows = useApi(() => api.silverRows(code, table.name, show, page, only), [code, table.name, show, page, only])
  const d = rows.data
  const pages = Math.max(1, Math.ceil((d?.count ?? 0) / 50))

  if (!table.rules) {
    return (
      <div className="lx-panel">
        <EmptyState icon="sliders" title={`No rules on ${table.name}`}>
          Silver forms only from rules.{' '}
          <Link to={`/rules?${new URLSearchParams({ source: code, table: table.name })}`}>Add a rule</Link>
        </EmptyState>
      </div>
    )
  }
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
    <div className="lx-stack">
      <div className="lx-panel lx-hero">
        <div className="lx-stack">
          <span>
            <b className="lx-big">{n(table.passed)}</b> <span className="muted">of {n(table.rows)} rows reached silver</span>
          </span>
          <Split
            thick
            parts={[
              { label: 'Silver', count: table.passed, tone: 'ok' },
              { label: 'Rejected', count: table.rejected, tone: 'bad' },
            ]}
          />
          <Legend
            parts={[
              { label: 'Silver', count: table.passed, tone: 'ok' },
              { label: 'Rejected', count: table.rejected, tone: 'bad' },
            ]}
          />
        </div>
        {d && d.reasons.length > 0 && (
          <div className="lx-reasons">
            <span className="lx-cap">Why rows were rejected</span>
            {d.reasons.map((r) => (
              <button
                key={r.column}
                type="button"
                className={only === r.column ? 'is-on' : undefined}
                aria-pressed={only === r.column}
                onClick={() => failing(r.column)}
              >
                <span>{r.column}</span>
                <span className="lx-bar is-bad">
                  <i style={{ width: `${pct(r.rows, Math.max(table.rejected, 1))}%` }} />
                </span>
                <span className="num muted">{n(r.rows)}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="lx-panel">
        <div className="lx-panel-h">
          <Seg
            label="Rows to show"
            value={show}
            onChange={choose}
            options={[
              { value: 'passed', label: `Silver · ${n(table.passed)}` },
              { value: 'rejected', label: `Rejected · ${n(table.rejected)}` },
            ]}
          />
          {pages > 1 && (
            <span className="lx-pages">
              <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span className="text-sm muted">
                {page} of {pages}
              </span>
              <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </span>
          )}
        </div>
        {rows.error && <ErrorAlert message={rows.error} />}
        {!d && !rows.error && <Loader kind="scan" label="Loading rows" />}
        {d && d.results.length === 0 && <EmptyState icon="check" title={show === 'passed' ? 'No row passed every rule' : 'No rejected rows'} />}
        {d && d.results.length > 0 && (
          <div className="lx-scroll">
            <table className="lx-table lx-data">
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
                      <td key={c} className={r.failed.includes(c) ? 'is-fail' : undefined}>
                        {r.values[i] === null || r.values[i] === '' ? <span className="muted">Empty</span> : String(r.values[i])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
