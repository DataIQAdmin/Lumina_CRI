import { useEffect, useState } from 'react'

import { api } from '../../api/client'
import type { ColumnCounts, CountProof } from '../../api/types'
import { Dialog } from '../Dialog'
import { Icon } from '../Icon'
import { Loader } from '../Loader'
import { Legend, n, Split } from '../Lx'
import { ErrorAlert } from '../ui'
import { Copyable, isEmail, isMixed, Pager, partsOf, reasonOf, tooLong } from './kit'

type Sample = { label: string; reason: string; count: number; values: string[] }

// One column in a popup: its counts, what is inside, and real values: good ones and the ones that need a look,
// each with why.
export function ColumnDialog({
  code,
  source,
  table,
  column: c,
  rows,
  canViewRows,
  onClose,
  onFix,
}: {
  code: string
  source: string
  table: string
  column: ColumnCounts
  rows: number
  canViewRows: boolean
  onClose: () => void
  onFix?: () => void
}) {
  const parts = partsOf(c)
  const main = c.counts[0]
  const badParts: { label: string; count: number }[] = [
    ...(c.empty ? [{ label: 'Empty', count: c.empty }] : []),
    ...parts.filter((x) => x.tone === 'warn' && x.count > 0),
  ]
  const [good, setGood] = useState<string[] | null>(null)
  const [bad, setBad] = useState<Sample[] | null>(null)
  const [all, setAll] = useState<{ label: string; value?: string } | null>(null)
  const [browse, setBrowse] = useState(false)
  const badCount = badParts.reduce((a, x) => a + x.count, 0)

  useEffect(() => {
    if (!canViewRows) return
    let live = true
    const first = (label: string, many: number) =>
      api.rawProof(code, table, c.name, label, 1).then(
        (got) => Array.from(new Set(got.results.map((r) => (r.value === null || r.value === undefined ? '' : String(r.value))))).slice(0, many),
        () => [] as string[],
      )
    if (main && main.count > 0) first(main.label, 5).then((v) => live && setGood(v))
    else setGood([])
    Promise.all(badParts.map(async (x) => ({ label: x.label, count: x.count, reason: reasonOf(c, x.label), values: x.label === 'Empty' ? [''] : await first(x.label, 3) }))).then(
      (got) => live && setBad(got),
    )
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, table, c.name, canViewRows])

  const why = [
    c.empty ? `${n(c.empty)} of ${n(rows)} values are empty.` : '',
    tooLong(c) ? `${n(c.counts[1].count)} values are longer than most emails.` : '',
    isMixed(c) ? `Most values have ${main.label.toLowerCase()}, but ${n(c.counts.slice(1).reduce((a, x) => a + x.count, 0))} do not.` : '',
  ].filter(Boolean)
  const rule = main ? (isEmail(c) ? `Good: ${main.label.toLowerCase()}.` : `Good: ${main.label.toLowerCase()}, like most values.`) : c.values?.length ? 'Good: one of the values this column uses.' : 'Free text: values of any length.'

  return (
    <Dialog
      size="lg"
      title={c.name}
      subtitle={`${table} · ${source}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {onFix && (
            <button type="button" className="btn btn-primary" onClick={onFix}>
              <Icon name="sliders" size={15} /> Fix it with a rule
            </button>
          )}
        </>
      }
    >
      <div className="sx-kv">
        <div>
          <b>{n(c.filled)}</b>
          <span>of {n(rows)} filled</span>
        </div>
        <div>
          <b className={c.empty ? 'is-bad-text' : undefined}>{n(c.empty)}</b>
          <span>empty</span>
        </div>
        <div>
          <b>{n(c.unique)}</b>
          <span>different values</span>
        </div>
      </div>
      {why.length > 0 && <p className="dq-why">{why.join(' ')}</p>}
      <div className="lx-stack">
        <span className="lx-cap">What is inside</span>
        {parts.length ? (
          <>
            <Split thick parts={parts} />
            <Legend parts={parts} max={6} />
          </>
        ) : (
          <span className="muted">Free text: values of any length.</span>
        )}
      </div>
      {all !== null ? (
        <Proof code={code} table={table} column={c.name} label={all.label} value={all.value} onClose={() => setAll(null)} />
      ) : (
        <div className="lx-stack">
          <span className="lx-cap">The values</span>
          {!canViewRows ? (
            <p className="muted rd-lead">Only the counts are shown. Seeing values needs permission to view personal data.</p>
          ) : (
            <>
              <p className="muted text-sm rd-lead">{rule}</p>
              <button type="button" className="link text-sm dq-browse-values" onClick={() => setBrowse((v) => !v)}>
                {browse ? 'Hide unique values' : `Browse ${n(c.unique)} unique values`}
              </button>
              {browse && <UniqueValues code={code} table={table} column={c.name} onRows={(value) => setAll({ label: value, value })} />}
              <div className="dq-vals">
                <div className="dq-val is-good">
                  <header>
                    <span>
                      <Icon name="check" size={14} /> Good
                    </span>
                    <span>{n(main ? main.count : c.filled)} rows</span>
                  </header>
                  {!main && c.values?.length ? (
                  c.values.slice(0, 6).map((v) => (
                    <div className="dq-unique-value" key={v.label}>
                      <Copyable value={v.label} />
                      <button type="button" className="link text-sm" onClick={() => setAll({ label: v.label })} aria-label={`Show ${n(v.count)} rows containing ${v.label}`}>
                        {n(v.count)} rows →
                      </button>
                    </div>
                  ))
                  ) : good === null ? (
                    <Loader kind="scan" label="Finding values" />
                  ) : good.length === 0 ? (
                    <div className="dq-v muted">No examples.</div>
                  ) : (
                    good.map((v) => <Copyable key={v} value={v} note={main?.label} />)
                  )}
                </div>
                <div className={`dq-val ${badCount ? 'is-bad' : 'is-good'}`}>
                  <header>
                    <span>
                      <Icon name={badCount ? 'alert' : 'check'} size={14} /> Needs a look
                    </span>
                    <span>{n(badCount)} rows</span>
                  </header>
                  {badCount === 0 && <div className="dq-v muted">Every value is fine.</div>}
                  {badCount > 0 && bad === null && <Loader kind="scan" label="Finding values" />}
                  {bad?.map((s) => (
                    <div key={s.label} className="dq-group">
                      {s.values.map((v) => (
                        <Copyable key={v} value={v} note={s.reason} />
                      ))}
                      <button type="button" className="link text-sm" onClick={() => setAll({ label: s.label })}>
                        See all {n(s.count)} {s.label === 'Empty' ? 'empty' : s.label.toLowerCase()} rows →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </Dialog>
  )
}

function UniqueValues({ code, table, column, onRows }: { code: string; table: string; column: string; onRows: (value: string) => void }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<Awaited<ReturnType<typeof api.rawUniqueValues>> | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setData(null)
    setError(null)
    api.rawUniqueValues(code, table, column, page).then(
      (got) => live && setData(got),
      (e: Error) => live && setError(e.message),
    )
    return () => { live = false }
  }, [code, table, column, page])
  const pages = data ? Math.max(1, Math.ceil(data.unique / data.page_size)) : 1
  return (
    <div className="dq-unique-list">
      {error && <p className="sx-error">{error}</p>}
      {!data && !error && <Loader kind="scan" label="Loading unique values" />}
      {data && (
        <>
          <div className="dq-unique-head"><b>{n(data.unique)} displayed value groups</b><span className="muted">{n(data.page_size)} per page</span></div>
          <div className="dq-unique-rows">
            {data.results.map((item) => (
              <div className="dq-unique-value" key={item.value}>
                <code>{item.value}</code>
                <button type="button" className="link text-sm" onClick={() => onRows(item.value)}>{n(item.count)} rows →</button>
              </div>
            ))}
          </div>
          <Pager page={page} pages={pages} onPage={setPage} text={`${n(data.unique)} unique values`} />
        </>
      )}
    </div>
  )
}

// The rows behind one count: row number, the table's ID and the value itself, 20 at a time.
function Proof({ code, table, column, label, value, onClose }: { code: string; table: string; column: string; label: string; value?: string; onClose: () => void }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState<CountProof | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    api.rawProof(code, table, column, label, page, value).then(
      (got) => live && setData(got),
      (e: Error) => live && setError(e.message),
    )
    return () => {
      live = false
    }
  }, [code, table, column, label, page, value])
  const pages = data ? Math.max(1, Math.ceil(data.count / data.page_size)) : 1
  const shown = (v: unknown) => (v === null || v === undefined || v === '' ? <span className="muted">Empty</span> : String(v))
  return (
    <div className="lx-stack">
      <div className="dq-proof-h">
        <button type="button" className="link text-sm" onClick={onClose}>
          ← Back to the values
        </button>
        <b>
          {data ? n(data.count) : '…'} rows · {label === 'Empty' ? 'empty' : label}
        </b>
      </div>
      {error && <ErrorAlert message={error} />}
      {!data && !error && <Loader kind="scan" label="Finding the rows" />}
      {data && (
        <>
          <table className="lx-mini">
            <thead>
              <tr>
                <th className="num">Row</th>
                <th>{data.key}</th>
                <th>{column}</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((r) => (
                <tr key={r.row}>
                  <td className="num muted">{r.row}</td>
                  <td className="muted lx-key">{shown(r.key)}</td>
                  <td>
                    <code>{shown(r.value)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} pages={pages} onPage={setPage} text={`${n(data.count)} rows`} />
        </>
      )}
    </div>
  )
}
