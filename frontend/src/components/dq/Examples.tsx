import { useEffect, useState } from 'react'

import { api } from '../../api/client'
import type { RuleExamples } from '../../api/types'
import { Icon } from '../Icon'
import { Loader } from '../Loader'
import { n } from '../Lx'
import { ErrorAlert } from '../ui'
import { Copyable } from './kit'

// "See 10 records": 5 values that pass and 5 that fail the regex (or, before there is one, 5 of the usual shape and
// 5 that need a look), with copy buttons, and more on request.
export function Examples({ code, table, column, pattern }: { code: string; table: string; column: string; pattern: string }) {
  const [pages, setPages] = useState<RuleExamples[]>([])
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = (page: number) => {
    setBusy(true)
    setError(null)
    api.ruleExamples(code, table, column, pattern, page).then(
      (got) => {
        setPages((old) => [...old.slice(0, page - 1), got])
        setBusy(false)
      },
      (e: Error) => {
        setError(e.message)
        setBusy(false)
      },
    )
  }
  useEffect(() => {
    load(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, table, column, pattern])

  const first = pages[0]
  const regex = first?.mode === 'regex'
  const passed = pages.flatMap((p) => p.passed)
  const failed = pages.flatMap((p) => p.failed)
  const last = pages[pages.length - 1]

  return (
    <div className="lx-stack dq-examples">
      {error && <ErrorAlert message={error} />}
      {!first && busy && <Loader kind="scan" label="Finding records" />}
      {first && (
        <>
          <p className="muted text-sm rd-lead">
            {regex
              ? `With this rule: ${n(first.total_passed)} rows pass, ${n(first.total_failed)} fail.`
              : `No rule yet, so values are sorted by shape: most have ${first.usual ? first.usual.toLowerCase() : 'a value'}.`}
          </p>
          <div className="dq-vals">
            <div className="dq-val is-good">
              <header>
                <span>
                  <Icon name="check" size={14} /> {regex ? 'Passes' : 'Usual shape'}
                </span>
                <span>{n(first.total_passed)} rows</span>
              </header>
              {passed.length === 0 && <div className="dq-v muted">None.</div>}
              {passed.map((r) => (
                <Copyable key={`p${r.row}`} value={r.value === null ? '' : String(r.value)} note={`Row ${r.row}${r.label ? ` · ${r.label}` : ''}`} />
              ))}
            </div>
            <div className={`dq-val ${first.total_failed ? 'is-bad' : 'is-good'}`}>
              <header>
                <span>
                  <Icon name={first.total_failed ? 'alert' : 'check'} size={14} /> {regex ? 'Fails' : 'Needs a look'}
                </span>
                <span>{n(first.total_failed)} rows</span>
              </header>
              {failed.length === 0 && <div className="dq-v muted">None.</div>}
              {failed.map((r) => (
                <Copyable key={`f${r.row}`} value={r.value === null ? '' : String(r.value)} note={`Row ${r.row}${r.label ? ` · ${r.label}` : ''}`} />
              ))}
            </div>
          </div>
          {last?.more && (
            <button type="button" className="btn btn-sm dq-more" disabled={busy} onClick={() => load(pages.length + 1)}>
              {busy ? 'Loading…' : 'Show 10 more'}
            </button>
          )}
        </>
      )}
    </div>
  )
}
