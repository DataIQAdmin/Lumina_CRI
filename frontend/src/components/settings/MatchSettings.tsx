import { useState } from 'react'

import { api } from '../../api/client'
import type { MatchSettingsValues } from '../../api/types'
import { useApi } from '../../api/useApi'
import { formatRelative } from '../../format'
import { Explain } from '../Explain'
import { Icon } from '../Icon'
import { Loader } from '../Loader'
import { n, Seg } from '../Lx'
import { useToast } from '../Toasts'
import { ErrorAlert } from '../ui'

const RULE_LABEL: Record<string, string> = {
  uniqueness: 'Uniqueness',
  recency: 'Recency',
  completeness: 'Completeness',
  consistency: 'Consistency',
  accuracy: 'Accuracy',
}

// Matching, trust score and golden record settings. Saving runs matching again, so every score and golden record
// follows the new settings at once.
export function MatchSettings() {
  const toast = useToast()
  const data = useApi(() => api.matchSettings(), [])
  const [draft, setDraft] = useState<MatchSettingsValues | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (data.error) return <ErrorAlert message={data.error} />
  if (!data.data) return <Loader kind="scan" label="Loading settings" />
  const d = data.data
  const s = draft ?? d.settings
  const edit = d.can_edit
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(d.settings)
  const set = (change: Partial<MatchSettingsValues>) => setDraft({ ...s, ...change })
  const order = d.sources.map((x) => x.code).sort((a, b) => {
    const ia = s.source_order.indexOf(a)
    const ib = s.source_order.indexOf(b)
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || d.sources.findIndex((x) => x.code === a) - d.sources.findIndex((x) => x.code === b)
  })
  const move = (i: number, by: number) => {
    const next = [...order]
    const [code] = next.splice(i, 1)
    next.splice(i + by, 0, code)
    set({ source_order: next })
  }
  const weightSum = Object.values(s.weights).reduce((a, x) => a + (Number(x) || 0), 0)
  const num = (v: string) => (v === '' ? 0 : Math.max(0, Math.round(Number(v)) || 0))
  const nameOf = (code: string) => d.sources.find((x) => x.code === code)?.name ?? code

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const done = await api.saveMatchSettings(s)
      toast('success', `Settings saved and matching run again: ${n(done.summary.people)} people, ${n(done.summary.review + done.summary.conflicts)} to review.`)
      setDraft(null)
      data.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="card">
        <div className="hm-h">
          <div>
            <h2>Matching, trust and golden records</h2>
            <span className="muted text-sm">
              {d.updated_at ? `Changed by ${d.updated_by} ${formatRelative(d.updated_at)}` : 'Using the defaults from the trust score document'}
            </span>
          </div>
          {edit && (
            <div className="row">
              <button type="button" className="btn" disabled={busy} onClick={() => setDraft({ ...d.defaults, source_order: [] })}>
                Reset to defaults
              </button>
              {dirty && (
                <button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>
                  Undo changes
                </button>
              )}
              <button type="button" className="btn btn-primary" disabled={!dirty || busy || weightSum !== 100} onClick={save}>
                {busy ? 'Saving and matching…' : 'Save and run matching'}
              </button>
            </div>
          )}
        </div>
        {error && <p className="sx-error hm-empty">{error}</p>}
      </section>

      <div className="st-grid">
        <section className="card">
          <div className="hm-h">
            <h2>Source order</h2>
          </div>
          <p className="muted text-sm st-note">Fields chosen by source order come from the first source here that has them.</p>
          <ol className="st-order">
            {order.map((code, i) => (
              <li key={code}>
                <i>{i + 1}</i>
                <span className="hm-grow">
                  <b>{nameOf(code)}</b>
                </span>
                {edit && (
                  <>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={i === 0} aria-label={`Move ${nameOf(code)} up`} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button type="button" className="btn btn-sm btn-ghost" disabled={i === order.length - 1} aria-label={`Move ${nameOf(code)} down`} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                  </>
                )}
              </li>
            ))}
            {order.length === 0 && <li className="muted">No sources yet.</li>}
          </ol>
        </section>

        <section className="card">
          <div className="hm-h">
            <h2>How each field is chosen</h2>
          </div>
          <div className="st-rows">
            {d.golden_fields.map((f) => (
              <div key={f.key} className="st-row">
                <span>{f.label}</span>
                <Seg
                  label={`How ${f.label} is chosen`}
                  value={s.field_rules[f.key]}
                  onChange={(v) => edit && set({ field_rules: { ...s.field_rules, [f.key]: v } })}
                  options={[
                    { value: 'order', label: 'Source order' },
                    { value: 'recent', label: 'Most recent' },
                  ]}
                />
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <div className="hm-h">
            <h2>
              <Explain title="Trust score" text="Each record scores 0 to 100 on each rule; the rules add up by these weights. The trust score document uses 20% each.">
                Trust score
              </Explain>
            </h2>
            <span className={`text-sm ${weightSum === 100 ? 'muted' : 'is-bad-text'}`}>Weights add up to {weightSum}%</span>
          </div>
          <div className="st-rows">
            {d.rules.map((r) => (
              <label key={r} className="st-row">
                <span>{RULE_LABEL[r]}</span>
                <span className="st-num">
                  <input className="input" type="number" onFocus={(e) => e.target.select()} onMouseUp={(e) => e.preventDefault()} min={0} max={100} disabled={!edit} value={s.weights[r]} onChange={(e) => set({ weights: { ...s.weights, [r]: num(e.target.value) } })} />%
                </span>
              </label>
            ))}
            <div className="st-sub">Bands</div>
            {(
              [
                ['high', 'High from'],
                ['good', 'Good from'],
                ['review', 'Review from'],
              ] as const
            ).map(([k, label]) => (
              <label key={k} className="st-row">
                <span>{label}</span>
                <span className="st-num">
                  <input className="input" type="number" onFocus={(e) => e.target.select()} onMouseUp={(e) => e.preventDefault()} min={1} max={100} disabled={!edit} value={s.bands[k]} onChange={(e) => set({ bands: { ...s.bands, [k]: num(e.target.value) } })} />
                </span>
              </label>
            ))}
            <p className="muted text-sm st-note">Below {s.bands.review} is Low (quarantine).</p>
          </div>
        </section>

        <section className="card">
          <div className="hm-h">
            <h2>
              <Explain title="Match score" text="Points for each thing two records share, up to 100. At the match score or above with no conflict, they are linked automatically; from the review score up, or with any conflict, a person decides.">
                Match score
              </Explain>
            </h2>
          </div>
          <div className="st-rows">
            {d.match_fields.map((f) => (
              <label key={f.key} className="st-row">
                <span>{f.label}</span>
                <span className="st-num">
                  <input className="input" type="number" onFocus={(e) => e.target.select()} onMouseUp={(e) => e.preventDefault()} min={0} max={100} disabled={!edit} value={s.points[f.key]} onChange={(e) => set({ points: { ...s.points, [f.key]: num(e.target.value) } })} />
                  pts
                </span>
              </label>
            ))}
            <div className="st-sub">Decisions</div>
            <label className="st-row">
              <span>Matched automatically from</span>
              <span className="st-num">
                <input className="input" type="number" onFocus={(e) => e.target.select()} onMouseUp={(e) => e.preventDefault()} min={1} max={100} disabled={!edit} value={s.auto} onChange={(e) => set({ auto: num(e.target.value) })} />
              </span>
            </label>
            <label className="st-row">
              <span>A person reviews from</span>
              <span className="st-num">
                <input className="input" type="number" onFocus={(e) => e.target.select()} onMouseUp={(e) => e.preventDefault()} min={1} max={100} disabled={!edit} value={s.review} onChange={(e) => set({ review: num(e.target.value) })} />
              </span>
            </label>
          </div>
        </section>
      </div>
      {!edit && (
        <p className="muted text-sm">
          <Icon name="lock" size={13} /> Only administrators change these settings.
        </p>
      )}
    </>
  )
}
