import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { ColumnCounts, RegexLibrary, RulePreview } from '../api/types'
import { BrandMark } from './BrandMark'
import { Dialog } from './Dialog'
import { Examples } from './dq/Examples'
import { partsOf } from './dq/kit'
import { Icon } from './Icon'
import { n, Pill, Split } from './Lx'
import { LibrarySelect, OfferCard, type Offer, PreviewResult, RegexVerdict, useRegexCheck } from './regex'
import { openGenie } from './GeniePanel'
import { useToast } from './Toasts'
import { ErrorAlert } from './ui'

export interface RuleColumn {
  name: string
  pattern: string
  needsLook: boolean
}

// Adding or changing a format rule in three steps: the column, the rule, a preview on the table's rows.
// Nothing changes until "Apply rule".
export function RuleDialog({
  code,
  table,
  source,
  columns,
  column: fixed,
  start = '',
  library,
  counts,
  rows,
  onClose,
  onDone,
}: {
  code: string
  table: string
  source: string
  columns: RuleColumn[]
  column?: string
  start?: string
  library: RegexLibrary | null
  counts: ColumnCounts[]
  rows: number
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [step, setStep] = useState(fixed ? 2 : 1)
  const [column, setColumn] = useState(fixed ?? columns.find((c) => c.needsLook && !c.pattern)?.name ?? columns[0]?.name ?? '')
  const current = columns.find((c) => c.name === column)
  const [pattern, setPattern] = useState(start || current?.pattern || '')
  const check = useRegexCheck(pattern)
  const [offers, setOffers] = useState<Offer[]>([])
  const [preview, setPreview] = useState<RulePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [seeing, setSeeing] = useState(false)
  const profile = counts.find((c) => c.name === column)

  const pickColumn = (name: string) => {
    setColumn(name)
    setPattern(columns.find((c) => c.name === name)?.pattern ?? '')
    setOffers([])
    setSeeing(false)
  }
  const fromLibrary = (chosen: string) => {
    const ready = library?.ready.find((r) => r.pattern === chosen)
    const saved = library?.saved.find((r) => r.pattern === chosen)
    const offer: Offer = {
      source: 'library',
      title: ready?.name ?? saved?.name ?? '',
      pattern: chosen,
      matching: ready ? [ready.example] : [],
      failing: ready ? [{ value: ready.bad[0], why: ready.bad[1] }] : [],
    }
    setOffers((old) => [...old.filter((o) => o.source !== 'library'), offer])
    setPattern(chosen)
  }
  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const showPreview = () =>
    run(async () => {
      setPreview(await api.rulePreview(code, table, column, pattern))
      setStep(3)
    })
  const apply = () =>
    run(async () => {
      const done = await api.ruleApply(code, table, column, pattern)
      toast('success', `Rule applied to ${column}. ${n(done.passed)} of ${n(done.total)} rows pass.`)
      onDone()
      onClose()
    })
  const remove = () =>
    run(async () => {
      await api.ruleRemove(code, table, column)
      toast('success', `Rule removed from ${column}.`)
      onDone()
      onClose()
    })

  const steps = ['Column', 'Rule', 'Preview']
  let body
  let footer
  if (step === 1) {
    body = (
      <div className="sx-checks">
        {columns.map((c) => (
          <label key={c.name}>
            <input type="radio" name="rule-column" checked={c.name === column} onChange={() => pickColumn(c.name)} />
            <span className="sx-grow">
              <b>{c.name}</b>
            </span>
            {c.pattern ? <Pill tone="plain">Has a rule</Pill> : c.needsLook ? <Pill tone="warn">Needs attention</Pill> : null}
          </label>
        ))}
      </div>
    )
    footer = (
      <>
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!column} onClick={() => setStep(2)}>
          Next
        </button>
      </>
    )
  } else if (step === 2) {
    body = (
      <>
        <p className="rd-lead">
          Pick a rule for <b>{column}</b>. The whole value must match it.
        </p>
        <div className="dq-see">
          <button type="button" className="btn btn-sm" onClick={() => setSeeing(!seeing)}>
            <Icon name="search" size={14} /> {seeing ? 'Hide records' : 'See 10 records'}
          </button>
          <span className="muted text-sm">5 good and 5 wrong values to copy.</span>
        </div>
        {seeing && <Examples code={code} table={table} column={column} pattern={check?.valid ? pattern : ''} />}
        <div className="lx-ask">
          <LibrarySelect library={library} column={column} onPick={fromLibrary} />
          <button type="button" className="btn" onClick={openGenie}>
            <BrandMark size={16} /> Ask Lumina AI
          </button>
        </div>
        <p className="muted text-sm rd-lead">Need a new regex? Copy values from the records above, ask Lumina AI, then paste its regex below.</p>
        {offers.map((o) => (
          <OfferCard key={o.source} offer={o} chosen={o.pattern === pattern} onUse={() => setPattern(o.pattern)} />
        ))}
        <div className="lx-stack">
          <span className="lx-cap">The rule</span>
          <input
            className="input regex-input"
            aria-label={`Regular expression for ${column}`}
            placeholder="Use a suggestion, or type your own regex"
            spellCheck={false}
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
          <RegexVerdict check={check} />
          <Link className="link text-sm" to="/regex">
            Open the regex library
          </Link>
        </div>
        {error && <ErrorAlert message={error} />}
      </>
    )
    footer = (
      <>
        {current?.pattern && (
          <button type="button" className="btn" style={{ marginRight: 'auto' }} disabled={busy} onClick={remove}>
            Remove rule
          </button>
        )}
        {fixed ? (
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
        ) : (
          <button type="button" className="btn" onClick={() => setStep(1)}>
            Back
          </button>
        )}
        <button type="button" className="btn btn-primary" disabled={busy || !check?.valid} onClick={showPreview}>
          {busy ? 'Checking…' : 'Preview on every row'}
        </button>
      </>
    )
  } else {
    body = (
      <>
        <code className="lx-code">{pattern}</code>
        {preview && <PreviewResult result={preview} column={column} />}
        <p className="muted text-sm rd-lead">Nothing changes until you apply. Held-back rows stay in the source untouched.</p>
        {error && <ErrorAlert message={error} />}
      </>
    )
    footer = (
      <>
        <button type="button" className="btn" onClick={() => setStep(2)}>
          Back
        </button>
        <button type="button" className="btn btn-primary" disabled={busy} onClick={apply}>
          Apply rule
        </button>
      </>
    )
  }

  return (
    <Dialog title={current?.pattern ? 'Change a format rule' : 'Add a format rule'} subtitle={`${table} · ${source}`} onClose={onClose} footer={footer}>
      {step > 1 && <ColumnStrip table={table} column={column} profile={profile} rows={rows} />}
      <ol className="rd-steps" aria-label="Steps">
        {steps.map((s, i) => (
          <li key={s} className={i + 1 === step ? 'is-now' : i + 1 < step ? 'is-done' : undefined} aria-current={i + 1 === step ? 'step' : undefined}>
            <b>{i + 1 < step ? <Icon name="check" size={12} /> : i + 1}</b>
            {s}
          </li>
        ))}
      </ol>
      {body}
    </Dialog>
  )
}

// Which table and column the rule is for, with what is inside it, so it is clear the right one was picked.
function ColumnStrip({ table, column, profile, rows }: { table: string; column: string; profile?: ColumnCounts; rows: number }) {
  const parts = profile ? partsOf(profile) : []
  return (
    <div className="rd-strip">
      <span className="rd-place">
        <span className="muted">{table}</span>
        <Icon name="chevron-right" size={13} />
        <b>{column}</b>
      </span>
      {profile && (
        <>
          <span className="muted text-sm">
            {n(profile.filled)} of {n(rows)} filled{profile.empty ? ` · ${n(profile.empty)} empty` : ''}
            {parts.length ? ` · ${parts.slice(0, 3).map((p) => `${p.label} ${n(p.count)}`).join(' · ')}` : ''}
          </span>
          {parts.length > 0 && <Split parts={parts} />}
        </>
      )}
    </div>
  )
}
