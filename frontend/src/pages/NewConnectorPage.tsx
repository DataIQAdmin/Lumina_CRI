import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api } from '../api/client'
import type { ConnectorType } from '../api/types'
import { useApi } from '../api/useApi'
import { ConnectorFields } from '../components/ConnectorFields'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { ConnectorLogo } from '../components/ConnectorLogo'
import { useToast } from '../components/Toasts'
import { Card, ErrorAlert, PageHeader, StatusBadge } from '../components/ui'

// Step 1 of adding a connector: pick a type from the catalog (the same for every organization), then enter
// this organization's own connection details. The setup page that follows tests it and maps its columns.
export function NewConnectorPage() {
  const { data, error } = useApi(() => api.connectorCatalog(), [])
  const [chosen, setChosen] = useState<ConnectorType | null>(null)

  return (
    <>
      <PageHeader
        title="Add a connector"
        description="Connect one of your systems. Lumina only ever reads, and only the columns you map."
        crumbs={[{ label: 'Connectors', to: '/connectors' }, { label: 'Add' }]}
      />
      {error && <ErrorAlert message={error} />}
      {!data ? (
        <div className="card">
          <Loader kind="orbit" label="Loading the connector catalog" />
        </div>
      ) : chosen ? (
        <ConnectionForm type={chosen} onBack={() => setChosen(null)} />
      ) : (
        <div className="catalog-grid">
          {data.map((t) => (
            <button
              key={t.type}
              type="button"
              className="card catalog-card"
              disabled={!t.available}
              onClick={() => setChosen(t)}
            >
              <ConnectorLogo type={t.type} />
              <span className="catalog-text">
                <strong>{t.label}</strong>
                <span className="text-sm muted">{t.description}</span>
              </span>
              {t.available ? (
                <span className="text-xs muted">{t.category}</span>
              ) : (
                <StatusBadge tone="neutral">Coming soon</StatusBadge>
              )}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

function ConnectionForm({ type, onBack }: { type: ConnectorType; onBack: () => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const [name, setName] = useState('')
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(type.fields.map((f) => [f.name, f.default])),
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const source = await api.createConnector({ name, connector_type: type.type, settings: values })
      toast('success', `${source.name} added. Now test it and choose what to read.`)
      navigate(`/connectors/${source.code}`)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <Card title={`New ${type.label} connector`} description={type.description}>
      <form className="form-grid" onSubmit={submit}>
        {error && (
          <div className="wide">
            <ErrorAlert message={error} />
          </div>
        )}
        <div className="form-field">
          <label htmlFor="cn-name">Name</label>
          <input
            id="cn-name"
            className="input"
            placeholder="e.g. Core banking replica"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <ConnectorFields fields={type.fields} values={values} onChange={setValues} />
        <div className="wide row" style={{ justifyContent: 'space-between' }}>
          <button type="button" className="btn" onClick={onBack}>
            <Icon name="arrowLeft" size={16} /> Other types
          </button>
          <div className="row" style={{ gap: 8 }}>
            <Link className="btn" to="/sources">
              Cancel
            </Link>
            <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 2}>
              {busy ? 'Saving...' : 'Save and continue'}
            </button>
          </div>
        </div>
      </form>
    </Card>
  )
}
