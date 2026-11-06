import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

import type { Capability } from './api/types'

import { AuthProvider, useAuth } from './auth/AuthContext'
import { Icon } from './components/Icon'
import { Layout } from './components/Layout'
import { Loader } from './components/Loader'
import { ToastProvider } from './components/Toasts'
import { OrganizationGate } from './components/OrganizationGate'
import { WakingBanner } from './components/WakingBanner'
import { ORG_BASE } from './organization'
import { AuditPage } from './pages/AuditPage'
import { ChangePasswordPage } from './pages/ChangePasswordPage'
import { ProfilingPage } from './pages/ProfilingPage'
import { RegexLibraryPage } from './pages/RegexLibraryPage'
import { RulesPage } from './pages/RulesPage'
import { SilverPage } from './pages/SilverPage'
import { ConnectorSetupPage } from './pages/ConnectorSetupPage'
import { ConnectorsPage } from './pages/ConnectorsPage'
import { LoginPage } from './pages/LoginPage'
import { NewConnectorPage } from './pages/NewConnectorPage'
import { SettingsPage } from './pages/SettingsPage'
import { UnderBuildingPage } from './pages/UnderBuildingPage'
import { UsersPage } from './pages/UsersPage'

function Routed() {
  const { user, checking, logout } = useAuth()
  if (checking) {
    return (
      <main className="splash">
        <Loader label="Opening Lumina" size={72} />
      </main>
    )
  }
  if (!user) return <LoginPage />
  // An administrator set a temporary password: nothing else opens until the person chooses their own.
  if (user.must_change_password) return <ChangePasswordPage forced />
  if (!user.role) {
    return (
      <main className="login">
        <div className="glass login-card" style={{ borderRadius: 'var(--radius-lg)' }}>
          <h1>No role assigned yet</h1>
          <p className="muted">
            You are signed in as <strong>{user.username}</strong>, but your account has no Lumina role. Ask an
            administrator to add you to one of: Relationship manager, Contact centre agent, Data steward, Compliance
            officer.
          </p>
          <button type="button" className="btn" onClick={logout}>
            <Icon name="logout" size={16} /> Sign out
          </button>
        </div>
      </main>
    )
  }
  const can = (c: Capability) => user.capabilities.includes(c)

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/profiling" replace />} />
        <Route path="/customers/*" element={<UnderBuildingPage title="Customers" />} />
        <Route path="/review" element={<UnderBuildingPage title="Match review" />} />
        <Route path="/approvals" element={<UnderBuildingPage title="Approvals" />} />
        <Route path="/compliance" element={<UnderBuildingPage title="Compliance" />} />
        {can('view_audit') && <Route path="/audit" element={<AuditPage />} />}
        <Route path="/connectors" element={<ConnectorsPage />} />
        <Route path="/profiling" element={<ProfilingPage />} />
        {can('manage_sources') && <Route path="/rules" element={<RulesPage />} />}
        {can('manage_sources') && <Route path="/regex" element={<RegexLibraryPage />} />}
        {can('manage_sources') && <Route path="/silver" element={<SilverPage />} />}
        {can('manage_connectors') && <Route path="/connectors/new" element={<NewConnectorPage />} />}
        {can('manage_connectors') && <Route path="/connectors/:code" element={<ConnectorSetupPage />} />}
        <Route path="/how-it-works" element={<UnderBuildingPage title="How it works" />} />
        <Route path="/password" element={<ChangePasswordPage />} />
        {can('manage_users') && <Route path="/users" element={<UsersPage />} />}
        {can('manage_settings') && <Route path="/settings" element={<SettingsPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <>
      <WakingBanner />
      <OrganizationGate>
        <AuthProvider>
          <ToastProvider>
            {/* Every page lives under /t/<org>/, so links like "/customers" stay inside this organization. */}
            <BrowserRouter basename={ORG_BASE}>
              <Routed />
            </BrowserRouter>
          </ToastProvider>
        </AuthProvider>
      </OrganizationGate>
    </>
  )
}
