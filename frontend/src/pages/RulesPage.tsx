import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { ReadyRegex, RegexCheck, RegexLibrary, RulePreview } from '../api/types'
import { useApi } from '../api/useApi'
import { ConnectorPicker } from '../components/ConnectorPicker'
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
        description="Pick or write a regular expression for a column, preview it, then apply it. Rows that pass go to silver."
      />
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
      <span className="text-sm muted">Choose from the library</span>
      <select
        className="select"
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
        <ul className="rule-columns">
          {list.map((c) => (
            <li key={c.name}>
              <button
                type="button"
                className={c.name === open.name ? 'is-on' : ''}
                aria-pressed={c.name === open.name}
                onClick={() => pick(c.name)}
              >
                <span className="pick-name">{c.name}</span>
                {c.pattern && <Icon name="check" size={14} />}
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
      <div className="stack" style={{ gap: 12 }}>
        <LibraryPicker library={library} column={column} onPick={setPattern} />
        <input
          className="input regex-input"
          aria-label={`Regular expression for ${column}`}
          placeholder="^[6-9][0-9]{9}$"
          spellCheck={false}
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
        />
        <RegexVerdict check={check} />
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
