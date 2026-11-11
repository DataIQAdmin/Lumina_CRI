// Shapes of the JSON our Django API returns. Keep in sync with backend/api/serializers.py.
// Decimals (trust, trust_score) arrive as strings like "0.85" so no precision is lost.

export type Field =
  | 'name'
  | 'father_name'
  | 'dob'
  | 'gender'
  | 'pan'
  | 'aadhaar'
  | 'ckyc'
  | 'mobile'
  | 'email'
  | 'address'
  | 'perm_address'
  | 'occupation'
  | 'income'
  | 'country'
  | 'residency'
export type Band = 'high' | 'medium' | 'low'

export interface Page<T> {
  count: number
  next: string | null
  previous: string | null
  results: T[]
}

export type Capability =
  | 'view_pii'
  | 'view_balances'
  | 'manage_sources'
  | 'view_matches'
  | 'decide_matches'
  | 'propose_corrections'
  | 'approve_corrections'
  | 'reveal_identity'
  | 'view_compliance'
  | 'record_consent'
  | 'export'
  | 'view_audit'
  | 'manage_users'
  | 'manage_settings'
  | 'manage_connectors'

export interface User {
  username: string
  name: string
  is_staff: boolean
  role: string | null
  role_label: string
  capabilities: Capability[]
  must_change_password: boolean // true after an administrator set a temporary password
}

export type RoleCode = 'relationship_manager' | 'agent' | 'steward' | 'compliance' | 'admin'

// A login in this organization, as its administrator sees it.
export interface OrgUser {
  id: number
  username: string
  first_name: string
  last_name: string
  name: string
  role: RoleCode | null
  role_label: string
  is_active: boolean
  last_login: string | null
  date_joined: string
  must_change_password: boolean
  temporary_password?: string // only in the reply that created it or reset it
}

export interface TrustSettings {
  sources: { code: string; name: string; category: string; trust: number; own_fields: number }[]
  weights: { field: string; label: string; points: number }[]
}

export interface AuditEvent {
  id: number
  at: string
  actor_name: string
  role: string
  action: string
  action_label: string
  target: string
  detail: Record<string, unknown>
  ip: string | null
}

export interface Source {
  code: string
  name: string
  category: string
  trust: string
  enabled: boolean
  last_synced_at: string | null
  record_count: number
  connector_type: string
  connector_label: string
  is_demo: boolean // built-in demo connector: not reconfigurable
  config: Record<string, string> // connection details without secrets
  mapping: ConnectorMapping | Record<string, never>
  has_secret: boolean // a password or token is stored (never sent to the browser)
  last_run: { status: 'ok' | 'failed'; at: string; fetched: number; error: string } | null
  sync_every_hours: 0 | 6 | 12 | 24 // scheduled sync; 0 = only when someone presses Sync
}

export interface ConnectorMapping {
  object: string
  id_column: string
  updated_column: string
  fields: Partial<Record<Field, string>>
  product_column?: string // CSV connectors: a column naming the customer's product(s)
  accounts?: AccountsMapping
  status?: 'active' | 'suspended' // the main table
  tables?: CustomerTable[] // customer tables added after the main one
}

// A customer table added to a database connector; its rows carry the table key in front of their IDs.
export interface CustomerTable {
  key: string
  object: string
  id_column: string
  updated_column: string
  fields: Partial<Record<Field, string>>
  status: 'active' | 'suspended'
}

export interface TableRemoval {
  tables: number
  records: number
  customers: number
  conversations: number
  corrections: number
}

export type AccountField = 'product_type' | 'product_name' | 'status' | 'opened_on' | 'balance'

// Optional second table: the customers' accounts, deposits, loans and cards.
export interface AccountsMapping {
  object: string
  id_column: string
  customer_column: string
  updated_column: string
  fields: Partial<Record<AccountField, string>>
}

export interface ConnectorField {
  name: string
  label: string
  kind: 'text' | 'number' | 'password' | 'select'
  required: boolean
  secret: boolean
  default: string
  help: string
  choices: [string, string][]
}

export interface ConnectorType {
  type: string
  label: string
  category: string
  description: string
  object_label: string
  available: boolean
  fields: ConnectorField[]
}

export interface SyncRun {
  id: number
  status: 'ok' | 'failed'
  started_at: string
  finished_at: string | null
  fetched: number
  created: number
  updated: number
  error: string
  started_by: string
}

export interface SyncResult {
  fetched: number
  created: number
  updated: number
  accounts: number | null // products read, when the connector has an accounts mapping
  retired?: number // records the system no longer sends, switched off
  customers: number
  new_suggestions: number
}

export interface CustomerSummary {
  id: number
  code: string
  name: string
  trust_score: string | null
  band: Band
  record_count: number
  sources: string[]
  source_names: string[] // display names, same order as sources
  conflict_fields: number
  kyc_status: 'verified' | 'due_soon' | 'overdue' | 'no_record'
  needs_review: number
  score_updated_at: string | null
}

export interface GoldenField {
  field: Field
  value: string
  trust: string
  conflicts: number
  source_code: string
  source_name: string
  source_record_id: number | null
  last_updated: string | null // when the source system says it last changed the record
  last_read?: string | null // when Lumina last read that record
  // Set when the value comes from an approved correction instead of a source system.
  correction: { id: number; evidence_ref: string; proposed_by: string; approved_by: string } | null
  guessed: boolean // worked out by Lumina from other details, not sent by any system
  score_trust: string | null // trust after agreement: other systems holding the same value raise it
}

export interface FieldCorrection {
  id: number
  customer: { id: number; code: string; name: string }
  field: Field
  value: string
  previous_value: string
  evidence_ref: string
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  proposed_by_name: string
  proposed_at: string
  decided_by_name: string
  decided_at: string | null
  decision_note: string
  mine: boolean // the signed-in user proposed it, so they cannot approve it
}

export interface SourceRecord {
  id: number
  source_code: string
  source_name: string
  source_trust: string
  field_trust?: Partial<Record<Field, string>> // this system's trust for each field
  source_enabled: boolean
  source_record_id: string
  name: string
  father_name: string
  dob: string | null
  gender: string
  pan: string // always masked, e.g. XXXXX1234X
  aadhaar: string // always masked, e.g. XXXX XXXX 4521
  ckyc: string // always masked
  mobile: string
  email: string
  address: string
  perm_address: string
  country: string
  residency: string
  occupation: string
  income: string
  source_updated_at: string | null
  match_reason: string
  // Per field: true = agrees with the golden record, false = differs, null = not held. Worked out by
  // the server, because masked or encrypted values cannot be compared in the browser.
  agreement?: Partial<Record<Field, boolean | null>>
}

export type ProductType =
  | 'savings' | 'current' | 'deposit' | 'home_loan' | 'personal_loan' | 'vehicle_loan' | 'loan' | 'credit_card' | 'other'

export interface Product {
  id: number
  type: ProductType
  type_label: string
  name: string
  account: string // last four characters only, e.g. "XX1234"
  status: 'active' | 'overdue' | 'dormant' | 'closed'
  opened_on: string | null
  balance: string | null // null when the role may not see amounts
  source_code: string
  source_name: string
  updated_at: string
}

export interface Products {
  amounts_hidden: boolean
  count: number // not closed
  overdue: number
  dormant: number
  deposits: string | null
  owed: string | null
  items: Product[]
}

export interface CustomerDetail extends CustomerSummary {
  products: Products
  golden: GoldenField[]
  records: SourceRecord[]
  weights: Partial<Record<Field, string>>
  masked: boolean // mobile, email and date of birth were hidden for this user's role
  corrections: FieldCorrection[]
  compliance: {
    kyc_status: 'verified' | 'due_soon' | 'overdue' | 'no_record'
    re_kyc_due: string | null
    has_pan: boolean
    consents: {
      purpose: string
      label: string
      status: 'granted' | 'revoked' | 'pending' | 'unknown'
      channel: string
      recorded_by: string
      recorded_at: string | null
    }[]
    // Only for compliance roles; null for everyone else
    aml: {
      risk: 'low' | 'medium' | 'high'
      risk_reason: string
      last_kyc: string
      pep: boolean
      pep_note: string
      sanctions: 'clear' | 'potential_match'
      sanctions_checked: string | null
    } | null
  }
}

export type Channel = 'call' | 'branch' | 'email' | 'whatsapp' | 'chat' | 'sms'
export type InteractionKind = 'query' | 'request' | 'complaint' | 'sales' | 'feedback'
export type Outcome = 'resolved' | 'follow_up' | 'escalated'

export interface Interaction {
  id: number
  channel: Channel
  channel_label: string
  inbound: boolean
  kind: InteractionKind
  kind_label: string
  summary: string // card and identity numbers already masked by the server
  outcome: Outcome
  outcome_label: string
  follow_up_on: string | null
  state: 'open' | 'closed'
  created_at: string
  created_by: string
  closed_at: string | null
  closed_by: string
  closing_note: string
  customer?: { id: number; code: string; name: string } // only in the open items list
}

export interface NewInteraction {
  channel: Channel
  kind: InteractionKind
  summary: string
  outcome: Outcome
  inbound: boolean
  follow_up_on?: string
}

export interface BriefingAlert {
  level: 'bad' | 'warn' | 'info'
  title: string
  action: string
  kind: string
}

export interface Briefing {
  headline: string
  alerts: BriefingAlert[]
  talking_points: string[]
  last_contact: { at: string; channel: string; by: string; summary: string } | null
  contacts_last_90_days: number
  open_items: number
}

export interface ComplianceQueue {
  summary: {
    customers: number
    overdue: number
    due_soon: number
    verified: number
    no_record: number
    high_risk: number
    medium_risk: number
    low_risk: number
    pep: number
    sanctions_review: number
  }
  results: {
    id: number
    code: string
    name: string
    trust_score: string | null
    kyc_status: string
    re_kyc_due: string | null
    last_kyc: string | null
    risk: 'low' | 'medium' | 'high' | null
    risk_reason: string
    pep: boolean
    sanctions: 'clear' | 'potential_match' | null
  }[]
}

export interface Overview {
  customers: number
  source_records: number
  average_trust: string
  bands: Record<Band, number>
  histogram: { from: number; to: number; count: number }[]
  pending_reviews: number
  pending_corrections: number
  last_synced_at: string | null
  sources: Source[]
  lowest_trust: CustomerSummary[]
  scores: { id: number; code: string; name: string; score: string }[]
  conflicts_by_field: { field: Field; customers: number }[]
  source_agreement: { code: string; name: string; trust: string; held: number; matched: number }[]
}

export interface Reference {
  roles: { role: string; label: string; capabilities: Capability[] }[]
  weights: Partial<Record<Field, string>>
  sources: { code: string; name: string; trust: string; enabled: boolean }[]
  matching: {
    points_pan: number
    points_mobile: number
    points_email: number
    points_dob: number
    points_name_max: number
    match_threshold: number
    review_threshold: number
    min_name_similarity: number
  }
  bands: { medium: string; high: string }
  correction_trust: string
}

export interface MatchSuggestion {
  id: number
  points: number
  reason: string
  status: 'pending' | 'accepted' | 'rejected'
  created_at: string
  decided_at: string | null
  record_a: SourceRecord
  record_b: SourceRecord
  customer_a: { id: number; code: string } | null
  customer_b: { id: number; code: string } | null
}

// A CSV uploaded to a file-upload connector. A sync reads every active file; the newest wins on the same ID.
export interface UploadedFile {
  id: number
  name: string
  rows: number
  status: 'active' | 'suspended'
  uploaded_at: string
  uploaded_by: string
}

export interface UploadResult {
  name: string
  ok: boolean
  rows?: number
  error?: string
  missing?: string[] // mapped columns this file does not have
  new_columns?: string[] // columns no earlier file had
  lumina_ids?: boolean // its IDs look like Lumina's own customer IDs (C-10168)
}

export interface FileRemoval {
  files: number
  records: number
  customers: number
  conversations: number
  corrections: number
}

// Data profiling: how each column's values look as the source systems sent them.
export interface ProfileCheck {
  key: string // e.g. "mobile.digits"
  column: string // "Mobile"
  label: string // "Number of digits"
  records: number
  values: { value: string; count: number; share: number }[]
}

export interface ProfilingSummary {
  records: number
  profiled: number // records synced since profiling started; the rest get their checks at the next sync
  checks: ProfileCheck[]
  sources: { code: string; name: string }[]
}

export interface ProfiledRecord {
  id: number
  source_code: string
  source_name: string
  record_id: string
  values: Partial<Record<Field, string>>
  checks: Record<string, string>
  customer: { id: number; code: string } | null
}

export interface ProfiledRecords {
  count: number
  page: number
  page_size: number
  masked: boolean
  results: ProfiledRecord[]
}

// Trust per field for one connector: the fields it supplies and how much each is trusted (0-100).
export interface FieldTrust {
  code: string
  name: string
  default: number // used for fields without their own value
  fields: { field: Field; label: string; trust: number; own: boolean }[]
}

// Customer breakdown (Customers page): how many customers in each group of one fact, after the filters.
export interface BreakdownGroup {
  key: string
  label: string
  count: number
  share: number
  members?: string[] // "Other" countries: the countries it stands for
}

export interface CustomerBreakdown {
  by: string
  total: number // customers matching the filters
  all: number // every customer
  groups: BreakdownGroup[]
  filters: Record<string, string[]>
  dimensions: { key: string; label: string }[]
  options: Record<string, { key: string; label: string; count: number; members?: string[] }[]>
}

// Bronze layer (Data profiling): the tables of a connector, profiled when chosen.
export interface RawSource {
  code: string
  name: string
  connector_type: string
  enabled: boolean
  tables: number
  read_at: string | null
}

export interface RawSources {
  sources: RawSource[]
  can_read: boolean
  can_view_rows: boolean
}

export interface RawTable {
  name: string
  columns: number
  rows: number
  complete: boolean
  sensitive: string[]
  read_at: string
  filled?: number // % of the table's values that are filled
  to_check?: number // columns with empty values, mixed lengths or too-long emails
  mixed: number // columns with mixed lengths
  with_empty: number // columns with empty values
}

export interface Pipeline {
  connectors: number
  tables: number
  rules: number
  silver: number
}

export interface ColumnCounts {
  name: string
  filled: number
  empty: number
  unique: number
  counts: { label: string; count: number }[]
  values?: { label: string; count: number }[] // absent on tables profiled before value counts existed
}

export interface RawTableProfile extends RawTable {
  profile: { rows: number; columns: ColumnCounts[] }
}

// Rules: one regex per column; only rows passing all of them reach silver (backend ingestion/rules.py).
export interface RegexCheck {
  valid: boolean
  error: string
}

export interface RuleColumns {
  name: string
  rows: number
  columns: { name: string; pattern: string; passed?: number; total?: number }[]
}

// What the AI helper suggests for a column, already checked and tested there (backend ingestion/regex_ai.py).
export interface RegexSuggestion {
  pattern: string
  explanation: string
  matching: string[] // made-up examples, checked: they pass
  failing: { value: string; why: string }[] // made-up examples, checked: they fail
  passed: number
  failed: number
  total: number
}

// The rows behind one count of the profile ("9 digits", "Empty"...), the proof that the count is real.
export interface CountProof {
  column: string
  label: string
  key: string // the table's first column, usually its ID
  count: number
  page: number
  page_size: number
  results: { row: number; key: unknown; value: unknown }[]
}

export interface RulePreview {
  total: number
  passed: number
  failed: number
  sample: { position: number; value: unknown; passed: boolean }[]
}

export interface ReadyRegex {
  name: string
  pattern: string
  group: string // Identity, Contact, Codes, Dates...
  example: string
  bad: [string, string] // a value that fails, and why
  hints: string[]
}

export interface SavedRegex {
  id: number
  name: string
  pattern: string
}

export interface RegexLibrary {
  ready: ReadyRegex[]
  saved: SavedRegex[]
  patterns: { pattern: string; used: { code: string; source: string; table: string; column: string }[] }[]
  tables: { code: string; source: string; table: string }[]
}

export interface SilverTable {
  name: string
  rows: number
  rules: number
  passed: number
  rejected: number
  read_at: string
}

export interface SilverRows {
  column_names: string[]
  rules: Record<string, string>
  page: number
  page_size: number
  count: number
  passed: number
  rejected: number
  reasons: { column: string; rows: number }[]
  results: { position: number; values: unknown[]; failed: string[] }[]
}
