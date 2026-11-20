import { Link, useSearchParams } from 'react-router-dom'

import { api } from '../api/client'
import { useApi } from '../api/useApi'
import { Head } from '../components/dq/kit'
import { MapStep } from '../components/dq/MapStep'
import { Icon } from '../components/Icon'
import { Loader } from '../components/Loader'
import { useToast } from '../components/Toasts'
import { EmptyState, ErrorAlert } from '../components/ui'

// Map fields: for each source, which silver column holds the customer's name, date of birth, PAN and so on.
// Matching, trust scores and golden records read silver data through this mapping; silver itself is not changed.
export function FieldMappingPage() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const sources = useApi(() => api.sources(), [])
  const code = params.get('source')
  const chosen = sources.data?.results.find((s) => s.code === code)

  const trail = (
    <nav className="dq-trail" aria-label="You are here">
      <Link to="/customers">Customers</Link>
      <Icon name="chevron-right" size={13} />
      {chosen ? (
        <>
          <button type="button" className="link" onClick={() => setParams({})}>
            Map fields
          </button>
          <Icon name="chevron-right" size={13} />
          <b>{chosen.name}</b>
        </>
      ) : (
        <b>Map fields</b>
      )}
    </nav>
  )

  if (sources.error) return <ErrorAlert message={sources.error} />
  if (!sources.data) return <Loader kind="scan" label="Loading sources" />

  if (chosen) {
    return (
      <>
        {trail}
        <Head title={`Map fields of ${chosen.name}`} text="Tell Lumina which column holds each customer detail. Only clean silver rows are read." />
        <MapStep
          code={chosen.code}
          source={chosen.name}
          onBack={() => setParams({})}
          onDone={() => {
            toast('success', `Fields of ${chosen.name} saved. Run matching on Customers to use them.`)
            setParams({})
          }}
        />
      </>
    )
  }

  const list = sources.data.results.filter((s) => s.enabled)
  return (
    <>
      {trail}
      <Head title="Map fields" text="Once per source: which column holds the name, date of birth, PAN, Aadhaar, mobile, email and address. Matching and trust scores use this." />
      <section className="card">
        {list.length === 0 ? (
          <EmptyState icon="connectors" title="No sources yet">
            Add a source first on <Link to="/sources">Sources</Link>.
          </EmptyState>
        ) : (
          list.map((s) => (
            <div key={s.code} className="hm-row">
              <span className="hm-ic is-acc">
                <Icon name="connectors" size={16} />
              </span>
              <div className="hm-grow">
                <b>{s.name}</b>
                <span className="muted text-sm">{s.connector_label}</span>
              </div>
              <button type="button" className="btn btn-sm" onClick={() => setParams({ source: s.code })}>
                Map fields
              </button>
            </div>
          ))
        )}
      </section>
    </>
  )
}
