import { useState } from 'react'

import { api } from '../../api/client'
import type { Links, MappingChoice, Place } from '../../api/types'
import { useApi } from '../../api/useApi'
import { Explain } from '../Explain'
import { Icon } from '../Icon'
import { Loader } from '../Loader'
import { Pill } from '../Lx'
import { useToast } from '../Toasts'
import { EmptyState, ErrorAlert } from '../ui'

const SEP = '\t'
const key = (p?: Place | null) => (p ? `${p.table}${SEP}${p.column}` : '')
const same = (a: MappingChoice, b: MappingChoice) => JSON.stringify(a) === JSON.stringify(b)

// Step 4: once for the whole source, which table and column holds each customer field, and how each table used
// joins to a customer. Lumina fills in first guesses; a person checks them.
export function MapStep({ code, source, onBack, onDone }: { code: string; source: string; onBack: () => void; onDone: () => void }) {
  const toast = useToast()
  const data = useApi(() => api.fieldMap(code), [code])
  const [draft, setDraft] = useState<MappingChoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (data.error) return <ErrorAlert message={data.error} />
  if (!data.data) return <Loader kind="scan" label="Loading the tables" />
  const d = data.data
  if (d.tables.length === 0) {
    return (
      <section className="card">
        <EmptyState icon="search" title="No checked tables yet">
          Check a table of {source} first.
        </EmptyState>
      </section>
    )
  }

  const saved: MappingChoice = { fields: d.mapped.fields, links: d.mapped.links }
  const chosen = draft ?? saved
  const picked = (f: string) => chosen.fields[f] ?? null
  const used = Array.from(new Set(Object.values(chosen.fields).filter(Boolean).map((p) => p!.table)))
  const linkOf = (t: string) => chosen.links[t] ?? {}
  const keep = (next: MappingChoice) => {
    // A table that starts giving a field gets its join columns guessed too.
    const links: Links = { ...next.links }
    for (const p of Object.values(next.fields)) if (p && !links[p.table]) links[p.table] = { ...(d.suggested.links[p.table] ?? {}) }
    setDraft({ fields: next.fields, links })
  }
  const setField = (f: string, value: string) => {
    const [table, column] = value.split(SEP)
    keep({ ...chosen, fields: { ...chosen.fields, [f]: value ? { table, column } : null } })
  }
  const setLink = (t: string, k: 'customer_id' | 'updated_at', column: string) =>
    keep({ ...chosen, links: { ...chosen.links, [t]: { ...linkOf(t), [k]: column } } })
  const offers = Object.entries(d.suggested.fields).filter(([f]) => !picked(f))
  const useOffers = () => keep({ ...chosen, fields: { ...chosen.fields, ...Object.fromEntries(offers) } })
  const dirty = draft !== null && !same(draft, saved)

  const fields = d.fields.filter((f) => !d.per_table.includes(f.key))
  const groups = Array.from(new Set(fields.map((f) => f.group)))
  const needed = fields.filter((f) => f.needed)
  const covered = needed.filter((f) => picked(f.key)).length
  const samples = (p: Place | null) => d.tables.find((t) => t.name === p?.table)?.columns.find((c) => c.name === p?.column)?.samples ?? []
  const columnsOf = (t: string) => d.tables.find((x) => x.name === t)?.columns ?? []
  const missingJoin = used.filter((t) => !linkOf(t).customer_id)

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const links = Object.fromEntries(used.map((t) => [t, linkOf(t)]))
      const done = await api.saveFieldMap(code, { fields: chosen.fields, links })
      toast('success', `Mapping saved for ${source}: ${done.saved} columns.`)
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
      <div className="dq-bar-row">
        <p className="dq-summary">
          Tell Lumina where each customer field lives in {source}.{' '}
          <Explain
            title="Needed fields"
            text="Name, date of birth, PAN, Aadhaar, mobile, email and address count for completeness in the trust score. Each can come from any table of this source."
            calc={`${covered} of ${needed.length} needed fields mapped`}
          >
            <b>
              {covered} of {needed.length} needed fields
            </b>
          </Explain>{' '}
          mapped.
        </p>
        {d.can_edit && (
          <div className="row">
            {offers.length > 0 && (
              <button type="button" className="btn" onClick={useOffers}>
                <Icon name="check" size={15} /> Use {offers.length} suggestion{offers.length === 1 ? '' : 's'}
              </button>
            )}
            {dirty && (
              <button type="button" className="btn" disabled={busy} onClick={() => setDraft(null)}>
                Undo changes
              </button>
            )}
            <button type="button" className="btn btn-primary" disabled={!dirty || busy || missingJoin.length > 0} onClick={save}>
              {busy ? 'Saving…' : 'Save mapping'}
            </button>
          </div>
        )}
      </div>
      {error && <ErrorAlert message={error} />}

      <section className="card">
        <div className="hm-h">
          <h2>Customer fields</h2>
          <span className="muted text-sm">Pick the table and column for each</span>
        </div>
        {groups.map((g) => (
          <div key={g}>
            <div className="mp-group-h">{g === 'Link' ? 'Other systems' : g}</div>
            {fields
              .filter((f) => f.group === g)
              .map((f) => {
                const p = picked(f.key)
                const guess = d.suggested.fields[f.key]
                return (
                  <div key={f.key} className="mp-row">
                    <div className="mp-field">
                      <b>
                        {f.label} {f.needed && <Pill tone="plain">Needed</Pill>}
                      </b>
                      {f.about && <small>{f.about}</small>}
                    </div>
                    <select className="select mp-select" aria-label={`Column for ${f.label}`} value={key(p)} disabled={!d.can_edit} onChange={(e) => setField(f.key, e.target.value)}>
                      <option value="">Not in this source</option>
                      {d.tables.map((t) => (
                        <optgroup key={t.name} label={t.name}>
                          {t.columns.map((c) => (
                            <option key={c.name} value={`${t.name}${SEP}${c.name}`}>
                              {t.name} · {c.name}
                              {guess && guess.table === t.name && guess.column === c.name ? ' (suggested)' : ''}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                    <div className="mp-samples">
                      {p &&
                        samples(p).map((v) => (
                          <code key={v} className="mp-chip">
                            {v}
                          </code>
                        ))}
                      {!p && guess && <span className="muted text-sm">Suggested: {guess.table} · {guess.column}</span>}
                    </div>
                  </div>
                )
              })}
          </div>
        ))}
      </section>

      <section className="card">
        <div className="hm-h">
          <h2>How the tables join</h2>
          <span className="muted text-sm">Each table used above needs its Customer ID</span>
        </div>
        {used.length === 0 && <p className="muted hm-empty">Map a field above first.</p>}
        {used.map((t) => {
          const link = linkOf(t)
          return (
            <div key={t} className="mp-row">
              <div className="mp-field">
                <b>{t}</b>
                <small>{fields.filter((f) => picked(f.key)?.table === t).map((f) => f.label).join(', ')}</small>
              </div>
              <label className="mp-join">
                <span className="muted text-sm">Customer ID</span>
                <select className="select mp-select" value={link.customer_id ?? ''} disabled={!d.can_edit} onChange={(e) => setLink(t, 'customer_id', e.target.value)}>
                  <option value="">Choose…</option>
                  {columnsOf(t).map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
              <label className="mp-join">
                <span className="muted text-sm">Last updated</span>
                <select className="select mp-select" value={link.updated_at ?? ''} disabled={!d.can_edit} onChange={(e) => setLink(t, 'updated_at', e.target.value)}>
                  <option value="">Not in this table</option>
                  {columnsOf(t).map((c) => (
                    <option key={c.name}>{c.name}</option>
                  ))}
                </select>
              </label>
            </div>
          )
        })}
        {missingJoin.length > 0 && <p className="sx-error hm-empty">Choose the Customer ID of {missingJoin.join(', ')} to save.</p>}
      </section>

      <div className="dq-nav">
        <button type="button" className="btn" onClick={onBack}>
          ← Back to Check & fix
        </button>
        <button type="button" className="btn btn-primary" disabled={dirty} title={dirty ? 'Save the mapping first' : undefined} onClick={onDone}>
          Continue →
        </button>
      </div>
    </>
  )
}
