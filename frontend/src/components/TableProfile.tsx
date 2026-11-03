import { useMemo, useState } from 'react'

import { api } from '../api/client'
import type { ColumnProfile, ProfileRule, RawTable, TableLink, TableProfile } from '../api/types'
import { useApi } from '../api/useApi'
import { formatDate, formatDateTime } from '../format'
import { Icon } from './Icon'
import { Loader } from './Loader'
import { QualityRing } from './QualityRing'
import { Card, EmptyState, ErrorAlert } from './ui'

export type TableTab = 'overview' | 'columns' | 'issues' | 'links' | 'rows'
// eslint-disable-next-line react-refresh/only-export-components
export const TABLE_TABS: { value: TableTab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'columns', label: 'Columns' },
  { value: 'issues', label: 'Problems' },
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
              onClick={() =>
                onOpen({ column: i.column, rule: i.rule, label: `${i.column}: ${problemLabel(i.rule, i.label)}` })
              }
            >
              <i className={`dq-dot is-${tone(failedShare)}`} aria-hidden="true" />
              <span className="raw-issue-text">
                <strong>{i.column}</strong>{' '}
                <span className="muted">{i.failed ? problemLabel(i.rule, i.label) : i.label}</span>
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
      title="Problems"
      description={
        broken.length
          ? `${broken.length} problem${broken.length === 1 ? '' : 's'} found. Click one to see the rows.`
          : 'No problems found.'
      }
      actions={
        <label className="row text-sm" style={{ gap: 6 }}>
          <input type="checkbox" checked={showPassed} onChange={(e) => setShowPassed(e.target.checked)} /> Show checks
          that pass
        </label>
      }
    >
      {shown.length === 0 ? (
        <EmptyState icon="check" title="No problems found" />
      ) : (
        <IssueList issues={shown} onOpen={onOpen} />
      )}
    </Card>
  )
}

// The Columns tab in plain words: what each column holds, how full it is and whether anything is wrong.
const HOLDS: Record<string, string> = {
  boolean: 'Yes / no',
  integer: 'Whole numbers',
  decimal: 'Numbers',
  percent: 'Percentages',
  scientific: 'Numbers like 4.05E+11',
  date: 'Dates',
  email: 'Email addresses',
  uuid: 'IDs',
  text: 'Text',
  empty: 'Nothing',
}

// One sentence per broken rule, with the number of rows in front.
const PROBLEM: Record<string, (count: string, c: ColumnProfile) => string> = {
  unique: (k) => `${k} rows share their ID with another row`,
  once: (k) => `${k} rows share this number with another row`,
  email: (k) => `${k} email addresses are not valid`,
  phone: (k) => `${k} numbers are not valid Indian mobile numbers`,
  pincode: (k) => `${k} PIN codes do not have 6 digits`,
  pan: (k) => `${k} PANs do not follow the PAN pattern (ABCDE1234F)`,
  aadhaar_excel: (k) => `${k} Aadhaar numbers were damaged by Excel (saved like 4.05E+11)`,
  aadhaar: (k) => `${k} Aadhaar numbers do not have 12 digits`,
  date: (k) => `${k} dates are not real dates (like 31-02-2020)`,
  age: (k) => `${k} people are under 18 or over 100 years old`,
  formats: (k) => `${k} dates are written in a different format from the rest`,
  spaces: (k) => `${k} values have extra spaces`,
  type: (k, c) => `${k} values are not ${(HOLDS[c.type] ?? 'the same kind').toLowerCase()}`,
  filled: () => 'This column is always empty',
}

function problemText(rule: ProfileRule, c: ColumnProfile) {
  const make = PROBLEM[rule.key]
  return make ? make(n(rule.failed), c) : `${n(rule.failed)} rows break: ${rule.label}`
}

// The same sentence without the number, for lists that show the number in their own column.
function problemLabel(key: string, fallback: string) {
  if (key === 'type') return 'values of a different kind'
  const make = PROBLEM[key]
  const text = make ? make('', {} as ColumnProfile).trim() : fallback
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function formatEnd(value: number | string | undefined, type: string) {
  if (value === undefined) return ''
  if (type === 'date') return formatDate(String(value))
  return typeof value === 'number' ? value.toLocaleString('en-IN') : value
}

function Columns({ profile, onOpen }: { profile: TableProfile; onOpen: (d: Drill) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const problems = profile.columns.filter((c) => c.rules.some((r) => r.failed)).length
  return (
    <Card
      flush
      title="Columns"
      description={`${profile.columns.length} columns · ${problems ? `${problems} with problems` : 'no problems found'}. Click a column to see more.`}
    >
      <div className="table-wrap">
        <table className="table raw-columns">
          <thead>
            <tr>
              <th>Column</th>
              <th>Holds</th>
              <th>Filled</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {profile.columns.map((c) => {
              const isOpen = open === c.name
              return (
                <ColumnRows
                  key={c.name}
                  column={c}
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

function ColumnStatus({ column: c }: { column: ColumnProfile }) {
  const broken = c.rules.filter((r) => r.failed)
  if (c.empty === c.rows && c.rows > 0) return <span className="col-status is-empty">Always empty</span>
  if (!broken.length) {
    return (
      <span className="col-status is-good">
        <Icon name="check" size={13} /> Looks good
      </span>
    )
  }
  return (
    <span className="col-status is-bad">
      <Icon name="alert" size={13} /> {broken.length} problem{broken.length === 1 ? '' : 's'}
    </span>
  )
}

function ColumnRows({
  column: c,
  isOpen,
  onToggle,
  onOpen,
}: {
  column: ColumnProfile
  isOpen: boolean
  onToggle: () => void
  onOpen: (d: Drill) => void
}) {
  const filled = c.rows - c.empty
  const filledShare = pct(filled, c.rows)
  return (
    <>
      <tr className={`raw-table-row${isOpen ? ' is-on' : ''}`} onClick={onToggle}>
        <td>
          <button type="button" className="link" aria-expanded={isOpen}>
            {c.name}
          </button>
          {c.key && <span className="badge">ID</span>}
          {c.identity && <Icon name="lock" size={12} className="raw-lock" label="Identity number, kept hidden" />}
        </td>
        <td className="text-sm">{c.key ? 'IDs' : c.identity ? 'Identity numbers' : (HOLDS[c.type] ?? c.type_label)}</td>
        <td>
          <span className="col-filled">
            <span className="dq-meter" aria-hidden="true">
              <i
                className={`is-${filledShare === 100 ? 'good' : filledShare >= 80 ? 'fix' : 'bad'}`}
                style={{ width: `${filledShare}%` }}
              />
            </span>
            <span className="num text-sm">{share(filled, c.rows)}</span>
          </span>
        </td>
        <td>
          <ColumnStatus column={c} />
        </td>
      </tr>
      {isOpen && (
        <tr className="raw-column-detail">
          <td colSpan={4}>
            <ColumnDetail column={c} onOpen={onOpen} />
          </td>
        </tr>
      )}
    </>
  )
}

// Plain sentences about one column, then its problems (each opens the rows), then its most common values.
function ColumnDetail({ column: c, onOpen }: { column: ColumnProfile; onOpen: (d: Drill) => void }) {
  const filled = c.rows - c.empty
  const broken = c.rules.filter((r) => r.failed)
  const facts: string[] = []
  facts.push(
    c.empty === 0
      ? 'Every row has a value.'
      : filled === 0
        ? 'Every row is empty.'
        : `${n(c.empty)} rows (${share(c.empty, c.rows)}) are empty.`,
  )
  if (c.identity) {
    facts.push('Identity number: Lumina keeps it hidden and checks only its shape.')
  } else if (filled > 0) {
    if (c.distinct === filled) facts.push('Every value is different.')
    else if (c.distinct === 1) facts.push(`Every filled row has the same value: ${c.top[0]?.value ?? 'hidden'}.`)
    else if (c.distinct <= 6 && c.top.length)
      facts.push(`Only ${c.distinct} different values: ${c.top.map((t) => t.value).join(', ')}.`)
    else facts.push(`${n(c.distinct)} different values.`)
  }
  if (c.min !== undefined && c.max !== undefined) {
    const what = c.type === 'date' ? 'Dates' : 'Values'
    facts.push(`${what} from ${formatEnd(c.min, c.type)} to ${formatEnd(c.max, c.type)}.`)
  }
  const formats = c.date_formats ?? []
  if (formats.length === 1) facts.push(`All dates are written as ${formats[0].format}.`)
  if (formats.length > 1)
    facts.push(`Dates are written in ${formats.length} ways: ${formats.map((f) => f.format).join(', ')}.`)

  return (
    <div className="col-detail">
      <ul className="col-facts">
        {facts.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>

      <div className="stack" style={{ gap: 8 }}>
        <span className="dq-eyebrow">{broken.length ? 'Problems found' : 'Checks'}</span>
        {broken.length === 0 ? (
          <p className="col-ok">
            <Icon name="check" size={14} /> No problems found
          </p>
        ) : (
          <ul className="col-problems">
            {broken.map((r) => (
              <li key={r.key}>
                <Icon name="alert" size={14} className="col-problem-icon" />
                <span>{problemText(r, c)}</span>
                {r.key !== 'filled' && (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onOpen({ column: c.name, rule: r.key, label: `${c.name}: ${problemText(r, c)}` })}
                  >
                    See rows
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Common values only help when values repeat; for dates of birth or names each is under 0.1%. */}
      {!c.identity && c.top.length > 0 && pct(c.top[0].count, filled) >= 1 && (
        <div className="stack" style={{ gap: 8 }}>
          <span className="dq-eyebrow">Most common values</span>
          <ul className="raw-values">
            {c.top.map((v) => (
              <li key={v.value}>
                <code title={v.value}>{v.value}</code>
                <span className="dq-meter" aria-hidden="true">
                  <i className="is-good" style={{ width: `${pct(v.count, filled)}%` }} />
                </span>
                <span className="num text-sm">{share(v.count, filled)}</span>
              </li>
            ))}
          </ul>
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
