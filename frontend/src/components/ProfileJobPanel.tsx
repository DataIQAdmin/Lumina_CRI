import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useNavigate } from 'react-router-dom'

import { profileJob, type ProfileJob, type TableState } from '../profileJob'
import { Icon } from './Icon'

const STATE_TEXT: Record<TableState, string> = {
  waiting: 'Waiting',
  running: 'Profiling...',
  done: 'Done',
  failed: 'Failed',
  stopped: 'Stopped',
}

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function useElapsed(job: ProfileJob | null) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!job || job.finished !== null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [job])
  if (!job) return ''
  return clock((job.finished ?? now) - job.started)
}

// The profiling job, shown as a popup with a checklist, or as a small panel in the corner while people keep
// working. Lives in the layout, so it stays while people move between pages.
export function ProfileJobPanel() {
  const job = useSyncExternalStore(profileJob.subscribe, profileJob.get)
  const navigate = useNavigate()
  const elapsed = useElapsed(job)
  const primary = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (job?.view !== 'popup') return
    primary.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (profileJob.running()) profileJob.show('background')
      else profileJob.dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [job?.view])

  if (!job) return null
  const total = job.tables.length
  const finished = job.tables.filter((t) => t.state === 'done' || t.state === 'failed' || t.state === 'stopped')
  const done = job.tables.filter((t) => t.state === 'done')
  const failed = job.tables.filter((t) => t.state === 'failed')
  const current = job.tables.find((t) => t.state === 'running')
  const over = job.finished !== null
  const share = Math.round((100 * finished.length) / total)
  const viewResults = () => {
    const first = done[0]?.name
    profileJob.dismiss()
    navigate(`/profiling?${new URLSearchParams({ source: job.code, ...(first ? { table: first } : {}) })}`)
  }
  const summary = over
    ? `Profiled ${done.length} of ${total} table${total === 1 ? '' : 's'}${failed.length ? `, ${failed.length} failed` : ''}`
    : `Profiling ${Math.min(finished.length + 1, total)} of ${total}${current ? `: ${current.name}` : ''}`

  if (job.view === 'background') {
    return (
      <aside className="job-corner" role="status" aria-live="polite">
        <div className="job-corner-head">
          <Icon name={over ? (failed.length ? 'alert' : 'check') : 'refresh'} size={16} />
          <span className="job-corner-text">{summary}</span>
        </div>
        <span className="raw-progress-bar" aria-hidden="true">
          <i style={{ width: `${share}%` }} />
        </span>
        <div className="row" style={{ gap: 6 }}>
          {over ? (
            <>
              <button type="button" className="btn btn-sm btn-primary" onClick={viewResults}>
                View results
              </button>
              <button type="button" className="btn btn-sm" onClick={profileJob.dismiss}>
                Close
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => profileJob.show('popup')}>
              Show details
            </button>
          )}
        </div>
      </aside>
    )
  }

  return (
    <div className="job-overlay">
      <section className="job-dialog" role="dialog" aria-modal="true" aria-labelledby="job-title">
        <header className="job-head">
          <div className="stack" style={{ gap: 2 }}>
            <h2 id="job-title">{over ? 'Profiling finished' : 'Profiling tables'}</h2>
            <span className="text-sm muted">
              {job.source} · {summary} · {elapsed}
            </span>
          </div>
        </header>
        <span className="raw-progress-bar" aria-hidden="true">
          <i style={{ width: `${share}%` }} />
        </span>
        <ul className="job-list">
          {job.tables.map((t) => (
            <li key={t.name} className={`is-${t.state}`}>
              <span className="job-mark" aria-hidden="true">
                {t.state === 'done' && <Icon name="check" size={14} />}
                {t.state === 'failed' && <Icon name="x" size={14} />}
                {t.state === 'running' && <span className="job-spin" />}
              </span>
              <span className="job-name">{t.name}</span>
              <span className="text-xs muted" title={t.error}>
                {t.state === 'failed' && t.error ? t.error : STATE_TEXT[t.state]}
              </span>
            </li>
          ))}
        </ul>
        <footer className="job-foot">
          {over ? (
            <>
              <button type="button" className="btn" onClick={profileJob.dismiss}>
                Close
              </button>
              <button ref={primary} type="button" className="btn btn-primary" onClick={viewResults} disabled={!done.length}>
                View results
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={profileJob.stop} disabled={job.stopping}>
                {job.stopping ? 'Stopping...' : 'Stop'}
              </button>
              <button ref={primary} type="button" className="btn btn-primary" onClick={() => profileJob.show('background')}>
                Run in background
              </button>
            </>
          )}
        </footer>
      </section>
    </div>
  )
}
