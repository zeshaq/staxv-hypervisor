import { NavLink, useLocation } from 'react-router-dom'
import { useState, useEffect } from 'react'
import api from '../api'
import {
  LayoutDashboard,
  Server,
  PlusCircle,
  HardDrive,
  Activity,
  Terminal,
  LogOut,
  Cpu,
  Container,
  Network,
  Files,
  Layers,
  Image,
  Boxes,
  Settings,
  SlidersHorizontal,
  Shield,
  ChevronDown,
  ChevronRight,
  MonitorDot,
  Flame,
  Lock,
} from 'lucide-react'

// ── nav items ─────────────────────────────────────────────────────────────────

const mainNavItems = [
  { to: '/', label: 'Host Info', icon: Cpu, exact: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/metrics', label: 'Metrics', icon: Activity },
]

const vmNavItems = [
  { to: '/vms', label: 'Virtual Machines', icon: Server },
  { to: '/vms/create', label: 'Create VM', icon: PlusCircle },
  { to: '/storage', label: 'Storage', icon: HardDrive },
  { to: '/images', label: 'Images', icon: Image },
]

const infraNavItems = [
  { to: '/docker',           label: 'Docker',           icon: Container },
  { to: '/kubernetes',       label: 'Kubernetes',       icon: Layers },
  { to: '/network',          label: 'Network',          icon: Network },
  { to: '/files',            label: 'File Manager',     icon: Files },
  { to: '/physical-servers', label: 'Physical Servers', icon: Server },
]

const ocpNavItems = [
  { to: '/openshift/clusters', label: 'OpenShift Clusters', icon: Layers },
  { to: '/openshift',          label: 'Assisted Install',   icon: Boxes  },
  { to: '/ocp-agent',          label: 'Agent Install',      icon: Terminal },
]

const systemNavItems = [
  { to: '/system/processes', label: 'Processes',     icon: MonitorDot },
  { to: '/system/services',  label: 'Services',      icon: Settings   },
  { to: '/system/firewall',  label: 'Firewall (UFW)', icon: Flame      },
  { to: '/system/security',  label: 'Security',      icon: Lock       },
  { to: '/settings',         label: 'Settings',      icon: SlidersHorizontal },
]

// ── components ────────────────────────────────────────────────────────────────

function NavItem({ to, label, icon: Icon, exact, indent = false }) {
  return (
    <NavLink
      to={to}
      end={exact}
      className={({ isActive }) =>
        `flex items-center gap-3 py-2.5 rounded-md mx-2 my-0.5 text-sm font-medium transition-all ${
          indent ? 'px-4 pl-8' : 'px-4'
        } ${
          isActive
            ? 'bg-navy-500 text-sky-400 border-l-2 border-sky-400'
            : 'text-slate-400 hover:text-sky-300 hover:bg-navy-600'
        }`
      }
    >
      <Icon size={16} />
      <span>{label}</span>
    </NavLink>
  )
}

function NavSection({ label, icon: Icon, items, defaultOpen = false }) {
  const location = useLocation()
  const isAnyActive = items.some(item => location.pathname.startsWith(item.to))
  const [open, setOpen] = useState(defaultOpen || isAnyActive)

  return (
    <div>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-6 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider hover:text-slate-400 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Icon size={12} />
          {label}
        </div>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>
      {open && items.map(item => (
        <NavItem key={item.to} {...item} indent />
      ))}
    </div>
  )
}

function NavGroupLabel({ label }) {
  return (
    <div className="px-6 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wider">
      {label}
    </div>
  )
}

export default function Layout({ children, username, onLogout }) {
  const location = useLocation()
  const [hostname, setHostname] = useState('')

  useEffect(() => {
    api.get('/host').then(r => setHostname(r.data.hostname || '')).catch(() => {})
  }, [])

  const getPageTitle = () => {
    const p = location.pathname
    if (p === '/')                    return 'Host Overview'
    if (p === '/dashboard')           return 'Dashboard'
    if (p === '/vms')                 return 'Virtual Machines'
    if (p === '/vms/create')          return 'Create VM'
    if (p.endsWith('/edit'))          return 'Edit VM'
    if (p.endsWith('/monitor'))       return 'VM Monitor'
    if (p.startsWith('/vms/'))        return 'VM Detail'
    if (p === '/storage')             return 'Storage'
    if (p === '/docker')              return 'Docker'
    if (p === '/metrics')             return 'Metrics'
    if (p === '/network')             return 'Network'
    if (p === '/files')               return 'File Manager'
    if (p === '/images')              return 'Images'
    if (p === '/kubernetes')          return 'Kubernetes'
    if (p === '/openshift/clusters')                          return 'OpenShift Clusters'
    if (p.match(/^\/openshift\/clusters\/(assisted|agent)\//)) return 'Cluster Dashboard'
    if (p === '/openshift')            return 'Assisted Installer Jobs'
    if (p === '/openshift/deploy')    return 'New OpenShift Deployment'
    if (p.startsWith('/openshift/jobs/')) return 'OpenShift Deployment'
    if (p === '/ocp-agent')              return 'Agent Installer Jobs'
    if (p === '/ocp-agent/deploy')       return 'New Agent Deployment'
    if (p.startsWith('/ocp-agent/jobs/'))return 'Agent Deployment'
    if (p === '/system/processes')    return 'Processes'
    if (p === '/system/services')     return 'System Services'
    if (p === '/system/firewall')     return 'Firewall (UFW)'
    if (p === '/system/security')     return 'Security Overview'
    if (p === '/settings')            return 'System Settings'
    if (p === '/physical-servers')    return 'Physical Servers'
    if (p.startsWith('/physical-servers/')) return 'Server Detail'
    return 'Hypercloud'
  }

  return (
    <div className="flex h-screen bg-navy-900 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-navy-800 border-r border-navy-400 flex flex-col flex-shrink-0">
        {/* Logo */}
        <div className="px-6 py-5 border-b border-navy-400">
          <div className="flex items-center gap-3 mb-2">
            <img src="/logo.svg" alt="Hypercloud" className="w-8 h-8" />
            <span className="text-sky-400 font-bold text-lg tracking-tight">Hypercloud</span>
          </div>
          {hostname && (
            <div
              className="mt-2 px-3 py-2 rounded-md bg-sky-700 text-white font-bold truncate"
              style={{ fontSize: '2rem', lineHeight: '1.1' }}
              title={hostname}
            >
              {hostname.toUpperCase()}
            </div>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-3 overflow-y-auto">

          {/* Overview */}
          <NavGroupLabel label="Overview" />
          {mainNavItems.map(item => <NavItem key={item.to} {...item} indent />)}

          <div className="mx-4 my-3 border-t border-navy-600" />

          {/* Virtual Machines */}
          <NavGroupLabel label="Virtual Machines" />
          {vmNavItems.map(item => <NavItem key={item.to} {...item} indent />)}

          <div className="mx-4 my-3 border-t border-navy-600" />

          {/* Infrastructure */}
          <NavGroupLabel label="Infrastructure" />
          {infraNavItems.map(item => <NavItem key={item.to} {...item} indent />)}

          <div className="mx-4 my-3 border-t border-navy-600" />

          {/* OpenShift — collapsible */}
          <NavSection
            label="OpenShift"
            icon={Boxes}
            items={ocpNavItems}
            defaultOpen={false}
          />

          <div className="mx-4 my-3 border-t border-navy-600" />

          {/* System Management — collapsible */}
          <NavSection
            label="System"
            icon={Settings}
            items={systemNavItems}
            defaultOpen={false}
          />

          {/* External links */}
          <div className="mt-3 pt-3 border-t border-navy-500 mx-2">
            <a
              href="/host-terminal"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 px-4 py-2.5 rounded-md text-sm font-medium text-slate-400 hover:text-sky-300 hover:bg-navy-600 transition-all"
            >
              <Terminal size={16} />
              <span>Host Terminal</span>
            </a>
          </div>
        </nav>

        {/* User section */}
        <div className="px-4 py-4 border-t border-navy-400">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-sky-500 flex items-center justify-center text-white text-xs font-bold uppercase">
                {username ? username[0] : 'U'}
              </div>
              <span className="text-slate-300 text-sm font-medium">{username || 'User'}</span>
            </div>
            <button
              onClick={onLogout}
              className="text-slate-400 hover:text-red-400 transition-colors p-1 rounded"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-navy-800 border-b border-navy-400 px-6 py-4 flex-shrink-0 flex items-center justify-between">
          <h1 className="text-slate-200 font-semibold text-lg">{getPageTitle()}</h1>
          <a
            href={`https://github.com/search?q=${__GIT_HASH__}&type=commits`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-sky-400 transition-colors font-mono"
            title="View commit on GitHub"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            <span>{__GIT_HASH__}</span>
            {__GIT_DATE__ && <span className="text-slate-600">· {__GIT_DATE__}</span>}
          </a>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  )
}
