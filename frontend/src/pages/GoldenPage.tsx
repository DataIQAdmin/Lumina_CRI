import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api } from '../api/client'
import type { PersonDetail } from '../api/types'
import { useApi } from '../api/useApi'
import { TrustDetail } from '../components/customers/TrustDetail'
import { BAND_TONE } from '../components/customers/TrustTab'
import { Dialog } from '../components/Dialog'
import { Bar } from '../components/dq/kit'
import { Explain } from '../components/Explain'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { n, Pill } from '../components/Lx'
import { useToast } from '../components/Toasts'
import { Avatar, ErrorAlert } from '../components/ui'
import { formatRelative } from '../format'

const HOW =
  'Each field is chosen on its own, from clean values only. Name, date of birth, gender, PAN and Aadhaar come from the first source in source order. Mobile and email come from the record updated last. The address, city, state and pincode come together from the most recently updated address, so an address is never stitched from two places. Press "Why?" on any field to see every value and why it was or was not chosen.'

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
        <b>{p.name}</b>
      </nav>
      <header className="page-header gd-head">
        <Avatar name={p.name_from === 'id' ? '#' : p.name} large />
        <div className="page-header-text">
          <h1>{p.name}</h1>
          <p className="gd-status">
            {p.approval?.current ? (
              <Pill tone="ok">Approved by {p.approval.by} {formatRelative(p.approval.at)}</Pill>
            ) : p.approval ? (
              <Pill tone="warn">Changed since {p.approval.by} approved it</Pill>
            ) : (
              <Pill tone="plain">Proposed</Pill>
            )}
            <span className="muted text-sm">
              Found in {p.records.length} system record{p.records.length === 1 ? '' : 's'}
              {p.name_from === 'raw' && ' · the name fails its rule in every system'}
              {p.name_from === 'id' && ' · no system holds a name'}
            </span>
          </p>
        </div>
        <div className="gd-score">
          <div className={`tx-ring is-${BAND_TONE[p.band] ?? 'plain'}`} style={{ ['--v' as string]: p.score ?? 0 }}>
            <b>{p.score ?? '—'}</b>
          </div>
          <span className="cu-side">
            <b>{p.band || 'Not scored'}</b>
            <small>trust score</small>
          </span>
        </div>
        {p.can_decide && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={busy || conflicts.length > 0 || !!p.approval?.current}
            title={conflicts.length ? 'Settle the differing details first' : undefined}
            onClick={approve}
          >
            <Icon name="check" size={15} /> {p.approval?.current ? 'Approved' : 'Approve'}
          </button>
        )}
      </header>

      {(p.holds.length > 0 || conflicts.length > 0) && (
        <p className="dq-why is-bad">
          <b>Needs review.</b> {[...p.holds, ...conflicts.map((c) => `${c.label} differs between sources`)].join('. ')}. Settle it by keeping a record
          apart, or by fixing the value at its source.
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
                <th>Sources agree</th>
                <th aria-label="Why" />
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
              text="The average of their records' scores. Each record is scored on five rules, weighted as set on Settings."
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
              Why this score?
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
        <Dialog size="lg" title={`${p.records[trust].source} · ${p.records[trust].key}`} subtitle="How this record's trust score was worked out" onClose={() => setTrust(null)}>
          <TrustDetail record={p.records[trust]} weights={p.weights} />
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
  const [open, setOpen] = useState(false)
  const [agree, of] = g.agree ?? [g.value ? 1 + g.others.filter((o) => o.same).length : 0, g.value ? 1 + g.others.length : 0]
  const tone = g.conflict ? 'bad' : of === 0 ? 'plain' : agree === of ? 'ok' : 'warn'
  return (
    <>
      <tr className={g.conflict ? 'is-conflict' : undefined}>
        <td className="is-main">
          <b>{g.label}</b>
        </td>
        <td data-label="Value">{g.value ? <code className="gd-value">{g.value}</code> : <span className="muted">Missing</span>}</td>
        <td data-label="From">
          {g.record ? (
            <span className="cu-side">
              <b>{g.record.source}</b>
              <small>{g.record.key}</small>
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td data-label="Sources agree">
          {g.conflict ? (
            <Pill tone="bad">Needs a person</Pill>
          ) : of ? (
            <span className="gd-agree">
              <Pill tone={tone}>
                {agree} of {of}
              </Pill>
            </span>
          ) : (
            <span className="muted">—</span>
          )}
        </td>
        <td className="dq-go">
          {g.value && (
            <button type="button" className="btn btn-sm btn-ghost gd-why-btn" aria-expanded={open} onClick={() => setOpen(!open)}>
              {open ? 'Hide' : 'Why?'}
            </button>
          )}
        </td>
      </tr>
      {open && (
        <tr className="gd-detail">
          <td colSpan={5}>
            <div className="gd-detail-box">
              <span className="text-sm">
                <b>{g.rule}:</b> {g.why}
              </span>
              <div className="gd-cands">
                {g.record && (
                  <div className="gd-cand is-chosen">
                    <span>
                      <b>{g.record.source}</b> <small className="muted">{g.record.key}</small>
                    </span>
                    <code>{g.value}</code>
                    <span className="text-sm">Chosen</span>
                  </div>
                )}
                {g.others.map((o) => (
                  <div key={o.record.id} className={`gd-cand${!o.same && g.conflict ? ' is-conflict' : ''}`}>
                    <span>
                      <b>{o.record.source}</b> <small className="muted">{o.record.key}</small>
                    </span>
                    <code>{o.value}</code>
                    <span className="muted text-sm">{o.why}</span>
                  </div>
                ))}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
