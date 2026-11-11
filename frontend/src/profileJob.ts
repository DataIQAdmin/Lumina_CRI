import { api } from './api/client'

// Profiling the chosen tables, one at a time, as a job that lives outside any page: people can watch it in a popup
// or send it to the background and keep working, even on other pages. Only one job runs at a time.

export type TableState = 'waiting' | 'running' | 'done' | 'failed' | 'stopped'

export interface ProfileJob {
  code: string
  source: string
  tables: { name: string; state: TableState; error?: string }[]
  started: number
  finished: number | null
  stopping: boolean
  view: 'popup' | 'background'
}

let job: ProfileJob | null = null
const listeners = new Set<() => void>()

function set(next: ProfileJob | null) {
  job = next
  listeners.forEach((listener) => listener())
}

function update(change: (current: ProfileJob) => ProfileJob) {
  if (job) set(change(job))
}

function mark(name: string, state: TableState, error?: string) {
  update((j) => ({ ...j, tables: j.tables.map((t) => (t.name === name ? { ...t, state, error } : t)) }))
}

async function run(code: string, names: string[]) {
  for (const name of names) {
    if (job?.stopping) {
      mark(name, 'stopped')
      continue
    }
    mark(name, 'running')
    try {
      await api.rawRead(code, name)
      mark(name, 'done')
    } catch {
      // One more try: the hosted server may have restarted halfway; reading a table again is safe.
      try {
        await api.rawRead(code, name)
        mark(name, 'done')
      } catch (e) {
        mark(name, 'failed', (e as Error).message)
      }
    }
  }
  update((j) => ({ ...j, finished: Date.now(), stopping: false }))
}

export const profileJob = {
  get: () => job,
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  running: () => !!job && job.finished === null,
  start(code: string, source: string, names: string[]) {
    if (profileJob.running() || !names.length) return
    set({
      code,
      source,
      tables: names.map((name) => ({ name, state: 'waiting' })),
      started: Date.now(),
      finished: null,
      stopping: false,
      view: 'popup',
    })
    void run(code, names)
  },
  // Stops after the table being read now; the tables already done keep their results.
  stop: () => update((j) => ({ ...j, stopping: true })),
  show: (view: ProfileJob['view']) => update((j) => ({ ...j, view })),
  dismiss: () => {
    if (!profileJob.running()) set(null)
  },
}
