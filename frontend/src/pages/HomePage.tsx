import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { AuditEvent } from '../api/types'
import { useApi } from '../api/useApi'
import { useAuth } from '../auth/AuthContext'
import { Explain } from '../components/Explain'
import { Icon, type IconName } from '../components/Icon'
import { formatRelative } from '../format'

const n = (v: number) => v.toLocaleString('en-IN')

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
    { done: (c?.tables ?? 0) > 0, title: 'Check the data', detail: c ? `${n(c.tables)} tables checked` : '…', action: 'Check more', to: '/profiling' },
    { done: (c?.rules ?? 0) > 0, title: 'Fix problems', detail: c ? `${n(c.rules)} format rule${c.rules === 1 ? '' : 's'}` : '…', action: 'Fix now', to: '/profiling' },
    { done: false, title: 'Review customers', detail: 'Matches, trust scores and golden records', action: 'Open', to: '/customers' },
  ]
  const next = steps.findIndex((s) => !s.done)
  const items: Attention[] = [
    ...off.map((s) => ({ icon: 'connectors' as IconName, tone: 'bad' as const, title: `${s.name} is switched off`, detail: 'Lumina is not reading it', action: 'Open', to: `/connectors/${s.code}` })),
    ...(attention ?? []),
  ]
  const first = (user?.name ?? '').split(' ')[0]

  return (
    <>
      <header className="page-header">
        <div className="page-header-text">
          <h1>
            {greeting()}
            {first ? `, ${first}` : ''}
          </h1>
          <p>Here is how your customer data looks today.</p>
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
          <span className="muted text-sm">Ready for customer records</span>
        </div>
      </div>

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
