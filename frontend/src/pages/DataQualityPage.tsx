import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { ColumnCounts, CountProof, RawSource, RawTable, SilverTable, Source } from '../api/types'
import { useApi } from '../api/useApi'
import { useCan } from '../auth/AuthContext'
import { ConnectorLogo } from '../components/ConnectorLogo'
import { Dialog } from '../components/Dialog'
import { Explain } from '../components/Explain'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { Legend, n, pct, Pill, Seg, Split, type Part } from '../components/Lx'
import { MapFields } from '../components/MapFields'
import { RuleDialog } from '../components/RuleDialog'
import { EmptyState, ErrorAlert } from '../components/ui'
import { formatRelative } from '../format'
import { profileJob } from '../profileJob'

type Tab = 'check' | 'fix' | 'clean' | 'map'
const TABS: { id: Tab; label: string }[] = [
  { id: 'check', label: 'Check' },
  { id: 'fix', label: 'Fix' },
  { id: 'clean', label: 'Clean data' },
  { id: 'map', label: 'Map fields' },
]
const PER_PAGE = 25

// Data quality as one guided flow: choose a source, choose one of its tables, then check it, fix it with format
// rules and see the clean rows. Source, table and tab live in the address, so every step can be linked to.
export function DataQualityPage() {
  const raw = useApi(() => api.rawSources(), [])
  const all = useApi(() => api.sources(), [])
  const [params, setParams] = useSearchParams()
  const [notYet, setNotYet] = useState<'source' | 'table' | null>(null)
  const job = useSyncExternalStore(profileJob.subscribe, profileJob.get)
  const canManage = useCan('manage_sources')

  // When a check ends, show what it found.
  const ended = job?.finished ?? null
  useEffect(() => {
    if (ended) raw.reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended])

  if (raw.error) return <ErrorAlert message={raw.error} />
  if (!raw.data) return <Loader kind="scan" label="Loading sources" />

  const list = raw.data.sources
  const src = list.find((s) => s.code === params.get('source'))
  const table = src ? params.get('table') : null
  const asked = params.get('tab') as Tab | null
  const tab: Tab = asked && TABS.some((t) => t.id === asked) && (asked === 'check' || asked === 'map' || canManage) ? asked : 'check'
  const at = !src ? 0 : !table ? 1 : 2
  const info = (code: string) => all.data?.results.find((s) => s.code === code)

  const steps = [
    { title: 'Choose a source', detail: src?.name ?? 'Where the data lives' },
    { title: 'Choose a table', detail: table ?? 'What to look at' },
    { title: 'Check, fix, clean, map', detail: table ? TABS.find((t) => t.id === tab)!.label : 'Find and fix problems' },
  ]
  const toStep = (i: number) => {
    if (i > at) setNotYet(at === 0 ? 'source' : 'table')
    else if (i === 0) setParams({})
    else if (i === 1 && src) setParams({ source: src.code })
  }

  const flow = (
    <nav className="dq-flow" aria-label="Steps">
      {steps.map((s, i) => (
        <button
          key={s.title}
          type="button"
          className={i < at ? 'is-done' : i === at ? 'is-now' : undefined}
          aria-current={i === at ? 'step' : undefined}
          onClick={() => toStep(i)}
        >
          <i>{i < at ? <Icon name="check" size={13} /> : i + 1}</i>
          <span>
            <b>{s.title}</b>
            <small>{s.detail}</small>
          </span>
        </button>
      ))}
    </nav>
  )

  let page: ReactNode
  if (!src) {
    page = (
      <>
        <Head title="Data quality" text="Start by choosing a source. Then pick one of its tables to check it, fix what is wrong and see the clean rows." />
        {flow}
        {list.length === 0 ? (
          <section className="card">
            <EmptyState icon="connectors" title="No sources yet">
              <Link to="/sources">Add a source</Link> first.
            </EmptyState>
          </section>
        ) : (
          <div className="dq-srcgrid">
            {list.map((s) => (
              <SourceCard key={s.code} source={s} info={info(s.code)} onOpen={() => setParams({ source: s.code })} />
            ))}
          </div>
        )}
      </>
    )
  } else if (!table) {
    page = (
      <TablesStep
        key={`${src.code}:${ended ?? ''}`}
        source={src}
        canRead={raw.data.can_read}
        trail={<Trail source={src} onHome={() => setParams({})} />}
        flow={flow}
        onOpen={(t) => setParams({ source: src.code, table: t })}
      />
    )
  } else {
    page = (
      <TableStep
        key={`${src.code}:${table}:${ended ?? ''}`}
        source={src}
        table={table}
        tab={tab}
        canRead={raw.data.can_read}
        canViewRows={raw.data.can_view_rows}
        canManage={canManage}
        trail={<Trail source={src} table={table} onHome={() => setParams({})} onSource={() => setParams({ source: src.code })} />}
        flow={flow}
        params={params}
        setParams={setParams}
      />
    )
  }

  return (
    <>
      {page}
      {notYet && (
        <Dialog
          size="sm"
          title={`Select a ${notYet} first`}
          onClose={() => setNotYet(null)}
          footer={
            <button type="button" className="btn btn-primary" onClick={() => setNotYet(null)}>
              Choose a {notYet}
            </button>
          }
        >
          <p className="rd-lead">
            {notYet === 'source'
              ? 'Choose the source you want to work on. Its tables appear next.'
              : "Choose one of this source's tables. Then you can check it, fix it, see the clean rows and map its fields."}
          </p>
        </Dialog>
      )}
    </>
  )
}

function Head({ title, text, actions }: { title: string; text: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div className="page-header-text">
        <h1>{title}</h1>
        <p>{text}</p>
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  )
}

function Trail({ source, table, onHome, onSource }: { source: RawSource; table?: string; onHome: () => void; onSource?: () => void }) {
  return (
    <nav className="dq-trail" aria-label="You are here">
      <button type="button" onClick={onHome}>
        Data quality
      </button>
      <Icon name="chevron-right" size={13} />
      {table ? (
        <>
          <button type="button" onClick={onSource}>
            {source.name}
          </button>
          <Icon name="chevron-right" size={13} />
          <b>{table}</b>
        </>
      ) : (
        <b>{source.name}</b>
      )}
    </nav>
  )
}

function Pager({ page, pages, onPage, text }: { page: number; pages: number; onPage: (p: number) => void; text: ReactNode }) {
  return (
    <div className="sx-foot">
      <span>{text}</span>
      {pages > 1 && (
        <span className="lx-pages">
          <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
            Previous
          </button>
          <span className="text-sm muted">
            Page {page} of {pages}
          </span>
          <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => onPage(page + 1)}>
            Next
          </button>
        </span>
      )}
    </div>
  )
}

function Bar({ value, tone }: { value: number; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <span className={`dq-bar${tone ? ` is-${tone}` : ''}`}>
      <i style={{ width: `${value}%` }} />
    </span>
  )
}

// ---------------- step 1: sources ----------------

function SourceCard({ source, info, onOpen }: { source: RawSource; info?: Source; onOpen: () => void }) {
  const tables = useApi(() => api.rawTables(source.code), [source.code])
  const list = tables.data?.tables ?? []
  const toFix = list.reduce((a, t) => a + (t.to_check ?? 0), 0)
  const quality = list.length ? Math.round(list.reduce((a, t) => a + (t.filled ?? 100), 0) / list.length) : null
  return (
    <button type="button" className="card dq-srccard" disabled={!source.enabled} onClick={onOpen}>
      <span className="sx-src">
        <ConnectorLogo type={source.connector_type} size={36} />
        <span>
          <b>{source.name}</b>
          <small>{info?.connector_label ?? ''}</small>
        </span>
      </span>
      <Bar value={quality ?? 0} tone={quality === null ? undefined : quality >= 90 ? 'good' : 'warn'} />
      <span className="dq-facts">
        <span>
          <b>{quality === null ? '—' : `${quality}%`}</b>filled
        </span>
        <span>
          <b>{tables.data ? n(list.length) : '…'}</b>tables checked
        </span>
        <span>
          <b className={toFix ? 'is-bad-text' : undefined}>{tables.data ? n(toFix) : '…'}</b>to fix
        </span>
      </span>
      {!source.enabled && <Pill tone="warn">Switched off</Pill>}
    </button>
  )
}

// ---------------- step 2: tables ----------------

function TablesStep({
  source,
  canRead,
  trail,
  flow,
  onOpen,
}: {
  source: RawSource
  canRead: boolean
  trail: ReactNode
  flow: ReactNode
  onOpen: (table: string) => void
}) {
  const checked = useApi(() => api.rawTables(source.code), [source.code])
  const [names, setNames] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const busy = useSyncExternalStore(profileJob.subscribe, profileJob.running)

  useEffect(() => {
    if (!canRead) return
    api.rawDiscover(source.code).then((f) => setNames(f.tables), (e: Error) => setError(e.message))
  }, [source.code, canRead])

  const done = checked.data?.tables ?? []
  const info = (t: string) => done.find((d) => d.name === t)
  const all = Array.from(new Set([...(names ?? []), ...done.map((t) => t.name)]))
  const shown = all.filter((t) => t.toLowerCase().includes(q.trim().toLowerCase()))
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE))
  const slice = shown.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const toggle = (t: string) =>
    setTicked((old) => {
      const next = new Set(old)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })

  return (
    <>
      {trail}
      <Head
        title={source.name}
        text={`${names ? `${n(all.length)} tables, ` : ''}${n(done.length)} checked. Open a checked table, or tick tables to check them.`}
        actions={
          canRead && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={!ticked.size || busy}
              onClick={() => {
                profileJob.start(source.code, source.name, all.filter((t) => ticked.has(t)))
                setTicked(new Set())
              }}
            >
              Check {ticked.size || ''} ticked {ticked.size === 1 ? 'table' : 'tables'}
            </button>
          )
        }
      />
      {flow}
      <section className="card">
        <div className="hm-h">
          <h2>Tables</h2>
          <label className="lx-search">
            <Icon name="search" size={15} />
            <input
              placeholder="Search tables"
              aria-label="Search tables"
              value={q}
              onChange={(e) => {
                setQ(e.target.value)
                setPage(1)
              }}
            />
          </label>
        </div>
        {error && <p className="sx-error hm-empty">{error}</p>}
        {!checked.data || (canRead && names === null && !error) ? (
          <Loader kind="scan" label="Asking the source for its tables" />
        ) : (
          <div className="table-wrap">
            <table className="sx-table">
              <thead>
                <tr>
                  {canRead && <th style={{ width: 36 }} aria-label="Tick" />}
                  <th>Table</th>
                  <th>Rows</th>
                  <th>Filled</th>
                  <th>Needs attention</th>
                  <th>Fields mapped</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {slice.map((t) => {
                  const d = info(t)
                  const open = () => (d ? onOpen(t) : canRead && toggle(t))
                  return (
                    <tr key={t} tabIndex={0} onClick={open} onKeyDown={(e) => e.key === 'Enter' && open()} title={d ? 'Open this table' : 'Not checked yet: tick it to check it'}>
                      {canRead && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`Tick ${t}`} checked={ticked.has(t)} onChange={() => toggle(t)} />
                        </td>
                      )}
                      <td>
                        <b className="dq-name">{t}</b>
                      </td>
                      <td className="num muted">{d ? n(d.rows) : '—'}</td>
                      <td>
                        {d ? (
                          <span className="dq-filled">
                            <Bar value={d.filled ?? 100} tone={(d.filled ?? 100) >= 95 ? 'good' : 'warn'} />
                            <span className="num text-sm">{d.filled ?? 100}%</span>
                          </span>
                        ) : (
                          <span className="muted">Not checked</span>
                        )}
                      </td>
                      <td>
                        {d ? (
                          d.to_check ? (
                            <Pill tone="warn">
                              {d.to_check} column{d.to_check === 1 ? '' : 's'}
                            </Pill>
                          ) : (
                            <Pill tone="ok">All fine</Pill>
                          )
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="num muted">{d?.mapped ? n(d.mapped) : '—'}</td>
                      <td className="dq-go">{d && <Icon name="chevron-right" size={16} />}</td>
                    </tr>
                  )
                })}
                {slice.length === 0 && (
                  <tr>
                    <td colSpan={7} className="muted sx-empty">
                      No table matches.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <Pager page={page} pages={pages} onPage={setPage} text={`${n(shown.length)} of ${n(all.length)} tables`} />
      </section>
    </>
  )
}

// ---------------- step 3: one table ----------------

const isEmail = (c: ColumnCounts) => !!c.counts[0]?.label.startsWith('Up to')
const isMixed = (c: ColumnCounts) => !isEmail(c) && c.counts.filter((x) => x.count > 0).length > 1
const tooLong = (c: ColumnCounts) => isEmail(c) && (c.counts[1]?.count ?? 0) > 0
const needsLook = (c: ColumnCounts) => c.empty > 0 || isMixed(c) || tooLong(c)

function status(c: ColumnCounts, rows: number): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  if (c.empty > 0) return { tone: 'bad', text: `${n(c.empty)} empty` }
  if (tooLong(c)) return { tone: 'warn', text: 'Too long' }
  if (isMixed(c)) return { tone: 'warn', text: 'Mixed lengths' }
  return { tone: 'ok', text: rows ? 'Looks fine' : 'Empty table' }
}

// The parts of a column for its split bar: its lengths or its values. The rarer lengths and too-long emails show
// as warnings.
function partsOf(c: ColumnCounts): Part[] {
  if (c.counts.length) {
    return c.counts.map((x, i) => ({ label: x.label, count: x.count, tone: (isEmail(c) ? i === 1 : i > 0) ? ('warn' as const) : undefined }))
  }
  return (c.values ?? []).map((x) => ({ label: x.label, count: x.count }))
}

// Why a value of this label needs a look, in plain words.
function reasonOf(c: ColumnCounts, label: string) {
  if (label === 'Empty') return 'Empty'
  if (isEmail(c)) return 'Longer than most emails'
  return `${label}; most values have ${c.counts[0]?.label.toLowerCase()}`
}

function TableStep({
  source,
  table,
  tab,
  canRead,
  canViewRows,
  canManage,
  trail,
  flow,
  params,
  setParams,
}: {
  source: RawSource
  table: string
  tab: Tab
  canRead: boolean
  canViewRows: boolean
  canManage: boolean
  trail: ReactNode
  flow: ReactNode
  params: URLSearchParams
  setParams: (p: Record<string, string>) => void
}) {
  const profile = useApi(() => api.rawProfile(source.code, table), [source.code, table])
  const busy = useSyncExternalStore(profileJob.subscribe, profileJob.running)
  const p = profile.data
  const check = () => profileJob.start(source.code, source.name, [table])
  const toTab = (t: Tab, extra: Record<string, string> = {}) => setParams({ source: source.code, table, tab: t, ...extra })

  if (profile.error) {
    return (
      <>
        {trail}
        <Head title={table} text={source.name} />
        {flow}
        <section className="card">
          <EmptyState icon="search" title="This table is not checked yet">
            {canRead ? (
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
  if (!p) return <Loader kind="scan" label="Loading the table" />
  const attention = p.profile.columns.filter(needsLook)

  return (
    <>
      {trail}
      <Head
        title={table}
        text={`${source.name} · ${n(p.rows)} rows · checked ${formatRelative(p.read_at)}`}
        actions={
          canRead && (
            <button type="button" className="btn" disabled={busy} onClick={check}>
              Check again
            </button>
          )
        }
      />
      {flow}
      <div className="dq-tabs" role="tablist">
          {TABS.filter((t) => canManage || t.id === 'check' || t.id === 'map').map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={t.id === tab} className={t.id === tab ? 'is-on' : undefined} onClick={() => toTab(t.id)}>
              {t.label}
              {t.id === 'fix' && attention.length > 0 && <span className="dq-count">{attention.length}</span>}
            </button>
          ))}
        </div>
      {tab === 'check' && (
        <CheckTab
          code={source.code}
          source={source.name}
          table={p}
          columns={p.profile.columns}
          canViewRows={canViewRows}
          onFix={canManage ? (column) => toTab('fix', { column }) : undefined}
        />
      )}
      {tab === 'fix' && (
        <FixTab
          code={source.code}
          source={source.name}
          table={table}
          columns={p.profile.columns}
          column={params.get('column')}
          regex={params.get('regex') ?? ''}
          onDialogClosed={() => toTab('fix')}
        />
      )}
      {tab === 'clean' && <CleanTab code={source.code} table={table} onFix={() => toTab('fix')} />}
      {tab === 'map' && <MapFields code={source.code} source={source.name} table={table} />}
    </>
  )
}

// ---------------- Check ----------------

function CheckTab({
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
  const [filter, setFilter] = useState<'all' | 'check' | 'fine'>('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<ColumnCounts | null>(null)
  const rows = table.rows
  const attention = columns.filter(needsLook)
  const filled = columns.reduce((a, c) => a + c.filled, 0)
  const cells = rows * columns.length
  const term = q.trim().toLowerCase()
  const shown = columns.filter((c) => c.name.toLowerCase().includes(term) && (filter === 'all' || (filter === 'check' ? needsLook(c) : !needsLook(c))))
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE))
  const slice = shown.slice((page - 1) * PER_PAGE, page * PER_PAGE)

  return (
    <>
      <p className="dq-summary">
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
      <section className="card">
        <div className="hm-h">
          <Seg
            label="Show"
            value={filter}
            onChange={(v) => {
              setFilter(v)
              setPage(1)
            }}
            options={[
              { value: 'all', label: `All ${columns.length}` },
              { value: 'check', label: `Need attention · ${attention.length}` },
              { value: 'fine', label: `Look fine · ${columns.length - attention.length}` },
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
                    No column matches.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pager page={page} pages={pages} onPage={setPage} text={`Showing ${n(shown.length)} of ${n(columns.length)} columns`} />
      </section>
      {open && (
        <ColumnDialog
          code={code}
          source={source}
          table={table.name}
          column={open}
          rows={rows}
          canViewRows={canViewRows}
          onClose={() => setOpen(null)}
          onFix={onFix && needsLook(open) ? () => onFix(open.name) : undefined}
        />
      )}
    </>
  )
}

type Sample = { label: string; reason: string; count: number; values: string[] }

// One column in a popup: its counts, what is inside, and real values: good ones and the ones that need a look,
// each with why.
function ColumnDialog({
  code,
  source,
  table,
  column: c,
  rows,
  canViewRows,
  onClose,
  onFix,
}: {
  code: string
  source: string
  table: string
  column: ColumnCounts
  rows: number
  canViewRows: boolean
  onClose: () => void
  onFix?: () => void
}) {
  const parts = partsOf(c)
  const main = c.counts[0]
  const badParts: { label: string; count: number }[] = [
    ...(c.empty ? [{ label: 'Empty', count: c.empty }] : []),
    ...parts.filter((x) => x.tone === 'warn' && x.count > 0),
  ]
  const [good, setGood] = useState<string[] | null>(null)
  const [bad, setBad] = useState<Sample[] | null>(null)
  const [all, setAll] = useState<string | null>(null)
  const badCount = badParts.reduce((a, x) => a + x.count, 0)

  useEffect(() => {
    if (!canViewRows) return
    let live = true
    const first = (label: string, many: number) =>
      api.rawProof(code, table, c.name, label, 1).then(
        (got) => Array.from(new Set(got.results.map((r) => (r.value === null || r.value === undefined ? '' : String(r.value))))).slice(0, many),
        () => [] as string[],
      )
    if (main && main.count > 0) first(main.label, 5).then((v) => live && setGood(v))
    else setGood([])
    Promise.all(badParts.map(async (x) => ({ label: x.label, count: x.count, reason: reasonOf(c, x.label), values: x.label === 'Empty' ? [''] : await first(x.label, 3) }))).then(
      (got) => live && setBad(got),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, table, c.name, canViewRows])

  const why = [
    c.empty ? `${n(c.empty)} of ${n(rows)} values are empty.` : '',
    tooLong(c) ? `${n(c.counts[1].count)} values are longer than most emails.` : '',
    isMixed(c) ? `Most values have ${main.label.toLowerCase()}, but ${n(c.counts.slice(1).reduce((a, x) => a + x.count, 0))} do not.` : '',
  ].filter(Boolean)
  const rule = main ? (isEmail(c) ? `Good: ${main.label.toLowerCase()}.` : `Good: ${main.label.toLowerCase()}, like most values.`) : c.values?.length ? 'Good: one of the values this column uses.' : 'Free text: values of any length.'

  return (
    <Dialog
      size="lg"
      title={c.name}
      subtitle={`${table} · ${source}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {onFix && (
            <button type="button" className="btn btn-primary" onClick={onFix}>
              <Icon name="sliders" size={15} /> Fix it with a rule
            </button>
          )}
        </>
      }
    >
      <div className="sx-kv">
        <div>
          <b>{n(c.filled)}</b>
          <span>of {n(rows)} filled</span>
        </div>
        <div>
          <b className={c.empty ? 'is-bad-text' : undefined}>{n(c.empty)}</b>
          <span>empty</span>
        </div>
        <div>
          <b>{n(c.unique)}</b>
          <span>different values</span>
        </div>
      </div>
      {why.length > 0 && <p className="dq-why">{why.join(' ')}</p>}
      <div className="lx-stack">
        <span className="lx-cap">What is inside</span>
        {parts.length ? (
          <>
            <Split thick parts={parts} />
            <Legend parts={parts} max={6} />
          </>
        ) : (
          <span className="muted">Free text: values of any length.</span>
        )}
      </div>
      {all !== null ? (
        <Proof code={code} table={table} column={c.name} label={all} onClose={() => setAll(null)} />
      ) : (
        <div className="lx-stack">
          <span className="lx-cap">The values</span>
          {!canViewRows ? (
            <p className="muted rd-lead">Only the counts are shown. Seeing values needs permission to view personal data.</p>
          ) : (
            <>
              <p className="muted text-sm rd-lead">{rule}</p>
              <div className="dq-vals">
                <div className="dq-val is-good">
                  <header>
                    <span>
                      <Icon name="check" size={14} /> Good
                    </span>
                    <span>{n(main ? main.count : c.filled)} rows</span>
                  </header>
                  {!main && c.values?.length
                    ? c.values.slice(0, 6).map((v) => (
                        <div key={v.label} className="dq-v">
                          <code>{v.label}</code>
                          <small>{n(v.count)} rows</small>
                        </div>
                      ))
                    : good === null
                      ? <Loader kind="scan" label="Finding values" />
                      : good.length === 0
                        ? <div className="dq-v muted">No examples.</div>
                        : good.map((v) => (
                            <div key={v} className="dq-v">
                              <code>{v}</code>
                              <small>{main?.label}</small>
                            </div>
                          ))}
                </div>
                <div className={`dq-val ${badCount ? 'is-bad' : 'is-good'}`}>
                  <header>
                    <span>
                      <Icon name={badCount ? 'alert' : 'check'} size={14} /> Needs a look
                    </span>
                    <span>{n(badCount)} rows</span>
                  </header>
                  {badCount === 0 && <div className="dq-v muted">Every value is fine.</div>}
                  {badCount > 0 && bad === null && <Loader kind="scan" label="Finding values" />}
                  {bad?.map((s) => (
                    <div key={s.label} className="dq-group">
                      {s.values.map((v) => (
                        <div key={v} className="dq-v">
                          <code>{v === '' ? <span className="muted">(empty)</span> : v}</code>
                          <small>{s.reason}</small>
                        </div>
                      ))}
                      <button type="button" className="link text-sm" onClick={() => setAll(s.label)}>
                        See all {n(s.count)} {s.label === 'Empty' ? 'empty' : s.label.toLowerCase()} rows →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

// The rows behind one count: row number, the table's ID and the value itself, 20 at a time.
function Proof({ code, table, column, label, onClose }: { code: string; table: string; column: string; label: string; onClose: () => void }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<CountProof | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    api.rawProof(code, table, column, label, page).then(
      (got) => live && setData(got),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [code, table, column, label, page])
  const pages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1
  const shown = (v: unknown) => (v === null || v === undefined || v === '' ? <span className="muted">Empty</span> : String(v))
  return (
    <div className="lx-stack">
      <div className="dq-proof-h">
        <button type="button" className="link text-sm" onClick={onClose}>
          ← Back to the values
        </button>
        <b>
          {data ? n(data.count) : '…'} rows · {label === 'Empty' ? 'empty' : label}
        </b>
      </div>
      {error && <ErrorAlert message={error} />}
      {!data && !error && <Loader kind="scan" label="Finding the rows" />}
      {data && (
        <>
          <table className="lx-mini">
            <thead>
              <tr>
                <th className="num">Row</th>
                <th>{data.key}</th>
                <th>{column}</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.row}>
                  <td className="num muted">{r.row}</td>
                  <td className="muted lx-key">{shown(r.key)}</td>
                  <td>
                    <code>{shown(r.value)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} pages={pages} onPage={setPage} text={`${n(data.count)} rows`} />
        </>
      )}
    </div>
  )
}

// ---------------- Fix ----------------

function FixTab({
  code,
  source,
  table,
  columns,
  column,
  regex,
  onDialogClosed,
}: {
  code: string
  source: string
  table: string
  columns: ColumnCounts[]
  column: string | null
  regex: string
  onDialogClosed: () => void
}) {
  const rules = useApi(() => api.ruleColumns(code, table), [code, table])
  const library = useApi(() => api.regexLibrary(), [])
  const [dialog, setDialog] = useState<{ column?: string; start?: string } | null>(column ? { column, start: regex } : null)
  const list = rules.data?.columns ?? []
  const look = new Set(columns.filter(needsLook).map((c) => c.name))
  const ruled = list.filter((c) => c.pattern)
  const todo = list.filter((c) => !c.pattern && look.has(c.name))
  const close = () => {
    setDialog(null)
    if (column) onDialogClosed()
  }

  if (rules.error) return <ErrorAlert message={rules.error} />
  return (
    <>
      <div className="dq-bar-row">
        <p className="dq-summary">
          A <b>format rule</b> says what a correct value looks like. Rows that break a rule are held back from customer records.
        </p>
        <button type="button" className="btn btn-primary" disabled={!rules.data} onClick={() => setDialog({})}>
          <Icon name="sliders" size={15} /> Add a rule
        </button>
      </div>
      {!rules.data && <Loader kind="scan" label="Loading rules" />}
      {todo.length > 0 && (
        <section className="card">
          <div className="hm-h">
            <h2>Suggested</h2>
            <span className="muted text-sm">Columns that need attention and have no rule yet</span>
          </div>
          {todo.map((c) => (
            <div key={c.name} className="hm-row">
              <span className="hm-ic is-warn">
                <Icon name="alert" size={16} />
              </span>
              <div className="hm-grow">
                <b>{c.name}</b>
                <span className="muted text-sm">{status(columns.find((x) => x.name === c.name)!, rules.data!.rows).text}</span>
              </div>
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setDialog({ column: c.name })}>
                Add rule
              </button>
            </div>
          ))}
        </section>
      )}
      {rules.data && (
        <section className="card">
          <div className="hm-h">
            <h2>Rules on this table</h2>
            <span className="muted text-sm">
              {ruled.length} rule{ruled.length === 1 ? '' : 's'}
            </span>
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
                    <th style={{ width: 240 }}>Rows that pass</th>
                    <th aria-label="Edit" />
                  </tr>
                </thead>
                <tbody>
                  {ruled.map((c) => {
                    const passed = c.passed ?? 0
                    const total = c.total ?? 0
                    return (
                      <tr key={c.name} tabIndex={0} onClick={() => setDialog({ column: c.name })} onKeyDown={(e) => e.key === 'Enter' && setDialog({ column: c.name })}>
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
        </section>
      )}
      {dialog && rules.data && (
        <RuleDialog
          code={code}
          table={table}
          source={source}
          columns={list.map((c) => ({ name: c.name, pattern: c.pattern, needsLook: look.has(c.name) }))}
          column={dialog.column}
          start={dialog.start}
          library={library.data}
          onClose={close}
          onDone={rules.reload}
        />
      )}
    </>
  )
}

// ---------------- Clean data ----------------

function CleanTab({ code, table, onFix }: { code: string; table: string; onFix: () => void }) {
  const tables = useApi(() => api.silverTables(code), [code])
  const t = tables.data?.tables.find((x) => x.name === table)
  if (tables.error) return <ErrorAlert message={tables.error} />
  if (!tables.data) return <Loader kind="scan" label="Checking rows against the rules" />
  if (!t || !t.rules) {
    return (
      <section className="card">
        <EmptyState icon="sliders" title="No rules on this table yet">
          Clean data forms only from format rules.{' '}
          <button type="button" className="link" onClick={onFix}>
            Add a rule
          </button>
        </EmptyState>
      </section>
    )
  }
  return <Clean code={code} table={t} />
}

function Clean({ code, table }: { code: string; table: SilverTable }) {
  const [show, setShow] = useState<'passed' | 'rejected'>('passed')
  const [page, setPage] = useState(1)
  const [only, setOnly] = useState('')
  const rows = useApi(() => api.silverRows(code, table.name, show, page, only), [code, table.name, show, page, only])
  const d = rows.data
  const pages = Math.max(1, Math.ceil((d?.count ?? 0) / 50))
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
      <p className="dq-summary">
        <Explain
          title={`${n(table.passed)} clean rows`}
          text="Rows that pass every format rule on this table. The other rows are held back so they never reach customer records."
          calc={`${n(table.rows)} rows − ${n(table.rejected)} held back = ${n(table.passed)} clean`}
        >
          <b>
            {n(table.passed)} of {n(table.rows)} rows
          </b>
        </Explain>{' '}
        are clean and go on to build customer records. <b>{n(table.rejected)} rows</b> are held back until they are fixed at the source.
      </p>
      <div className="dq-grid">
        <section className="card">
          <div className="hm-h">
            <Seg
              label="Rows to show"
              value={show}
              onChange={choose}
              options={[
                { value: 'passed', label: `Clean · ${n(table.passed)}` },
                { value: 'rejected', label: `Held back · ${n(table.rejected)}` },
              ]}
            />
            {only && (
              <button type="button" className="btn btn-sm" onClick={() => setOnly('')}>
                Breaking {only} <Icon name="x" size={13} />
              </button>
            )}
          </div>
          {rows.error && <ErrorAlert message={rows.error} />}
          {!d && !rows.error && <Loader kind="scan" label="Loading rows" />}
          {d && d.results.length === 0 && <p className="muted hm-empty">{show === 'passed' ? 'No row passed every rule.' : 'No row is held back.'}</p>}
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
                          {r.values[i] === null || r.values[i] === '' ? <span className="muted">Empty</span> : String(r.values[i])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pager page={page} pages={pages} onPage={setPage} text={d ? `${n(d.count)} rows` : ''} />
        </section>
        <section className="card">
          <div className="hm-h">
            <h2>Why rows are held back</h2>
          </div>
          <div className="dq-reasons">
            {d && d.reasons.length === 0 && <p className="muted rd-lead">No row is held back.</p>}
            {d?.reasons.map((r) => (
              <button key={r.column} type="button" className={only === r.column ? 'is-on' : undefined} aria-pressed={only === r.column} onClick={() => failing(r.column)}>
                <span className="dq-reason-h">
                  <span>{r.column}</span>
                  <span className="num muted text-sm">{n(r.rows)} rows</span>
                </span>
                <Bar value={pct(r.rows, Math.max(table.rejected, 1))} tone="bad" />
              </button>
            ))}
            <span className="muted text-sm">A row can break more than one rule. Click one to see its rows.</span>
          </div>
        </section>
      </div>
    </>
  )
}
