import type { RawSource } from '../api/types'

// The row of connector cards at the top of every data-layer page.
export function ConnectorPicker({
  sources,
  chosen,
  onChoose,
}: {
  sources: RawSource[]
  chosen: string
  onChoose: (code: string) => void
}) {
  return (
    <div className="raw-sources" role="group" aria-label="Connector">
      {sources.map((s) => (
        <button
          key={s.code}
          type="button"
          className={`raw-source${s.code === chosen ? ' is-on' : ''}`}
          aria-pressed={s.code === chosen}
          onClick={() => onChoose(s.code)}
        >
          <strong>{s.name}</strong>
          <span className="text-xs muted">
            {s.tables ? `${s.tables} table${s.tables === 1 ? '' : 's'} profiled` : 'Nothing profiled yet'}
          </span>
        </button>
      ))}
    </div>
  )
}
