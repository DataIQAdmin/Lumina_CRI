import { type ReactNode, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { ReadyRegex, RegexCheck, RegexLibrary, RulePreview } from '../api/types'
import { useApi } from '../api/useApi'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { n, PanelHead, pct, Pill, Split } from '../components/Lx'
import { useToast } from '../components/Toasts'
import { EmptyState, ErrorAlert, PageHeader } from '../components/ui'

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

// Rules: columns on the left, the chosen column's rule on the right in three steps. Only rows passing every applied
// rule reach silver. Connector, table and column live in the address, so the regex library can link here.
export function RulesPage() {
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
        <PageHeader title="Rules" />
        <div className="lx-panel">
          <EmptyState icon="sliders" title="No tables yet">
            Profile a table on <Link to="/profiling">Data profiling</Link> first.
          </EmptyState>
        </div>
      </>
    )
  }
  return (
    <TableRules
      key={chosen.code}
      code={chosen.code}
      sources={list.map((s) => ({ code: s.code, name: s.name }))}
      onSource={(code) => setParams({ source: code })}
    />
  )
}

function TableRules({
  code,
  sources,
  onSource,
}: {
  code: string
  sources: { code: string; name: string }[]
  onSource: (code: string) => void
}) {
  const tables = useApi(() => api.rawTables(code), [code])
  const [params, setParams] = useSearchParams()
  const names = (tables.data?.tables ?? []).map((t) => t.name)
  const table = names.find((name) => name === params.get('table')) ?? names[0]
  const regex = params.get('regex')
  const keep: Record<string, string> = regex ? { regex } : {}

  if (tables.error) return <ErrorAlert message={tables.error} />
  if (!table) return null
  return (
    <Columns
      key={table}
      code={code}
      table={table}
      header={(description) => (
        <PageHeader
          title="Rules"
          description={description}
          actions={
            <>
              {sources.length > 1 && (
                <select
                  className="select lx-select"
                  aria-label="Connector"
                  value={code}
                  onChange={(e) => onSource(e.target.value)}
                >
                  {sources.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
              )}
              <select
                className="select lx-select"
                aria-label="Table"
                value={table}
                onChange={(e) => setParams({ source: code, table: e.target.value, ...keep })}
              >
                {names.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </>
          }
        />
      )}
    />
  )
}

function Columns({
  code,
  table,
  header,
}: {
  code: string
  table: string
  header: (description: string) => ReactNode
}) {
  const columns = useApi(() => api.ruleColumns(code, table), [code, table])
  const library = useApi(() => api.regexLibrary(), [])
  const [params, setParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const list = columns.data?.columns ?? []
  const open = list.find((c) => c.name === params.get('column')) ?? list[0]
  const typed = params.get('regex') ?? ''
  const shown = list.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
  const ruled = list.filter((c) => c.pattern).length

  if (columns.error) return <ErrorAlert message={columns.error} />
  const pick = (column: string) => setParams({ source: code, table, column, ...(typed ? { regex: typed } : {}) })
  return (
    <>
      {header(`${table} · ${ruled} of ${list.length} columns have a rule`)}
      {!columns.data || !open ? (
        <div className="lx-panel">
          <Loader kind="scan" label="Loading columns" />
        </div>
      ) : (
        <div className="lx-two">
          <div className="lx-panel">
            <div className="lx-panel-h">
              <label className="lx-search is-wide">
                <Icon name="search" size={15} />
                <input
                  aria-label="Search columns"
                  placeholder="Search columns"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            <div className="lx-list lx-scroll">
              {shown.map((c) => (
                <button
                  key={c.name}
                  type="button"
                  className={c.name === open.name ? 'is-on' : undefined}
                  aria-pressed={c.name === open.name}
                  onClick={() => pick(c.name)}
                >
                  <span className="lx-grow">
                    <strong>{c.name}</strong>
                    <small>{c.pattern ? 'Rule applied' : 'No rule yet'}</small>
                  </span>
                  {c.pattern && c.total ? (
                    <Pill tone={(c.passed ?? 0) === c.total ? 'ok' : 'warn'}>{pct(c.passed ?? 0, c.total)}%</Pill>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
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
      )}
    </>
  )
}

// A regex someone could use, from the AI or the library, with made-up values it lets through and values it stops
// (each checked against the regex). "Use this" only fills the box in step 2.
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
    <div className="lx-offer" role="status">
      <div className="lx-offer-h">
        <Pill tone="plain">{offer.source === 'ai' ? 'Suggested by AI' : 'From the library'}</Pill>
        {offer.total !== undefined && (
          <span className="text-sm muted">
            {n(offer.passed ?? 0)} of {n(offer.total)} rows pass
          </span>
        )}
      </div>
      <code className="lx-code">{offer.pattern}</code>
      {offer.title && <p>{offer.title}</p>}
      {(offer.matching.length > 0 || offer.failing.length > 0) && (
        <div className="lx-examples">
          <div>
            <span className="lx-cap is-good">Valid</span>
            {offer.matching.map((v) => (
              <span key={v} className="lx-example">
                {v}
              </span>
            ))}
          </div>
          <div>
            <span className="lx-cap is-bad">Not valid</span>
            {offer.failing.map((f) => (
              <span key={f.value} className="lx-example">
                {f.value === '' ? '(empty)' : f.value}
                {f.why && <small>{f.why}</small>}
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="lx-row">
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

// The ready-made regexes that fit a column name: "AlternatePhoneNumber" has the words alternate, phone, number.
function suggested(column: string, ready: ReadyRegex[]) {
  const words = column
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
  return ready.filter((r) => r.hints.some((hint) => words.includes(hint)))
}

function LibrarySelect({
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
    <select
      className="select lx-select"
      aria-label="Choose from the library"
      value=""
      onChange={(e) => {
        if (e.target.value) onPick(e.target.value)
      }}
    >
      <option value="">Library</option>
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
  )
}

function Step({ number, title, children }: { number: number; title: string; children: ReactNode }) {
  return (
    <section className="lx-step">
      <h4>
        <b>{number}</b>
        {title}
      </h4>
      {children}
    </section>
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
  const [wish, setWish] = useState('')
  const [asking, setAsking] = useState(false)
  const [offer, setOffer] = useState<Offer | null>(null)
  const [offerError, setOfferError] = useState<string | null>(null)
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
  const ask = async () => {
    setAsking(true)
    setOfferError(null)
    try {
      const got = await api.ruleSuggest(code, table, column, wish)
      setOffer({ source: 'ai', title: got.explanation, pattern: got.pattern, matching: got.matching, failing: got.failing, passed: got.passed, total: got.total })
    } catch (e) {
      setOffer(null)
      setOfferError((e as Error).message)
    } finally {
      setAsking(false)
    }
  }
  const pick = (chosen: string) => {
    const ready = library?.ready.find((r) => r.pattern === chosen)
    const saved = library?.saved.find((r) => r.pattern === chosen)
    setOfferError(null)
    setOffer({
      source: 'library',
      title: ready?.name ?? saved?.name ?? '',
      pattern: chosen,
      matching: ready ? [ready.example] : [],
      failing: ready ? [{ value: ready.bad[0], why: ready.bad[1] }] : [],
    })
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
    <div className="lx-panel">
      <PanelHead
        title={
          <>
            <span className="lx-cap">Column</span>
            <span className="lx-title">{column}</span>
          </>
        }
        aside={<span className="muted text-sm">The whole value must match</span>}
      />
      <Step number={1} title="Get a regex">
        <div className="lx-ask">
          <label className="lx-search is-wide">
            <Icon name="search" size={15} />
            <input
              aria-label="Describe the rule in words (optional)"
              placeholder="Describe the rule, or leave it empty"
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !asking) ask()
              }}
            />
          </label>
          <button type="button" className="btn btn-primary" disabled={asking} onClick={ask}>
            {asking ? 'Thinking…' : 'Suggest with AI'}
          </button>
          <LibrarySelect library={library} column={column} onPick={pick} />
        </div>
        {offerError && <ErrorAlert message={offerError} />}
        {offer && (
          <OfferCard
            offer={offer}
            busy={asking}
            onUse={() => setPattern(offer.pattern)}
            onRetry={offer.source === 'ai' ? ask : undefined}
          />
        )}
      </Step>
      <Step number={2} title="Your regex">
        <input
          className="input regex-input"
          aria-label={`Regular expression for ${column}`}
          placeholder="Use a suggestion, or type a regex"
          spellCheck={false}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
        />
        <RegexVerdict check={check} />
      </Step>
      <Step number={3} title="Preview and apply">
        {error && <ErrorAlert message={error} />}
        {preview && previewed && <PreviewResult result={preview.result} />}
        <div className="lx-row">
          <button type="button" className="btn" disabled={busy || !check?.valid} onClick={showPreview}>
            {previewed ? 'Preview again' : 'Preview'}
          </button>
          <button type="button" className="btn btn-primary" disabled={busy || !previewed} onClick={apply}>
            Apply rule
          </button>
          {applied && (
            <button type="button" className="btn" disabled={busy} onClick={remove}>
              Remove rule
            </button>
          )}
        </div>
      </Step>
    </div>
  )
}

function PreviewResult({ result }: { result: RulePreview }) {
  return (
    <div className="lx-stack">
      <div className="lx-passline">
        <Split
          thick
          parts={[
            { label: 'Pass', count: result.passed, tone: 'ok' },
            { label: 'Rejected', count: result.failed, tone: 'bad' },
          ]}
        />
        <span>
          <b>{n(result.passed)}</b> pass · <b className="is-bad-text">{n(result.failed)}</b> rejected
        </span>
      </div>
      <table className="lx-mini">
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
              <td>
                <code>{s.value === null || s.value === '' ? <span className="muted">Empty</span> : String(s.value)}</code>
              </td>
              <td>
                <Pill tone={s.passed ? 'ok' : 'bad'}>{s.passed ? 'Pass' : 'Fail'}</Pill>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
