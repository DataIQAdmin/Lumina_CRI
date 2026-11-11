import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { Source } from '../api/types'
import { useApi } from '../api/useApi'
import { useCan } from '../auth/AuthContext'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { PipelineBar } from '../components/PipelineBar'
import { useToast } from '../components/Toasts'
import { Card, ErrorAlert, PageHeader, StatusBadge } from '../components/ui'
import { ConnectorLogo } from '../components/ConnectorLogo'
import { formatRelative, formatScore, sourceHue, sourceTier } from '../format'

// Source trust tiers: why one system's value beats another's when they disagree.
const TIERS = [
  { tone: 'good' as const, name: 'Tier 1 · Core systems', range: '80 and above', min: 0.8, max: 1.01 },
  { tone: 'warn' as const, name: 'Tier 2 · Staff-entered', range: '50 to 79', min: 0.5, max: 0.8 },
  { tone: 'bad' as const, name: 'Tier 3 · Files and manual', range: 'below 50', min: 0, max: 0.5 },
]

export function ConnectorsPage() {
  const { data, error, reload } = useApi(() => api.sources(), [])
  const toast = useToast()
  const [syncingAll, setSyncingAll] = useState(false)
  const canManage = useCan('manage_sources')
  const canSetUp = useCan('manage_connectors')

  const sources = data?.results ?? []
  const enabled = sources.filter((s) => s.enabled)
  const totalRecords = sources.reduce((sum, s) => sum + s.record_count, 0)
  const lastSync = sources
    .map((s) => s.last_synced_at)
    .filter(Boolean)
    .sort()
    .at(-1)

  const syncAll = async () => {
    setSyncingAll(true)
    try {
      for (const s of enabled) await api.syncSource(s.code)
      toast('success', `Synced ${enabled.length} sources. Golden records and scores rebuilt.`)
      reload()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setSyncingAll(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Connectors"
        description="Bank systems Lumina reads from. Read-only: Lumina never writes back."
        actions={
          canManage ? (
            <>
              {canSetUp && (
                <Link className="btn" to="/connectors/new">
                  <Icon name="connectors" size={16} /> Add connector
                </Link>
              )}
              <button type="button" className="btn btn-primary" onClick={syncAll} disabled={syncingAll || !enabled.length}>
                <Icon name="refresh" size={16} className={syncingAll ? 'spin' : undefined} />
                {syncingAll ? 'Syncing...' : 'Sync all'}
              </button>
            </>
          ) : (
            <span className="pill">
              <Icon name="lock" size={14} /> View only for your role
            </span>
          )
        }
      />
      <PipelineBar />
      {error && <ErrorAlert message={error} />}

      {data && (
        <section className="card">
          <dl className="status-strip">
            <div>
              <dt>Connected</dt>
              <dd>
                {enabled.length} <span className="muted text-sm">of {sources.length}</span>
              </dd>
            </div>
            <div>
              <dt>Source records</dt>
              <dd>{totalRecords}</dd>
            </div>
            <div>
              <dt>Last sync</dt>
              <dd>{formatRelative(lastSync ?? null)}</dd>
            </div>
            <div>
              <dt>Share of records</dt>
              <dd>
                <div className="share-bar" style={{ marginTop: 8 }} role="img" aria-label="Share of records by source">
                  {sources.map((s) => (
                    <i
                      key={s.code}
                      style={{
                        width: `${(s.record_count / Math.max(totalRecords, 1)) * 100}%`,
                        background: `var(--c${sourceHue(s.code).slice(4)})`,
                      }}
                      title={`${s.name}: ${s.record_count} records`}
                    />
                  ))}
                </div>
              </dd>
            </div>
          </dl>
        </section>
      )}

      <div className="grid-auto">
        {data
          ? sources.map((s) => (
              <ConnectorCard
                key={s.code}
                s={s}
                share={s.record_count / Math.max(totalRecords, 1)}
                canManage={canManage}
                canSetUp={canSetUp}
                onChanged={reload}
              />
            ))
          : (
              <div className="card grid-full">
                <Loader kind="orbit" label="Connecting to the source systems" />
              </div>
            )}
        {data &&
          (canSetUp ? (
            <Link className="add-tile" to="/connectors/new">
              <span className="add-icon">
                <Icon name="connectors" size={20} />
              </span>
              <strong>Add a bank system</strong>
              <span>Databases, Snowflake, Databricks, Cloudera, Salesforce, ServiceNow, an API or a CSV file. Read-only.</span>
            </Link>
          ) : (
            <div className="add-tile">
              <span className="add-icon">
                <Icon name="connectors" size={20} />
              </span>
              <strong>Add a bank system</strong>
              <span>Your organization admin connects new systems: databases, APIs or files.</span>
            </div>
          ))}
      </div>

      {data && (
        <Card
          title="Which source wins"
          description="Higher trust wins a field. On a tie, the newest value wins."
        >
          <div className="tiers">
            {TIERS.map((t) => {
              const members = sources.filter((s) => Number(s.trust) >= t.min && Number(s.trust) < t.max)
              return (
                <div key={t.name} className="tier">
                  <div className="tier-head">
                    <StatusBadge tone={t.tone}>{t.name}</StatusBadge>
                    <span className="mono text-xs muted">{t.range}</span>
                  </div>
                  <span className="text-sm">
                    {members.length ? (
                      members.map((s) => `${s.name} (${formatScore(s.trust)})`).join(', ')
                    ) : (
                      <span className="muted">No sources yet</span>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </>
  )
}

function ConnectorCard({
  s,
  share,
  canManage,
  onChanged,
 canSetUp,}: {
  s: Source
  share: number
  canManage: boolean
  onChanged: () => void; canSetUp: boolean}) {
  const [busy, setBusy] = useState<'sync' | 'toggle' | null>(null)
  const toast = useToast()
  const tier = sourceTier(Number(s.trust))

  const sync = async () => {
    setBusy('sync')
    try {
      const r = await api.syncSource(s.code)
      toast(
        'success',
        `${s.name}: ${r.fetched} records read, ${r.created} new.${r.new_suggestions ? ` ${r.new_suggestions} new matches to review.` : ''}`,
      )
      onChanged()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const toggle = async () => {
    setBusy('toggle')
    try {
      await api.updateSource(s.code, { enabled: !s.enabled })
      toast(
        'success',
        s.enabled
          ? `${s.name} disconnected. Customers found only there are hidden until you reconnect it.`
          : `${s.name} connected. Its customers are back, with the same IDs.`,
      )
      onChanged()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <article className={`card connector${s.enabled ? '' : ' off'}`}>
      <div className="connector-head">
        <ConnectorLogo type={s.connector_type} />
        <div className="stack" style={{ flex: 1, minWidth: 0 }}>
          <h3>{s.name}</h3>
          <span className="text-sm muted">
            {s.category} · {s.connector_label}
          </span>
        </div>
        {s.enabled ? <StatusBadge tone="good">Active</StatusBadge> : <StatusBadge tone="neutral">Off</StatusBadge>}
      </div>
      <dl className="connector-stats">
        <div>
          <dt>Trust</dt>
          <dd className="row" style={{ gap: 6 }}>
            <span className="mono">{formatScore(s.trust)}</span>
            <span className={`badge-dot`} style={{ background: `var(--${tier.tone}-dot)` }} title={`${tier.label} tier`} />
          </dd>
        </div>
        <div>
          <dt>Records</dt>
          <dd>{s.record_count}</dd>
        </div>
        <div>
          <dt>Last sync</dt>
          <dd style={{ fontWeight: 500 }}>{formatRelative(s.last_synced_at)}</dd>
        </div>
      </dl>
      <div className={`connector-share ${sourceHue(s.code)}`}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span>Share of all source records</span>
          <span className="num">{Math.round(share * 100)}%</span>
        </div>
        <div className="share-bar" aria-hidden="true">
          <i style={{ width: `${share * 100}%`, background: 'var(--h)', borderRadius: 999 }} />
        </div>
      </div>
      {canManage && (
      <div className="connector-actions">
        {s.enabled && s.connector_type !== 'push_api' && (
          <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={sync}>
            <Icon name="refresh" size={16} className={busy === 'sync' ? 'spin' : undefined} />
            {busy === 'sync' ? 'Syncing' : 'Sync now'}
          </button>
        )}
        <button type="button" className="btn" disabled={busy !== null} onClick={toggle}>
          <Icon name="power" size={16} />
          {s.enabled ? 'Disconnect' : 'Connect'}
        </button>
        {canSetUp && !s.is_demo && (
          <Link className="btn" to={`/connectors/${s.code}`}>
            <Icon name="sliders" size={16} /> Set up
          </Link>
        )}
      </div>
      )}
    </article>
  )
}
