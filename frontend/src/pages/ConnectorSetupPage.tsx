import { useEffect, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'

import { api } from '../api/client'
import type { AccountField, AccountsMapping, ConnectorMapping, ConnectorType, CustomerTable, Field, Source, TableRemoval } from '../api/types'
import { useApi } from '../api/useApi'
import { useCan } from '../auth/AuthContext'
import { ConnectorFields } from '../components/ConnectorFields'
import { ConnectorLogo } from '../components/ConnectorLogo'
import { DeleteConnectorCard } from '../components/DeleteConnectorCard'
import { FieldTrustStep } from '../components/FieldTrustStep'
import { UploadedFilesCard } from '../components/UploadedFilesCard'
import { Icon } from '../components/Icon'
import { Loader, LoaderRow } from '../components/Loader'
import { useToast } from '../components/Toasts'
import { Card, ErrorAlert, PageHeader, StatusBadge } from '../components/ui'
import { FIELD_LABELS, FIELDS, formatDateTime } from '../format'

// Guesses which column feeds which Lumina field from its name ("MOB_NO" -> Mobile). Only a suggestion:
// the administrator confirms every choice before saving.
const GUESS: Record<Field | 'id' | 'updated', { has: string[]; not?: string[] }> = {
  name: { has: ['fullname', 'custname', 'customername', 'name'], not: ['father', 'first', 'last', 'user', 'file', 'branch'] },
  father_name: { has: ['father'] },
  dob: { has: ['dob', 'birth'] },
  gender: { has: ['gender', 'sex'] },
  pan: { has: ['pan'], not: ['company', 'span'] },
  aadhaar: { has: ['aadhaar', 'aadhar', 'uid'] },
  ckyc: { has: ['ckyc'] },
  mobile: { has: ['mobile', 'mob', 'phone', 'cell'] },
  email: { has: ['email', 'mail'] },
  address: { has: ['address', 'addr'], not: ['perm', 'email', 'mail'] },
  perm_address: { has: ['permaddr', 'permanent', 'perm'] },
  occupation: { has: ['occupation', 'job', 'title', 'profession'] },
  income: { has: ['income', 'salary'] },
  country: { has: ['country', 'nation', 'cntry'] },
  residency: { has: ['residency', 'residenttype', 'residentstatus', 'resstatus', 'resident', 'nristatus'] },
  id: { has: ['custid', 'customerid', 'refno', 'ref', 'id', 'code'], not: ['pan', 'ckyc', 'aadhaar', 'email'] },
  updated: { has: ['updated', 'modified', 'lastupd', 'changed'] },
}

// The same kind of guess for the optional accounts table.
const ACCOUNT_GUESS: Record<AccountField | 'account' | 'customer' | 'updated', { has: string[]; not?: string[] }> = {
  account: { has: ['acctno', 'accountno', 'accountnumber', 'loanaccount', 'acct', 'account'], not: ['cust', 'type', 'status'] },
  customer: { has: ['custid', 'customerid', 'custno', 'cust', 'customer'] },
  product_type: { has: ['producttype', 'productcode', 'loantype', 'accttype', 'accounttype', 'type', 'code'], not: ['cust', 'branch'] },
  product_name: { has: ['productname', 'productdesc', 'scheme', 'description', 'desc', 'product'], not: ['code', 'type'] },
  status: { has: ['status', 'state'] },
  opened_on: { has: ['opendate', 'opened', 'open', 'disburs', 'startdate', 'since'] },
  balance: { has: ['balance', 'outstanding', 'principal', 'amount', 'amt'], not: ['emi', 'limit'] },
  updated: { has: ['updated', 'modified', 'lasttxn', 'lastupd', 'changed'] },
}
const ACCOUNT_LABELS: Record<AccountField, [string, string]> = {
  product_type: ['Product type', 'A code or word, e.g. SB, HL, Credit card'],
  product_name: ['Product name', "The bank's own name, e.g. Prime Savings"],
  status: ['Status', 'Active, overdue, dormant or closed'],
  opened_on: ['Opened on', ''],
  balance: ['Balance or amount owed', 'Rupees'],
}
const ACCOUNT_FIELDS = Object.keys(ACCOUNT_LABELS) as AccountField[]

function guess(key: keyof typeof GUESS, columns: string[]): string {
  return pick(GUESS[key], columns)
}

function pick(rule: { has: string[]; not?: string[] }, columns: string[]): string {
  const norm = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, '')
  for (const word of rule.has) {
    const hit = columns.find((c) => norm(c).includes(word) && !(rule.not ?? []).some((n) => norm(c).includes(n)))
    if (hit) return hit
  }
  return ''
}

export function ConnectorSetupPage() {
  const { code = '' } = useParams()
  const source = useApi(() => api.sources().then((p) => p.results.find((s) => s.code === code) ?? null), [code])
  const catalog = useApi(() => api.connectorCatalog(), [])

  const s = source.data
  const type = catalog.data?.find((t) => t.type === s?.connector_type)

  return (
    <>
      <PageHeader
        title={
          s ? (
            <span className="title-with-logo">
              <ConnectorLogo type={s.connector_type} size={36} />
              {s.name}
            </span>
          ) : (
            'Connector'
          )
        }
        description={
          type?.type === 'push_api'
            ? 'Your own systems send customers to Lumina with an API key.'
            : type
              ? `${type.label} connector. Lumina only reads, and only the columns you map.`
              : undefined
        }
        crumbs={[{ label: 'Connectors', to: '/connectors' }, { label: s?.name ?? '...' }]}
      />
      {(source.error || catalog.error) && <ErrorAlert message={source.error ?? catalog.error ?? ''} />}
      {/* useApi starts with null too, so only say "no connector" once the list has loaded without it. */}
      {!source.loading && !source.error && source.data === null && <ErrorAlert message="No connector with this code." />}
      {!s || !catalog.data ? (
        (source.loading || source.data !== null) && (
          <div className="card">
            <Loader kind="orbit" label="Loading the connector" />
          </div>
        )
      ) : s.is_demo || !type ? (
        <>
          <Card title="Built-in demo connector">
            <p className="muted">This demo connector reads Lumina&apos;s sample data and cannot be reconfigured.</p>
          </Card>
          <DeleteConnectorCard source={s} onChanged={source.reload} />
        </>
      ) : (
        <>
          <SetupSteps source={s} type={type} onChanged={source.reload} />
          <DeleteConnectorCard source={s} onChanged={source.reload} />
        </>
      )}
    </>
  )
}

// Connector types that can read customers from several tables or collections.
const MULTI_TABLE = ['postgresql', 'mysql', 'mongodb', 'snowflake', 'databricks', 'servicenow', 'salesforce', 'cloudera']

function SetupSteps({ source, type, onChanged }: { source: Source; type: ConnectorType; onChanged: () => void }) {
  // Bumped after files change, so the mapping step reads the columns again.
  const [filesVersion, setFilesVersion] = useState(0)
  if (type.type === 'push_api') {
    return (
      <>
        <ApiKeyStep source={source} onChanged={onChanged} />
        <FieldTrustStep source={source} title={<StepTitle n={2} text="Trust" />} onChanged={onChanged} />
        <SyncStep source={source} onChanged={onChanged} push n={3} />
      </>
    )
  }
  return (
    <>
      {type.type === 'file_upload' ? (
        <UploadedFilesCard
          source={source}
          title={<StepTitle n={1} text="Files" />}
          onChanged={() => {
            setFilesVersion((v) => v + 1)
            onChanged()
          }}
        />
      ) : (
        <ConnectionStep source={source} type={type} onChanged={onChanged} />
      )}
      <MappingStep source={source} type={type} onChanged={onChanged} refresh={filesVersion} />
      {MULTI_TABLE.includes(type.type) && 'object' in source.mapping && (
        <CustomerTablesCard source={source} type={type} onChanged={onChanged} />
      )}
      {type.type !== 'file_upload' && <AccountsStep source={source} type={type} onChanged={onChanged} />}
      <FieldTrustStep
        source={source}
        title={<StepTitle n={type.type === 'file_upload' ? 3 : 4} text="Trust" />}
        onChanged={onChanged}
      />
      <SyncStep source={source} onChanged={onChanged} n={type.type === 'file_upload' ? 4 : 5} />
    </>
  )
}

function StepTitle({ n, text }: { n: number; text: string }) {
  return (
    <span className="row" style={{ gap: 10 }}>
      <span className="step-n">{n}</span>
      {text}
    </span>
  )
}

function ConnectionStep({ source, type, onChanged }: { source: Source; type: ConnectorType; onChanged: () => void }) {
  const toast = useToast()
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(type.fields.map((f) => [f.name, f.secret ? '' : (source.config[f.name] ?? f.default)])),
  )
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; detail: string } | null>(null)

  const save = async () => {
    setBusy('save')
    try {
      await api.updateConnector(source.code, { settings: values })
      setValues((v) => Object.fromEntries(Object.entries(v).map(([k, val]) => [k, type.fields.find((f) => f.name === k)?.secret ? '' : val])))
      toast('success', 'Connection details saved.')
      onChanged()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const test = async () => {
    setBusy('test')
    setResult(null)
    try {
      setResult(await api.testConnector(source.code))
    } catch (e) {
      setResult({ ok: false, detail: (e as Error).message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card
      title={<StepTitle n={1} text="Connection" />}
      description="Use a read-only login that can see only the customer table or view."
      footer={
        <>
          {result ? (
            <span className="row text-sm" style={{ gap: 8, color: result.ok ? 'var(--good-text)' : 'var(--bad-text)' }}>
              <Icon name={result.ok ? 'check' : 'alert'} size={16} /> {result.detail}
            </span>
          ) : (
            <span className="text-sm muted">Save, then test the connection.</span>
          )}
          <div className="row" style={{ gap: 8 }}>
            <button type="button" className="btn" disabled={busy !== null} onClick={save}>
              {busy === 'save' ? 'Saving...' : 'Save'}
            </button>
            <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={test}>
              <Icon name="refresh" size={16} className={busy === 'test' ? 'spin' : undefined} />
              {busy === 'test' ? 'Testing...' : 'Test connection'}
            </button>
          </div>
        </>
      }
    >
      <div className="form-grid">
        <ConnectorFields fields={type.fields} values={values} onChange={setValues} secretStored={source.has_secret} />
      </div>
    </Card>
  )
}

function MappingStep({
  source,
  type,
  onChanged,
  refresh = 0,
}: {
  source: Source
  type: ConnectorType
  onChanged: () => void
  refresh?: number
}) {
  const toast = useToast()
  const saved = 'object' in source.mapping ? (source.mapping as ConnectorMapping) : null
  return (
    <TableEditor
      source={source}
      type={type}
      saved={saved}
      title={<StepTitle n={2} text="What to read" />}
      description="Choose where customers are, then match its columns to Lumina's fields. Unmapped columns are never read."
      refresh={refresh}
      onSave={async (mapping) => {
        await api.saveMapping(source.code, mapping)
        toast('success', 'Mapping saved. Sync to read the customers.')
        onChanged()
      }}
    />
  )
}

// Picks a table or collection and maps its columns to Lumina's fields. Used for the main table and added ones.
function TableEditor({
  source,
  type,
  saved,
  title,
  description,
  onSave,
  onCancel,
  refresh = 0,
}: {
  source: Source
  type: ConnectorType
  saved: ConnectorMapping | null
  title: ReactNode
  description: string
  refresh?: number
  onSave: (mapping: ConnectorMapping) => Promise<void>
  onCancel?: () => void
}) {
  const [objects, setObjects] = useState<string[] | null>(null)
  const [object, setObject] = useState(saved?.object ?? '')
  const [columns, setColumns] = useState<string[] | null>(null)
  const [mapping, setMapping] = useState<ConnectorMapping>(
    saved ?? { object: '', id_column: '', updated_column: '', fields: {} },
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const discover = () =>
    run('objects', async () => {
      const found = (await api.discoverObjects(source.code)).objects
      setObjects(found)
      if (!object && found.length === 1) setObject(found[0])
    })

  const loadColumns = (target = object) =>
    run('columns', async () => {
      const cols = (await api.discoverColumns(source.code, target)).columns
      setColumns(cols)
      setMapping((m) => {
        const sameObject = m.object === target
        const fields: Partial<Record<Field, string>> = sameObject ? { ...m.fields } : {}
        for (const f of FIELDS) if (!fields[f]) fields[f] = guess(f, cols)
        return {
          object: target,
          id_column: (sameObject && m.id_column) || guess('id', cols),
          updated_column: (sameObject && m.updated_column) || guess('updated', cols),
          fields,
          ...(type.type === 'file_upload'
            ? { product_column: (sameObject && m.product_column) || cols.find((c) => /product/i.test(c)) || '' }
            : {}),
        }
      })
    })

  // CSV files: read the columns straight away, and again whenever files are uploaded, suspended or removed, so
  // the lists below always offer every column the active files have. (Databases are only read on request.)
  const isFiles = type.type === 'file_upload'
  useEffect(() => {
    if (isFiles && object) loadColumns(object)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFiles, refresh])

  const save = () => run('save', () => onSave(mapping))

  const setField = (f: Field, column: string) => setMapping((m) => ({ ...m, fields: { ...m.fields, [f]: column } }))
  const columnSelect = (value: string, onChange: (v: string) => void, label: string, emptyText: string) => (
    <select className="select select-sm" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyText}</option>
      {columns?.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )

  return (
    <Card
      title={title}
      description={description}
      footer={
        (columns || onCancel) && (
          <>
            <span className="text-sm muted">
              {columns ? `${Object.values(mapping.fields).filter(Boolean).length} of ${FIELDS.length} fields mapped` : ''}
            </span>
            {onCancel && (
              <button type="button" className="btn" disabled={busy !== null} onClick={onCancel}>
                Cancel
              </button>
            )}
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null || !mapping.id_column || !mapping.fields.name}
              onClick={save}
            >
              <Icon name="check" size={16} /> {busy === 'save' ? 'Saving...' : 'Save mapping'}
            </button>
          </>
        )
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        {error && <ErrorAlert message={error} />}
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn" disabled={busy !== null} onClick={discover}>
            <Icon name="search" size={16} /> {busy === 'objects' ? 'Looking...' : 'Discover'}
          </button>
          {(objects || object) && (
            <select
              className="select"
              aria-label={type.object_label}
              value={object}
              onChange={(e) => {
                setObject(e.target.value)
                setColumns(null)
              }}
            >
              <option value="">Choose {type.object_label.toLowerCase()}</option>
              {(objects ?? [object]).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          {object && (
            <button type="button" className="btn" disabled={busy !== null} onClick={() => loadColumns()}>
              {busy === 'columns' ? 'Reading columns...' : columns ? 'Reload columns' : 'Show columns'}
            </button>
          )}
        </div>

        {busy === 'objects' && <Loader kind="rows" label="Looking for tables" size={44} />}
        {busy === 'columns' && <Loader kind="rows" label="Reading the columns" size={44} />}

        {columns && (
          <div className="mapping-grid">
            <div className="mapping-row is-key">
              <span>
                <strong>Record ID</strong>
                <span className="text-xs muted">Required. Never changes for a customer.</span>
              </span>
              {columnSelect(mapping.id_column, (v) => setMapping((m) => ({ ...m, id_column: v })), 'Record ID column', 'Choose...')}
              {mapping.id_column === '_id' && (
                <span className="mapping-warn" role="note">
                  MongoDB's own _id changes whenever the data is reloaded, so the same customer would come in again
                  under a new ID. Choose your own customer ID column if there is one.
                </span>
              )}
            </div>
            <div className="mapping-row is-key">
              <span>
                <strong>Last updated</strong>
                <span className="text-xs muted">Optional. The newest value wins a tie.</span>
              </span>
              {columnSelect(mapping.updated_column, (v) => setMapping((m) => ({ ...m, updated_column: v })), 'Last updated column', 'Not available')}
            </div>
            {FIELDS.map((f) => (
              <div key={f} className="mapping-row">
                <span>
                  {FIELD_LABELS[f]}
                  {f === 'name' && <span className="muted"> (required)</span>}
                </span>
                {columnSelect(mapping.fields[f] ?? '', (v) => setField(f, v), `Column for ${FIELD_LABELS[f]}`, 'Not in this source')}
              </div>
            ))}
            {isFiles && (
              <div className="mapping-row">
                <span>
                  Product
                  <span className="text-xs muted"> Optional. e.g. Savings, Home Loan; several can be separated by ;</span>
                </span>
                {columnSelect(
                  mapping.product_column ?? '',
                  (v) => setMapping((m) => ({ ...m, product_column: v })),
                  'Column for Product',
                  'Not in these files',
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  )
}

// Database connectors: every customer table the connector reads. The main table is the one mapped above; more
// can be added, each with its own mapping. Suspend hides the customers only those tables hold (Resume brings
// them back with the same IDs); Remove deletes an added table's customers after showing what goes.
function CustomerTablesCard({ source, type, onChanged }: { source: Source; type: ConnectorType; onChanged: () => void }) {
  const toast = useToast()
  const main = source.mapping as ConnectorMapping
  const tables: CustomerTable[] = [
    { key: 'main', object: main.object, id_column: main.id_column, updated_column: main.updated_column,
      fields: main.fields, status: main.status ?? 'active' },
    ...(main.tables ?? []),
  ]
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<CustomerTable | 'new' | null>(null)
  const [removal, setRemoval] = useState<TableRemoval | null>(null)
  const [busy, setBusy] = useState<'status' | 'look' | 'remove' | null>(null)

  const chosen = tables.filter((t) => selected.includes(t.key))
  const toggle = (key: string) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]))

  const act = async (label: 'status' | 'look' | 'remove', work: () => Promise<void>) => {
    setBusy(label)
    try {
      await work()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const setStatus = (status: 'active' | 'suspended') =>
    act('status', async () => {
      const out = await api.setTableStatus(source.code, selected, status)
      const n = `${out.changed} table${out.changed === 1 ? '' : 's'}`
      toast('success', status === 'suspended'
        ? `${n} suspended. Customers found only there are hidden.`
        : `${n} resumed. Their customers are back, with the same IDs.`)
      setSelected([])
      onChanged()
    })

  const look = () => act('look', async () => setRemoval(await api.tableRemovePreview(source.code, selected)))

  const remove = () =>
    act('remove', async () => {
      const out = await api.removeTables(source.code, selected)
      toast('success', `${out.tables} table${out.tables === 1 ? '' : 's'} removed.`)
      setSelected([])
      setRemoval(null)
      onChanged()
    })

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

  if (editing) {
    const isNew = editing === 'new'
    return (
      <TableEditor
        source={source}
        type={type}
        saved={isNew ? null : editing}
        title={isNew ? 'Add another customer table' : `Change ${editing.object}`}
        description="Pick the table and match its columns. Its customers are read next to the main table's; IDs from this table never clash with the main table's."
        onCancel={() => setEditing(null)}
        onSave={async (mapping) => {
          await api.saveCustomerTable(source.code, { ...mapping, key: isNew ? undefined : editing.key })
          toast('success', isNew ? 'Table added. Sync to read its customers.' : 'Table mapping saved.')
          setEditing(null)
          onChanged()
        }}
      />
    )
  }

  return (
    <Card
      title="Customer tables"
      description="Every table this connector reads customers from. Add more when customers are split across tables, for example retail and corporate."
      actions={
        <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}>
          <Icon name="search" size={14} /> Add another table
        </button>
      }
      flush
    >
      <div className="files-toolbar">
        <span className="text-sm muted">
          {selected.length ? `${selected.length} selected` : 'Select tables to suspend, resume or remove'}
        </span>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-sm" disabled={busy !== null || !chosen.some((t) => t.status === 'active')} onClick={() => setStatus('suspended')}>
            <Icon name="power" size={14} /> Suspend
          </button>
          <button type="button" className="btn btn-sm" disabled={busy !== null || !chosen.some((t) => t.status === 'suspended')} onClick={() => setStatus('active')}>
            <Icon name="refresh" size={14} /> Resume
          </button>
          <button
            type="button"
            className="btn btn-sm btn-danger-ghost"
            disabled={busy !== null || !selected.length || selected.includes('main')}
            title={selected.includes('main') ? 'The main table cannot be removed; suspend it or delete the connector.' : undefined}
            onClick={look}
          >
            <Icon name="x" size={14} /> {busy === 'look' ? 'Checking...' : 'Remove...'}
          </button>
        </div>
      </div>

      {removal && (
        <div className="files-removal" role="alert">
          <p>
            Removing {plural(removal.tables, 'table')} deletes {plural(removal.records, 'customer row')} read from it,
            and {plural(removal.customers, 'customer')} no other table or system knows, with their{' '}
            {plural(removal.conversations, 'conversation')} and {plural(removal.corrections, 'correction')}. This cannot
            be undone; Suspend can.
          </p>
          <div className="row" style={{ gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={() => setRemoval(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-sm btn-danger" disabled={busy !== null} onClick={remove}>
              {busy === 'remove' ? 'Removing...' : 'Remove for good'}
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="table" style={{ minWidth: 620 }}>
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              <th>{type.object_label}</th>
              <th>Record ID</th>
              <th className="num">Fields</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.key} className={t.status === 'suspended' ? 'is-muted' : undefined}>
                <td>
                  <input type="checkbox" aria-label={`Select ${t.object}`} checked={selected.includes(t.key)} onChange={() => toggle(t.key)} />
                </td>
                <td>
                  <span className="mono">{t.object}</span>
                  {t.key === 'main' && <span className="text-xs muted"> · main</span>}
                </td>
                <td className="mono text-sm">{t.id_column}</td>
                <td className="num">{Object.values(t.fields).filter(Boolean).length}</td>
                <td>
                  <StatusBadge tone={t.status === 'active' ? 'good' : 'neutral'}>
                    {t.status === 'active' ? 'Active' : 'Suspended'}
                  </StatusBadge>
                </td>
                <td className="right">
                  {t.key !== 'main' && (
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(t)}>
                      <Icon name="sliders" size={14} /> Change
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

function AccountsStep({ source, type, onChanged }: { source: Source; type: ConnectorType; onChanged: () => void }) {
  const toast = useToast()
  const customers = 'object' in source.mapping ? (source.mapping as ConnectorMapping) : null
  const saved = customers?.accounts ?? null
  const empty: AccountsMapping = { object: '', id_column: '', customer_column: '', updated_column: '', fields: {} }
  const [open, setOpen] = useState(Boolean(saved))
  const [objects, setObjects] = useState<string[] | null>(null)
  const [columns, setColumns] = useState<string[] | null>(null)
  const [mapping, setMapping] = useState<AccountsMapping>(saved ?? empty)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (label: string, work: () => Promise<void>) => {
    setBusy(label)
    setError(null)
    try {
      await work()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const discover = () =>
    run('objects', async () => {
      const found = (await api.discoverObjects(source.code)).objects
      setObjects(found.filter((o) => o !== customers?.object))
    })

  const loadColumns = (target = mapping.object) =>
    run('columns', async () => {
      const cols = (await api.discoverColumns(source.code, target)).columns
      setColumns(cols)
      setMapping((m) => {
        const same = m.object === target
        const fields: Partial<Record<AccountField, string>> = same ? { ...m.fields } : {}
        for (const f of ACCOUNT_FIELDS) if (!fields[f]) fields[f] = pick(ACCOUNT_GUESS[f], cols)
        return {
          object: target,
          id_column: (same && m.id_column) || pick(ACCOUNT_GUESS.account, cols),
          customer_column: (same && m.customer_column) || pick(ACCOUNT_GUESS.customer, cols),
          updated_column: (same && m.updated_column) || pick(ACCOUNT_GUESS.updated, cols),
          fields,
        }
      })
    })

  const save = () =>
    run('save', async () => {
      await api.saveAccountsMapping(source.code, mapping)
      toast('success', 'Accounts mapping saved. Sync to read the products.')
      onChanged()
    })

  const remove = () =>
    run('remove', async () => {
      await api.removeAccountsMapping(source.code)
      setMapping(empty)
      setColumns(null)
      setOpen(false)
      toast('success', 'Lumina no longer reads accounts from this connector. Its products were removed.')
      onChanged()
    })

  const columnSelect = (value: string, onChange: (v: string) => void, label: string, emptyText: string) => (
    <select className="select select-sm" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{emptyText}</option>
      {columns?.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  )

  const ready = Boolean(
    mapping.id_column && mapping.customer_column && (mapping.fields.product_type || mapping.fields.product_name),
  )

  return (
    <Card
      title={<StepTitle n={3} text="Accounts and products (optional)" />}
      description="If this system also keeps accounts, deposits, loans or cards, choose that table. Each row needs the customer's ID from step 2."
      actions={
        saved && (
          <button type="button" className="btn btn-sm" disabled={busy !== null} onClick={remove}>
            {busy === 'remove' ? 'Removing...' : 'Stop reading accounts'}
          </button>
        )
      }
      footer={
        columns && (
          <>
            <span className="text-sm muted">Account numbers are kept as their last four only.</span>
            <button type="button" className="btn btn-primary" disabled={busy !== null || !ready} onClick={save}>
              <Icon name="check" size={16} /> {busy === 'save' ? 'Saving...' : 'Save accounts mapping'}
            </button>
          </>
        )
      }
    >
      {!customers ? (
        <p className="muted">Map the customers first.</p>
      ) : !open ? (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          <Icon name="file" size={16} /> Add an accounts table
        </button>
      ) : (
        <div className="stack" style={{ gap: 16 }}>
          {error && <ErrorAlert message={error} />}
          {saved && !columns && (
            <p className="text-sm">
              Reading <span className="mono">{saved.object}</span>. Show its columns to change the mapping.
            </p>
          )}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn" disabled={busy !== null} onClick={discover}>
              <Icon name="search" size={16} /> {busy === 'objects' ? 'Looking...' : 'Discover'}
            </button>
            {(objects || mapping.object) && (
              <select
                className="select"
                aria-label={`Accounts ${type.object_label.toLowerCase()}`}
                value={mapping.object}
                onChange={(e) => {
                  setMapping({ ...empty, object: e.target.value })
                  setColumns(null)
                }}
              >
                <option value="">Choose {type.object_label.toLowerCase()}</option>
                {(objects ?? [mapping.object]).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
            {mapping.object && (
              <button type="button" className="btn" disabled={busy !== null} onClick={() => loadColumns()}>
                {busy === 'columns' ? 'Reading columns...' : columns ? 'Reload columns' : 'Show columns'}
              </button>
            )}
          </div>

          {busy === 'columns' && <Loader kind="pair" label="Reading the columns" size={44} />}

          {columns && (
            <div className="mapping-grid">
              <div className="mapping-row is-key">
                <span>
                  <strong>Account number</strong>
                  <span className="text-xs muted">Required. One per account.</span>
                </span>
                {columnSelect(mapping.id_column, (v) => setMapping((m) => ({ ...m, id_column: v })), 'Account number column', 'Choose...')}
              </div>
              <div className="mapping-row is-key">
                <span>
                  <strong>Customer ID</strong>
                  <span className="text-xs muted">Required. The same ID as the customer&apos;s record ID.</span>
                </span>
                {columnSelect(mapping.customer_column, (v) => setMapping((m) => ({ ...m, customer_column: v })), 'Customer ID column', 'Choose...')}
              </div>
              <div className="mapping-row is-key">
                <span>
                  <strong>Last updated</strong>
                  <span className="text-xs muted">Optional.</span>
                </span>
                {columnSelect(mapping.updated_column, (v) => setMapping((m) => ({ ...m, updated_column: v })), 'Accounts last updated column', 'Not available')}
              </div>
              {ACCOUNT_FIELDS.map((f) => (
                <div key={f} className="mapping-row">
                  <span>
                    {ACCOUNT_LABELS[f][0]}
                    {ACCOUNT_LABELS[f][1] && <span className="text-xs muted"> {ACCOUNT_LABELS[f][1]}</span>}
                  </span>
                  {columnSelect(
                    mapping.fields[f] ?? '',
                    (v) => setMapping((m) => ({ ...m, fields: { ...m.fields, [f]: v } })),
                    `Column for ${ACCOUNT_LABELS[f][0]}`,
                    'Not in this table',
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

function SyncStep({
  source,
  onChanged,
  push = false,
  n = 3,
}: {
  source: Source
  onChanged: () => void
  push?: boolean
  n?: number
}) {
  const toast = useToast()
  const canSync = useCan('manage_sources')
  const runs = useApi(() => api.connectorRuns(source.code), [source.code])
  const [busy, setBusy] = useState(false)
  const ready = 'object' in source.mapping

  const setSchedule = async (hours: number) => {
    try {
      await api.updateSource(source.code, { sync_every_hours: hours as Source['sync_every_hours'] })
      toast('success', hours ? `Lumina will sync this every ${hours} hours.` : 'Automatic sync turned off.')
      onChanged()
    } catch (e) {
      toast('error', (e as Error).message)
    }
  }

  const sync = async () => {
    setBusy(true)
    try {
      const r = await api.syncSource(source.code)
      const products = r.accounts === null ? '' : ` and ${r.accounts} products`
      const gone = r.retired ? `, ${r.retired} no longer in the system (switched off)` : ''
      toast('success', `Read ${r.fetched} rows: ${r.created} new, ${r.updated} updated${gone}${products}. Customers rebuilt.`)
      onChanged()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
      runs.reload()
    }
  }

  return (
    <Card
      title={<StepTitle n={n} text={push ? 'Received data' : 'Sync'} />}
      description={
        push
          ? 'Every batch your systems sent, newest first.'
          : 'Read the mapped columns, then match and score the customers. Every attempt is listed below.'
      }
      actions={
        canSync &&
        !push && (
          <div className="row" style={{ gap: 8 }}>
            <select
              className="select select-sm"
              aria-label="Sync automatically"
              value={source.sync_every_hours}
              onChange={(e) => setSchedule(Number(e.target.value))}
            >
              <option value={0}>Sync by hand only</option>
              <option value={6}>Every 6 hours</option>
              <option value={12}>Every 12 hours</option>
              <option value={24}>Every day</option>
            </select>
            <button type="button" className="btn btn-primary" disabled={busy || !ready || !source.enabled} onClick={sync}>
              <Icon name="refresh" size={16} className={busy ? 'spin' : undefined} /> {busy ? 'Syncing...' : 'Sync now'}
            </button>
          </div>
        )
      }
      flush
    >
      <div className="table-wrap runs-scroll" tabIndex={0} aria-label="Sync history">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Result</th>
              <th className="right">Rows read</th>
              <th className="right col-sm">New</th>
              <th className="right col-sm">Updated</th>
              <th className="col-md">By</th>
            </tr>
          </thead>
          {runs.loading && !runs.data ? (
            <LoaderRow kind="trail" label="Loading sync history" columns={6} />
          ) : (
            <tbody>
              {runs.data?.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted text-sm">
                    {push ? 'Nothing received yet.' : 'No syncs yet.'}
                  </td>
                </tr>
              )}
              {runs.data?.map((r) => (
                <tr key={r.id}>
                  <td className="text-sm">{formatDateTime(r.started_at)}</td>
                  <td>
                    {r.status === 'ok' ? (
                      <StatusBadge tone="good">Succeeded</StatusBadge>
                    ) : (
                      <span className="stack" style={{ gap: 2 }}>
                        <StatusBadge tone="bad">Failed</StatusBadge>
                        <span className="text-xs muted">{r.error}</span>
                      </span>
                    )}
                  </td>
                  <td className="right num">{r.fetched}</td>
                  <td className="right num col-sm">{r.created}</td>
                  <td className="right num col-sm">{r.updated}</td>
                  <td className="mono text-sm col-md">{r.started_by || '-'}</td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      </div>
    </Card>
  )
}

function ApiKeyStep({ source, onChanged }: { source: Source; onChanged: () => void }) {
  const toast = useToast()
  const [key, setKey] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const prefix = source.config.key_prefix
  const endpoint = `${window.location.origin}/t/${window.location.pathname.split('/')[2]}/api/ingest/${source.code}/`
  const continued = ' \\' // shell line continuation
  const example = [
    `curl -X POST ${endpoint}${continued}`,
    `  -H "Authorization: Bearer ${key ?? 'YOUR_API_KEY'}"${continued}`,
    `  -H "Content-Type: application/json"${continued}`,
    `  -d '{"records": [{"id": "C-1001", "name": "Asha Rao", "mobile": "9000000001", "pan": "ABCPR1234K", "updated_at": "2026-10-01T10:00:00"}]}'`,
  ].join('\n')

  const create = async () => {
    if (prefix && !window.confirm('Create a new key? The current key stops working immediately.')) return
    setBusy(true)
    try {
      setKey((await api.createApiKey(source.code)).api_key)
      toast('success', 'New API key created. Copy it now: it is shown only once.')
      onChanged()
    } catch (e) {
      toast('error', (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card
      title={<StepTitle n={1} text="API key" />}
      description="Your systems send customers to Lumina with this key. Lumina keeps only a scrambled copy, so a lost key can be replaced, not shown again."
      actions={
        <button type="button" className={`btn${prefix ? '' : ' btn-primary'}`} disabled={busy} onClick={create}>
          {prefix ? 'Replace key' : 'Create API key'}
        </button>
      }
    >
      <div className="stack" style={{ gap: 16 }}>
        {key ? (
          <div className="issued" role="status">
            <Icon name="key" size={18} />
            <div className="issued-text">
              <strong>Copy this key now</strong>
              <span className="text-sm">It is shown only once. Keep it in your system&apos;s secret settings, never in code.</span>
            </div>
            <code className="issued-pw">{key}</code>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => navigator.clipboard?.writeText(key).then(() => toast('success', 'Copied.'))}
            >
              Copy
            </button>
          </div>
        ) : prefix ? (
          <span className="text-sm">
            Active key starts with <code className="mono">{prefix}…</code>
          </span>
        ) : (
          <span className="text-sm muted">No key yet.</span>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <strong className="text-sm">How your system sends customers</strong>
          <pre className="code-block">{example}</pre>
          <span className="text-xs muted">
            Up to 1,000 records per request. Each needs id and name; other fields: father_name, dob, gender, pan, aadhaar,
            ckyc, mobile, email, address, perm_address, occupation, income, updated_at. PAN and CKYC are encrypted on
            arrival; only the last 4 digits of Aadhaar are kept.
          </span>
        </div>
      </div>
    </Card>
  )
}
