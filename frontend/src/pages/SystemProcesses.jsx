import { useState, useEffect, useCallback, useRef } from 'react'
import { Activity, Search, RefreshCw, Loader2, Zap, AlertTriangle, X } from 'lucide-react'
import api from '../api'

function PctBar({ value, warn = 10, danger = 50, color = 'sky' }) {
  const pct = Math.min(value ?? 0, 100)
  const barColor = pct >= danger ? 'bg-red-500'
                 : pct >= warn   ? 'bg-yellow-500'
                 : `bg-${color}-500`
  return (
    <div className="flex items-center gap-2">
      <span className={`font-mono text-xs w-10 text-right ${pct >= danger ? 'text-red-400' : pct >= warn ? 'text-yellow-400' : 'text-slate-300'}`}>
        {pct.toFixed(1)}%
      </span>
      <div className="w-16 bg-navy-600 rounded-full h-1.5 flex-shrink-0">
        <div className={`h-1.5 rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function KillModal({ proc, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-navy-800 border border-navy-500 rounded-xl p-6 max-w-sm w-full shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-500/10 rounded-lg">
            <AlertTriangle size={20} className="text-red-400" />
          </div>
          <div>
            <h3 className="text-slate-100 font-semibold text-sm">
              {proc.force ? 'Force Kill' : 'Kill'} Process
            </h3>
            <p className="text-slate-400 text-xs">{proc.force ? 'SIGKILL — immediate termination' : 'SIGTERM — graceful stop'}</p>
          </div>
        </div>
        <div className="bg-navy-900 rounded-lg p-3 mb-5 text-xs font-mono text-slate-300">
          <div><span className="text-slate-500">PID  </span> {proc.pid}</div>
          <div><span className="text-slate-500">Name </span> {proc.name}</div>
          <div><span className="text-slate-500">User </span> {proc.user}</div>
        </div>
        <div className="flex gap-3">
          <button
            onClick={onConfirm}
            className="flex-1 bg-red-600 hover:bg-red-500 text-white font-semibold py-2 rounded-md text-sm transition-colors"
          >
            {proc.force ? 'Force Kill' : 'Kill'}
          </button>
          <button
            onClick={onCancel}
            className="flex-1 bg-navy-600 hover:bg-navy-500 border border-navy-400 text-slate-300 py-2 rounded-md text-sm transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

const SORT_OPTIONS = [
  { key: 'cpu',  label: 'CPU %' },
  { key: 'mem',  label: 'Mem %' },
  { key: 'pid',  label: 'PID' },
  { key: 'name', label: 'Name' },
]

export default function SystemProcesses() {
  const [procs, setProcs]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [search, setSearch]     = useState('')
  const [sortBy, setSortBy]     = useState('cpu')
  const [confirm, setConfirm]   = useState(null) // { pid, name, user, force }
  const [toast, setToast]       = useState({ msg: '', ok: true })
  const [autoRefresh, setAR]    = useState(false)
  const timerRef                = useRef(null)
  const loadRef                 = useRef(0)

  const load = useCallback(async (quiet = false) => {
    const seq = ++loadRef.current
    if (!quiet) setLoading(true)
    try {
      const r = await api.get('/system/processes')
      if (seq === loadRef.current) setProcs(r.data.processes || [])
    } catch (e) {
      if (seq === loadRef.current) setError(e.response?.data?.error || 'Failed to load processes')
    } finally {
      if (seq === loadRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (autoRefresh) {
      timerRef.current = setInterval(() => load(true), 3000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [autoRefresh, load])

  const killProc = async () => {
    if (!confirm) return
    const { pid, force } = confirm
    setConfirm(null)
    try {
      await api.post(`/system/processes/${pid}/kill`, { force })
      setToast({ msg: `Process ${pid} ${force ? 'force-killed' : 'killed'}`, ok: true })
      load(true)
    } catch (e) {
      setToast({ msg: e.response?.data?.error || 'Kill failed', ok: false })
    }
    setTimeout(() => setToast({ msg: '' }), 4000)
  }

  const q = search.toLowerCase()
  const filtered = procs.filter(p =>
    !q || p.name.toLowerCase().includes(q)
       || p.user.toLowerCase().includes(q)
       || String(p.pid).includes(q)
       || p.cmd.toLowerCase().includes(q)
  )

  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'cpu')  return b.cpu - a.cpu
    if (sortBy === 'mem')  return b.mem - a.mem
    if (sortBy === 'pid')  return a.pid - b.pid
    if (sortBy === 'name') return a.name.localeCompare(b.name)
    return 0
  })

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
      <Loader2 size={20} className="animate-spin" /> Loading processes…
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
            placeholder="Filter by name, user, PID, command…"
            className="w-full pl-9 pr-8 py-2 bg-navy-800 border border-navy-500 rounded-lg text-sm text-slate-200 focus:outline-none focus:border-sky-500 placeholder-slate-600"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
              <X size={14} />
            </button>
          )}
        </div>

        <div className="flex gap-1 bg-navy-800 border border-navy-500 rounded-lg p-1">
          {SORT_OPTIONS.map(o => (
            <button key={o.key} onClick={() => setSortBy(o.key)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
                sortBy === o.key ? 'bg-navy-500 text-sky-300' : 'text-slate-400 hover:text-slate-200 hover:bg-navy-700'
              }`}>
              {o.label}
            </button>
          ))}
        </div>

        <button
          onClick={() => setAR(v => !v)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors border ${
            autoRefresh
              ? 'bg-sky-600/20 border-sky-500/50 text-sky-300'
              : 'bg-navy-800 border-navy-500 text-slate-300 hover:text-sky-300'
          }`}
        >
          <Activity size={13} className={autoRefresh ? 'animate-pulse' : ''} />
          {autoRefresh ? 'Live' : 'Live off'}
        </button>

        <button onClick={() => load()} className="flex items-center gap-2 bg-navy-800 border border-navy-500 text-slate-300 hover:text-sky-300 px-3 py-2 rounded-lg text-sm transition-colors">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-navy-600 flex items-center gap-2">
          <Activity size={15} className="text-sky-400" />
          <span className="text-slate-200 text-sm font-semibold">Running Processes</span>
          <span className="text-xs bg-navy-600 text-slate-400 px-2 py-0.5 rounded-full ml-1">
            {sorted.length} / {procs.length}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700 bg-navy-700/40 text-slate-400 text-xs">
                <th className="text-left px-4 py-3 font-medium">PID</th>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium hidden md:table-cell">User</th>
                <th className="text-left px-4 py-3 font-medium">CPU %</th>
                <th className="text-left px-4 py-3 font-medium">Mem %</th>
                <th className="text-left px-4 py-3 font-medium hidden lg:table-cell">Status</th>
                <th className="text-left px-4 py-3 font-medium hidden xl:table-cell">Command</th>
                <th className="text-right px-4 py-3 font-medium">Kill</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(p => (
                <tr key={p.pid} className="border-b border-navy-700/50 hover:bg-navy-700/20 transition-colors">
                  <td className="px-4 py-2.5 font-mono text-slate-400 text-xs">{p.pid}</td>
                  <td className="px-4 py-2.5 text-slate-200 text-xs font-medium">{p.name}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs hidden md:table-cell">{p.user}</td>
                  <td className="px-4 py-2.5"><PctBar value={p.cpu} warn={5} danger={30} color="sky" /></td>
                  <td className="px-4 py-2.5"><PctBar value={p.mem} warn={5} danger={20} color="purple" /></td>
                  <td className="px-4 py-2.5 hidden lg:table-cell">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      p.status === 'running' ? 'bg-green-900/30 text-green-400'
                    : p.status === 'sleeping' ? 'bg-navy-700 text-slate-500'
                    : 'bg-navy-700 text-slate-500'
                    }`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs font-mono truncate max-w-xs hidden xl:table-cell">
                    {p.cmd || '—'}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => setConfirm({ ...p, force: false })}
                        title="SIGTERM"
                        className="p-1.5 rounded text-orange-400 hover:bg-orange-500/10 transition-colors"
                      >
                        <Zap size={13} />
                      </button>
                      <button
                        onClick={() => setConfirm({ ...p, force: true })}
                        title="SIGKILL"
                        className="p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors"
                      >
                        <AlertTriangle size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {confirm && (
        <KillModal proc={confirm} onConfirm={killProc} onCancel={() => setConfirm(null)} />
      )}

      {toast.msg && (
        <div className={`fixed bottom-5 right-5 flex items-center gap-2 px-4 py-3 rounded-lg border text-sm z-50 shadow-xl ${
          toast.ok
            ? 'bg-green-900/90 border-green-700 text-green-200'
            : 'bg-red-900/90 border-red-700 text-red-200'
        }`}>
          {toast.msg}
          <button onClick={() => setToast({ msg: '' })} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  )
}
