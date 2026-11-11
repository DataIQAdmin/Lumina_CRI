import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { api } from '../api/client'
import type { Capability } from '../api/types'
import { applyTheme, getTheme, type Theme } from '../theme'
import { useAuth } from '../auth/AuthContext'
import { useOrganization } from '../organization'
import { BrandMark } from './BrandMark'
import { FlowPill } from './FlowPill'
import { Icon, type IconName } from './Icon'
import { OrgLogo } from './OrgLogo'
import { ProfileJobPanel } from './ProfileJobPanel'
import { Avatar } from './ui'

type NavItem = { to: string; label: string; icon: IconName; end?: boolean; needs?: Capability[] }

const GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Data',
    items: [
      { to: '/connectors', label: 'Connectors', icon: 'connectors' },
      { to: '/profiling', label: 'Data profiling', icon: 'search' },
      { to: '/rules', label: 'Rules', icon: 'sliders', needs: ['manage_sources'] },
      { to: '/regex', label: 'Regex library', icon: 'key', needs: ['manage_sources'] },
      { to: '/silver', label: 'Silver layer', icon: 'layers', needs: ['manage_sources'] },
    ],
  },
  {
    label: 'Being rebuilt',
    items: [
      { to: '/customers', label: 'Customers', icon: 'customers' },
      { to: '/review', label: 'Match review', icon: 'merge' },
      { to: '/approvals', label: 'Approvals', icon: 'approve' },
      { to: '/compliance', label: 'Compliance', icon: 'shield' },
    ],
  },
  {
    label: 'Governance',
    items: [{ to: '/audit', label: 'Audit log', icon: 'audit', needs: ['view_audit'] }],
  },
  {
    label: 'Administration',
    items: [
      { to: '/users', label: 'Users and roles', icon: 'customers', needs: ['manage_users'] },
      { to: '/settings', label: 'Settings', icon: 'sliders', needs: ['manage_settings'] },
    ],
  },
  {
    label: 'Help',
    items: [{ to: '/how-it-works', label: 'How it works', icon: 'info' }],
  },
]

const PAGE_TITLES = [
  { path: '/customers', title: 'Customers' },
  { path: '/review', title: 'Match review' },
  { path: '/connectors', title: 'Connectors' },
  { path: '/audit', title: 'Audit log' },
  { path: '/approvals', title: 'Approvals' },
  { path: '/how-it-works', title: 'How it works' },
  { path: '/users', title: 'Users and roles' },
  { path: '/settings', title: 'Settings' },
  { path: '/password', title: 'Change password' },
  { path: '/compliance', title: 'Compliance' },
  { path: '/profiling', title: 'Data profiling' },
  { path: '/rules', title: 'Rules' },
  { path: '/regex', title: 'Regex library' },
  { path: '/silver', title: 'Silver layer' },
]

export function Layout() {
  const { user, logout } = useAuth()
  const org = useOrganization()
  const location = useLocation()
  const [pending, setPending] = useState<number | null>(null)
  const [pendingCorrections, setPendingCorrections] = useState<number | null>(null)
  const [theme, setTheme] = useState<Theme>(getTheme)
  // Phones and small tablets: the menu is a drawer that slides in from the left.
  const [navOpen, setNavOpen] = useState(false)
  const closeNav = () => setNavOpen(false)

  useEffect(() => {
    if (!navOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navOpen])

  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    applyTheme(next)
    setTheme(next)
  }

  // Refresh the "Match review" count whenever the user moves between pages.
  const canSeeMatches = !!user?.capabilities.includes('view_matches')
  const canApprove = !!user?.capabilities.includes('approve_corrections')
  useEffect(() => {
    if (canApprove) {
      api
        .corrections({ status: 'pending' })
        .then((page) => setPendingCorrections(page.count))
        .catch(() => setPendingCorrections(null))
    }
    if (canSeeMatches) {
      api
        .suggestions('pending')
        .then((page) => setPending(page.count))
        .catch(() => setPending(null))
    }
  }, [location.pathname, canSeeMatches, canApprove])

  const page = PAGE_TITLES.find((p) => location.pathname.startsWith(p.path))

  return (
    <div className="shell">
      <aside id="main-nav" className={`sidebar${navOpen ? ' open' : ''}`} aria-label="Main navigation">
        <Link to="/" className="brand" title="Go to Overview" onClick={closeNav}>
          <BrandMark />
          <div className="rail-text">
            <div className="brand-name">Lumina</div>
            <div className="brand-sub">Customer data platform</div>
          </div>
        </Link>

        {GROUPS.map((group) => ({ ...group, items: group.items.filter((i) => !i.needs || i.needs.some((c) => user?.capabilities.includes(c))) }))
          .filter((group) => group.items.length > 0)
          .map((group) => (
          <nav key={group.label} className="nav-group" aria-label={group.label}>
            <div className="nav-label">
              <span className="rail-text">{group.label}</span>
            </div>
            {group.items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className="nav-link" onClick={closeNav}>
                <Icon name={item.icon} />
                <span className="rail-text">{item.label}</span>
                {item.to === '/review' && pending ? <span className="nav-count">{pending}</span> : null}
                {item.to === '/approvals' && pendingCorrections ? (
                  <span className="nav-count">{pendingCorrections}</span>
                ) : null}
              </NavLink>
            ))}
          </nav>
        ))}

        <div className="sidebar-foot">
          <Avatar name={user?.name ?? ''} />
          <div className="sidebar-user rail-text">
            <strong>{user?.name}</strong>
            <span>{user?.role_label}</span>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon theme-toggle"
            onClick={toggleTheme}
            title={theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme'}
          >
            <Icon name={theme === 'light' ? 'moon' : 'sun'} label={theme === 'light' ? 'Dark theme' : 'Light theme'} />
          </button>
          <Link to="/password" className="btn btn-ghost btn-icon" title="Change password" onClick={closeNav}>
            <Icon name="key" label="Change password" />
          </Link>
          <button type="button" className="btn btn-ghost btn-icon" onClick={logout} title="Sign out">
            <Icon name="logout" label="Sign out" />
          </button>
        </div>
      </aside>
      {navOpen && <div className="nav-backdrop" onClick={closeNav} aria-hidden="true" />}

      <main className="content">
        <header className="topbar glass">
          <button
            type="button"
            className="btn btn-ghost btn-icon menu-btn"
            onClick={() => setNavOpen(true)}
            aria-label="Open menu"
            aria-expanded={navOpen}
            aria-controls="main-nav"
          >
            <Icon name="menu" />
          </button>
          <Link to="/" className="topbar-brand" title="Go to Overview">
            <BrandMark size={28} />
            <span>{page?.title ?? 'Lumina'}</span>
          </Link>
          <div className="topbar-path">
            <Link to="/" className="topbar-home">
              Lumina
            </Link>
            <Icon name="chevronRight" size={14} />
            <strong>{page?.title ?? 'Workspace'}</strong>
          </div>
          <div className="topbar-right">
            <FlowPill />
            {/* The organization's own logo: the one place its identity appears inside Lumina. */}
            <span className="org-badge" title={`Signed in to ${org.name}`}>
              <OrgLogo org={org} size={26} />
              <span className="org-badge-name">{org.name}</span>
            </span>
          </div>
        </header>
        <div className="content-inner">
          <div className="page">
            <Outlet />
          </div>
        </div>
      </main>
      <ProfileJobPanel />
    </div>
  )
}
