import { type ReactNode, useState, useSyncExternalStore } from 'react'

import { api } from '../../api/client'
import type { ColumnCounts, RawSource, RawTable, SilverRows, SilverTable } from '../../api/types'
import { useApi } from '../../api/useApi'
import { formatRelative } from '../../format'
import { profileJob } from '../../profileJob'
import { Dialog } from '../Dialog'
import { Explain } from '../Explain'
import { Icon } from '../Icon'
import { Loader } from '../Loader'
import { Legend, n, pct, Pill, Seg, Split } from '../Lx'
import { RuleDialog } from '../RuleDialog'
import { EmptyState, ErrorAlert } from '../ui'
import { ColumnDialog } from './ColumnDialog'
import { Bar, needsLook, PER_PAGE, Pager, status } from './kit'

// Step 3: the chosen tables in order on the left; the open one on the right with its problems, its rules and the
// result, then on to the next table.
export function WorkStep({
  source,
  list,
  current,
  canRead,
  canViewRows,
  canManage,
  ask,
  onOpen,
  onTables,
  onDone,
}: {
  source: RawSource
  list: string[]
  current: string
  canRead: boolean
  canViewRows: boolean
  canManage: boolean
  ask: { column: string; regex: string } | null
  onOpen: (table: string) => void
  onTables: () => void
  onDone: () => void
}) {
  const tables = useApi(() => api.rawTables(source.code), [source.code])
  const job = useSyncExternalStore(profileJob.subscribe, profileJob.get)
  const info = (t: string) => tables.data?.tables.find((x) => x.name === t)
  const at = list.indexOf(current)
  const running = (t: string) => !!job && !job.finished && job.code === source.code && job.tables.some((x) => x.name === t)

  return (
    <div className="dq-work">
      <aside className="card dq-worklist">
        <div className="hm-h">
          <h2>Your tables</h2>
          <button type="button" className="link text-sm" onClick={onTables}>
            Change
          </button>
        </div>
        <ol>
          {list.map((t, i) => {
            const d = info(t)
            return (
              <li key={t}>
                <button type="button" className={t === current ? 'is-on' : undefined} aria-current={t === current ? 'true' : undefined} onClick={() => onOpen(t)}>
                  <i>{i + 1}</i>
                  <span className="hm-grow">
                    <b>{t}</b>
                    <small>
                      {running(t) ? 'Checking…' : !d ? 'Not checked yet' : d.to_check ? `${d.to_check} need attention` : 'All fine'}
                    </small>
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      </aside>
      <div className="dq-workmain">
        <TableWork
          key={`${current}:${info(current)?.read_at ?? ''}`}
          source={source}
          table={current}
          checked={info(current)}
          checking={running(current)}
          canRead={canRead}
          canViewRows={canViewRows}
          canManage={canManage}
          ask={ask}
        />
        <div className="dq-nav">
          {at > 0 ? (
            <button type="button" className="btn" onClick={() => onOpen(list[at - 1])}>
              ← {list[at - 1]}
            </button>
          ) : (
            <span />
          )}
          {at < list.length - 1 ? (
            <button type="button" className="btn btn-primary" onClick={() => onOpen(list[at + 1])}>
              Next table: {list[at + 1]} →
            </button>
          ) : (
            <button type="button" className="btn btn-primary" onClick={onDone}>
              Continue to Map fields →
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ number, title, aside, children }: { number: number; title: ReactNode; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card dq-section">
      <div className="hm-h">
        <h2>
          <b className="dq-num">{number}</b>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function TableWork({
  source,
  table,
  checked,
  checking,
  canRead,
  canViewRows,
  canManage,
  ask,
}: {
  source: RawSource
  table: string
  checked?: RawTable
  checking: boolean
  canRead: boolean
  canViewRows: boolean
  canManage: boolean
  ask: { column: string; regex: string } | null
}) {
  const profile = useApi(() => (checked ? api.rawProfile(source.code, table) : Promise.resolve(null)), [source.code, table, checked?.read_at])
  const busy = useSyncExternalStore(profileJob.subscribe, profileJob.running)
  const [version, setVersion] = useState(0)
  const [fixing, setFixing] = useState<{ column?: string; start?: string } | null>(ask ? { column: ask.column, start: ask.regex } : null)
  const check = () => profileJob.start(source.code, source.name, [table])
  const p = profile.data

  const head = (
    <div className="dq-tablehead">
      <div>
        <h2>{table}</h2>
        <span className="muted">{p ? `${source.name} · ${n(p.rows)} rows · checked ${formatRelative(p.read_at)}` : source.name}</span>
      </div>
      {canRead && checked && (
        <button type="button" className="btn" disabled={busy} onClick={check}>
          Check again
        </button>
      )}
    </div>
  )

  if (!checked) {
    return (
      <>
        {head}
        <section className="card">
          <EmptyState icon="search" title={checking ? 'Checking this table…' : 'This table is not checked yet'}>
            {checking ? (
              'Its problems show here when the check ends.'
            ) : canRead ? (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={check}>
                Check it now
              </button>
            ) : (
              'A data steward or administrator checks tables.'
            )}
          </EmptyState>
        </section>
      </>
    )
  }
  if (profile.error) return <ErrorAlert message={profile.error} />
  if (!p) return <Loader kind="scan" label="Loading the table" />
  const columns = p.profile.columns

  return (
    <>
      {head}
      <Problems
        code={source.code}
        source={source.name}
        table={p}
        columns={columns}
        canViewRows={canViewRows}
        onFix={canManage ? (column) => setFixing({ column }) : undefined}
      />
      {canManage && (
        <Rules
          key={version}
          code={source.code}
          source={source.name}
          table={table}
          columns={columns}
          rows={p.rows}
          fixing={fixing}
          setFixing={setFixing}
          onChanged={() => setVersion(version + 1)}
        />
      )}
      {canManage && <Result key={`r${version}`} code={source.code} source={source.name} table={table} />}
    </>
  )
}

// ---------------- 1. Problems ----------------

function Problems({
  code,
  source,
  table,
  columns,
  canViewRows,
  onFix,
}: {
  code: string
  source: string
  table: RawTable
  columns: ColumnCounts[]
  canViewRows: boolean
  onFix?: (column: string) => void
}) {
  const attention = columns.filter(needsLook)
  const [filter, setFilter] = useState<'all' | 'check' | 'fine'>(attention.length ? 'check' : 'all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<ColumnCounts | null>(null)
  const rows = table.rows
  const filled = columns.reduce((a, c) => a + c.filled, 0)
  const cells = rows * columns.length
  const term = q.trim().toLowerCase()
  const shown = columns.filter((c) => c.name.toLowerCase().includes(term) && (filter === 'all' || (filter === 'check' ? needsLook(c) : !needsLook(c))))
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE))
  const slice = shown.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <Section number={1} title={`Problems in ${table.name}`}>
      <p className="dq-summary dq-pad">
        <b>{n(columns.length)} columns</b> checked.{' '}
        <Explain title={`${pct(filled, cells)}% filled`} text={`Values that are not empty in ${table.name}.`} calc={`${n(filled)} filled values\n÷ ${n(cells)} values (${n(columns.length)} columns × ${n(rows)} rows)\n= ${pct(filled, cells)}%`}>
          <b>{pct(filled, cells)}% filled</b>
        </Explain>
        , and{' '}
        <Explain
          title={`${attention.length} columns need attention`}
          text="A column needs attention when it has empty values or values that do not fit, like phone numbers of the wrong length."
          calc={attention.length ? attention.map((c) => c.name).join('\n') : undefined}
        >
          <b>
            {attention.length} column{attention.length === 1 ? ' needs' : 's need'} attention
          </b>
        </Explain>
        . Click a column to see its values.
      </p>
      <div className="hm-h dq-tools">
        <Seg
          label="Show"
          value={filter}
          onChange={(v) => {
            setFilter(v)
            setPage(1)
          }}
          options={[
            { value: 'check', label: `Need attention · ${attention.length}` },
            { value: 'fine', label: `Look fine · ${columns.length - attention.length}` },
            { value: 'all', label: `All ${columns.length}` },
          ]}
        />
        <label className="lx-search">
          <Icon name="search" size={15} />
          <input
            placeholder="Search columns"
            aria-label="Search columns"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setPage(1)
            }}
          />
        </label>
      </div>
      <div className="table-wrap">
        <table className="sx-table">
          <thead>
            <tr>
              <th>Column</th>
              <th style={{ width: 240 }}>Filled</th>
              <th>Status</th>
              <th aria-label="Open" />
            </tr>
          </thead>
          <tbody>
            {slice.map((c) => {
              const st = status(c, rows)
              return (
                <tr key={c.name} tabIndex={0} onClick={() => setOpen(c)} onKeyDown={(e) => e.key === 'Enter' && setOpen(c)}>
                  <td>
                    <b className="dq-name">{c.name}</b>
                  </td>
                  <td>
                    <span className="dq-filled">
                      <Bar value={pct(c.filled, rows)} tone={c.filled < rows ? 'warn' : undefined} />
                      <span className="num text-sm muted">
                        {n(c.filled)} of {n(rows)}
                      </span>
                    </span>
                  </td>
                  <td>
                    <Pill tone={st.tone}>{st.text}</Pill>
                  </td>
                  <td className="dq-go">
                    <Icon name="chevron-right" size={16} />
                  </td>
                </tr>
              )
            })}
            {slice.length === 0 && (
              <tr>
                <td colSpan={4} className="muted sx-empty">
                  {filter === 'check' && !term ? 'No column needs attention.' : 'No column matches.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager page={page} pages={pages} onPage={setPage} text={`Showing ${n(shown.length)} of ${n(columns.length)} columns`} />
      {open && (
        <ColumnDialog
          code={code}
          source={source}
          table={table.name}
          column={open}
          rows={rows}
          canViewRows={canViewRows}
          onClose={() => setOpen(null)}
          onFix={
            onFix && needsLook(open)
              ? () => {
                  setOpen(null)
                  onFix(open.name)
                }
              : undefined
          }
        />
      )}
    </Section>
  )
}

// ---------------- 2. Rules ----------------

function Rules({
  code,
  source,
  table,
  columns,
  rows,
  fixing,
  setFixing,
  onChanged,
}: {
  code: string
  source: string
  table: string
  columns: ColumnCounts[]
  rows: number
  fixing: { column?: string; start?: string } | null
  setFixing: (f: { column?: string; start?: string } | null) => void
  onChanged: () => void
}) {
  const rules = useApi(() => api.ruleColumns(code, table), [code, table])
  const library = useApi(() => api.regexLibrary(), [])
  const list = rules.data?.columns ?? []
  const look = new Set(columns.filter(needsLook).map((c) => c.name))
  const ruled = list.filter((c) => c.pattern)
  const todo = list.filter((c) => !c.pattern && look.has(c.name))

  return (
    <Section
      number={2}
      title={`Rules on ${table}`}
      aside={
        <button type="button" className="btn btn-sm btn-primary" disabled={!rules.data} onClick={() => setFixing({})}>
          <Icon name="sliders" size={14} /> Add a rule
        </button>
      }
    >
      <p className="dq-summary dq-pad">
        A <b>format rule</b> says what a correct value looks like. Rows that break a rule are held back from customer records.
      </p>
      {rules.error && <ErrorAlert message={rules.error} />}
      {!rules.data && !rules.error && <Loader kind="scan" label="Loading rules" />}
      {todo.length > 0 && (
        <>
          <div className="dq-sub">Suggested: columns that need attention and have no rule</div>
          {todo.map((c) => (
            <div key={c.name} className="hm-row">
              <span className="hm-ic is-warn">
                <Icon name="alert" size={16} />
              </span>
              <div className="hm-grow">
                <b>{c.name}</b>
                <span className="muted text-sm">{status(columns.find((x) => x.name === c.name)!, rows).text}</span>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setFixing({ column: c.name })}>
                Add rule
              </button>
            </div>
          ))}
        </>
      )}
      {rules.data && (
        <>
          <div className="dq-sub">
            {ruled.length} rule{ruled.length === 1 ? '' : 's'} applied
          </div>
          {ruled.length === 0 ? (
            <p className="muted hm-empty">No rules yet. Without rules no row reaches the clean data.</p>
          ) : (
            <div className="table-wrap">
              <table className="sx-table">
                <thead>
                  <tr>
                    <th>Column</th>
                    <th>Rule</th>
                    <th style={{ width: 220 }}>Rows that pass</th>
                    <th aria-label="Edit" />
                  </tr>
                </thead>
                <tbody>
                  {ruled.map((c) => {
                    const passed = c.passed ?? 0
                    const total = c.total ?? 0
                    return (
                      <tr key={c.name} tabIndex={0} onClick={() => setFixing({ column: c.name })} onKeyDown={(e) => e.key === 'Enter' && setFixing({ column: c.name })}>
                        <td>
                          <b className="dq-name">{c.name}</b>
                        </td>
                        <td>
                          <code className="dq-pattern">{c.pattern}</code>
                        </td>
                        <td>
                          <span className="dq-filled">
                            <Bar value={pct(passed, total)} tone={pct(passed, total) >= 90 ? 'good' : 'warn'} />
                            <span className="num text-sm">
                              {n(passed)} of {n(total)}
                            </span>
                          </span>
                        </td>
                        <td className="dq-go">
                          <button type="button" className="btn btn-sm btn-ghost">
                            Edit
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {fixing && rules.data && (
        <RuleDialog
          code={code}
          table={table}
          source={source}
          columns={list.map((c) => ({ name: c.name, pattern: c.pattern, needsLook: look.has(c.name) }))}
          column={fixing.column}
          start={fixing.start}
          library={library.data}
          counts={columns}
          rows={rows}
          onClose={() => setFixing(null)}
          onDone={onChanged}
        />
      )}
    </Section>
  )
}

// ---------------- 3. Result ----------------

function Result({ code, source, table }: { code: string; source: string; table: string }) {
  const tables = useApi(() => api.silverTables(code), [code])
  const [open, setOpen] = useState(false)
  const t = tables.data?.tables.find((x) => x.name === table)
  return (
    <Section
      number={3}
      title="Result"
      aside={
        t && t.rules > 0 ? (
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)}>
            See rows
          </button>
        ) : undefined
      }
    >
      {tables.error && <ErrorAlert message={tables.error} />}
      {!tables.data && !tables.error && <Loader kind="scan" label="Checking rows against the rules" />}
      {tables.data && (!t || !t.rules) && <p className="muted hm-empty">No clean rows yet. Add a rule above: a table without rules gives no clean rows.</p>}
      {t && t.rules > 0 && (
        <div className="dq-result">
          <p className="dq-summary">
            <Explain
              title={`${n(t.passed)} clean rows`}
              text="Rows that pass every format rule on this table. The other rows are held back so they never reach customer records."
              calc={`${n(t.rows)} rows − ${n(t.rejected)} held back = ${n(t.passed)} clean`}
            >
              <b>
                {n(t.passed)} of {n(t.rows)} rows
              </b>
            </Explain>{' '}
            are clean and go on to customer records. <b>{n(t.rejected)}</b> are held back until fixed at the source.
          </p>
          <Split
            thick
            parts={[
              { label: 'Clean', count: t.passed, tone: 'ok' },
              { label: 'Held back', count: t.rejected, tone: 'bad' },
            ]}
          />
          <Legend
            parts={[
              { label: 'Clean', count: t.passed, tone: 'ok' },
              { label: 'Held back', count: t.rejected, tone: 'bad' },
            ]}
          />
        </div>
      )}
      {open && t && <RowsDialog code={code} source={source} name={table} table={t} onClose={() => setOpen(false)} />}
    </Section>
  )
}

// A table's rows in a popup: clean and held back when it has rules, and always every row as it was read.
export function RowsDialog({ code, source, name, table, onClose }: { code: string; source: string; name: string; table?: SilverTable; onClose: () => void }) {
  const ruled = !!table?.rules
  const [show, setShow] = useState<'passed' | 'rejected' | 'all'>(ruled ? 'passed' : 'all')
  const [page, setPage] = useState(1)
  const [only, setOnly] = useState('')
  const rows = useApi(
    () =>
      show === 'all'
        ? api.rawRows(code, name, page).then((r) => ({ column_names: r.column_names, count: r.count, page_size: r.page_size, reasons: [] as SilverRows['reasons'], results: r.results.map((values, i) => ({ position: i, values, failed: [] as string[] })) }))
        : api.silverRows(code, name, show, page, only),
    [code, name, show, page, only],
  )
  const d = rows.data
  const pages = Math.max(1, Math.ceil((d?.count ?? 0) / (d?.page_size || 50)))
  const choose = (next: 'passed' | 'rejected' | 'all') => {
    setShow(next)
    setPage(1)
    setOnly('')
  }
  const options = [
    ...(ruled
      ? [
          { value: 'passed' as const, label: `Clean · ${n(table!.passed)}` },
          { value: 'rejected' as const, label: `Held back · ${n(table!.rejected)}` },
        ]
      : []),
    { value: 'all' as const, label: 'All rows' },
  ]
  return (
    <Dialog
      size="xl"
      title={`Rows of ${name}`}
      subtitle={ruled ? `${source} · ${n(table!.passed)} clean · ${n(table!.rejected)} held back` : `${source} · no rules yet, so no row is clean`}
      onClose={onClose}
    >
      <div className="dq-bar-row">
        <Seg label="Rows to show" value={show} onChange={choose} options={options} />
        {only && (
          <button type="button" className="btn btn-sm" onClick={() => setOnly('')}>
            Breaking {only} <Icon name="x" size={13} />
          </button>
        )}
      </div>
      {show !== 'all' && d && d.reasons.length > 0 && (
        <div className="dq-reasons is-inline">
          <span className="lx-cap">Why rows are held back</span>
          {d.reasons.map((r) => (
            <button
              key={r.column}
              type="button"
              className={only === r.column ? 'is-on' : undefined}
              aria-pressed={only === r.column}
              onClick={() => {
                setShow('rejected')
                setPage(1)
                setOnly(only === r.column ? '' : r.column)
              }}
            >
              <span className="dq-reason-h">
                <span>{r.column}</span>
                <span className="num muted text-sm">{n(r.rows)} rows</span>
              </span>
              <Bar value={pct(r.rows, Math.max(table?.rejected ?? 1, 1))} tone="bad" />
            </button>
          ))}
        </div>
      )}
      {rows.error && <ErrorAlert message={rows.error} />}
      {!d && !rows.error && <Loader kind="scan" label="Loading rows" />}
      {d && d.results.length === 0 && <p className="muted">{show === 'passed' ? 'No row passed every rule.' : show === 'rejected' ? 'No row is held back.' : 'This table has no rows.'}</p>}
      {d && d.results.length > 0 && (
        <div className="table-wrap dq-rows">
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
                      {r.values[i] === null || r.values[i] === undefined || r.values[i] === '' ? <span className="muted">Empty</span> : String(r.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pages={pages} onPage={setPage} text={d ? `${n(d.count)} rows` : ''} />
    </Dialog>
  )
}
