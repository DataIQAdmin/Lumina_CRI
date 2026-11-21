import { useRef, useState, type ChangeEvent } from 'react'

import { api } from '../api/client'
import { OrgLogo } from '../components/OrgLogo'
import { MatchSettings } from '../components/settings/MatchSettings'
import { useToast } from '../components/Toasts'
import { Icon } from '../components/Icon'
import { GOLDEN_READY } from '../features'
import { Card, PageHeader } from '../components/ui'
import { useOrganization } from '../organization'

const MAX_LOGO_BYTES = 256 * 1024
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']

// The organization administrator's settings: the bank's logo, and how matching, trust scores and golden records
// work. Saving those runs matching again so every customer follows them.
export function SettingsPage() {
  const org = useOrganization()
  return (
    <>
      <PageHeader
        title="Organization settings"
        description={`Settings for ${org.name} only. Other organizations are not affected.`}
      />
      <LogoCard />
      {GOLDEN_READY ? (
        <MatchSettings />
      ) : (
        <section className="card building">
          <span className="building-icon">
            <Icon name="layers" size={26} />
          </span>
          <span className="building-status">Under development</span>
          <h2>Matching, trust scores and golden records</h2>
          <p className="muted">Settings for matching, trust score weights and how golden records are chosen will appear here once golden records are released.</p>
        </section>
      )}
    </>
  )
}

function LogoCard() {
  const org = useOrganization()
  const toast = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const save = async (logo: string, done: string) => {
    setBusy(true)
    try {
      await api.saveLogo(logo)
      toast('success', done)
      // The logo appears across the app; a reload shows it everywhere at once.
      window.setTimeout(() => window.location.reload(), 700)
    } catch (e) {
      toast('error', (e as Error).message)
      setBusy(false)
    }
  }

  const pick = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!LOGO_TYPES.includes(file.type)) {
      toast('error', 'Choose a PNG, JPEG or WebP image.')
      return
    }
    if (file.size > MAX_LOGO_BYTES) {
      toast('error', 'The logo must be 256 KB or smaller.')
      return
    }
    const reader = new FileReader()
    reader.onload = () => save(String(reader.result), 'Logo saved.')
    reader.readAsDataURL(file)
  }

  return (
    <Card
      title="Logo"
      description="Shown on your sign-in page and in the top bar. Lumina keeps its own look everywhere else."
    >
      <div className="logo-setting">
        <OrgLogo org={org} size={64} />
        <div className="stack" style={{ gap: 4 }}>
          <strong>{org.logo ? 'Your logo' : 'Initials badge (no logo yet)'}</strong>
          <span className="text-sm muted">PNG, JPEG or WebP, square works best, up to 256 KB.</span>
        </div>
        <div className="row" style={{ gap: 8, marginLeft: 'auto' }}>
          <input ref={input} type="file" accept={LOGO_TYPES.join(',')} hidden onChange={pick} />
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => input.current?.click()}>
            {org.logo ? 'Replace' : 'Upload logo'}
          </button>
          {org.logo && (
            <button type="button" className="btn" disabled={busy} onClick={() => save('', 'Logo removed.')}>
              Remove
            </button>
          )}
        </div>
      </div>
    </Card>
  )
}
