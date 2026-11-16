import { useState } from 'react'

import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { Explain } from './Explain'
import { Icon } from './Icon'
import { Loader } from './Loader'
import { Pill } from './Lx'
import { useToast } from './Toasts'
import { ErrorAlert } from './ui'

const same = (a: Record<string, string>, b: Record<string, string>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((k) => (a[k] ?? '') === (b[k] ?? ''))
}

// Map fields: which column of this table holds each standard customer field. Lumina suggests from column names; a
// person confirms. Matching, trust scores and golden records use only mapped fields.
export function MapFields({ code, source, table }: { code: string; source: string; table: string }) {
  const toast = useToast()
  const data = useApi(() => api.fieldMap(code, table), [code, table])
  const overview = useApi(() => api.fieldMapOverview(code), [code])
  const [draft, setDraft] = useState<Record<string, string> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (data.error) return <ErrorAlert message={data.error} />
  if (!data.data) return <Loader kind="scan" label="Loading the columns" />
  const d = data.data
  const chosen = draft ?? d.mapped
  const dirty = draft !== null && !same(draft, d.mapped)
  const taken = Object.values(chosen).filter(Boolean)
  const offers = Object.entries(d.suggested).filter(([f, c]) => !chosen[f] && !taken.includes(c))
  const samples = (column: string) => d.columns.find((c) => c.name === column)?.samples ?? []
  const twice = (column: string) => taken.filter((c) => c === column).length > 1
  const set = (field: string, column: string) => setDraft({ ...chosen, [field]: column })
  const groups = Array.from(new Set(d.fields.map((f) => f.group)))

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const done = await api.saveFieldMap(code, table, chosen)
      toast('success', `Mapping saved: ${Object.keys(done.mapped).length} fields on ${table}.`)
      setDraft(null)
      data.reload()
      overview.reload()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  // Where each needed field comes from across the source's tables, as saved.
  const needed = d.fields.filter((f) => f.needed)
  const from = (field: string) => overview.data?.tables.filter((t) => t.fields[field]).map((t) => `${t.name}.${t.fields[field]}`) ?? []
  const covered = needed.filter((f) => from(f.key).length > 0).length

  return (
    <>
      <div className="dq-bar-row">
        <p className="dq-summary">
          Tell Lumina which column holds each customer field. Matching and golden records use only <b>mapped fields</b>.
        </p>
        {d.can_edit && (
          <div className="row">
            {offers.length > 0 && (
              <button type="button" className="btn" onClick={() => setDraft({ ...chosen, ...Object.fromEntries(offers) })}>
                <Icon name="check" size={15} /> Use {offers.length} suggestion{offers.length === 1 ? '' : 's'}
              </button>
            )}
            {dirty && (
              <button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>
                Undo changes
              </button>
            )}
            <button type="button" className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
              {busy ? 'Saving…' : 'Save mapping'}
            </button>
          </div>
        )}
      </div>
      {error && <ErrorAlert message={error} />}
      <div className="dq-grid">
        <section className="card">
          {groups.map((g) => (
            <div key={g}>
              <div className="hm-h mp-group">
                <h2>{g}</h2>
              </div>
              {d.fields
                .filter((f) => f.group === g)
                .map((f) => {
                  const column = chosen[f.key] ?? ''
                  return (
                    <div key={f.key} className="mp-row">
                      <div className="mp-field">
                        <b>
                          {f.label} {f.needed && <Pill tone="plain">Needed</Pill>}
                        </b>
                        {f.about && <small>{f.about}</small>}
                      </div>
                      <select
                        className="select mp-select"
                        aria-label={`Column for ${f.label}`}
                        value={column}
                        disabled={!d.can_edit}
                        onChange={(e) => set(f.key, e.target.value)}
                      >
                        <option value="">Not in this table</option>
                        {d.columns.map((c) => (
                          <option key={c.name} value={c.name}>
                            {c.name}
                            {d.suggested[f.key] === c.name ? ' (suggested)' : ''}
                          </option>
                        ))}
                      </select>
                      <div className="mp-samples">
                        {column && twice(column) && <span className="is-bad-text text-sm">Chosen twice</span>}
                        {column && !twice(column) &&
                          samples(column).map((v) => (
                            <code key={v} className="mp-chip">
                              {v}
                            </code>
                          ))}
                        {!column && d.suggested[f.key] && !taken.includes(d.suggested[f.key]) && (
                          <span className="muted text-sm">Suggested: {d.suggested[f.key]}</span>
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          ))}
        </section>
        <section className="card">
          <div className="hm-h">
            <h2>
              <Explain
                title="Needed fields"
                text={`Name, date of birth, PAN, Aadhaar, mobile, email and address count for completeness in the trust score. Each can come from any table of ${source}.`}
                calc={`${covered} of ${needed.length} needed fields mapped`}
              >
                {covered} of {needed.length} needed fields
              </Explain>
            </h2>
          </div>
          <div className="mp-cover">
            {needed.map((f) => {
              const where = from(f.key)
              return (
                <div key={f.key} className="mp-cover-row">
                  <span className={`hm-ic ${where.length ? 'is-acc' : 'is-warn'}`}>
                    <Icon name={where.length ? 'check' : 'alert'} size={14} />
                  </span>
                  <span className="hm-grow">
                    <b>{f.label}</b>
                    <span className="muted text-sm">{where.length ? where.join(', ') : 'Not mapped in this source yet'}</span>
                  </span>
                </div>
              )
            })}
            <span className="muted text-sm">Counts saved mappings across every table of {source}.</span>
          </div>
        </section>
      </div>
    </>
  )
}
