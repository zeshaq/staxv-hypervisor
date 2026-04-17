import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Server, Plus, Trash2, RefreshCw, Cpu, MemoryStick,
  Zap, Wifi, WifiOff, ChevronRight, X, AlertTriangle,
  CheckCircle, Activity
} from 'lucide-react'
import api from '../api'

// ── Helpers ──────────────────────────────────────────────────────────────────

const healthColor = h => {
  if (!h) return 'text-slate-400'
  const s = h.toLowerCase()
  if (s === 'ok')       return 'text-emerald-400'
  if (s === 'warning')  return 'text-amber-400'
  return 'text-red-400'
}

const healthBg = h => {
  if (!h) return 'bg-slate-700 text-slate-300'
  const s = h.toLowerCase()
  if (s === 'ok')       return 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
  if (s === 'warning')  return 'bg-amber-900/60 text-amber-300 border border-amber-700'
  return 'bg-red-900/60 text-red-300 border border-red-700'
}

const powerBg = p => {
  if (!p) return 'bg-slate-700 text-slate-300'
  const s = p.toLowerCase()
  if (s === 'on')  return 'bg-emerald-900/60 text-emerald-300 border border-emerald-700'
  if (s === 'off') return 'bg-slate-700 text-slate-400 border border-slate-600'
  return 'bg-amber-900/60 text-amber-300 border border-amber-700'
}

// ── Add Server Modal ──────────────────────────────────────────────────────────

function AddServerModal({ onClose, onAdded }) {
  const [form, setForm] = useState({
    name: '', ilo_ip: '', username: 'Administrator', password: '', description: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.post('/bmc/servers', form)
      onAdded()
      onClose()
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to add server')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between p-5 border-b border-slate-700">
          <h2 className="text-white font-semibold text-lg flex items-center gap-2">
            <Server size={18} className="text-blue-400" /> Add Physical Server
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {[
            { key: 'name',        label: 'Server Name',    placeholder: 'dl385-3' },
            { key: 'ilo_ip',      label: 'iLO IP Address', placeholder: '192.168.1.100' },
            { key: 'username',    label: 'iLO Username',   placeholder: 'Administrator' },
            { key: 'description', label: 'Description',    placeholder: 'Optional notes' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="text-slate-400 text-sm block mb-1">{label}</label>
              <input
                value={form[key]}
                onChange={e => set(key, e.target.value)}
                placeholder={placeholder}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2
                           text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm"
              />
            </div>
          ))}
          <div>
            <label className="text-slate-400 text-sm block mb-1">iLO Password</label>
            <input
              type="password"
              value={form.password}
              onChange={e => set('password', e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2
                         text-white placeholder-slate-500 focus:border-blue-500 focus:outline-none text-sm"
            />
          </div>
          {error && (
            <p className="text-red-400 text-sm flex items-center gap-1.5">
              <AlertTriangle size={14} /> {error}
            </p>
          )}
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 py-2 rounded-lg border border-slate-600 text-slate-300
                         hover:bg-slate-700 text-sm transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white
                         text-sm font-medium transition-colors disabled:opacity-50">
              {saving ? 'Adding…' : 'Add Server'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Server Card ───────────────────────────────────────────────────────────────

function ServerCard({ server, onDelete, onRefresh }) {
  const [summary, setSummary]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [deleting, setDeleting] = useState(false)

  const fetchSummary = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get(`/bmc/servers/${server.id}/summary`)
      setSummary(r.data)
    } catch {
      setSummary({ offline: true, name: server.name, ilo_ip: server.ilo_ip, id: server.id })
    } finally {
      setLoading(false)
    }
  }, [server.id])

  useEffect(() => { fetchSummary() }, [fetchSummary])

  const handleDelete = async () => {
    if (!confirm(`Remove ${server.name} from the server list?`)) return
    setDeleting(true)
    try {
      await api.delete(`/bmc/servers/${server.id}`)
      onDelete(server.id)
    } catch (e) {
      alert(e.response?.data?.error || 'Delete failed')
      setDeleting(false)
    }
  }

  const s = summary

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden
                    hover:border-slate-500 transition-all group">
      {/* Header */}
      <div className="p-4 border-b border-slate-700 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${s?.offline ? 'bg-slate-700' : 'bg-blue-900/50'}`}>
            {s?.offline
              ? <WifiOff size={18} className="text-slate-400" />
              : <Server size={18} className="text-blue-400" />
            }
          </div>
          <div>
            <h3 className="text-white font-semibold">{server.name}</h3>
            <p className="text-slate-400 text-xs">{server.ilo_ip}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!loading && s && !s.offline && (
            <>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${healthBg(s.health)}`}>
                {s.health || '—'}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${powerBg(s.power_state)}`}>
                {s.power_state || '—'}
              </span>
            </>
          )}
          {s?.offline && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 border border-slate-600">
              Offline
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-4">
        {loading ? (
          <div className="space-y-2">
            {[1,2,3].map(i => (
              <div key={i} className="h-4 bg-slate-700 rounded animate-pulse" />
            ))}
          </div>
        ) : s?.offline ? (
          <div className="text-center py-4">
            <WifiOff size={24} className="text-slate-500 mx-auto mb-2" />
            <p className="text-slate-400 text-sm">Cannot reach iLO</p>
            <p className="text-slate-500 text-xs mt-1">{s.error}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-slate-300 text-sm">{s.model}</p>
            {server.description && (
              <p className="text-slate-500 text-xs">{server.description}</p>
            )}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-slate-400">
                <Cpu size={12} className="text-blue-400 shrink-0" />
                <span className="truncate">{s.cpu_model
                  ? s.cpu_model.replace('AMD EPYC', 'EPYC').replace('Intel Xeon', 'Xeon')
                  : '—'
                }</span>
              </div>
              <div className="flex items-center gap-1.5 text-slate-400">
                <MemoryStick size={12} className="text-purple-400 shrink-0" />
                <span>{s.ram_gib ? `${s.ram_gib} GiB RAM` : '—'}</span>
              </div>
              {s.power_watts != null && (
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Zap size={12} className="text-amber-400 shrink-0" />
                  <span>{s.power_watts}W</span>
                </div>
              )}
              {s.post_state && (
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Activity size={12} className="text-emerald-400 shrink-0" />
                  <span className="truncate">{s.post_state}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-slate-700 flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={fetchSummary} disabled={loading}
            className="p-1.5 rounded text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
            title="Refresh">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="p-1.5 rounded text-slate-400 hover:text-red-400 hover:bg-slate-700 transition-colors"
            title="Remove server">
            <Trash2 size={14} />
          </button>
        </div>
        <Link to={`/physical-servers/${server.id}`}
          className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
          View Details <ChevronRight size={12} />
        </Link>
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PhysicalServers() {
  const [servers, setServers]   = useState([])
  const [loading, setLoading]   = useState(true)
  const [showAdd, setShowAdd]   = useState(false)

  const fetchServers = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/bmc/servers')
      setServers(r.data.servers || [])
    } catch {
      setServers([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchServers() }, [fetchServers])

  const handleDelete = id => setServers(s => s.filter(x => x.id !== id))

  return (
    <div className="p-6 max-w-7xl mx-auto">
      {/* Page header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Server size={24} className="text-blue-400" /> Physical Servers
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage bare-metal servers via iLO / BMC Redfish API
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchServers}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-600
                       text-slate-300 hover:bg-slate-700 text-sm transition-colors">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600
                       hover:bg-blue-500 text-white text-sm font-medium transition-colors">
            <Plus size={14} /> Add Server
          </button>
        </div>
      </div>

      {/* Server grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[1,2].map(i => (
            <div key={i} className="bg-slate-800 border border-slate-700 rounded-xl p-4 animate-pulse">
              <div className="h-6 bg-slate-700 rounded w-1/2 mb-3" />
              <div className="h-4 bg-slate-700 rounded w-3/4 mb-2" />
              <div className="h-4 bg-slate-700 rounded w-1/2" />
            </div>
          ))}
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center py-20">
          <Server size={48} className="text-slate-600 mx-auto mb-4" />
          <h3 className="text-slate-300 font-medium text-lg">No servers added yet</h3>
          <p className="text-slate-500 text-sm mt-1 mb-6">
            Add a server with iLO / BMC access to manage it from here
          </p>
          <button onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600
                       hover:bg-blue-500 text-white text-sm font-medium transition-colors">
            <Plus size={16} /> Add Your First Server
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {servers.map(srv => (
            <ServerCard
              key={srv.id}
              server={srv}
              onDelete={handleDelete}
              onRefresh={fetchServers}
            />
          ))}
        </div>
      )}

      {showAdd && (
        <AddServerModal
          onClose={() => setShowAdd(false)}
          onAdded={fetchServers}
        />
      )}
    </div>
  )
}
