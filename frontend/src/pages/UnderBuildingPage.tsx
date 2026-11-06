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
        <h2>We are rebuilding this</h2>
        <p className="muted">
          {title} will be back once the new data layers are ready. For now, you can follow the data from{' '}
          <Link to="/profiling">Data profiling</Link> to <Link to="/rules">Rules</Link> and the{' '}
          <Link to="/silver">Silver layer</Link>.
        </p>
      </section>
    </>
  )
}
