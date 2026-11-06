import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { useToast } from '../components/Toasts'
import { Card, EmptyState, ErrorAlert, PageHeader } from '../components/ui'
import { RegexVerdict, useRegexCheck } from './RulesPage'

interface Fit {
  code: string
  source: string
  table: string
  column: string
  matched: number
  filled: number
}

const percent = (f: Fit) => Math.round((100 * f.matched) / f.filled)

// Regex library: the regexes in use and where, and a tester that tries one on every column of every profiled
// table, best fit first, so people can see where to use it. A chosen column opens on Rules for the usual preview.
export function RegexLibraryPage() {
  const toast = useToast()
  const library = useApi(() => api.regexLibrary(), [])
  const [pattern, setPattern] = useState('')
  const check = useRegexCheck(pattern)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [fits, setFits] = useState<{ pattern: string; rows: Fit[] } | null>(null)
  const tables = library.data?.tables ?? []
  const patterns = library.data?.patterns ?? []

  const test = async () => {
    const rows: Fit[] = []
    try {
      for (const [i, t] of tables.entries()) {
        setProgress({ done: i, total: tables.length })
        const { columns } = await api.regexTest(t.code, t.table, pattern)
        rows.push(...columns.map((c) => ({ ...c, code: t.code, source: t.source, table: t.table })))
      }
      setFits({ pattern, rows: rows.sort((a, b) => percent(b) - percent(a)) })
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setProgress(null)
    }
  }
  const shown = fits?.rows.filter((f) => f.matched > 0) ?? []

  return (
    <>
      <PageHeader title="Regex library" description="Test a regular expression on all tables to see where it fits." />
      {library.error && <ErrorAlert message={library.error} />}
      <Card
        title="Test a regex"
        description={library.data ? `Tries it on every column of ${tables.length} profiled tables.` : 'Tries it on every column.'}
      >
        <div className="stack" style={{ gap: 12 }}>
          <input
            className="input regex-input"
            aria-label="Regular expression to test"
            placeholder="^[A-Z]{5}[0-9]{4}[A-Z]$"
            spellCheck={false}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
          <RegexVerdict check={check} />
          <div className="row" style={{ gap: 8 }}>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!check?.valid || !tables.length || progress !== null}
              onClick={test}
            >
              <Icon name="search" size={14} /> Test on all tables
            </button>
          </div>
          {progress && (
            <div className="raw-progress" role="status" aria-live="polite">
              <span>
                Testing table {progress.done + 1} of {progress.total}
              </span>
              <span className="raw-progress-bar" aria-hidden="true">
                <i style={{ width: `${(100 * progress.done) / progress.total}%` }} />
              </span>
            </div>
          )}
        </div>
      </Card>

      {fits && (
        <Card
          flush
          title="Where it fits"
          description={`Best fit first. ${fits.rows.length - shown.length} columns did not match at all.`}
        >
          {shown.length === 0 ? (
            <EmptyState icon="search" title="No column matches this regex" />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Table</th>
                    <th>Connector</th>
                    <th className="num">Match</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f) => (
                    <tr key={`${f.code}:${f.table}:${f.column}`}>
                      <td>
                        <strong>{f.column}</strong>
                      </td>
                      <td>{f.table}</td>
                      <td>{f.source}</td>
                      <td className="num">
                        {percent(f)}%{' '}
                        <small className="muted">
                          ({f.matched} of {f.filled})
                        </small>
                      </td>
                      <td>
                        <Link
                          className="btn btn-sm"
                          to={`/rules?${new URLSearchParams({
                            source: f.code,
                            table: f.table,
                            column: f.column,
                            regex: fits.pattern,
                          })}`}
                        >
                          Use here
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      <Card flush title="Regexes in use" description="Every regex applied so far, and where.">
        {!library.data && !library.error && <Loader kind="scan" label="Loading" />}
        {library.data && patterns.length === 0 && (
          <EmptyState icon="sliders" title="No regex applied yet">
            Apply one on <Link to="/rules">Rules</Link> and it will be kept here.
          </EmptyState>
        )}
        {patterns.length > 0 && (
          <ul className="regex-list">
            {patterns.map((p) => (
              <li key={p.pattern}>
                <button type="button" className="link" title="Put it in the tester" onClick={() => setPattern(p.pattern)}>
                  <code>{p.pattern}</code>
                </button>
                <span className="text-sm muted">
                  {p.used.map((u) => `${u.source}: ${u.table}.${u.column}`).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  )
}
