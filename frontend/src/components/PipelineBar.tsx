import { Link, useLocation } from 'react-router-dom'

import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../auth/AuthContext'

const n = (v: number) => v.toLocaleString('en-IN')
const many = (v: number, one: string, more: string) => `${n(v)} ${v === 1 ? one : more}`

// The data flow at a glance, on top of every data page: where you are, and how far the data has come.
export function PipelineBar() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const counts = useApi(() => api.pipeline(), [pathname])
  const c = counts.data
  const canRules = !!user?.capabilities.includes('manage_sources')
  const steps = [
    { to: '/connectors', label: 'Connectors', note: c ? `${n(c.connectors)} connected` : '' },
    { to: '/profiling', label: 'Data profiling', note: c ? `${many(c.tables, 'table', 'tables')} profiled` : '' },
    ...(canRules
      ? [
          { to: '/rules', label: 'Rules', note: c ? many(c.rules, 'rule', 'rules') : '' },
          { to: '/silver', label: 'Silver layer', note: c ? many(c.silver, 'row', 'rows') : '' },
        ]
      : []),
  ]
  return (
    <nav className="pipeline" aria-label="Data flow">
      <ol>
        {steps.map((s, i) => {
          const here = pathname.startsWith(s.to)
          return (
            <li key={s.to} className={here ? 'is-here' : undefined}>
              <Link to={s.to} aria-current={here ? 'step' : undefined}>
                <span className="pipeline-n">{i + 1}</span>
                <span className="pipeline-text">
                  <strong>{s.label}</strong>
                  <span className="text-xs muted">{s.note || ' '}</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
