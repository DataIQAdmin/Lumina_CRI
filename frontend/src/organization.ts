import { createContext, useContext } from 'react'
import { fetchWhileWaking } from './api/client'

// Which organization (bank) this page belongs to, read from the address: /t/axis/... is Axis Bank.
// One page load serves one organization; switching organization is a full page load, so nothing from one
// bank's session can linger in memory while another bank's pages are open.
const match = window.location.pathname.match(/^\/t\/([a-z0-9-]+)(\/|$)/i)

export const ORG_CODE: string | null = match ? match[1].toLowerCase() : null

// Prefix for this organization's pages and API: "/t/axis", or "" outside any organization.
export const ORG_BASE = ORG_CODE ? `/t/${ORG_CODE}` : ''

export interface Organization {
  code: string
  name: string
  brand_color: string
  logo: string // https:// or data:image/ address; empty shows initials
}

// Asks the server whether an organization code exists. It answers one code at a time; there is no list.
export async function lookupOrganization(code: string): Promise<Organization> {
  const clean = code.trim().toLowerCase()
  if (!/^[a-z0-9-]+$/.test(clean)) {
    throw new Error('Use the short code your administrator gave you, for example "axis".')
  }
  // Waits while the sleeping demo server starts, like every other request.
  const response = await fetchWhileWaking(`/api/organizations/${clean}/`, { headers: { Accept: 'application/json' } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.detail ?? 'Could not check that organization. Please try again.')
  }
  return data as Organization
}

export const OrganizationContext = createContext<Organization | null>(null)

// The organization whose workspace this is. Only valid inside OrganizationGate.
export function useOrganization(): Organization {
  const org = useContext(OrganizationContext)
  if (!org) throw new Error('useOrganization must be used inside OrganizationGate')
  return org
}
