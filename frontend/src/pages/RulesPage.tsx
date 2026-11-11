import { type ReactNode, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { ReadyRegex, RegexCheck, RegexLibrary, RulePreview } from '../api/types'
import { useApi } from '../api/useApi'
import { ConnectorPicker } from '../components/ConnectorPicker'
import { PipelineBar } from '../components/PipelineBar'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { useToast } from '../components/Toasts'
import { Card, EmptyState, ErrorAlert, PageHeader, StatusBadge } from '../components/ui'

const n = (v: number) => v.toLocaleString('en-IN')

// Tells whether what is typed is a proper regular expression, shortly after typing stops.
export function useRegexCheck(pattern: string) {
  const [check, setCheck] = useState<RegexCheck | null>(null)
  useEffect(() => {
    setCheck(null)
    if (!pattern.trim()) return
    const timer = setTimeout(() => {
      api.regexCheck(pattern).then(setCheck, () => setCheck(null))
    }, 300)
    return () => clearTimeout(timer)
  }, [pattern])
  return check
}

export function RegexVerdict({ check }: { check: RegexCheck | null }) {
  if (!check) return null
  return (
    <p className={`regex-verdict ${check.valid ? 'is-good' : 'is-bad'}`} role="status">
      <Icon name={check.valid ? 'check' : 'alert'} size={14} />
      {check.valid ? 'This is a proper regular expression.' : check.error}
    </p>
  )
}

// Rules: pick a table and a column, write a regex, preview it on 10 rows, then apply it. Only rows passing every
// applied rule reach the silver layer. The chosen place lives in the address, so the regex library can link here.
export function RulesPage() {
  const sources = useApi(() => api.rawSources(), [])
  const [params, setParams] = useSearchParams()
  const list = (sources.data?.sources ?? []).filter((s) => s.tables > 0)
  const chosen = list.find((s) => s.code === params.get('source')) ?? list[0]

  return (
    <>
      <PageHeader
        title="Rules"
        description="Ask AI, pick or write a regular expression for a column, preview it, then apply it. Rows that pass go to silver."
      />
      <PipelineBar />
      {sources.error && <ErrorAlert message={sources.error} />}
      {!sources.data && !sources.error && (
        <div className="card">
          <Loader kind="scan" label="Loading connectors" />
        </div>
      )}
      {sources.data && !chosen && (
        <Card>
          <EmptyState icon="sliders" title="No tables yet">
            Profile a table on <Link to="/profiling">Data profiling</Link> first. Then you can add rules to its columns.
          </EmptyState>
        </Card>
      )}
      {chosen && (
        <>
          <ConnectorPicker sources={list} chosen={chosen.code} onChoose={(code) => setParams({ source: code })} />
          <TableRules key={chosen.code} code={chosen.code} />
        </>
      )}
    </>
  )
}

// The ready-made regexes that fit a column name: "AlternatePhoneNumber" has the words alternate, phone, number.
function suggested(column: string, ready: ReadyRegex[]) {
  const words = column
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
  return ready.filter((r) => r.hints.some((hint) => words.includes(hint)))
}

function LibraryPicker({
  library,
  column,
  onPick,
}: {
  library: RegexLibrary | null
  column: string
  onPick: (pattern: string) => void
}) {
  if (!library) return null
  const fits = suggested(column, library.ready)
  return (
    <label className="regex-pick">
      <span className="text-sm muted">Or choose from the library</span>
      <select
        className="select"
        aria-label="Choose from the library"
        value=""
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value)
        }}
      >
        <option value="">Pick a regex, or type your own below</option>
        {fits.length > 0 && (
          <optgroup label="Suggested for this column">
            {fits.map((r) => (
              <option key={r.pattern} value={r.pattern}>
                {r.name}
              </option>
            ))}
          </optgroup>
        )}
        {library.saved.length > 0 && (
          <optgroup label="Saved by your team">
            {library.saved.map((r) => (
              <option key={r.id} value={r.pattern}>
                {r.name}
              </option>
            ))}
          </optgroup>
        )}
        <optgroup label="All ready-made">
          {library.ready.map((r) => (
            <option key={r.pattern} value={r.pattern}>
              {r.name}
            </option>
          ))}
        </optgroup>
      </select>
    </label>
  )
}

// A regex someone could use, from the AI or the library: what it checks, made-up values it lets through and values
// it stops (each checked against the regex), and how this column does. "Use this" only fills the box below.
interface Offer {
  source: 'ai' | 'library'
  title: string
  pattern: string
  matching: string[]
  failing: { value: string; why: string }[]
  passed?: number
  total?: number
}

function OfferCard({ offer, onUse, onRetry, busy }: { offer: Offer; onUse: () => void; onRetry?: () => void; busy?: boolean }) {
  return (
    <div className="offer" role="status">
      <div className="offer-head">
        <span className="offer-tag">{offer.source === 'ai' ? 'Suggested by AI' : 'From the library'}</span>
        {offer.total !== undefined && (
          <span className="text-sm muted">
            {n(offer.passed ?? 0)} of {n(offer.total)} rows in this column pass
          </span>
        )}
      </div>
      <code className="offer-pattern">{offer.pattern}</code>
      {offer.title && <p className="text-sm">{offer.title}</p>}
      {(offer.matching.length > 0 || offer.failing.length > 0) && (
        <div className="offer-examples">
          <div>
            <span className="offer-label is-good">
              <Icon name="check" size={13} /> Valid
            </span>
            <ul>
              {offer.matching.map((v) => (
                <li key={v}>
                  <code>{v}</code>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <span className="offer-label is-bad">
              <Icon name="x" size={13} /> Not valid
            </span>
            <ul>
              {offer.failing.map((f) => (
                <li key={f.value}>
                  <code>{f.value === '' ? '(empty)' : f.value}</code>
                  {f.why && <span className="text-xs muted"> {f.why}</span>}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-sm btn-primary" onClick={onUse}>
          Use this
        </button>
        {onRetry && (
          <button type="button" className="btn btn-sm" disabled={busy} onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    </div>
  )
}

// Step 1: ask the AI (optionally in words), or pick from the library. Either way an OfferCard shows the regex with
// its examples, and nothing reaches the box until "Use this".
function GetRegex({
  code,
  table,
  column,
  library,
  onUse,
}: {
  code: string
  table: string
  column: string
  library: RegexLibrary | null
  onUse: (pattern: string) => void
}) {
  const [wish, setWish] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [offer, setOffer] = useState<Offer | null>(null)
  const ask = async () => {
    setBusy(true)
    setError(null)
    try {
      const got = await api.ruleSuggest(code, table, column, wish)
      setOffer({ source: 'ai', title: got.explanation, pattern: got.pattern, matching: got.matching,
        failing: got.failing, passed: got.passed, total: got.total })
    } catch (e) {
      setOffer(null)
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const pick = (pattern: string) => {
    const ready = library?.ready.find((r) => r.pattern === pattern)
    const saved = library?.saved.find((r) => r.pattern === pattern)
    setError(null)
    setOffer({
      source: 'library',
      title: ready?.name ?? saved?.name ?? '',
      pattern,
      matching: ready ? [ready.example] : [],
      failing: ready ? [{ value: ready.bad[0], why: ready.bad[1] }] : [],
    })
  }
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="ai-helper-ask">
        <input
          className="input"
          aria-label="Describe the rule in words (optional)"
          placeholder="Optional: describe the rule, e.g. 10-digit mobile starting with 6 to 9"
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !busy) ask()
          }}
        />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={ask}>
          <Icon name="search" size={14} /> {busy ? 'Thinking...' : 'Suggest with AI'}
        </button>
      </div>
      <LibraryPicker library={library} column={column} onPick={pick} />
      <p className="text-xs muted">
        Only the column name and the shape of its values (like AAAAA9999A) go to the AI, never the values.
      </p>
      {error && <ErrorAlert message={error} />}
      {offer && (
        <OfferCard
          offer={offer}
          busy={busy}
          onUse={() => onUse(offer.pattern)}
          onRetry={offer.source === 'ai' ? ask : undefined}
        />
      )}
    </div>
  )
}

function Step({ n: number, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="rule-step">
      <h3>
        <span className="step-n">{number}</span> {title}
      </h3>
      {children}
    </section>
  )
}

function TableRules({ code }: { code: string }) {
  const tables = useApi(() => api.rawTables(code), [code])
  const [params, setParams] = useSearchParams()
  const names = (tables.data?.tables ?? []).map((t) => t.name)
  // A regex brought from the library stays while people choose where to use it.
  const place = (source: string, table: string) => {
    const regex = params.get('regex')
    return { source, table, ...(regex ? { regex } : {}) }
  }
  const table = names.find((name) => name === params.get('table')) ?? names[0]

  if (tables.error) return <ErrorAlert message={tables.error} />
  if (!table) return null
  return (
    <>
      <label className="rule-table">
        <span>Table</span>
        <select
          className="select"
          value={table}
          onChange={(e) => setParams(place(code, e.target.value))}
        >
          {names.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
      </label>
      <Columns key={table} code={code} table={table} />
    </>
  )
}

function Columns({ code, table }: { code: string; table: string }) {
  const columns = useApi(() => api.ruleColumns(code, table), [code, table])
  const library = useApi(() => api.regexLibrary(), [])
  const [params, setParams] = useSearchParams()
  const list = columns.data?.columns ?? []
  const open = list.find((c) => c.name === params.get('column')) ?? list[0]
  const typed = params.get('regex') ?? ''
  const [search, setSearch] = useState('')
  const shown = list.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))

  if (columns.error) return <ErrorAlert message={columns.error} />
  if (!columns.data || !open) {
    return (
      <div className="card">
        <Loader kind="scan" label="Loading columns" />
      </div>
    )
  }
  const pick = (column: string) => setParams({ source: code, table, column, ...(typed ? { regex: typed } : {}) })
  return (
    <div className="rule-layout">
      <Card flush title="Columns" description={`${list.filter((c) => c.pattern).length} of ${list.length} have a rule`}>
        <div className="rule-search">
          <input
            className="input input-sm"
            aria-label="Search columns"
            placeholder="Search columns"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <ul className="rule-columns">
          {shown.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                className={c.name === open.name ? 'is-on' : ''}
                aria-pressed={c.name === open.name}
                onClick={() => pick(c.name)}
              >
                <span className="pick-name">{c.name}</span>
                {c.pattern && (
                  <span className="rule-status" title={c.pattern}>
                    <Icon name="check" size={13} />
                    {c.total ? `${Math.round((100 * (c.passed ?? 0)) / c.total)}% pass` : 'Rule'}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </Card>
      <RuleEditor
        key={`${open.name}:${open.pattern}:${typed}`}
        code={code}
        table={table}
        column={open.name}
        applied={open.pattern}
        start={typed || open.pattern}
        library={library.data}
        onChanged={columns.reload}
      />
    </div>
  )
}

function RuleEditor({
  code,
  table,
  column,
  applied,
  start,
  library,
  onChanged,
}: {
  code: string
  table: string
  column: string
  applied: string
  start: string
  library: RegexLibrary | null
  onChanged: () => void
}) {
  const toast = useToast()
  const [pattern, setPattern] = useState(start)
  const check = useRegexCheck(pattern)
  const [preview, setPreview] = useState<{ pattern: string; result: RulePreview } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const previewed = preview?.pattern === pattern

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const showPreview = () =>
    run(async () => setPreview({ pattern, result: await api.rulePreview(code, table, column, pattern) }))
  const apply = () =>
    run(async () => {
      const done = await api.ruleApply(code, table, column, pattern)
      toast('success', `Rule applied. ${n(done.passed)} of ${n(done.total)} rows pass.`)
      onChanged()
    })
  const remove = () =>
    run(async () => {
      await api.ruleRemove(code, table, column)
      toast('success', 'Rule removed.')
      onChanged()
    })

  return (
    <Card title={column} description="The whole value must match. Empty values fail unless your regex allows them.">
      <div className="rule-steps">
        <Step n={1} title="Get a regex">
          <GetRegex code={code} table={table} column={column} library={library} onUse={setPattern} />
        </Step>
        <Step n={2} title="Your regex">
          <div className="stack" style={{ gap: 6 }}>
            <input
              className="input regex-input"
              aria-label={`Regular expression for ${column}`}
              placeholder="Use a suggestion above, or type a regex here"
              spellCheck={false}
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
            <RegexVerdict check={check} />
          </div>
        </Step>
        <Step n={3} title="Preview and apply">
          <div className="stack" style={{ gap: 10 }}>
            {error && <ErrorAlert message={error} />}
            <div className="row" style={{ gap: 8 }}>
              <button type="button" className="btn" disabled={busy || !check?.valid} onClick={showPreview}>
                <Icon name="search" size={14} /> Preview
              </button>
              <button type="button" className="btn btn-primary" disabled={busy || !previewed} onClick={apply}>
                <Icon name="check" size={14} /> Apply
              </button>
              {applied && (
                <button type="button" className="btn" disabled={busy} onClick={remove}>
                  Remove rule
                </button>
              )}
            </div>
            {!previewed && <p className="text-sm muted">Preview first. Nothing changes until you click Apply.</p>}
            {preview && previewed && <PreviewRows result={preview.result} />}
          </div>
        </Step>
      </div>
    </Card>
  )
}

function PreviewRows({ result }: { result: RulePreview }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="text-sm">
        <strong>{n(result.passed)}</strong> of {n(result.total)} rows pass. <strong>{n(result.failed)}</strong> would be
        rejected.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="num">Row</th>
              <th>Value</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {result.sample.map((s) => (
              <tr key={s.position}>
                <td className="num muted">{s.position + 1}</td>
                <td>{s.value === null || s.value === '' ? <span className="muted">Empty</span> : String(s.value)}</td>
                <td>
                  <StatusBadge tone={s.passed ? 'good' : 'bad'}>{s.passed ? 'Pass' : 'Fail'}</StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
