import { useMemo, useState } from 'react'

import { api } from '../api/client'
import type { ColumnProfile, RawTable, TableLink, TableProfile } from '../api/types'
import { useApi } from '../api/useApi'
import { formatDateTime } from '../format'
import { Icon } from './Icon'
import { Loader } from './Loader'
import { QualityRing } from './QualityRing'
import { Card, EmptyState, ErrorAlert } from './ui'

export type TableTab = 'overview' | 'columns' | 'issues' | 'links' | 'rows'
// eslint-disable-next-line react-refresh/only-export-components
export const TABLE_TABS: { value: TableTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'columns', label: 'Columns' },
  { value: 'issues', label: 'Issues' },
  { value: 'links', label: 'Relationships' },
  { value: 'rows', label: 'Rows' },
]

// Rows behind one finding: a broken rule of a column, values missing from a linked table, or exact copies.
export type Drill = { column?: string; rule: string; label: string }

type Issue = { column: string; rule: string; label: string; checked: number; failed: number }

const pct = (part: number, whole: number) => (whole ? (100 * part) / whole : 0)
const share = (part: number, whole: number) => {
  const p = pct(part, whole)
  return p > 0 && p < 0.1 ? '<0.1%' : `${p >= 10 || p === 0 ? Math.round(p) : p.toFixed(1)}%`
}
const n = (v: number) => v.toLocaleString('en-IN')
const tone = (failedShare: number) => (failedShare === 0 ? 'good' : failedShare < 5 ? 'fix' : 'bad')

function issuesOf(profile: TableProfile): Issue[] {
  return profile.columns
    .flatMap((c) =>
      c.rules.map((r) => ({ column: c.name, rule: r.key, label: r.label, checked: r.checked, failed: r.failed })),
    )
    .sort((a, b) => b.failed - a.failed || a.column.localeCompare(b.column))
}

// One table of a connector: what it holds, which rules its rows break, how it links to the other tables,
// and the rows behind any finding.
export function TableDetail({
  code,
  table,
  tab,
  onTab,
  onBack,
  canViewRows,
}: {
  code: string
  table: RawTable
  tab: TableTab
  onTab: (tab: TableTab) => void
  onBack: () => void
  canViewRows: boolean
}) {
  const data = useApi(() => api.rawProfile(code, table.name), [code, table.name, table.read_at])
  const [drill, setDrill] = useState<Drill | null>(null)
  const raw = data.data?.profile
  // A table read before profiling existed has no profile yet: the screen asks for it to be read again.
  const profile = raw && Array.isArray(raw.columns) && typeof raw.rows === 'number' ? (raw as TableProfile) : null

  const open = (d: Drill) => {
    setDrill(d)
    onTab('rows')
  }

  return (
    <>
      <section className="card raw-detail-head">
        <div className="raw-detail-title">
          <button type="button" className="btn btn-sm" onClick={onBack}>
            <Icon name="arrowLeft" size={14} /> All tables
          </button>
          <div className="stack" style={{ gap: 2, minWidth: 0 }}>
            <h2>{table.name}</h2>
            <span className="text-sm muted">
              {n(table.rows)} rows · {table.columns} columns · read {formatDateTime(table.read_at)}
              {!table.complete && ' · first rows only'}
            </span>
          </div>
        </div>
        <div className="tabs" role="tablist" aria-label="Table sections">
          {TABLE_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              className="tab"
              onClick={() => {
                if (t.value === 'rows') setDrill(null)
                onTab(t.value)
              }}
            >
              {t.label}
              {t.value === 'issues' && table.issues > 0 && <span className="tab-count">{table.issues}</span>}
            </button>
          ))}
        </div>
      </section>

      {data.error && <ErrorAlert message={data.error} />}
      {!data.data && !data.error && (
        <div className="card">
          <Loader kind="scan" label="Loading the profile" />
        </div>
      )}
      {data.data && !profile && tab !== 'rows' && (
        <Card>
          <EmptyState icon="refresh" title="Not profiled yet">
            This table was read before profiling existed. Click Read all tables again on the tables list.
          </EmptyState>
        </Card>
      )}

      {profile && tab === 'overview' && <Overview profile={profile} onOpen={open} onTab={onTab} />}
      {profile && tab === 'columns' && <Columns profile={profile} onOpen={open} />}
      {profile && tab === 'issues' && <Issues profile={profile} onOpen={open} />}
      {tab === 'links' && <Links code={code} table={table.name} onOpen={open} />}
      {tab === 'rows' && (
        <Rows
          key={`${drill?.column}:${drill?.rule}`}
          code={code}
          table={table}
          drill={drill}
          onClear={() => setDrill(null)}
          canViewRows={canViewRows}
        />
      )}
    </>
  )
}

function Overview({
  profile,
  onOpen,
  onTab,
}: {
  profile: TableProfile
  onOpen: (d: Drill) => void
  onTab: (t: TableTab) => void
}) {
  const issues = issuesOf(profile).filter((i) => i.failed > 0)
  const empty = profile.columns.filter((c) => c.empty === c.rows && c.rows > 0).length
  return (
    <>
      <section className="card raw-overview">
        <div className="raw-overview-score">
          <QualityRing score={profile.score} size={120} />
          <div className="stack" style={{ gap: 4, minWidth: 0 }}>
            <span className="dq-eyebrow">Data quality</span>
            <strong className="dq-health-title">
              {profile.score >= 95 ? 'In good shape' : profile.score >= 80 ? 'Needs some attention' : 'Needs attention'}
            </strong>
            <span className="text-sm muted">
              {n(profile.rules_checked - profile.rules_failed)} of {n(profile.rules_checked)} rule checks passed
            </span>
          </div>
        </div>
        <dl className="raw-facts">
          <div>
            <dt>Rows</dt>
            <dd className="num">{n(profile.rows)}</dd>
          </div>
          <div>
            <dt>Columns</dt>
            <dd className="num">
              {profile.column_count}
              {empty > 0 && <small> · {empty} always empty</small>}
            </dd>
          </div>
          <div>
            <dt>Cells filled</dt>
            <dd className="num">{profile.filled_share}%</dd>
          </div>
          <div>
            <dt>Rows with every column filled</dt>
            <dd className="num">{share(profile.complete_rows, profile.rows)}</dd>
          </div>
          <div>
            <dt>ID column</dt>
            <dd>{profile.key ?? <span className="muted">None found</span>}</dd>
          </div>
          <div>
            <dt>Exact copies</dt>
            <dd className="num">
              {profile.duplicate_rows ? (
                <button
                  type="button"
                  className="link"
                  onClick={() => onOpen({ rule: 'duplicates', label: 'Rows that are exact copies of another row' })}
                >
                  {n(profile.duplicate_rows)} rows
                </button>
              ) : (
                'None'
              )}
            </dd>
          </div>
        </dl>
      </section>

      <Card
        flush
        title="Biggest issues"
        description={
          issues.length
            ? `${issues.length} rule${issues.length === 1 ? '' : 's'} broken by at least one row`
            : 'Every rule passed.'
        }
        actions={
          issues.length > 5 && (
            <button type="button" className="btn btn-sm" onClick={() => onTab('issues')}>
              See all {issues.length}
            </button>
          )
        }
      >
        {issues.length === 0 ? (
          <EmptyState icon="check" title="No issues found" />
        ) : (
          <IssueList issues={issues.slice(0, 5)} onOpen={onOpen} />
        )}
      </Card>
    </>
  )
}

function IssueList({ issues, onOpen }: { issues: Issue[]; onOpen: (d: Drill) => void }) {
  return (
    <ul className="raw-issues">
      {issues.map((i) => {
        const failedShare = pct(i.failed, i.checked)
        return (
          <li key={`${i.column}:${i.rule}`}>
            <button
              type="button"
              className="raw-issue"
              disabled={!i.failed}
              onClick={() => onOpen({ column: i.column, rule: i.rule, label: `${i.column}: ${i.label}` })}
            >
              <i className={`dq-dot is-${tone(failedShare)}`} aria-hidden="true" />
              <span className="raw-issue-text">
                <strong>{i.column}</strong> <span className="muted">{i.label}</span>
              </span>
              <span className="dq-meter raw-issue-meter" aria-hidden="true">
                <i
                  className={`is-${tone(failedShare)}`}
                  style={{ width: `${Math.max(failedShare, i.failed ? 2 : 0)}%` }}
                />
              </span>
              <span className="num raw-issue-count">
                {i.failed ? (
                  <>
                    {n(i.failed)} <small className="muted">· {share(i.failed, i.checked)}</small>
                  </>
                ) : (
                  <span className="muted">All pass</span>
                )}
              </span>
              {i.failed > 0 && <Icon name="chevronRight" size={14} />}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Issues({ profile, onOpen }: { profile: TableProfile; onOpen: (d: Drill) => void }) {
  const [showPassed, setShowPassed] = useState(false)
  const all = issuesOf(profile)
  const broken = all.filter((i) => i.failed > 0)
  const shown = showPassed ? all : broken
  return (
    <Card
      flush
      title="Rules"
      description={`${broken.length} of ${all.length} rules broken. Click one to see the rows.`}
      actions={
        <label className="row text-sm" style={{ gap: 6 }}>
          <input type="checkbox" checked={showPassed} onChange={(e) => setShowPassed(e.target.checked)} /> Show rules
          that pass
        </label>
      }
    >
      {shown.length === 0 ? (
        <EmptyState icon="check" title="No rule is broken" />
      ) : (
        <IssueList issues={shown} onOpen={onOpen} />
      )}
    </Card>
  )
}

function Columns({ profile, onOpen }: { profile: TableProfile; onOpen: (d: Drill) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Card flush title="Columns" description="Click a column for its values, patterns and rules.">
      <div className="table-wrap">
        <table className="table raw-columns">
          <thead>
            <tr>
              <th>Column</th>
              <th>Type</th>
              <th className="num">Empty</th>
              <th className="num">Different values</th>
              <th className="num">Issues</th>
            </tr>
          </thead>
          <tbody>
            {profile.columns.map((c) => {
              const broken = c.rules.filter((r) => r.failed).length
              const isOpen = open === c.name
              return (
                <ColumnRows
                  key={c.name}
                  column={c}
                  broken={broken}
                  isOpen={isOpen}
                  onToggle={() => setOpen(isOpen ? null : c.name)}
                  onOpen={onOpen}
                />
              )
            })}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function ColumnRows({
  column: c,
  broken,
  isOpen,
  onToggle,
  onOpen,
}: {
  column: ColumnProfile
  broken: number
  isOpen: boolean
  onToggle: () => void
  onOpen: (d: Drill) => void
}) {
  return (
    <>
      <tr className={`raw-table-row${isOpen ? ' is-on' : ''}`} onClick={onToggle}>
        <td>
          <button type="button" className="link" aria-expanded={isOpen}>
            {c.name}
          </button>
          {c.key && <span className="badge">ID</span>}
          {c.identity && <Icon name="lock" size={12} className="raw-lock" label="Identity number, masked" />}
        </td>
        <td className="text-sm">{c.type_label}</td>
        <td className="num">{c.empty ? share(c.empty, c.rows) : <span className="muted">0</span>}</td>
        <td className="num">{n(c.distinct)}</td>
        <td className="num">
          {broken ? <strong className="raw-score is-bad">{broken}</strong> : <span className="muted">0</span>}
        </td>
      </tr>
      {isOpen && (
        <tr className="raw-column-detail">
          <td colSpan={5}>
            <ColumnDetail column={c} onOpen={onOpen} />
          </td>
        </tr>
      )}
    </>
  )
}

function ValueBars({
  title,
  items,
  total,
}: {
  title: string
  items: { value: string; count: number }[]
  total: number
}) {
  if (!items.length) return null
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="dq-eyebrow">{title}</span>
      <ul className="raw-values">
        {items.map((v) => (
          <li key={v.value}>
            <code title={v.value}>{v.value}</code>
            <span className="dq-meter" aria-hidden="true">
              <i className="is-good" style={{ width: `${pct(v.count, total)}%` }} />
            </span>
            <span className="num text-sm">{n(v.count)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ColumnDetail({ column: c, onOpen }: { column: ColumnProfile; onOpen: (d: Drill) => void }) {
  const filled = c.rows - c.empty
  const facts: [string, string][] = [
    ['Filled', `${n(filled)} of ${n(c.rows)} (${share(filled, c.rows)})`],
    ['Different values', `${n(c.distinct)}${c.distinct === filled && filled > 0 ? ' · every value different' : ''}`],
    [
      'Length',
      c.min_length === null
        ? '—'
        : c.min_length === c.max_length
          ? `${c.min_length}`
          : `${c.min_length} to ${c.max_length}`,
    ],
  ]
  if (c.min !== undefined) facts.push(['Smallest · largest', `${c.min} · ${c.max}`])
  if (c.types.length > 1) facts.push(['Kinds of value', c.types.map((t) => `${t.label} ${n(t.count)}`).join(', ')])
  if (c.date_formats?.length)
    facts.push(['Date formats', c.date_formats.map((f) => `${f.format} ${n(f.count)}`).join(', ')])
  return (
    <div className="raw-column-grid">
      <dl className="raw-facts raw-facts-compact">
        {facts.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
      {c.identity ? (
        <p className="text-sm muted">Identity number: only patterns are kept, never the numbers.</p>
      ) : (
        <ValueBars title="Most common values" items={c.top} total={filled} />
      )}
      <ValueBars title={`Patterns (${n(c.pattern_count)})`} items={c.patterns} total={filled} />
      {c.rules.length > 0 && (
        <div className="stack raw-column-rules" style={{ gap: 6 }}>
          <span className="dq-eyebrow">Rules</span>
          <IssueList
            issues={c.rules.map((r) => ({
              column: c.name,
              rule: r.key,
              label: r.label,
              checked: r.checked,
              failed: r.failed,
            }))}
            onOpen={onOpen}
          />
        </div>
      )}
    </div>
  )
}

function Links({ code, table, onOpen }: { code: string; table: string; onOpen: (d: Drill) => void }) {
  const links = useApi(() => api.rawLinks(code), [code])
  const mine = useMemo(
    () => (links.data?.relationships ?? []).filter((l) => l.table === table || l.to_table === table),
    [links.data, table],
  )
  if (links.error) return <ErrorAlert message={links.error} />
  if (!links.data) {
    return (
      <div className="card">
        <Loader kind="scan" label="Checking how the tables link" />
      </div>
    )
  }
  return (
    <Card flush title="Relationships" description="An ID column should only hold IDs the table it points to has.">
      {mine.length === 0 ? (
        <EmptyState icon="merge" title="No links found">
          No column of this table is named like another table's ID column, and no table points here.
        </EmptyState>
      ) : (
        <ul className="raw-links">
          {mine.map((l) => (
            <LinkRow key={`${l.table}.${l.column}`} link={l} here={table} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </Card>
  )
}

function LinkRow({ link: l, here, onOpen }: { link: TableLink; here: string; onOpen: (d: Drill) => void }) {
  const missingShare = pct(l.missing, l.checked)
  return (
    <li className="raw-link">
      <div className="raw-link-path">
        <code className={l.table === here ? 'is-here' : ''}>
          {l.table}.{l.column}
        </code>
        <Icon name="chevronRight" size={14} />
        <code className={l.to_table === here ? 'is-here' : ''}>
          {l.to_table}.{l.to_column}
        </code>
      </div>
      <span className="dq-meter" aria-hidden="true">
        <i className={`is-${tone(missingShare)}`} style={{ width: `${l.share}%` }} />
      </span>
      <span className="text-sm">
        <strong className="num">{l.share}%</strong> found
        {l.missing > 0 && (
          <>
            {' · '}
            {l.table === here ? (
              <button
                type="button"
                className="link"
                onClick={() =>
                  onOpen({ column: l.column, rule: 'link', label: `${l.column} not found in ${l.to_table}` })
                }
              >
                {n(l.missing)} not found
              </button>
            ) : (
              <span>{n(l.missing)} not found</span>
            )}
          </>
        )}
      </span>
    </li>
  )
}

function Rows({
  code,
  table,
  drill,
  onClear,
  canViewRows,
}: {
  code: string
  table: RawTable
  drill: Drill | null
  onClear: () => void
  canViewRows: boolean
}) {
  const [page, setPage] = useState(1)
  const rows = useApi(
    () => (canViewRows ? api.rawRows(code, table.name, page, drill ?? undefined) : Promise.resolve(null)),
    [code, table.name, page, canViewRows, drill?.column, drill?.rule],
  )
  const count = rows.data?.count ?? (drill ? 0 : table.rows)
  const pages = Math.max(1, Math.ceil(count / 50))
  const sensitive = new Set(table.sensitive)

  return (
    <Card
      flush
      title={drill ? drill.label : 'Rows'}
      description={
        drill
          ? rows.data
            ? `${n(rows.data.total)} rows${rows.data.total > rows.data.count ? `, the first ${n(rows.data.count)} shown` : ''}`
            : 'Finding the rows'
          : `${n(table.rows)} rows, values exactly as the system sent them`
      }
      actions={
        <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
          {drill && (
            <button type="button" className="btn btn-sm" onClick={onClear}>
              <Icon name="x" size={14} /> Show all rows
            </button>
          )}
          {canViewRows && pages > 1 && (
            <>
              <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <span className="text-sm muted num">
                Page {page} of {pages}
              </span>
              <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next
              </button>
            </>
          )}
        </div>
      }
    >
      {!canViewRows && (
        <EmptyState icon="lock" title="Rows hidden for your role">
          Your role sees the profile only.
        </EmptyState>
      )}
      {rows.error && <ErrorAlert message={rows.error} />}
      {canViewRows && !rows.data && !rows.error && <Loader kind="scan" label="Loading rows" />}
      {rows.data && (
        <div className="table-wrap raw-preview">
          <table className="table">
            <thead>
              <tr>
                <th className="num">Row</th>
                {rows.data.column_names.map((c) => (
                  <th key={c} className={c === drill?.column ? 'is-drill' : undefined}>
                    {c}
                    {sensitive.has(c) && <Icon name="lock" size={12} className="raw-lock" />}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.data.results.map((r, i) => (
                <tr key={rows.data!.positions[i] ?? i}>
                  <td className="num muted">{n((rows.data!.positions[i] ?? (page - 1) * 50 + i) + 1)}</td>
                  {r.map((v, j) => (
                    <td
                      key={j}
                      title={v === null ? 'Empty' : String(v)}
                      className={rows.data!.column_names[j] === drill?.column ? 'is-drill' : undefined}
                    >
                      {v === null || v === '' ? <span className="raw-empty">empty</span> : String(v)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}
