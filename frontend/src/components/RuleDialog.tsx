import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../api/client'
import type { RegexLibrary, RulePreview } from '../api/types'
import { Dialog } from './Dialog'
import { Icon } from './Icon'
import { n, Pill } from './Lx'
import { LibrarySelect, OfferCard, type Offer, PreviewResult, RegexVerdict, useRegexCheck } from './regex'
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
  onClose: () => void
  onDone: () => void
}) {
  const toast = useToast()
  const [step, setStep] = useState(fixed ? 2 : 1)
  const [column, setColumn] = useState(fixed ?? columns.find((c) => c.needsLook && !c.pattern)?.name ?? columns[0]?.name ?? '')
  const current = columns.find((c) => c.name === column)
  const [pattern, setPattern] = useState(start || current?.pattern || '')
  const check = useRegexCheck(pattern)
  const [wish, setWish] = useState('')
  const [asking, setAsking] = useState(false)
  const [offers, setOffers] = useState<Offer[]>([])
  const [offerError, setOfferError] = useState<string | null>(null)
  const [preview, setPreview] = useState<RulePreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickColumn = (name: string) => {
    setColumn(name)
    setPattern(columns.find((c) => c.name === name)?.pattern ?? '')
    setOffers([])
    setOfferError(null)
  }
  const ask = async () => {
    setAsking(true)
    setOfferError(null)
    try {
      const got = await api.ruleSuggest(code, table, column, wish)
      const offer: Offer = { source: 'ai', title: got.explanation, pattern: got.pattern, matching: got.matching, failing: got.failing, passed: got.passed, total: got.total }
      setOffers((old) => [offer, ...old.filter((o) => o.source !== 'ai')])
    } catch (e) {
      setOfferError((e as Error).message)
    } finally {
      setAsking(false)
    }
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
        <div className="lx-ask">
          <label className="lx-search is-wide">
            <Icon name="search" size={15} />
            <input
              aria-label="Describe the rule in words (optional)"
              placeholder="Describe the rule, or leave it empty"
              value={wish}
              onChange={(e) => setWish(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !asking) ask()
              }}
            />
          </label>
          <button type="button" className="btn btn-primary" disabled={asking} onClick={ask}>
            {asking ? 'Thinking…' : 'Suggest with AI'}
          </button>
          <LibrarySelect library={library} column={column} onPick={fromLibrary} />
        </div>
        {offerError && <ErrorAlert message={offerError} />}
        {offers.map((o) => (
          <OfferCard
            key={o.source}
            offer={o}
            chosen={o.pattern === pattern}
            busy={asking}
            onUse={() => setPattern(o.pattern)}
            onRetry={o.source === 'ai' ? ask : undefined}
          />
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
