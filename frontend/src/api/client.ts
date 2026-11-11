// One place that talks to the backend. Every page calls the functions at the bottom, never fetch() directly.

import type {
  AccountsMapping,
  AuditEvent,
  Briefing,
  ComplianceQueue,
  CustomerDetail,
  ConnectorMapping,
  ConnectorType,
  CustomerSummary,
  Field,
  FieldCorrection,
  Interaction,
  NewInteraction,
  MatchSuggestion,
  OrgUser,
  Overview,
  Page,
  Reference,
  RoleCode,
  Source,
  SyncResult,
  SyncRun,
  TrustSettings,
  CustomerBreakdown,
  FieldTrust,
  UploadResult,
  UploadedFile,
  FileRemoval,
  TableRemoval,
  ProfilingSummary,
  ProfiledRecords,
  RawSources,
  RawTable,
  RawTableProfile,
  RegexCheck,
  RegexLibrary,
  RuleColumns,
  RegexSuggestion,
  RulePreview,
  SavedRegex,
  SilverRows,
  SilverTable,
  User,
} from './types'
import { ORG_BASE } from '../organization'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

// The hosted demo's free server sleeps after 15 minutes without visitors. While it starts again (up to three
// minutes) every request gets 502, 503 or 504, or no answer at all. Wait and retry instead of failing, and tell
// the screen so it can say what is happening. While it restarts, the host also answers 429 with its own page
// (not JSON); Lumina's own 429 (too many sign-in attempts) is JSON and is not retried.
const WAKING_STATUSES = [502, 503, 504]

function isWaking(response: Response) {
  if (WAKING_STATUSES.includes(response.status)) return true
  return response.status === 429 && !(response.headers.get('content-type') ?? '').includes('application/json')
}
const WAKING_LIMIT_MS = 180_000
const WAKING_RETRY_MS = 5_000

let waking = false
const wakingListeners = new Set<() => void>()

function setWaking(value: boolean) {
  if (value === waking) return
  waking = value
  wakingListeners.forEach((listener) => listener())
}

export const serverWaking = {
  get: () => waking,
  subscribe: (listener: () => void) => {
    wakingListeners.add(listener)
    return () => {
      wakingListeners.delete(listener)
    }
  },
}

export async function fetchWhileWaking(url: string, init: RequestInit): Promise<Response> {
  const started = Date.now()
  for (;;) {
    let response: Response | null = null
    try {
      response = await fetch(url, init)
    } catch {
      response = null // no answer at all
    }
    if (response && !isWaking(response)) {
      setWaking(false)
      return response
    }
    if (Date.now() - started > WAKING_LIMIT_MS) {
      setWaking(false)
      if (response) return response
      throw new ApiError(0, 'The server did not answer. Please try again in a minute.')
    }
    setWaking(true)
    await new Promise((resolve) => setTimeout(resolve, WAKING_RETRY_MS))
  }
}

// Django rejects POST/PATCH without the CSRF token it put in the csrftoken cookie.
function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)csrftoken=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

export const SIGNED_OUT_EVENT = 'lumina:signed-out'

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetchWhileWaking(`${ORG_BASE}/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' ? { 'X-CSRFToken': csrfToken() } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (response.status === 204) return undefined as T
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    // The session ended (30 minutes without activity, or signed out elsewhere): tell the app to show sign-in.
    if (response.status === 403 && data.detail === 'Authentication credentials were not provided.') {
      window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
    }
    throw new ApiError(response.status, data.detail ?? `Request failed (${response.status})`)
  }
  return data as T
}

const get = <T>(path: string) => request<T>('GET', path)
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {})
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body)
const put = <T>(path: string, body: unknown) => request<T>('PUT', path, body)

function query(params: Record<string, string | undefined>): string {
  const clean = Object.entries(params).filter(([, v]) => v) as [string, string][]
  return clean.length ? `?${new URLSearchParams(clean)}` : ''
}

function withFilters(base: string, filters: string): string {
  if (!filters) return base
  return base ? `${base}&${filters}` : `?${filters}`
}

export const api = {
  // Login
  csrf: () => get<{ detail: string }>('/auth/csrf/'),
  login: (username: string, password: string) => post<User>('/auth/login/', { username, password }),
  logout: () => post<void>('/auth/logout/'),
  me: () => get<User>('/auth/me/'),
  changePassword: (current_password: string, new_password: string) =>
    post<void>('/auth/change-password/', { current_password, new_password }),

  // Organization administration (organization admins only)
  users: () => get<OrgUser[]>('/users/'),
  createUser: (body: { username: string; first_name: string; last_name: string; role: RoleCode }) =>
    post<OrgUser>('/users/', body),
  updateUser: (id: number, body: Partial<Pick<OrgUser, 'role' | 'is_active' | 'first_name' | 'last_name'>>) =>
    patch<OrgUser>(`/users/${id}/`, body),
  resetPassword: (id: number) => post<OrgUser>(`/users/${id}/reset-password/`),
  trustSettings: () => get<TrustSettings>('/settings/trust/'),
  saveTrustSettings: (body: { sources?: Record<string, number>; weights?: Record<string, number> }) =>
    put<TrustSettings>('/settings/trust/', body),
  saveLogo: (logo: string) => put<{ logo: string }>('/settings/logo/', { logo }),

  overview: () => get<Overview>('/overview/'),
  reference: () => get<Reference>('/reference/'),

  // Connectors
  sources: () => get<Page<Source>>('/sources/'),
  updateSource: (code: string, changes: Partial<Pick<Source, 'enabled' | 'trust' | 'sync_every_hours'>>) =>
    patch<Source>(`/sources/${code}/`, changes),
  syncSource: (code: string) => post<SyncResult>(`/sources/${code}/sync/`),

  // Connector setup (organization admins)
  connectorCatalog: () => get<ConnectorType[]>('/connectors/catalog/'),
  fieldTrust: (code: string) => get<FieldTrust>(`/connectors/${code}/trust/`),
  saveFieldTrust: (code: string, trust: Record<string, number>) => put<FieldTrust>(`/connectors/${code}/trust/`, { trust }),
  createConnector: (body: { name: string; connector_type: string; settings: Record<string, string> }) =>
    post<Source>('/connectors/', body),
  updateConnector: (code: string, body: { name?: string; settings?: Record<string, string> }) =>
    patch<Source>(`/connectors/${code}/`, body),
  testConnector: (code: string) => post<{ ok: boolean; detail: string }>(`/connectors/${code}/test/`),
  discoverObjects: (code: string) => post<{ objects: string[] }>(`/connectors/${code}/discover/`),
  discoverColumns: (code: string, object: string) =>
    post<{ object: string; columns: string[] }>(`/connectors/${code}/discover/`, { object }),
  saveMapping: (code: string, mapping: ConnectorMapping) => put<Source>(`/connectors/${code}/mapping/`, mapping),
  saveAccountsMapping: (code: string, mapping: AccountsMapping) =>
    put<Source>(`/connectors/${code}/accounts-mapping/`, mapping),
  removeAccountsMapping: (code: string) => request<Source>('DELETE', `/connectors/${code}/accounts-mapping/`),
  connectorDeletePreview: (code: string) =>
    get<{ name: string; records: number; products: number; customers: number; conversations: number; corrections: number }>(
      `/connectors/${code}/delete/`,
    ),
  deleteConnector: (code: string, confirm: string) => post<{ deleted: string }>(`/connectors/${code}/delete/`, { confirm }),
  connectorRuns: (code: string) => get<SyncRun[]>(`/connectors/${code}/runs/`),
  createApiKey: (code: string) => post<{ api_key: string; key_prefix: string }>(`/connectors/${code}/api-key/`),
  saveCustomerTable: (code: string, table: ConnectorMapping & { key?: string }) =>
    put<Source & { key: string }>(`/connectors/${code}/tables/`, table),
  setTableStatus: (code: string, keys: string[], status: 'active' | 'suspended') =>
    post<Source & { changed: number }>(`/connectors/${code}/tables/status/`, { keys, status }),
  tableRemovePreview: (code: string, keys: string[]) =>
    get<TableRemoval>(`/connectors/${code}/tables/remove/?keys=${keys.join(',')}`),
  removeTables: (code: string, keys: string[]) =>
    post<TableRemoval>(`/connectors/${code}/tables/remove/`, { keys, confirm: true }),
  profiling: (source: string) => get<ProfilingSummary>(`/profiling/?source=${encodeURIComponent(source)}`),
  profilingRecords: (source: string, checks: string[], page: number, pageSize: 10 | 50) =>
    get<ProfiledRecords>(
      `/profiling/records/?source=${encodeURIComponent(source)}&page=${page}&page_size=${pageSize}` +
        checks.map((c) => `&check=${encodeURIComponent(c)}`).join(''),
    ),
  rawSources: () => get<RawSources>('/raw/'),
  rawTables: (code: string) => get<{ code: string; name: string; tables: RawTable[] }>(`/raw/${code}/`),
  rawDiscover: (code: string) => post<{ tables: string[]; dropped: number }>(`/raw/${code}/discover/`),
  rawRead: (code: string, table: string) => post<RawTable>(`/raw/${code}/read/`, { table }),
  rawProfile: (code: string, table: string) =>
    get<RawTableProfile>(`/raw/${code}/profile/?table=${encodeURIComponent(table)}`),
  ruleColumns: (code: string, table: string) =>
    get<RuleColumns>(`/rules/${code}/?table=${encodeURIComponent(table)}`),
  ruleSuggest: (code: string, table: string, column: string, wish: string) =>
    post<RegexSuggestion>(`/rules/${code}/suggest/`, { table, column, wish }),
  rulePreview: (code: string, table: string, column: string, pattern: string) =>
    post<RulePreview>(`/rules/${code}/preview/`, { table, column, pattern }),
  ruleApply: (code: string, table: string, column: string, pattern: string) =>
    post<{ passed: number; failed: number; total: number }>(`/rules/${code}/`, { table, column, pattern }),
  ruleRemove: (code: string, table: string, column: string) =>
    post<{ removed: number }>(`/rules/${code}/remove/`, { table, column }),
  regexCheck: (pattern: string) => post<RegexCheck>('/regex/check/', { pattern }),
  regexLibrary: () => get<RegexLibrary>('/regex/library/'),
  regexSave: (name: string, pattern: string) => post<SavedRegex>('/regex/library/', { name, pattern }),
  regexDelete: (id: number) => request<void>('DELETE', `/regex/library/${id}/`),
  regexTest: (code: string, table: string, pattern: string) =>
    post<{ columns: { column: string; matched: number; filled: number }[] }>('/regex/test/', { code, table, pattern }),
  silverTables: (code: string) => get<{ code: string; name: string; tables: SilverTable[] }>(`/silver/${code}/`),
  silverRows: (code: string, table: string, show: 'passed' | 'rejected', page: number) =>
    get<SilverRows>(`/silver/${code}/rows/?table=${encodeURIComponent(table)}&show=${show}&page=${page}`),
  connectorFiles: (code: string) => get<UploadedFile[]>(`/connectors/${code}/files/`),
  setFileStatus: (code: string, ids: number[], status: UploadedFile['status']) =>
    post<{ changed: number; files: UploadedFile[] }>(`/connectors/${code}/files/status/`, { ids, status }),
  fileRemovePreview: (code: string, ids: number[]) =>
    get<FileRemoval>(`/connectors/${code}/files/remove/?ids=${ids.join(',')}`),
  removeFiles: (code: string, ids: number[]) =>
    post<FileRemoval & { files: UploadedFile[] }>(`/connectors/${code}/files/remove/`, { ids, confirm: true }),
  // Several CSVs at once. Each file is checked on its own; the answer lists what was kept and what was refused.
  uploadConnectorFiles: async (code: string, files: File[]): Promise<UploadResult[]> => {
    const form = new FormData()
    for (const f of files) form.append('files', f)
    const response = await fetchWhileWaking(`${ORG_BASE}/api/connectors/${code}/upload/`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json', 'X-CSRFToken': csrfToken() },
      body: form,
    })
    const data = await response.json().catch(() => ({}))
    if (Array.isArray(data.files)) return data.files as UploadResult[]
    throw new ApiError(response.status, data.detail ?? `Upload failed (${response.status})`)
  },

  // Customers
  // filters: the super filter as URL parameters (?kyc=overdue&country=India&country=Singapore).
  customers: (params: { search?: string; ordering?: string; page?: string }, filters = '') =>
    get<Page<CustomerSummary>>(`/customers/${withFilters(query(params), filters)}`),
  customerBreakdown: (by: string, filters = '') =>
    get<CustomerBreakdown>(`/customers/breakdown/${withFilters(query({ by }), filters)}`),
  customer: (id: number) => get<CustomerDetail>(`/customers/${id}/`),
  briefing: (id: number) => get<Briefing>(`/customers/${id}/briefing/`),
  interactions: (id: number) => get<Interaction[]>(`/customers/${id}/interactions/`),
  logInteraction: (id: number, body: NewInteraction) => post<Interaction>(`/customers/${id}/interactions/`, body),
  closeInteraction: (id: number, note: string) => post<Interaction>(`/interactions/${id}/close/`, { note }),
  openInteractions: () => get<Interaction[]>('/interactions/open/'),

  // Full PAN or CKYC number, with an audited reason (compliance officers and admins)
  reveal: (customerId: number, field: 'pan' | 'ckyc', reason: string) =>
    post<{ field: 'pan' | 'ckyc'; value: string }>(`/customers/${customerId}/reveal/`, { field, reason }),

  // Compliance
  compliance: (params: { status?: string; risk?: string }) => get<ComplianceQueue>(`/compliance/${query(params)}`),
  recordConsent: (customerId: number, body: { purpose: string; status: string; channel: string; note: string }) =>
    post<{ purpose: string; status: string }>(`/customers/${customerId}/consent/`, body),

  // Corrections (maker-checker)
  proposeCorrection: (customerId: number, body: { field: Field; value: string; evidence_ref: string; reason: string }) =>
    post<FieldCorrection>(`/customers/${customerId}/corrections/`, body),
  corrections: (params: { status?: string; customer?: string; page?: string }) =>
    get<Page<FieldCorrection>>(`/corrections/${query(params)}`),
  approveCorrection: (id: number) => post<FieldCorrection>(`/corrections/${id}/approve/`),
  rejectCorrection: (id: number, note: string) => post<FieldCorrection>(`/corrections/${id}/reject/`, { note }),

  // Audit log
  audit: (params: { action?: string; search?: string; page?: string }) =>
    get<Page<AuditEvent>>(`/audit/${query(params)}`),

  // CSV download: the server builds the file (and writes the audit entry).
  exportCustomers: async (): Promise<Blob> => {
    const response = await fetchWhileWaking(`${ORG_BASE}/api/customers/export/`, { credentials: 'same-origin' })
    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      throw new ApiError(response.status, data.detail ?? `Export failed (${response.status})`)
    }
    return response.blob()
  },

  // Match review
  suggestions: (status?: string) => get<Page<MatchSuggestion>>(`/suggestions/${query({ status })}`),
  acceptSuggestion: (id: number) => post<MatchSuggestion>(`/suggestions/${id}/accept/`),
  rejectSuggestion: (id: number) => post<MatchSuggestion>(`/suggestions/${id}/reject/`),
}
