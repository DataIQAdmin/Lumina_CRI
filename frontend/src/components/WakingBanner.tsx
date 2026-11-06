import { useSyncExternalStore } from 'react'

import { serverWaking } from '../api/client'
import { Icon } from './Icon'

// Shown while the free hosting server starts up after sleeping. Requests wait and retry on their own.
export function WakingBanner() {
  const waking = useSyncExternalStore(serverWaking.subscribe, serverWaking.get)
  if (!waking) return null
  return (
    <div className="waking-banner" role="status">
      <Icon name="refresh" size={16} />
      <span>
        <strong>The server is starting.</strong> It sleeps when nobody uses it. This can take up to 3 minutes; you
        do not need to do anything.
      </span>
    </div>
  )
}
