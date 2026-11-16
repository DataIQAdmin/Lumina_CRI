import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api/client'
import type { PersonDetail } from '../api/types'
import { useApi } from '../api/useApi'
import { BAND_TONE, RulesTable } from '../components/customers/TrustTab'
import { Dialog } from '../components/Dialog'
import { Bar } from '../components/dq/kit'
import { Explain } from '../components/Explain'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { n, Pill } from '../components/Lx'
import { useToast } from '../components/Toasts'
import { ErrorAlert } from '../components/ui'
import { formatRelative } from '../format'

const HOW =
  'Each field is chosen on its own. Name, date of birth, gender, PAN and Aadhaar come from the first source in source order (core banking first). Mobile and email come from the record updated last. The address, city, state and pincode come together from the most recently updated address, so an address is never stitched from two places.'

// A person's golden record: the best value of each field with where it came from and why, the values that were
// not chosen and why, and every record behind it with its trust score.
export function GoldenPage() {
  const { person = '' } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const data = useApi(() => api.person(person), [person])
  const [trust, setTrust] = useState<number | null>(null)
  const [apart, setApart] = useState<PersonDetail['records'][number] | null>(null)
  const [busy, setBusy] = useState(false)
  const p = data.data

  if (data.error) return <ErrorAlert message={data.error} />
  if (!p) return <Loader kind="scan" label="Building the golden record" />
  const conflicts = p.golden.filter((g) => g.conflict)
  const filled = p.golden.filter((g) => g.value).length

  const approve = async () => {
    setBusy(true)
    try {
      await api.approveGolden(p.person)
      toast('success', 'Golden record approved.')
      data.reload()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const keepApart = async () => {
    if (!apart) return
    setBusy(true)
    try {
      const done = await api.keepApart(p.person, apart.id)
      toast('success', `${apart.source} · ${apart.key} is now kept apart.`)
      setApart(null)
      if (done.stays === p.person) data.reload()
      else navigate(`/customers/${encodeURIComponent(done.stays)}`, { replace: true })
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <nav className="dq-trail" aria-label="You are here">
        <Link to="/customers">Customers</Link>
        <Icon name="chevron-right" size={13} />
        <b>{p.name || p.person}</b>
      </nav>
      <header className="page-header gd-head">
        <div className={`tr-big is-${BAND_TONE[p.band] ?? 'plain'}`}>
          <b>{p.score ?? '—'}</b>
          <span>{p.band}</span>
        </div>
        <div className="page-header-text">
          <h1>{p.name || 'No name'}</h1>
          <p>
            {p.person} · found in {p.records.length} record{p.records.length === 1 ? '' : 's'} ·{' '}
            {p.approval ? (
              p.approval.current ? (
                <span className="is-good-text">
                  Approved by {p.approval.by} {formatRelative(p.approval.at)}
                </span>
              ) : (
                <span className="is-bad-text">Changed since {p.approval.by} approved it</span>
              )
            ) : (
              'Not approved yet'
            )}
          </p>
        </div>
        {p.can_decide && (
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || conflicts.length > 0 || !!p.approval?.current}
              title={conflicts.length ? 'Settle the differing details first' : undefined}
              onClick={approve}
            >
              <Icon name="check" size={15} /> {p.approval?.current ? 'Approved' : 'Approve'}
            </button>
          </div>
        )}
      </header>

      {(p.holds.length > 0 || conflicts.length > 0) && (
        <p className="dq-why is-bad">
          {[...p.holds, ...conflicts.map((c) => `${c.label} differs between sources`)].join('. ')}. A person must settle this: keep a record apart, or fix
          the value at its source.
        </p>
      )}

      <section className="card">
        <div className="hm-h">
          <h2>
            <Explain title="Golden record" text={HOW}>
              Golden record
            </Explain>
          </h2>
          <span className="muted text-sm">
            {filled} of {p.golden.length} fields filled
          </span>
        </div>
        <div className="table-wrap">
          <table className="sx-table gd-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>Field</th>
                <th>Value</th>
                <th>From</th>
                <th>Why</th>
              </tr>
            </thead>
            <tbody>
              {p.golden.map((g) => (
                <GoldenRow key={g.field} g={g} />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <div className="hm-h">
          <h2>Found in {p.records.length} record{p.records.length === 1 ? '' : 's'}</h2>
          <span className="muted text-sm">
            <Explain
              title="Person's trust score"
              text="The average of their records' scores. Each record is scored on five rules worth 20% each."
              calc={`(${p.records.map((r) => r.trust).join(' + ')}) ÷ ${p.records.length} = ${p.score}`}
            >
              Score {p.score} is the average
            </Explain>
          </span>
        </div>
        {p.records.map((r, i) => (
          <div key={r.id} className="hm-row gd-record">
            <span className="hm-ic is-acc">
              <Icon name="connectors" size={16} />
            </span>
            <div className="hm-grow">
              <b>{r.source}</b>
              <span className="muted text-sm">
                {r.key} · {r.updated_at ? `updated ${formatRelative(r.updated_at)}` : 'no last-updated date'} · {n(r.rows.clean ?? 0)} of {n(r.rows.total ?? 0)} rows clean
              </span>
            </div>
            <span className="dq-filled gd-score">
              <Bar value={r.trust ?? 0} tone={(r.trust ?? 0) >= 75 ? 'good' : (r.trust ?? 0) >= 50 ? 'warn' : 'bad'} />
              <b className="num">{r.trust ?? '—'}</b>
              <Pill tone={BAND_TONE[r.band] ?? 'plain'}>{r.band}</Pill>
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setTrust(i)}>
              Trust details
            </button>
            {p.can_decide && p.records.length > 1 && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setApart(r)}>
                Keep apart
              </button>
            )}
          </div>
        ))}
      </section>

      {trust !== null && (
        <Dialog size="lg" title={`${p.records[trust].source} · ${p.records[trust].key}`} subtitle={`Trust score ${p.records[trust].trust} · ${p.records[trust].band}`} onClose={() => setTrust(null)}>
          {p.records[trust].holds.length > 0 && <p className="dq-why is-bad">{p.records[trust].holds.join('. ')}. This keeps the band at Review at best.</p>}
          <RulesTable record={p.records[trust]} />
        </Dialog>
      )}
      {apart && (
        <Dialog
          size="sm"
          title="Keep this record apart?"
          onClose={() => setApart(null)}
          footer={
            <>
              <button type="button" className="btn" onClick={() => setApart(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" disabled={busy} onClick={keepApart}>
                Keep apart
              </button>
            </>
          }
        >
          <p className="rd-lead">
            <b>
              {apart.source} · {apart.key}
            </b>{' '}
            leaves {p.name || p.person} and becomes a person of its own. Matching keeps them apart from now on.
          </p>
        </Dialog>
      )}
    </>
  )
}

function GoldenRow({ g }: { g: PersonDetail['golden'][number] }) {
  return (
    <>
      <tr className={`${g.conflict ? 'is-conflict' : ''}${g.others.length ? ' has-others' : ''}`}>
        <td>
          <b>{g.label}</b>
          <small className="gd-rule">{g.rule}</small>
        </td>
        <td>{g.value ? <code className="gd-value">{g.value}</code> : <span className="muted">Missing</span>}</td>
        <td>
          {g.record ? (
            <span className="cu-side">
              <b>{g.record.source}</b>
              <small>{g.record.key}</small>
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="text-sm">
          {g.conflict && <Pill tone="bad">Needs a person</Pill>} {g.why}
        </td>
      </tr>
      {g.others.map((o) => (
        <tr key={`${g.field}:${o.record.id}`} className={`gd-other${o.same ? ' is-same' : ''}${!o.same && g.conflict ? ' is-conflict' : ''}`}>
          <td className="muted text-sm">↳ also</td>
          <td>
            <code className="gd-value is-muted">{o.value}</code>
          </td>
          <td>
            <span className="cu-side">
              <small>
                {o.record.source} · {o.record.key}
              </small>
            </span>
          </td>
          <td className="muted text-sm">{o.why}</td>
        </tr>
      ))}
    </>
  )
}
