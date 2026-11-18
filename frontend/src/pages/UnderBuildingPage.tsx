import { Link } from 'react-router-dom'

import { Icon } from '../components/Icon'
import { PageHeader } from '../components/ui'

// Features waiting for the new data layers. Their code stays; they come back once gold is built on silver.
export function UnderBuildingPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <section className="card building">
        <span className="building-icon">
          <Icon name="layers" size={26} />
        </span>
        <span className="building-status">Under development</span>
        <h2>This workspace is under development</h2>
        <p className="muted">
          This area is being prepared for the silver-first data platform. Your existing data and services remain in place. For now, use{' '}
          <Link to="/profiling">Data profiling</Link>.
        </p>
      </section>
    </>
  )
}
