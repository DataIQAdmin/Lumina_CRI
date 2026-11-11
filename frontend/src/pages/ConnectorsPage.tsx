import { Link } from 'react-router-dom'

import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { useCan } from '../auth/AuthContext'
import { ConnectorLogo } from '../components/ConnectorLogo'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { n, Pill } from '../components/Lx'
import { ErrorAlert, PageHeader } from '../components/ui'

// The bank systems Lumina reads from, each with how many of its tables are profiled.
export function ConnectorsPage() {
  const sources = useApi(() => api.sources(), [])
  const raw = useApi(() => api.rawSources(), [])
  const canSetUp = useCan('manage_connectors')
  const tables = (code: string) => raw.data?.sources.find((s) => s.code === code)?.tables ?? 0
  const list = sources.data?.results ?? []

  return (
    <>
      <PageHeader
        title="Connectors"
        description="The bank systems Lumina reads from. Read-only, always."
        actions={
          canSetUp && (
            <Link className="btn btn-primary" to="/connectors/new">
              <Icon name="connectors" size={15} /> Add connector
            </Link>
          )
        }
      />
      {sources.error && <ErrorAlert message={sources.error} />}
      {!sources.data && !sources.error && (
        <div className="lx-panel">
          <Loader kind="orbit" label="Loading connectors" />
        </div>
      )}
      {sources.data && (
        <div className="lx-cards">
          {list.map((s) => (
            <Link key={s.code} to={`/connectors/${s.code}`} className="lx-panel lx-conn">
              <header>
                <ConnectorLogo type={s.connector_type} size={42} />
                <span className="lx-grow">
                  <strong>{s.name}</strong>
                  <small>{s.connector_label}</small>
                </span>
                <Pill tone={s.enabled ? 'ok' : 'warn'}>{s.enabled ? 'Connected' : 'Off'}</Pill>
              </header>
              <span className="lx-conn-tables">
                <b>{n(tables(s.code))}</b> {tables(s.code) === 1 ? 'table' : 'tables'}
              </span>
            </Link>
          ))}
          {canSetUp && (
            <Link to="/connectors/new" className="lx-panel lx-add">
              <Icon name="connectors" size={22} />
              <strong>Add a connector</strong>
            </Link>
          )}
        </div>
      )}
    </>
  )
}
