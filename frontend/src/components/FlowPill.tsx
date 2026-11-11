import { Fragment } from 'react'
import { Link, useLocation } from 'react-router-dom'

import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useAuth } from '../auth/AuthContext'
import { n } from './Lx'

// The data flow in the top bar: connectors, profiled tables, rules and silver rows, with live numbers.
export function FlowPill() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const counts = useApi(() => api.pipeline(), [pathname])
  const c = counts.data
  const canRules = !!user?.capabilities.includes('manage_sources')
  const steps = [
    { to: '/connectors', label: 'Connectors', value: c?.connectors },
    { to: '/profiling', label: 'Profiled', value: c?.tables },
    ...(canRules
      ? [
          { to: '/rules', label: 'Rules', value: c?.rules },
          { to: '/silver', label: 'Silver rows', value: c?.silver },
        ]
      : []),
  ]
  return (
    <nav className="lx-flow" aria-label="Data flow">
      {steps.map((s, i) => {
        const here = pathname.startsWith(s.to)
        return (
          <Fragment key={s.to}>
            {i > 0 && <i aria-hidden="true" />}
            <Link to={s.to} className={here ? 'is-on' : undefined} aria-current={here ? 'page' : undefined}>
              {s.label} <b>{s.value === undefined ? '…' : n(s.value)}</b>
            </Link>
          </Fragment>
        )
      })}
    </nav>
  )
}
