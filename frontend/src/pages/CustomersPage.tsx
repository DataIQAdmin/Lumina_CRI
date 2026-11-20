import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import type { MatchPairRow, MatchPoint } from '../api/types'
import { useApi } from '../api/useApi'
import { useCan } from '../auth/AuthContext'
import { TrustTab } from '../components/customers/TrustTab'
import { Dialog } from '../components/Dialog'
import { Bar, Head, Pager } from '../components/dq/kit'
import { Explain } from '../components/Explain'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { n, Pill, Seg } from '../components/Lx'
import { useToast } from '../components/Toasts'
import { EmptyState, ErrorAlert } from '../components/ui'
import { formatRelative } from '../format'

type Show = 'review' | 'conflicts' | 'matched' | 'rejected'

const RESULT: Record<MatchPoint['result'], { tone: 'ok' | 'warn' | 'bad' | 'plain'; text: string }> = {
  same: { tone: 'ok', text: 'Same' },
  similar: { tone: 'ok', text: 'Alike' },
  different: { tone: 'bad', text: 'Different' },
  missing: { tone: 'plain', text: 'Missing' },
}
const STATUS: Record<MatchPairRow['status'], { tone: 'ok' | 'warn' | 'bad' | 'plain'; text: string }> = {
  matched: { tone: 'ok', text: 'Matched automatically' },
  confirmed: { tone: 'ok', text: 'Same person' },
  review: { tone: 'warn', text: 'To review' },
  rejected: { tone: 'plain', text: 'Not the same' },
}

// Customers: for now, matching. It finds the same person across the bank's systems (and twice in one system),
// links the sure ones and asks a person about the rest. Golden records come next, built from these people.
export function CustomersPage() {
  const toast = useToast()
  const canSee = useCan('view_matches')
  const info = useApi(() => (canSee ? api.match() : Promise.resolve(null)), [canSee])
  const [show, setShow] = useState<Show>('review')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState<number | null>(null)
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'match' ? 'match' : 'trust'
  const [running, setRunning] = useState(false)
  const [version, setVersion] = useState(0)
  const pairs = useApi(() => (canSee ? api.matchPairs(show, q.trim(), page) : Promise.resolve(null)), [canSee, show, q, page, version])

  if (!canSee) {
    return (
      <>
        <Head title="Customers" text="One record per real person, built from every source." />
        <section className="card">
          <EmptyState icon="customers" title="Golden records are coming next">
            Matching is open to data stewards, compliance officers and administrators.
          </EmptyState>
        </section>
      </>
    )
  }
  if (info.error) return <ErrorAlert message={info.error} />
  if (!info.data) return <Loader kind="scan" label="Loading" />
  const d = info.data
  const s = d.summary
  const refresh = () => {
    info.reload()
    setVersion(version + 1)
  }
  const run = async () => {
    setRunning(true)
    try {
      const got = await api.matchRun()
      toast('success', `Matching done: ${n(got.profiles)} profiles, ${n(got.people)} people, ${n(got.review + got.conflicts)} to review.`)
      refresh()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setRunning(false)
    }
  }
  const pages = pairs.data ? Math.max(1, Math.ceil(pairs.data.count / pairs.data.page_size)) : 1
  const sources = Object.entries(s.per_source)

  return (
    <>
      <Head
        title="Customers"
        text="One person per real customer, found across every source, each with a trust score you can trace."
        actions={
          d.can_run && (
            <>
              <Link className="btn" to="/customers/mapping">
                <Icon name="sliders" size={15} /> Map fields
              </Link>
              <button type="button" className="btn btn-primary" disabled={running} onClick={run}>
                <Icon name="refresh" size={15} /> {running ? 'Matching…' : s.profiles ? 'Run matching again' : 'Run matching'}
              </button>
            </>
          )
        }
      />
      <div className="dq-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'trust'} className={tab === 'trust' ? 'is-on' : undefined} onClick={() => setParams({})}>
          All customers
        </button>
        <button type="button" role="tab" aria-selected={tab === 'match'} className={tab === 'match' ? 'is-on' : undefined} onClick={() => setParams({ tab: 'match' })}>
          Match
          {s.review + s.conflicts > 0 && <span className="dq-count">{s.review + s.conflicts}</span>}
        </button>
      </div>

      {s.profiles === 0 ? (
        <section className="card">
          <EmptyState icon="customers" title="Nothing matched yet">
            Matching reads each source's clean silver rows through its mapped fields. {d.can_run ? <><Link to="/customers/mapping">Map the fields</Link> of each source, then run matching.</> : 'Ask an administrator to map the fields and run matching.'}
          </EmptyState>
        </section>
      ) : tab === 'trust' ? (
        <TrustTab key={version} />
      ) : (
        <>
          <div className="hm-stats">
            <div className="card hm-stat">
              <span className="muted">Profiles</span>
              <b>
                <Explain title="Profiles" text="One per customer per source, from the source's clean rows and mapped fields." calc={sources.map(([name, count]) => `${name}: ${n(count)}`).join('\n')}>
                  {n(s.profiles)}
                </Explain>
              </b>
              <span className="muted text-sm">from {sources.length} source{sources.length === 1 ? '' : 's'}</span>
            </div>
            <div className="card hm-stat">
              <span className="muted">People</span>
              <b>
                <Explain
                  title="People"
                  text="Profiles linked into one real person: matched automatically or confirmed by someone. A profile with no match is a person on its own."
                  calc={`${n(s.profiles)} profiles\n− ${n(s.profiles - s.people)} linked into someone else\n= ${n(s.people)} people`}
                >
                  {n(s.people)}
                </Explain>
              </b>
              <span className="muted text-sm">{n(s.matched + s.confirmed)} links</span>
            </div>
            <div className="card hm-stat">
              <span className="muted">To review</span>
              <b>{n(s.review + s.conflicts)}</b>
              <span className="muted text-sm">{s.conflicts ? `${n(s.conflicts)} with a conflict` : 'No conflicts'}</span>
            </div>
            <div className="card hm-stat">
              <span className="muted">How a pair is scored</span>
              <b className="cu-rule">
                <Explain
                  title="Match score"
                  text={`Points for each thing two profiles share, up to 100. ${d.auto} or more with no conflict: matched automatically. ${d.review} to ${d.auto - 1}, or any conflict: a person decides. A different PAN, Aadhaar or date of birth, or very different names, is a conflict.`}
                  calc={Object.entries(d.points).map(([k, v]) => `${LABEL[k] ?? k}: ${v}`).join('\n')}
                >
                  {d.auto}+ is a match
                </Explain>
              </b>
              <span className="muted text-sm">{d.ran_at ? `Last run ${formatRelative(d.ran_at)}` : 'Not run yet'}</span>
            </div>
          </div>

          <section className="card">
            <div className="hm-h">
              <Seg
                label="Pairs"
                value={show}
                onChange={(v) => {
                  setShow(v)
                  setPage(1)
                }}
                options={[
                  { value: 'review', label: `To review · ${n(s.review)}` },
                  { value: 'conflicts', label: `Conflicts · ${n(s.conflicts)}` },
                  { value: 'matched', label: `Matched · ${n(s.matched + s.confirmed)}` },
                  { value: 'rejected', label: `Not the same · ${n(s.rejected)}` },
                ]}
              />
              <label className="lx-search">
                <Icon name="search" size={15} />
                <input
                  placeholder="Search name or ID"
                  aria-label="Search name or ID"
                  value={q}
                  onChange={(e) => {
                    setQ(e.target.value)
                    setPage(1)
                  }}
                />
              </label>
            </div>
            {pairs.error && <ErrorAlert message={pairs.error} />}
            {!pairs.data && !pairs.error && <Loader kind="scan" label="Loading pairs" />}
            {pairs.data && (
              <div className="table-wrap">
                <table className="sx-table">
                  <thead>
                    <tr>
                      <th>Profile</th>
                      <th>Profile</th>
                      <th style={{ width: 170 }}>Score</th>
                      <th>Why</th>
                      <th aria-label="Open" />
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.data.results.map((p) => (
                      <tr key={p.id} tabIndex={0} onClick={() => setOpen(p.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(p.id)}>
                        <td className="is-main">
                          <Side side={p.a} />
                        </td>
                        <td className="is-main">
                          <Side side={p.b} />
                        </td>
                        <td data-label="Score">
                          <span className="dq-filled">
                            <Bar value={p.score} tone={p.conflicts.length ? 'bad' : p.score >= d.auto ? 'good' : 'warn'} />
                            <b className="num">{p.score}</b>
                          </span>
                        </td>
                        <td>
                          {p.conflicts.length > 0 ? (
                            <span className="is-bad-text text-sm">{p.conflicts.join(', ')}</span>
                          ) : (
                            <span className="muted text-sm">{p.same.length ? `Same ${p.same.map((l) => (/^[A-Z]{2}/.test(l) ? l : l.replace(/^ID/, 'ID').replace(/^./, (c) => c.toLowerCase()).replace(/^iD/, 'ID'))).join(', ')}` : 'Similar name'}</span>
                          )}
                        </td>
                        <td className="dq-go">
                          <Icon name="chevron-right" size={16} />
                        </td>
                      </tr>
                    ))}
                    {pairs.data.results.length === 0 && (
                      <tr>
                        <td colSpan={5} className="muted sx-empty">
                          {q ? 'No pair matches.' : show === 'review' || show === 'conflicts' ? 'Nothing to review.' : 'None yet.'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            <Pager page={page} pages={pages} onPage={setPage} text={pairs.data ? `${n(pairs.data.count)} pairs` : ''} />
          </section>
        </>
      )}
      {open !== null && <PairDialog id={open} canDecide={d.can_decide} auto={d.auto} review={d.review} onClose={() => setOpen(null)} onDecided={refresh} />}
    </>
  )
}

const LABEL: Record<string, string> = { cross_ref: 'ID in another system', pan: 'PAN', aadhaar: 'Aadhaar', name: 'Name', dob: 'Date of birth', mobile: 'Mobile', email: 'Email' }

function Side({ side }: { side: MatchPairRow['a'] }) {
  return (
    <span className="cu-side">
      <b>{side.name || side.key}</b>
      <small>
        {side.source} · {side.key}
      </small>
    </span>
  )
}

// One pair side by side: every field, whether it agrees, and the points behind the score.
function PairDialog({ id, canDecide, auto, review, onClose, onDecided }: { id: number; canDecide: boolean; auto: number; review: number; onClose: () => void; onDecided: () => void }) {
  const toast = useToast()
  const pair = useApi(() => api.matchPair(id), [id])
  const [busy, setBusy] = useState(false)
  const p = pair.data
  const decide = async (same: boolean) => {
    setBusy(true)
    try {
      await api.matchDecide(id, same)
      toast('success', same ? 'Marked as the same person.' : 'Kept apart: not the same person.')
      onDecided()
      onClose()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const sum = (p?.points ?? []).reduce((a, r) => a + r.points, 0)

  return (
    <Dialog
      size="lg"
      title={p ? `${p.a.name || p.a.key} and ${p.b.name || p.b.key}` : 'Pair'}
      subtitle={p ? `Score ${p.score} · ${STATUS[p.status].text}${p.decided_by ? ` by ${p.decided_by}` : ''}` : undefined}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" style={{ marginRight: 'auto' }} onClick={onClose}>
            Close
          </button>
          {canDecide && p && (
            <>
              <button type="button" className="btn" disabled={busy || p.status === 'rejected'} onClick={() => decide(false)}>
                Not the same
              </button>
              <button type="button" className="btn btn-primary" disabled={busy || p.status === 'confirmed'} onClick={() => decide(true)}>
                Same person
              </button>
            </>
          )}
        </>
      }
    >
      {pair.error && <ErrorAlert message={pair.error} />}
      {!p && !pair.error && <Loader kind="scan" label="Loading the pair" />}
      {p && (
        <>
          <div className="mx-scale" style={{ ['--review' as string]: `${review}%`, ['--auto' as string]: `${auto}%` }} role="img" aria-label={`Score ${p.score} of 100`}>
            <div className="mx-track" />
            <div className="mx-mark" style={{ left: `${p.score}%` }} />
            <span className="mx-lab" style={{ left: `${review / 2}%` }}>
              Different people
            </span>
            <span className="mx-lab" style={{ left: `${(review + auto) / 2}%` }}>
              A person decides
            </span>
            <span className="mx-lab" style={{ left: `${(auto + 100) / 2}%` }}>
              Same person
            </span>
          </div>
          {p.conflicts.length > 0 && (
            <p className="dq-why is-bad">
              {p.conflicts.join('. ')}. A conflict is never matched automatically, however high the score: a person decides.
            </p>
          )}
          <div className="table-wrap">
            <table className="lx-mini cu-compare">
              <thead>
                <tr>
                  <th>Field</th>
                  <th>
                    {p.a.source}
                    <small>{p.a.key}</small>
                  </th>
                  <th>
                    {p.b.source}
                    <small>{p.b.key}</small>
                  </th>
                  <th>Result</th>
                  <th className="num">Points</th>
                </tr>
              </thead>
              <tbody>
                {p.points!.map((r) => (
                  <tr key={r.field} className={r.result === 'different' ? 'is-diff' : undefined}>
                    <td className="is-main">{r.label}</td>
                    <td data-label={p.a.source}>
                      <code>{r.a || <span className="muted">—</span>}</code>
                    </td>
                    <td data-label={p.b.source}>
                      <code>{r.b || <span className="muted">—</span>}</code>
                    </td>
                    <td data-label="Result">
                      <Pill tone={RESULT[r.result].tone}>{RESULT[r.result].text}</Pill>
                      {r.result === 'same' && r.a && r.b && r.a !== r.b && !r.detail ? (
                        <small className="cu-detail">Equal after cleaning</small>
                      ) : (
                        r.detail && <small className="cu-detail">{r.detail}</small>
                      )}
                    </td>
                    <td data-label="Points" className="num">
                      <b>{r.points}</b>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>
                    <b>Score</b>{' '}
                    <code className="text-sm">
                      {p.points!.filter((r) => r.points).map((r) => r.points).join(' + ') || '0'} = {sum}
                      {sum > 100 ? ', capped at 100' : ''} ·{' '}
                      {p.conflicts.length ? 'conflict, so a person decides' : p.score >= auto ? `${auto} or more, so the same person` : p.score >= review ? `below ${auto}, so a person decides` : `below ${review}, so different people`}
                    </code>
                  </td>
                  <td className="num">
                    <b>{p.score}</b>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted text-sm rd-lead">PAN and Aadhaar are compared by a fingerprint of the real number; only the last 4 characters are shown.</p>
        </>
      )}
    </Dialog>
  )
}
