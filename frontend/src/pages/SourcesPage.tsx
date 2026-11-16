import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { RawTable, Source } from '../api/types'
import { useApi } from '../api/useApi'
import { useCan } from '../auth/AuthContext'
import { ConnectorLogo } from '../components/ConnectorLogo'
import { Dialog } from '../components/Dialog'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { formatRelative } from '../format'
import { profileJob } from '../profileJob'

const n = (v: number) => v.toLocaleString('en-IN')
const KIND: Record<string, string> = { postgresql: 'Databases', mysql: 'Databases', snowflake: 'Databases', databricks: 'Databases', cloudera: 'Databases', mongodb: 'Databases', file_upload: 'Files', salesforce: 'Apps', servicenow: 'Apps', rest_api: 'Apps', push_api: 'Apps' }
const kindOf = (s: Source) => KIND[s.connector_type] ?? 'Other'

// Sources: the bank systems Lumina reads from. A list that stays usable with any number of them.
export function SourcesPage() {
  const sources = useApi(() => api.sources(), [])
  const raw = useApi(() => api.rawSources(), [])
  const canAdd = useCan('manage_connectors')
  const [kind, setKind] = useState('All')
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Source | null>(null)
  const list = sources.data?.results ?? []
  const kinds = ['All', ...Array.from(new Set(list.map(kindOf)))]
  const shown = list.filter((s) => (kind === 'All' || kindOf(s) === kind) && s.name.toLowerCase().includes(q.trim().toLowerCase()))
  const profiled = (code: string) => raw.data?.sources.find((s) => s.code === code)

  return (
    <>
      <header className="page-header">
        <div className="page-header-text">
          <h1>Sources</h1>
          <p>The bank systems Lumina reads from. Read-only: Lumina never changes them.</p>
        </div>
        {canAdd && (
          <Link className="btn btn-primary" to="/connectors/new">
            <Icon name="connectors" size={15} /> Add source
          </Link>
        )}
      </header>
      <section className="card">
        <div className="hm-h">
          <div className="lx-seg" role="group" aria-label="Kind">
            {kinds.map((k) => (
              <button key={k} type="button" className={k === kind ? 'is-on' : undefined} aria-pressed={k === kind} onClick={() => setKind(k)}>
                {k}
              </button>
            ))}
          </div>
          <label className="lx-search">
            <Icon name="search" size={15} />
            <input placeholder="Search sources" aria-label="Search sources" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
        </div>
        {!sources.data && <Loader kind="orbit" label="Loading sources" />}
        {sources.data && (
          <div className="table-wrap">
            <table className="sx-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Tables checked</th>
                  <th>Last checked</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((s) => {
                  const p = profiled(s.code)
                  return (
                    <tr key={s.code} tabIndex={0} onClick={() => setOpen(s)} onKeyDown={(e) => e.key === 'Enter' && setOpen(s)}>
                      <td className="is-main">
                        <span className="sx-src">
                          <ConnectorLogo type={s.connector_type} size={34} />
                          <span>
                            <b>{s.name}</b>
                            <small>{s.connector_label}</small>
                          </span>
                        </span>
                      </td>
                      <td data-label="Tables checked" className="num">{p ? n(p.tables) : '—'}</td>
                      <td data-label="Last checked" className="muted">{p?.read_at ? formatRelative(p.read_at) : 'Never'}</td>
                      <td>
                        <span className={`lx-pill is-${s.enabled ? 'ok' : 'warn'}`}>{s.enabled ? 'Connected' : 'Switched off'}</span>
                      </td>
                    </tr>
                  )
                })}
                {shown.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted sx-empty">
                      No source matches.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        <div className="sx-foot">
          <span>
            Showing {shown.length} of {list.length} sources
          </span>
          <span>Click a source to see its tables</span>
        </div>
      </section>
      {open && <SourceDialog source={open} canRead={raw.data?.can_read ?? false} onClose={() => setOpen(null)} />}
    </>
  )
}

function SourceDialog({ source, canRead, onClose }: { source: Source; canRead: boolean; onClose: () => void }) {
  const [names, setNames] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<RawTable[]>([])
  const [ticked, setTicked] = useState<Set<string>>(new Set())
  const canSetUp = useCan('manage_connectors')

  useEffect(() => {
    api.rawTables(source.code).then((t) => setDone(t.tables), () => undefined)
    if (!canRead) return
    api.rawDiscover(source.code).then((f) => setNames(f.tables), (e: Error) => setError(e.message))
  }, [source.code, canRead])

  const tables = names ?? done.map((t) => t.name)
  const info = (name: string) => done.find((t) => t.name === name)
  const toggle = (t: string) =>
    setTicked((old) => {
      const next = new Set(old)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  const check = () => {
    profileJob.start(source.code, source.name, tables.filter((t) => ticked.has(t)))
    onClose()
  }

  return (
    <Dialog
      title={source.name}
      subtitle={`${source.connector_label} · ${source.enabled ? 'Connected' : 'Switched off'}`}
      onClose={onClose}
      size="lg"
      footer={
        <>
          {canSetUp && (
            <Link className="btn" to={`/connectors/${source.code}`} style={{ marginRight: 'auto' }}>
              Connection settings
            </Link>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {canRead && (
            <button type="button" className="btn btn-primary" disabled={!ticked.size} onClick={check}>
              Check {ticked.size || ''} {ticked.size === 1 ? 'table' : 'tables'}
            </button>
          )}
        </>
      }
    >
      <div className="sx-kv">
        <div>
          <b>{names ? n(names.length) : '…'}</b>
          <span>tables</span>
        </div>
        <div>
          <b>{n(done.length)}</b>
          <span>checked</span>
        </div>
        <div>
          <b>{n(done.reduce((a, t) => a + (t.to_check ?? 0), 0))}</b>
          <span>columns need attention</span>
        </div>
      </div>
      {error && <p className="sx-error">{error}</p>}
      {canRead && names === null && !error && <Loader kind="scan" label="Asking the source for its tables" />}
      <div className="sx-checks">
        {tables.map((t) => {
          const d = info(t)
          return (
            <label key={t}>
              {canRead && <input type="checkbox" checked={ticked.has(t)} onChange={() => toggle(t)} />}
              <span className="sx-grow">
                <b>{t}</b>
                <small>{d ? `${n(d.rows)} rows · checked ${formatRelative(d.read_at)}` : 'Not checked yet'}</small>
              </span>
              {d && <span className={`lx-pill is-${d.to_check ? 'warn' : 'ok'}`}>{d.to_check ? `${d.to_check} to fix` : 'All fine'}</span>}
            </label>
          )
        })}
      </div>
    </Dialog>
  )
}
