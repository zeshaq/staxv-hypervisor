import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import {
  Container, Image, Network, HardDrive, Play, Square, RotateCw,
  Trash2, Terminal, RefreshCw, Plus, ChevronDown, ChevronRight,
  AlertCircle, CheckCircle, Loader2, Download, X, Database
} from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────

function bytes(n) {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`
}

function ago(iso) {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

function formatPorts(ports) {
  if (!ports || typeof ports !== 'object') return '—'
  const lines = []
  for (const [k, v] of Object.entries(ports)) {
    if (v && Array.isArray(v)) {
      v.forEach(b => lines.push(`${b.HostPort}→${k}`))
    } else {
      lines.push(k)
    }
  }
  return lines.length ? lines.join(', ') : '—'
}

// ── reusable UI ───────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = (status || '').toLowerCase()
  const color = s === 'running' ? 'text-green-400 bg-green-400/10 ring-green-400/30'
    : s === 'exited' || s === 'stopped' ? 'text-red-400 bg-red-400/10 ring-red-400/30'
    : s === 'paused' ? 'text-yellow-400 bg-yellow-400/10 ring-yellow-400/30'
    : 'text-slate-400 bg-slate-400/10 ring-slate-400/30'
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ring-1 ${color}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status}
    </span>
  )
}

function Btn({ children, onClick, variant = 'ghost', size = 'sm', disabled, loading, className = '' }) {
  const base = 'inline-flex items-center gap-1.5 rounded font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed'
  const sizes = { sm: 'px-2.5 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
  const variants = {
    ghost:   'text-slate-400 hover:text-sky-300 hover:bg-navy-600',
    primary: 'bg-sky-600 hover:bg-sky-500 text-white',
    danger:  'text-red-400 hover:text-red-300 hover:bg-red-400/10',
    success: 'text-green-400 hover:text-green-300 hover:bg-green-400/10',
  }
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
    >
      {loading ? <Loader2 size={12} className="animate-spin" /> : children}
    </button>
  )
}

function Toast({ msg, type, onClose }) {
  useEffect(() => { if (msg) { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) } }, [msg])
  if (!msg) return null
  const color = type === 'error' ? 'bg-red-900/80 border-red-700 text-red-200'
    : 'bg-green-900/80 border-green-700 text-green-200'
  return (
    <div className={`fixed bottom-5 right-5 flex items-center gap-2 px-4 py-3 rounded-lg border text-sm z-50 shadow-xl ${color}`}>
      {type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
      {msg}
      <button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100"><X size={14} /></button>
    </div>
  )
}

function SectionHeader({ title, icon: Icon, count, onRefresh, refreshing, extra }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Icon size={18} className="text-sky-400" />
        <h2 className="text-slate-200 font-semibold text-base">{title}</h2>
        {count !== undefined && (
          <span className="text-xs bg-navy-600 text-slate-400 px-2 py-0.5 rounded-full">{count}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {extra}
        {onRefresh && (
          <Btn onClick={onRefresh} disabled={refreshing}>
            <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </Btn>
        )}
      </div>
    </div>
  )
}

function EmptyState({ message }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-slate-500">
      <Database size={36} className="mb-3 opacity-30" />
      <p className="text-sm">{message}</p>
    </div>
  )
}

// ── Overview cards ─────────────────────────────────────────────────────────────

function OverviewCards({ info }) {
  if (!info) return null
  const cards = [
    { label: 'Running',  value: info.containers_running, color: 'text-green-400',  bg: 'bg-green-400/10' },
    { label: 'Stopped',  value: info.containers_stopped, color: 'text-red-400',   bg: 'bg-red-400/10' },
    { label: 'Images',   value: info.images,             color: 'text-sky-400',   bg: 'bg-sky-400/10' },
    { label: 'Engine',   value: `v${info.server_version}`,color: 'text-purple-400',bg: 'bg-purple-400/10' },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {cards.map(c => (
        <div key={c.label} className="bg-navy-800 border border-navy-600 rounded-lg px-4 py-3">
          <p className="text-xs text-slate-500 mb-1">{c.label}</p>
          <p className={`text-2xl font-bold ${c.color}`}>{c.value}</p>
        </div>
      ))}
    </div>
  )
}

// ── Containers tab ─────────────────────────────────────────────────────────────

function ContainersTab({ notify }) {
  const [containers, setContainers] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState({})
  const [expandedLogs, setExpandedLogs] = useState({})
  const [logs, setLogs] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/docker/containers')
      setContainers(r.data)
    } catch (e) {
      notify(e.response?.data?.error || 'Failed to load containers', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const action = async (id, endpoint, method = 'post') => {
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await api[method](`/docker/containers/${id}/${endpoint}`)
      notify(`Done`, 'ok')
      await load()
    } catch (e) {
      notify(e.response?.data?.error || 'Action failed', 'error')
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  const remove = async (id, name) => {
    if (!confirm(`Remove container "${name}"?`)) return
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await api.delete(`/docker/containers/${id}?force=true`)
      notify('Container removed', 'ok')
      setContainers(cs => cs.filter(c => c.id !== id))
    } catch (e) {
      notify(e.response?.data?.error || 'Remove failed', 'error')
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  const toggleLogs = async (id) => {
    if (expandedLogs[id]) {
      setExpandedLogs(l => ({ ...l, [id]: false }))
      return
    }
    setExpandedLogs(l => ({ ...l, [id]: true }))
    if (!logs[id]) {
      try {
        const r = await api.get(`/docker/containers/${id}/logs?tail=100`)
        setLogs(l => ({ ...l, [id]: r.data.logs }))
      } catch {
        setLogs(l => ({ ...l, [id]: 'Failed to load logs.' }))
      }
    }
  }

  const openShell = (id, name) => {
    window.open(`/docker-exec?container_id=${encodeURIComponent(id)}&name=${encodeURIComponent(name)}`, '_blank',
      'width=900,height=600,noopener,noreferrer')
  }

  if (loading) return <div className="flex items-center gap-2 text-slate-400 py-8"><Loader2 size={18} className="animate-spin" />Loading containers…</div>
  if (!containers.length) return <EmptyState message="No containers found" />

  return (
    <div className="space-y-2">
      <SectionHeader title="Containers" icon={Container} count={containers.length} onRefresh={load} refreshing={loading} />
      <div className="overflow-x-auto rounded-lg border border-navy-600">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-navy-600 bg-navy-700/50">
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Name</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Image</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Status</th>
              <th className="text-left px-4 py-3 text-slate-400 font-medium">Ports</th>
              <th className="text-right px-4 py-3 text-slate-400 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {containers.map(c => (
              <>
                <tr key={c.id} className="border-b border-navy-700 hover:bg-navy-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => toggleLogs(c.id)}
                        className="text-slate-500 hover:text-sky-400 transition-colors"
                      >
                        {expandedLogs[c.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                      <span className="text-slate-200 font-mono">{c.name}</span>
                    </div>
                    <div className="text-xs text-slate-500 font-mono ml-5">{c.id}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-300 font-mono text-xs">{c.image}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-slate-400 text-xs font-mono">{formatPorts(c.ports)}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-0.5">
                      {c.status === 'running' ? (
                        <>
                          <Btn onClick={() => action(c.id, 'stop')} loading={busy[c.id]} title="Stop">
                            <Square size={13} />
                          </Btn>
                          <Btn onClick={() => action(c.id, 'restart')} loading={busy[c.id]} title="Restart">
                            <RotateCw size={13} />
                          </Btn>
                          <Btn onClick={() => openShell(c.id, c.name)} title="Shell" className="text-sky-400 hover:text-sky-300 hover:bg-sky-400/10">
                            <Terminal size={13} />
                          </Btn>
                        </>
                      ) : (
                        <Btn onClick={() => action(c.id, 'start')} loading={busy[c.id]} title="Start" className="text-green-400 hover:text-green-300 hover:bg-green-400/10">
                          <Play size={13} />
                        </Btn>
                      )}
                      <Btn onClick={() => remove(c.id, c.name)} loading={busy[c.id]} variant="danger" title="Remove">
                        <Trash2 size={13} />
                      </Btn>
                    </div>
                  </td>
                </tr>
                {expandedLogs[c.id] && (
                  <tr key={`${c.id}-logs`} className="bg-navy-900/70">
                    <td colSpan={5} className="px-4 py-3">
                      <div className="text-xs text-slate-400 mb-1 font-semibold">Logs (last 100 lines)</div>
                      <pre className="bg-black/40 rounded p-3 text-xs font-mono text-green-300 overflow-x-auto max-h-56 overflow-y-auto whitespace-pre-wrap break-all">
                        {logs[c.id] || 'Loading…'}
                      </pre>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Images tab ─────────────────────────────────────────────────────────────────

function ImagesTab({ notify }) {
  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [pulling, setPulling] = useState(false)
  const [pullName, setPullName] = useState('')
  const [busy, setBusy] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/docker/images')
      setImages(r.data)
    } catch (e) {
      notify(e.response?.data?.error || 'Failed to load images', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const pull = async () => {
    const name = pullName.trim()
    if (!name) return
    setPulling(true)
    try {
      await api.post('/docker/images/pull', { image: name })
      notify(`Pulled ${name}`, 'ok')
      setPullName('')
      await load()
    } catch (e) {
      notify(e.response?.data?.error || 'Pull failed', 'error')
    } finally {
      setPulling(false)
    }
  }

  const remove = async (id, tag) => {
    if (!confirm(`Remove image "${tag || id}"?`)) return
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await api.post('/docker/images/remove', { id, force: false })
      notify('Image removed', 'ok')
      setImages(imgs => imgs.filter(i => i.id !== id))
    } catch (e) {
      notify(e.response?.data?.error || 'Remove failed', 'error')
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  const pullForm = (
    <div className="flex gap-2">
      <input
        value={pullName}
        onChange={e => setPullName(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && pull()}
        placeholder="ubuntu:22.04"
        className="bg-navy-700 border border-navy-500 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 w-48"
      />
      <Btn onClick={pull} loading={pulling} variant="primary" size="sm">
        <Download size={13} /> Pull
      </Btn>
    </div>
  )

  if (loading) return <div className="flex items-center gap-2 text-slate-400 py-8"><Loader2 size={18} className="animate-spin" />Loading images…</div>

  return (
    <div className="space-y-4">
      <SectionHeader title="Images" icon={Image} count={images.length} onRefresh={load} refreshing={loading} extra={pullForm} />
      {!images.length ? <EmptyState message="No images found" /> : (
        <div className="overflow-x-auto rounded-lg border border-navy-600">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-600 bg-navy-700/50">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Tag</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">ID</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Size</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Created</th>
                <th className="text-right px-4 py-3 text-slate-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {images.map(img => (
                <tr key={img.id} className="border-b border-navy-700 hover:bg-navy-700/30 transition-colors">
                  <td className="px-4 py-3 text-slate-200 font-mono text-xs">
                    {img.tags.length ? img.tags.map(t => (
                      <div key={t}>{t}</div>
                    )) : <span className="text-slate-500">{'<none>'}</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-400 font-mono text-xs">{img.short_id}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{bytes(img.size)}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{ago(img.created)}</td>
                  <td className="px-4 py-3 text-right">
                    <Btn onClick={() => remove(img.id, img.tags[0])} loading={busy[img.id]} variant="danger">
                      <Trash2 size={13} /> Remove
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Networks tab ───────────────────────────────────────────────────────────────

function NetworksTab({ notify }) {
  const [networks, setNetworks] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', driver: 'bridge' })
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/docker/networks')
      setNetworks(r.data)
    } catch (e) {
      notify(e.response?.data?.error || 'Failed to load networks', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!form.name.trim()) return
    setCreating(true)
    try {
      await api.post('/docker/networks', form)
      notify('Network created', 'ok')
      setForm({ name: '', driver: 'bridge' })
      setShowForm(false)
      await load()
    } catch (e) {
      notify(e.response?.data?.error || 'Create failed', 'error')
    } finally {
      setCreating(false)
    }
  }

  const remove = async (id, name) => {
    if (!confirm(`Remove network "${name}"?`)) return
    setBusy(b => ({ ...b, [id]: true }))
    try {
      await api.delete(`/docker/networks/${id}`)
      notify('Network removed', 'ok')
      setNetworks(ns => ns.filter(n => n.id !== id))
    } catch (e) {
      notify(e.response?.data?.error || 'Remove failed', 'error')
    } finally {
      setBusy(b => ({ ...b, [id]: false }))
    }
  }

  const createBtn = (
    <Btn onClick={() => setShowForm(s => !s)} variant="primary" size="sm">
      <Plus size={13} /> Create Network
    </Btn>
  )

  return (
    <div className="space-y-4">
      <SectionHeader title="Networks" icon={Network} count={networks.length} onRefresh={load} refreshing={loading} extra={createBtn} />

      {showForm && (
        <div className="bg-navy-700/50 border border-navy-600 rounded-lg p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Name</label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && create()}
              placeholder="my-network"
              className="bg-navy-800 border border-navy-500 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500 w-44"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Driver</label>
            <select
              value={form.driver}
              onChange={e => setForm(f => ({ ...f, driver: e.target.value }))}
              className="bg-navy-800 border border-navy-500 rounded px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500"
            >
              {['bridge', 'overlay', 'macvlan', 'host', 'none'].map(d => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-2">
            <Btn onClick={create} loading={creating} variant="primary" size="sm">Create</Btn>
            <Btn onClick={() => setShowForm(false)} size="sm">Cancel</Btn>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-slate-400 py-8"><Loader2 size={18} className="animate-spin" />Loading…</div>
      ) : !networks.length ? <EmptyState message="No networks found" /> : (
        <div className="overflow-x-auto rounded-lg border border-navy-600">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-600 bg-navy-700/50">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Driver</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Scope</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Subnet</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Containers</th>
                <th className="text-right px-4 py-3 text-slate-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {networks.map(n => (
                <tr key={n.id} className="border-b border-navy-700 hover:bg-navy-700/30 transition-colors">
                  <td className="px-4 py-3">
                    <span className="text-slate-200 font-medium">{n.name}</span>
                    <div className="text-xs text-slate-500 font-mono">{n.id}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-300 text-xs">{n.driver}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{n.scope}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs font-mono">{n.subnet || '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{n.containers}</td>
                  <td className="px-4 py-3 text-right">
                    {!['bridge', 'host', 'none'].includes(n.name) && (
                      <Btn onClick={() => remove(n.id, n.name)} loading={busy[n.id]} variant="danger">
                        <Trash2 size={13} /> Remove
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Volumes tab ────────────────────────────────────────────────────────────────

function VolumesTab({ notify }) {
  const [volumes, setVolumes] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/docker/volumes')
      setVolumes(r.data)
    } catch (e) {
      notify(e.response?.data?.error || 'Failed to load volumes', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const remove = async (name) => {
    if (!confirm(`Remove volume "${name}"?`)) return
    setBusy(b => ({ ...b, [name]: true }))
    try {
      await api.delete(`/docker/volumes/${encodeURIComponent(name)}`)
      notify('Volume removed', 'ok')
      setVolumes(vs => vs.filter(v => v.name !== name))
    } catch (e) {
      notify(e.response?.data?.error || 'Remove failed', 'error')
    } finally {
      setBusy(b => ({ ...b, [name]: false }))
    }
  }

  if (loading) return <div className="flex items-center gap-2 text-slate-400 py-8"><Loader2 size={18} className="animate-spin" />Loading volumes…</div>

  return (
    <div className="space-y-4">
      <SectionHeader title="Volumes" icon={HardDrive} count={volumes.length} onRefresh={load} refreshing={loading} />
      {!volumes.length ? <EmptyState message="No volumes found" /> : (
        <div className="overflow-x-auto rounded-lg border border-navy-600">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-600 bg-navy-700/50">
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Name</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Driver</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Mountpoint</th>
                <th className="text-left px-4 py-3 text-slate-400 font-medium">Created</th>
                <th className="text-right px-4 py-3 text-slate-400 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {volumes.map(v => (
                <tr key={v.name} className="border-b border-navy-700 hover:bg-navy-700/30 transition-colors">
                  <td className="px-4 py-3 text-slate-200 font-mono text-xs">{v.name}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{v.driver}</td>
                  <td className="px-4 py-3 text-slate-300 text-xs font-mono truncate max-w-xs">{v.mountpoint}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{ago(v.created)}</td>
                  <td className="px-4 py-3 text-right">
                    <Btn onClick={() => remove(v.name)} loading={busy[v.name]} variant="danger">
                      <Trash2 size={13} /> Remove
                    </Btn>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'containers', label: 'Containers', icon: Container },
  { id: 'images',     label: 'Images',     icon: Image },
  { id: 'networks',   label: 'Networks',   icon: Network },
  { id: 'volumes',    label: 'Volumes',    icon: HardDrive },
]

export default function Docker() {
  const [tab, setTab] = useState('containers')
  const [info, setInfo] = useState(null)
  const [dockerAvailable, setDockerAvailable] = useState(true)
  const [toast, setToast] = useState({ msg: '', type: 'ok' })

  const notify = (msg, type = 'ok') => setToast({ msg, type })
  const clearToast = () => setToast({ msg: '', type: 'ok' })

  useEffect(() => {
    api.get('/docker/info')
      .then(r => setInfo(r.data))
      .catch(() => setDockerAvailable(false))
  }, [])

  if (!dockerAvailable) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-slate-400">
        <AlertCircle size={40} className="mb-4 text-red-400" />
        <h2 className="text-lg font-semibold text-slate-300 mb-2">Docker not available</h2>
        <p className="text-sm">Make sure Docker is installed and the daemon is running.</p>
        <code className="mt-3 bg-navy-800 px-3 py-1.5 rounded text-xs text-green-400">
          sudo apt install docker.io && sudo systemctl enable --now docker
        </code>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <OverviewCards info={info} />

      {/* Tab bar */}
      <div className="flex gap-1 bg-navy-800 border border-navy-600 rounded-lg p-1 w-fit">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all ${
                tab === t.id
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-sky-300 hover:bg-navy-700'
              }`}
            >
              <Icon size={15} />
              {t.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'containers' && <ContainersTab notify={notify} />}
        {tab === 'images'     && <ImagesTab     notify={notify} />}
        {tab === 'networks'   && <NetworksTab   notify={notify} />}
        {tab === 'volumes'    && <VolumesTab     notify={notify} />}
      </div>

      <Toast msg={toast.msg} type={toast.type} onClose={clearToast} />
    </div>
  )
}
