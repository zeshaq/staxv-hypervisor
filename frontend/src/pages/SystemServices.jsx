import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Settings, Play, Square, RotateCcw, CheckCircle, XCircle,
  ChevronDown, ChevronRight, Loader2, Search, RefreshCw,
  Zap, Power, AlertTriangle
} from 'lucide-react'
import api from '../api'

const ACTIONS = [
  { id: 'start',      label: 'Start',        icon: Play,          cls: 'text-green-400 hover:bg-green-500/10' },
  { id: 'stop',       label: 'Stop',         icon: Square,        cls: 'text-red-400 hover:bg-red-500/10' },
  { id: 'restart',    label: 'Restart',      icon: RotateCcw,     cls: 'text-yellow-400 hover:bg-yellow-500/10' },
  { id: 'enable',     label: 'Enable',       icon: CheckCircle,   cls: 'text-sky-400 hover:bg-sky-500/10' },
  { id: 'disable',    label: 'Disable',      icon: XCircle,       cls: 'text-slate-400 hover:bg-slate-500/10' },
  { id: 'kill',       label: 'Kill',         icon: Zap,           cls: 'text-orange-400 hover:bg-orange-500/10' },
  { id: 'force-kill', label: 'Force Kill',   icon: AlertTriangle, cls: 'text-red-500 hover:bg-red-500/10' },
]

function StatusBadge({ active, sub }) {
  const isActive  = active === 'active'
  const isFailed  = active === 'failed'
  const color = isActive ? 'bg-green-500/15 text-green-400 ring-green-500/30'
              : isFailed ? 'bg-red-500/15 text-red-400 ring-red-500/30'
              :            'bg-slate-500/15 text-slate-400 ring-slate-500/30'
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${isActive ? 'bg-green-400 animate-pulse' : isFailed ? 'bg-red-400' : 'bg-slate-500'}`} />
      {sub || active}
    </span>
  )
}

function EnabledBadge({ enabled }) {
  const isEnabled  = enabled === 'enabled'
  const isDisabled = enabled === 'disabled'
  const isStatic   = enabled === 'static'
  const color = isEnabled  ? 'text-sky-400 bg-sky-500/10'
              : isDisabled ? 'text-slate-500 bg-slate-500/10'
              : isStatic   ? 'text-slate-400 bg-slate-500/10'
              :              'text-slate-500 bg-slate-500/10'
  return (
    <span className={`text-xs px-2 py-0.5 rounded font-medium ${color}`}>
      {enabled}
    </span>
  )
}

function ServiceRow({ svc, onAction }) {
  const [expanded, setExpanded]   = useState(false)
  const [status, setStatus]       = useState(null)
  const [loadingStatus, setLS]    = useState(false)
  const [actioning, setActioning] = useState(null)
  const [toast, setToast]         = useState('')

  const loadStatus = async () => {
    setLS(true)
    try {
      const r = await api.get(`/system/services/${encodeURIComponent(svc.name)}/status`)
      setStatus(r.data.output)
    } catch (e) {
      setStatus(e.response?.data?.error || 'Failed to load status')
    } finally {
      setLS(false)
    }
  }

  const toggleExpand = () => {
    if (!expanded && !status) loadStatus()
    setExpanded(v => !v)
  }

  const doAction = async (action) => {
    setActioning(action)
    try {
      await api.post(`/system/services/${encodeURIComponent(svc.name)}/${action}`)
      setToast(`${action} succeeded`)
      if (expanded) loadStatus()
      onAction()
    } catch (e) {
      setToast(e.response?.data?.error || `${action} failed`)
    } finally {
      setActioning(null)
      setTimeout(() => setToast(''), 3000)
    }
  }

  const isActive = svc.active === 'active'
  const isFailed = svc.active === 'failed'

  return (
    <>
      <tr
        className={`border-b border-navy-700/50 hover:bg-navy-700/20 transition-colors cursor-pointer
          ${isFailed ? 'bg-red-900/5' : ''}`}
        onClick={toggleExpand}
      >
        <td className="px-4 py-3 w-5">
          {expanded
            ? <ChevronDown size={14} className="text-slate-400" />
            : <ChevronRight size={14} className="text-slate-500" />
          }
        </td>
        <td className="px-2 py-3">
          <span className="text-slate-200 text-sm font-mono">{svc.name.replace('.service', '')}</span>
        </td>
        <td className="px-2 py-3">
          <StatusBadge active={svc.active} sub={svc.sub} />
        </td>
        <td className="px-2 py-3">
          <EnabledBadge enabled={svc.enabled} />
        </td>
        <td className="px-2 py-3 text-slate-400 text-xs truncate max-w-xs">{svc.description}</td>
        <td className="px-2 py-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-0.5">
            {ACTIONS.map(a => {
              const Icon = a.icon
              return (
                <button
                  key={a.id}
                  onClick={() => doAction(a.id)}
                  disabled={actioning === a.id}
                  title={a.label}
                  className={`p-1.5 rounded transition-colors ${a.cls} disabled:opacity-40`}
                >
                  {actioning === a.id
                    ? <Loader2 size={13} className="animate-spin" />
                    : <Icon size={13} />
                  }
                </button>
              )
            })}
          </div>
        </td>
      </tr>

      {expanded && (
        <tr className="border-b border-navy-700/50">
          <td colSpan={6} className="px-4 py-0 pb-3">
            <div className="bg-navy-900 rounded-lg p-4 mt-1">
              {toast && (
                <div className={`text-xs mb-2 px-3 py-1.5 rounded ${toast.includes('failed') || toast.includes('error') ? 'bg-red-900/50 text-red-300' : 'bg-green-900/50 text-green-300'}`}>
                  {toast}
                </div>
              )}
              {loadingStatus
                ? <div className="flex items-center gap-2 text-slate-400 text-xs"><Loader2 size={13} className="animate-spin" /> Loading…</div>
                : <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap leading-5 max-h-64 overflow-y-auto">{status}</pre>
              }
              <button onClick={loadStatus} className="mt-2 text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
                <RefreshCw size={11} /> Refresh status
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

export default function SystemServices() {
  const [services, setServices]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState('all') // all | active | inactive | failed
  const loadRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++loadRef.current
    setLoading(true)
    try {
      const r = await api.get('/system/services')
      if (seq === loadRef.current) setServices(r.data.services || [])
    } catch (e) {
      if (seq === loadRef.current) setError(e.response?.data?.error || 'Failed to load services')
    } finally {
      if (seq === loadRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = services.filter(s => {
    const q = search.toLowerCase()
    const matchQ = !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    const matchF = filter === 'all'
      || (filter === 'active'   && s.active === 'active')
      || (filter === 'inactive' && s.active === 'inactive')
      || (filter === 'failed'   && s.active === 'failed')
    return matchQ && matchF
  })

  const counts = {
    all:      services.length,
    active:   services.filter(s => s.active === 'active').length,
    inactive: services.filter(s => s.active === 'inactive').length,
    failed:   services.filter(s => s.active === 'failed').length,
  }

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
      <Loader2 size={20} className="animate-spin" /> Loading services…
    </div>
  )

  if (error) return (
    <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-xl px-5 py-4 text-sm">{error}</div>
  )

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search services…"
            className="w-full pl-9 pr-3 py-2 bg-navy-800 border border-navy-500 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500 placeholder-slate-600"
          />
        </div>

        <div className="flex gap-1 bg-navy-800 border border-navy-500 rounded-lg p-1">
          {Object.entries(counts).map(([k, v]) => (
            <button key={k}
              onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-all capitalize ${
                filter === k ? 'bg-navy-500 text-sky-300' : 'text-slate-400 hover:text-slate-200 hover:bg-navy-700'
              }`}
            >
              {k} <span className="opacity-60">({v})</span>
            </button>
          ))}
        </div>

        <button onClick={load} className="flex items-center gap-2 bg-navy-800 border border-navy-500 text-slate-300 hover:text-sky-300 px-3 py-2 rounded-lg text-sm transition-colors">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-navy-600 flex items-center gap-2">
          <Settings size={15} className="text-sky-400" />
          <span className="text-slate-200 text-sm font-semibold">
            Systemd Services
          </span>
          <span className="text-xs bg-navy-600 text-slate-400 px-2 py-0.5 rounded-full ml-1">
            {filtered.length}
          </span>
          {counts.failed > 0 && (
            <span className="text-xs bg-red-900/50 text-red-400 border border-red-700/50 px-2 py-0.5 rounded-full">
              {counts.failed} failed
            </span>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700 bg-navy-700/40 text-slate-400 text-xs">
                <th className="w-5 px-4 py-3" />
                <th className="text-left px-2 py-3 font-medium">Service</th>
                <th className="text-left px-2 py-3 font-medium">State</th>
                <th className="text-left px-2 py-3 font-medium">Enabled</th>
                <th className="text-left px-2 py-3 font-medium">Description</th>
                <th className="text-left px-2 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0
                ? (
                  <tr>
                    <td colSpan={6} className="text-center py-12 text-slate-500 text-sm">
                      No services match your filter.
                    </td>
                  </tr>
                )
                : filtered.map(svc => (
                  <ServiceRow key={svc.name} svc={svc} onAction={load} />
                ))
              }
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-slate-600 text-xs">
        Actions require <code className="bg-navy-700 px-1 rounded">sudo -n</code> access.
        Add <code className="bg-navy-700 px-1 rounded">NOPASSWD: /usr/bin/systemctl</code> to sudoers if needed.
      </p>
    </div>
  )
}
