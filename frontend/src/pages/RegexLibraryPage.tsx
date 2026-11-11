import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { n, pct, Pill, Seg } from '../components/Lx'
import { useToast } from '../components/Toasts'
import { EmptyState, ErrorAlert, PageHeader } from '../components/ui'
import { RegexVerdict, useRegexCheck } from './RulesPage'

interface Fit {
  code: string
  source: string
  table: string
  column: string
  matched: number
  filled: number
}

const rulesLink = (pattern: string, place: Record<string, string> = {}) =>
  `/rules?${new URLSearchParams({ ...place, regex: pattern })}`

// Regex library: a tester on top (try a regex on every profiled table, best fit first, and keep it), then the
// ready-made and saved regexes as cards to test or use in a rule.
export function RegexLibraryPage() {
  const toast = useToast()
  const library = useApi(() => api.regexLibrary(), [])
  const [pattern, setPattern] = useState('')
  const [name, setName] = useState('')
  const [group, setGroup] = useState('All')
  const check = useRegexCheck(pattern)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [fits, setFits] = useState<{ pattern: string; rows: Fit[] } | null>(null)
  const tables = library.data?.tables ?? []
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
      setFits({ pattern, rows: rows.filter((f) => f.matched).sort((a, b) => b.matched / b.filled - a.matched / a.filled) })
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
    setFits(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const cards = [
    ...saved.map((r) => ({ key: `s${r.id}`, id: r.id, name: r.name, group: 'Saved', pattern: r.pattern, good: '', bad: '' })),
    ...ready.map((r) => ({ key: r.pattern, id: 0, name: r.name, group: r.group, pattern: r.pattern, good: r.example, bad: r.bad[0] })),
  ]
  const groups = ['All', ...Array.from(new Set(cards.map((c) => c.group)))]
  const shown = cards.filter((c) => group === 'All' || c.group === group)

  return (
    <>
      <PageHeader title="Regex library" description="Ready regular expressions. Test one on every table, or use it in a rule." />
      {library.error && <ErrorAlert message={library.error} />}
      <div className="lx-panel lx-tester">
        <span className="lx-cap">Test on all tables</span>
        <div className="lx-ask">
          <input
            className="input regex-input"
            aria-label="Regular expression to test"
            placeholder="Type a regex, or press Test on a card below"
            spellCheck={false}
            value={pattern}
            onChange={(e) => {
              setPattern(e.target.value)
              setFits(null)
            }}
          />
          <button type="button" className="btn btn-primary" disabled={!check?.valid || !tables.length || progress !== null} onClick={test}>
            {progress ? `Testing ${progress.done + 1} of ${progress.total}…` : `Test on ${tables.length} tables`}
          </button>
        </div>
        <RegexVerdict check={check} />
        {check?.valid && (
          <div className="lx-ask">
            <input
              className="input"
              aria-label="Name for this regex"
              placeholder="Name it to keep it in the library"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button type="button" className="btn" disabled={!name.trim()} onClick={save}>
              Save to library
            </button>
          </div>
        )}
        {fits &&
          (fits.rows.length === 0 ? (
            <p className="muted">No column matches this regex.</p>
          ) : (
            <div className="lx-scroll is-short">
              <table className="lx-mini">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Table</th>
                    <th className="num">Match</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {fits.rows.map((f) => (
                    <tr key={`${f.code}:${f.table}:${f.column}`}>
                      <td>
                        <strong>{f.column}</strong>
                      </td>
                      <td className="muted">
                        {f.source} · {f.table}
                      </td>
                      <td className="num">
                        {pct(f.matched, f.filled)}% <span className="muted">({n(f.matched)})</span>
                      </td>
                      <td>
                        <Link className="btn btn-sm" to={rulesLink(fits.pattern, { source: f.code, table: f.table, column: f.column })}>
                          Use here
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>

      {!library.data && !library.error && (
        <div className="lx-panel">
          <Loader kind="scan" label="Loading the library" />
        </div>
      )}
      {library.data && (
        <>
          <Seg label="Kind of regex" value={group} onChange={setGroup} options={groups.map((g) => ({ value: g, label: g }))} />
          {shown.length === 0 ? (
            <div className="lx-panel">
              <EmptyState icon="key" title="Nothing here yet" />
            </div>
          ) : (
            <div className="lx-cards">
              {shown.map((c) => (
                <article key={c.key} className="lx-panel lx-rx">
                  <header>
                    <h4>{c.name}</h4>
                    <Pill tone="plain">{c.group}</Pill>
                  </header>
                  <code className="lx-code">{c.pattern}</code>
                  {(c.good || c.bad) && (
                    <div className="lx-pair">
                      {c.good && (
                        <span className="is-good-text">
                          <Icon name="check" size={13} /> {c.good}
                        </span>
                      )}
                      <span className="is-bad-text">
                        <Icon name="x" size={13} /> {c.bad || '(empty)'}
                      </span>
                    </div>
                  )}
                  <footer>
                    <button type="button" className="btn btn-sm" onClick={() => tryIt(c.pattern)}>
                      Test
                    </button>
                    <Link className="btn btn-sm btn-primary" to={rulesLink(c.pattern)}>
                      Use in a rule
                    </Link>
                    {c.id > 0 && (
                      <button type="button" className="btn btn-sm" onClick={() => remove(c.id)}>
                        Delete
                      </button>
                    )}
                  </footer>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}
