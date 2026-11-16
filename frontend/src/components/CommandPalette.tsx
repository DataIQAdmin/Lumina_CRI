import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import { Icon } from './Icon'
import { useScrollLock } from './scrollLock'

type Item = { label: string; hint: string; to: string }

const PAGES: Item[] = [
  { label: 'Home', hint: 'Page', to: '/' },
  { label: 'Sources', hint: 'Page', to: '/sources' },
  { label: 'Data quality', hint: 'Page', to: '/profiling' },
  { label: 'Customers', hint: 'Page', to: '/customers' },
  { label: 'Settings', hint: 'Page', to: '/settings' },
  { label: 'Users and roles', hint: 'Page', to: '/users' },
]

// Ctrl+K: jump to any page or profiled table by typing its name.
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  useScrollLock()
  const [q, setQ] = useState('')
  const [tables, setTables] = useState<Item[]>([])
  const [at, setAt] = useState(0)

  useEffect(() => {
    let live = true
    api.rawSources().then(async ({ sources }) => {
      const found: Item[] = []
      for (const s of sources.filter((x) => x.tables > 0)) {
        const t = await api.rawTables(s.code).catch(() => null)
        t?.tables.forEach((x) => found.push({ label: x.name, hint: s.name, to: `/profiling?${new URLSearchParams({ source: s.code, table: x.name })}` }))
      }
      if (live) setTables(found)
    }, () => undefined)
    return () => {
      live = false
    }
  }, [])

  const items = useMemo(() => {
    const term = q.trim().toLowerCase()
    return [...PAGES, ...tables].filter((i) => i.label.toLowerCase().includes(term)).slice(0, 12)
  }, [q, tables])
  const go = (item: Item | undefined) => {
    if (!item) return
    onClose()
    navigate(item.to)
  }

  return (
    <div className="dlg-scrim is-top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <section className="dlg is-md palette" role="dialog" aria-modal="true" aria-label="Search">
        <label className="palette-in">
          <Icon name="search" size={18} />
          <input
            autoFocus
            placeholder="Search pages and tables"
            aria-label="Search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value)
              setAt(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              if (e.key === 'ArrowDown') setAt(Math.min(at + 1, items.length - 1))
              if (e.key === 'ArrowUp') setAt(Math.max(at - 1, 0))
              if (e.key === 'Enter') go(items[at])
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="palette-list" role="listbox">
          {items.length === 0 && <p className="muted palette-empty">Nothing found.</p>}
          {items.map((item, i) => (
            <button
              key={`${item.to}`}
              type="button"
              role="option"
              aria-selected={i === at}
              className={i === at ? 'is-on' : undefined}
              onMouseEnter={() => setAt(i)}
              onClick={() => go(item)}
            >
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
