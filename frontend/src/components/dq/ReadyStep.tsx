import { useState } from 'react'
import { Link } from 'react-router-dom'

import { api } from '../../api/client'
import { useApi } from '../../api/useApi'
import { Explain } from '../Explain'
import { Icon } from '../Icon'
import { Loader } from '../Loader'
import { n, pct } from '../Lx'
import { Bar } from './kit'
import { RowsDialog } from './WorkStep'

// Step 5: what this source is ready to give: clean rows per table and the customer fields mapped, with anything
// still missing.
export function ReadyStep({ code, source, list, canManage, canViewRows, onOpen, onMap }: { code: string; source: string; list: string[]; canManage: boolean; canViewRows: boolean; onOpen: (table: string) => void; onMap: () => void }) {
  const [seeing, setSeeing] = useState<string | null>(null)
  const raw = useApi(() => api.rawTables(code), [code])
  const silver = useApi(() => (canManage ? api.silverTables(code) : Promise.resolve(null)), [code, canManage])
  const map = useApi(() => api.fieldMap(code), [code])
  if (!raw.data || !map.data || (canManage && !silver.data)) return <Loader kind="scan" label="Adding it up" />

  // The chosen tables, then any other table the mapping takes fields from.
  const names = Array.from(new Set([...list, ...Object.values(map.data.mapped.fields).map((p) => p.table)]))
  const tables = names.map((name) => ({ name, raw: raw.data!.tables.find((t) => t.name === name), clean: silver.data?.tables.find((t) => t.name === name) }))
  const clean = tables.reduce((a, t) => a + (t.clean?.rules ? t.clean.passed : 0), 0)
  const total = tables.reduce((a, t) => a + (t.raw?.rows ?? 0), 0)
  const needed = map.data.fields.filter((f) => f.needed)
  const missing = needed.filter((f) => !map.data!.mapped.fields[f.key])
  const noRules = tables.filter((t) => t.raw && canManage && !t.clean?.rules)
  const unchecked = tables.filter((t) => !t.raw)
  const todo = [
    ...unchecked.map((t) => ({ text: `${t.name} is not checked yet`, action: () => onOpen(t.name), label: 'Open' })),
    ...noRules.map((t) => ({ text: `${t.name} has no rules, so it gives no clean rows`, action: () => onOpen(t.name), label: 'Add rules' })),
    ...(missing.length ? [{ text: `Not mapped: ${missing.map((f) => f.label).join(', ')}`, action: onMap, label: 'Map' }] : []),
  ]

  return (
    <>
      <div className="hm-stats">
        <div className="card hm-stat">
          <span className="muted">Tables</span>
          <b>{n(names.length)}</b>
          <span className="muted text-sm">{unchecked.length ? `${unchecked.length} not checked yet` : 'All checked'}</span>
        </div>
        {canManage && (
          <div className="card hm-stat">
            <span className="muted">Clean rows</span>
            <b>
              <Explain title="Clean rows" text="Rows that pass every format rule of their table, across the tables you chose." calc={`${n(clean)} clean of ${n(total)} rows`}>
                {n(clean)}
              </Explain>
            </b>
            <span className="muted text-sm">of {n(total)} rows</span>
          </div>
        )}
        <div className="card hm-stat">
          <span className="muted">Needed fields mapped</span>
          <b>
            {needed.length - missing.length} of {needed.length}
          </b>
          <span className="muted text-sm">{missing.length ? `${missing.length} missing` : 'All mapped'}</span>
        </div>
      </div>

      <div className="hm-grid">
        <section className="card">
          <div className="hm-h">
            <h2>Your tables</h2>
          </div>
          {tables.map((t) => (
            <button
              key={t.name}
              type="button"
              className="hm-row dq-readyrow"
              disabled={!t.raw || !canViewRows}
              title={t.raw && canViewRows ? 'See its rows' : undefined}
              onClick={() => setSeeing(t.name)}
            >
              <div className="hm-grow">
                <b>{t.name}</b>
                <span className="muted text-sm">
                  {!t.raw ? 'Not checked yet' : !canManage ? `${n(t.raw.rows)} rows` : t.clean?.rules ? `${n(t.clean.passed)} of ${n(t.clean.rows)} rows clean · ${t.clean.rules} rule${t.clean.rules === 1 ? '' : 's'}` : 'No rules yet'}
                </span>
              </div>
              {t.clean?.rules ? (
                <span className="dq-filled">
                  <Bar value={pct(t.clean.passed, t.clean.rows)} tone={pct(t.clean.passed, t.clean.rows) >= 90 ? 'good' : 'warn'} />
                </span>
              ) : null}
              {t.raw && canViewRows && <span className="link text-sm">See rows →</span>}
            </button>
          ))}
        </section>
        <section className="card">
          <div className="hm-h">
            <h2>Still to do</h2>
          </div>
          {todo.length === 0 && (
            <div className="hm-row">
              <span className="hm-ic is-acc">
                <Icon name="check" size={16} />
              </span>
              <div className="hm-grow">
                <b>{source} is ready</b>
                <span className="muted text-sm">Its clean rows and mapped fields can build customer records.</span>
              </div>
            </div>
          )}
          {todo.map((t) => (
            <div key={t.text} className="hm-row">
              <span className="hm-ic is-warn">
                <Icon name="alert" size={16} />
              </span>
              <div className="hm-grow">
                <b>{t.text}</b>
              </div>
              <button type="button" className="btn btn-sm" onClick={t.action}>
                {t.label}
              </button>
            </div>
          ))}
        </section>
      </div>

      {seeing && (
        <RowsDialog code={code} source={source} name={seeing} table={tables.find((t) => t.name === seeing)?.clean} onClose={() => setSeeing(null)} />
      )}

      <div className="dq-nav">
        <button type="button" className="btn" onClick={onMap}>
          ← Back to Map fields
        </button>
        <Link to="/customers" className="btn btn-primary">
          Go to Match →
        </Link>
      </div>
    </>
  )
}
