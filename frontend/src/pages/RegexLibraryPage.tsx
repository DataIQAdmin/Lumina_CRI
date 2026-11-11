import { useRef, useState } from 'react'
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
const rulesLink = (pattern: string, place: Record<string, string> = {}) =>
  `/rules?${new URLSearchParams({ ...place, regex: pattern })}`

// Regex library: ready-made and saved regexes to use on Rules without writing them, a tester that tries one on every
// column of every profiled table, best fit first, and the regexes already applied. Chosen regexes open on Rules for
// the usual preview.
export function RegexLibraryPage() {
  const toast = useToast()
  const library = useApi(() => api.regexLibrary(), [])
  const [pattern, setPattern] = useState('')
  const [name, setName] = useState('')
  const check = useRegexCheck(pattern)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [fits, setFits] = useState<{ pattern: string; rows: Fit[] } | null>(null)
  const top = useRef<HTMLDivElement>(null)
  const tables = library.data?.tables ?? []
  const patterns = library.data?.patterns ?? []
  const saved = library.data?.saved ?? []
  const ready = library.data?.ready ?? []

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
  const save = async () => {
    try {
      await api.regexSave(name, pattern)
      toast('success', 'Saved to the library.')
      setName('')
      library.reload()
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }
  const remove = async (id: number) => {
    try {
      await api.regexDelete(id)
      library.reload()
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }
  const tryIt = (next: string) => {
    setPattern(next)
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const shown = fits?.rows.filter((f) => f.matched > 0) ?? []
  const entries = [
    ...saved.map((r) => ({ ...r, example: '', bad: ['', ''] as [string, string] })),
    ...ready.map((r) => ({ ...r, id: 0 })),
  ]

  return (
    <>
      <div ref={top} className="pick-results">
        <PageHeader
          title="Regex library"
          description="Ready regular expressions to use on Rules, and a tester to see where each one fits."
        />
      </div>
      {library.error && <ErrorAlert message={library.error} />}
      <Card
        title="Test a regex"
        description={library.data ? `Tries it on every column of ${tables.length} profiled tables.` : 'Tries it on every column.'}
      >
        <div className="stack" style={{ gap: 12 }}>
          <input
            className="input regex-input"
            aria-label="Regular expression to test"
            placeholder="Pick one below, or type your own"
            spellCheck={false}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
          <RegexVerdict check={check} />
          <div className="regex-save">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!check?.valid || !tables.length || progress !== null}
              onClick={test}
            >
              <Icon name="search" size={14} /> Test on all tables
            </button>
            <input
              className="input"
              aria-label="Name for this regex"
              placeholder="Name, to keep it in the library"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="button" className="btn" disabled={!check?.valid || !name.trim()} onClick={save}>
              Save to library
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
                          to={rulesLink(fits.pattern, { source: f.code, table: f.table, column: f.column })}
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

      <Card flush title="Library" description="Test a regex above, or use it on Rules without writing it.">
        {!library.data && !library.error && <Loader kind="scan" label="Loading the library" />}
        {entries.length > 0 && (
          <div className="table-wrap">
            <table className="table regex-ready">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Regex</th>
                  <th>Valid</th>
                  <th>Not valid</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {entries.map((r) => (
                  <tr key={r.pattern}>
                    <td>
                      <strong>{r.name}</strong>
                      {r.id > 0 && <small className="muted"> Saved</small>}
                    </td>
                    <td>
                      <code>{r.pattern}</code>
                    </td>
                    <td className="text-sm muted">{r.example}</td>
                    <td className="text-sm muted" title={r.bad[1]}>
                      {r.bad[0] || (r.bad[1] ? '(empty)' : '')}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <button type="button" className="btn btn-sm" onClick={() => tryIt(r.pattern)}>
                          Test
                        </button>
                        <Link className="btn btn-sm" to={rulesLink(r.pattern)}>
                          Use in Rules
                        </Link>
                        {r.id > 0 && (
                          <button type="button" className="btn btn-sm" onClick={() => remove(r.id)}>
                            Delete
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {patterns.length > 0 && (
        <Card flush title="Regexes in use" description="Every regex applied so far, and where.">
          <ul className="regex-list">
            {patterns.map((p) => (
              <li key={p.pattern}>
                <button type="button" className="link" title="Put it in the tester" onClick={() => tryIt(p.pattern)}>
                  <code>{p.pattern}</code>
                </button>
                <span className="text-sm muted">
                  {p.used.map((u) => `${u.source}: ${u.table}.${u.column}`).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  )
}
