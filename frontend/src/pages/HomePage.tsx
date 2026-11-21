import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { AuditEvent } from '../api/types'
import { useApi } from '../api/useApi'
import { useAuth, useCan } from '../auth/AuthContext'
import { Explain } from '../components/Explain'
import { Icon, type IconName } from '../components/Icon'
import { GOLDEN_READY } from '../features'
import { formatRelative } from '../format'

const n = (v: number) => v.toLocaleString('en-IN')

const HOME_BANDS = [
  { band: 'High', label: 'High', range: '90–100', tone: 'good' },
  { band: 'Good', label: 'Good', range: '75–89', tone: 'ok' },
  { band: 'Review', label: 'Review', range: '50–74', tone: 'warn' },
  { band: 'Low', label: 'Low', range: 'below 50', tone: 'bad' },
] as const

type Attention = { icon: IconName; tone: 'bad' | 'warn' | 'acc'; title: string; detail: string; action: string; to: string }

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// Home: how far the bank's data has come, what needs attention, and what happened lately.
export function HomePage() {
  const { user } = useAuth()
  const counts = useApi(() => api.pipeline(), [])
  const sources = useApi(() => api.sources(), [])
  const activity = useApi(() => api.audit({}), [])
  const canMatch = useCan('view_matches') && GOLDEN_READY
  const match = useApi(() => (canMatch ? api.match() : Promise.resolve(null)), [canMatch])
  const people = useApi(() => (canMatch ? api.people('', '', 1) : Promise.resolve(null)), [canMatch])
  const [attention, setAttention] = useState<Attention[] | null>(null)

  // Tables that need a look, most problems first, plus systems that cannot connect.
  useEffect(() => {
    let live = true
    api.rawSources().then(async ({ sources: raw }) => {
      const found: (Attention & { weight: number })[] = []
      for (const s of raw.filter((x) => x.tables > 0)) {
        const t = await api.rawTables(s.code).catch(() => null)
        t?.tables
          .filter((x) => x.to_check)
          .forEach((x) =>
            found.push({
              icon: 'alert',
              tone: 'warn',
              title: `${x.name}: ${x.to_check} column${x.to_check === 1 ? ' needs' : 's need'} attention`,
              detail: s.name,
              action: 'Open',
              to: `/profiling?${new URLSearchParams({ source: s.code, table: x.name })}`,
              weight: x.to_check ?? 0,
            }),
          )
      }
      if (live) setAttention(found.sort((a, b) => b.weight - a.weight).slice(0, 5))
    }, () => live && setAttention([]))
    return () => {
      live = false
    }
  }, [])

  const c = counts.data
  const all = sources.data?.results ?? []
  const off = all.filter((s) => !s.enabled)
  const steps = [
    { done: all.length > 0, title: 'Connect a source', detail: sources.data ? `${n(all.length)} connected` : '…', action: 'Add another', to: '/sources' },
    { done: (c?.tables ?? 0) > 0, title: 'Profile source data', detail: c ? `${n(c.tables)} tables checked` : '…', action: 'Open profiling', to: '/profiling' },
    { done: (c?.rules ?? 0) > 0, title: 'Apply quality rules', detail: c ? `${n(c.rules)} format rule${c.rules === 1 ? '' : 's'}` : '…', action: 'Manage rules', to: '/rules' },
    {
      done: (match.data?.summary.people ?? 0) > 0,
      title: GOLDEN_READY ? 'Match customers' : 'Customers and golden records',
      detail: !GOLDEN_READY ? 'Under development' : match.data ? (match.data.summary.people ? `${n(match.data.summary.people)} customers found` : 'Map fields, then run matching') : '…',
      action: GOLDEN_READY ? 'Open customers' : 'View status',
      to: '/customers',
    },
  ]
  const next = steps.findIndex((s) => !s.done)
  const items: Attention[] = [
    ...off.map((s) => ({ icon: 'connectors' as IconName, tone: 'bad' as const, title: `${s.name} is switched off`, detail: 'Lumina is not reading it', action: 'Open', to: `/connectors/${s.code}` })),
    ...(match.data && match.data.summary.review + match.data.summary.conflicts > 0
      ? [{ icon: 'merge' as IconName, tone: 'warn' as const, title: `${n(match.data.summary.review + match.data.summary.conflicts)} possible matches wait for a decision`, detail: match.data.summary.conflicts ? `${n(match.data.summary.conflicts)} with differing PAN, Aadhaar or date of birth` : 'Same person or not?', action: 'Review', to: '/customers?tab=match' }]
      : []),
    ...(attention ?? []),
  ]
  const bands = people.data?.bands
  const scored = bands ? Object.values(bands).reduce((a, x) => a + x, 0) : 0
  const first = (user?.name ?? '').split(' ')[0]

  return (
    <>
      <header className="page-header">
        <div className="page-header-text">
          <h1>
            {greeting()}
            {first ? `, ${first}` : ''}
          </h1>
          <p>Here is the current state of your data operations.</p>
        </div>
      </header>

      <section className="card">
        <div className="hm-h">
          <h2>Your progress</h2>
          <span className="muted text-sm">
            {steps.filter((s) => s.done).length} of {steps.length} steps done
          </span>
        </div>
        <div className="hm-steps">
          {steps.map((s, i) => (
            <div key={s.title} className={`hm-step${s.done ? ' is-done' : i === next ? ' is-now' : ''}`}>
              <span className="hm-dot">{s.done ? <Icon name="check" size={14} /> : i + 1}</span>
              <div>
                <b>{s.title}</b>
                <p>{s.detail}</p>
                <Link to={s.to} className="link text-sm">
                  {s.action} →
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="hm-stats">
        <div className="card hm-stat">
          <span className="muted">Sources</span>
          <b>{sources.data ? n(all.length) : '…'}</b>
          <span className="muted text-sm">{off.length ? `${off.length} switched off` : 'All connected'}</span>
        </div>
        <div className="card hm-stat">
          <span className="muted">Tables checked</span>
          <b>
            {c ? (
              <Explain title="Tables checked" text="Tables whose columns Lumina has counted. Only the tables someone chose are checked.">
                {n(c.tables)}
              </Explain>
            ) : '…'}
          </b>
          <span className="muted text-sm">Across every source</span>
        </div>
        <div className="card hm-stat">
          <span className="muted">Format rules</span>
          <b>{c ? n(c.rules) : '…'}</b>
          <span className="muted text-sm">Say what a correct value looks like</span>
        </div>
        <div className="card hm-stat">
          <span className="muted">Clean rows</span>
          <b>
            {c ? (
              <Explain title="Clean rows" text="Rows that pass every format rule on their table. Rows that break a rule are held back." calc="Counted on tables that have rules">
                {n(c.silver)}
              </Explain>
            ) : '…'}
          </b>
          <span className="muted text-sm">Rows that pass all table rules</span>
        </div>
      </div>

      {canMatch && scored > 0 && bands && (
        <section className="card">
          <div className="hm-h">
            <h2>
              <Explain title="Customer trust" text="Every customer gets a trust score from five checks: uniqueness, recency, completeness, consistency and accuracy. Open a customer and press Why? to see how.">
                Customer trust
              </Explain>
            </h2>
            <Link to="/customers" className="link text-sm">
              See all {n(scored)} customers →
            </Link>
          </div>
          <div className="hm-trust" role="img" aria-label={HOME_BANDS.map((b) => `${b.band} ${bands[b.band] ?? 0}`).join(', ')}>
            {HOME_BANDS.map((b) => (bands[b.band] ? <i key={b.band} className={`is-${b.tone}`} style={{ flexGrow: bands[b.band] }} /> : null))}
          </div>
          <div className="hm-trust-legend">
            {HOME_BANDS.map((b) => (
              <Link key={b.band} to="/customers" className={`hm-trust-key is-${b.tone}`}>
                <i />
                <b>{n(bands[b.band] ?? 0)}</b> {b.label}
                <small className="muted">{b.range}</small>
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="hm-grid">
        <section className="card">
          <div className="hm-h">
            <h2>Needs your attention</h2>
          </div>
          {attention === null && <p className="muted hm-empty">Looking…</p>}
          {attention !== null && items.length === 0 && <p className="muted hm-empty">Nothing needs attention right now.</p>}
          {items.map((t) => (
            <div key={t.title} className="hm-row">
              <span className={`hm-ic is-${t.tone}`}>
                <Icon name={t.icon} size={17} />
              </span>
              <div className="hm-grow">
                <b>{t.title}</b>
                <span className="muted text-sm">{t.detail}</span>
              </div>
              <Link to={t.to} className="btn btn-sm">
                {t.action}
              </Link>
            </div>
          ))}
        </section>
        <section className="card">
          <div className="hm-h">
            <h2>Recent activity</h2>
          </div>
          {!activity.data && <p className="muted hm-empty">Loading…</p>}
          {activity.data?.results.length === 0 && <p className="muted hm-empty">Nothing yet.</p>}
          {activity.data?.results.slice(0, 6).map((a: AuditEvent) => (
            <div key={a.id} className="hm-row">
              <span className="hm-ic is-acc">
                <Icon name="audit" size={16} />
              </span>
              <div className="hm-grow">
                <b>{a.action_label}</b>
                <span className="muted text-sm">
                  {a.actor_name || 'System'} · {formatRelative(a.at)}
                </span>
              </div>
            </div>
          ))}
        </section>
      </div>
    </>
  )
}
