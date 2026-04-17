import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Boxes, PlusCircle, RefreshCw, Trash2, CheckCircle,
  XCircle, Loader2, Clock, ChevronRight, AlertTriangle,
  HardDrive, Download, ChevronDown,
} from 'lucide-react'
import api from '../api'

// ── helpers ───────────────────────────────────────────────────────────────────

const STATUS_META = {
  complete: { color: 'text-green-400 bg-green-500/10 border-green-500/20', icon: CheckCircle,  label: 'Complete'    },
  failed:   { color: 'text-red-400   bg-red-500/10   border-red-500/20',   icon: XCircle,      label: 'Failed'      },
  running:  { color: 'text-sky-400   bg-sky-500/10   border-sky-500/20',   icon: Loader2,      label: 'Running'     },
  pending:  { color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', icon: Clock,     label: 'Pending'     },
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.pending
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border ${m.color}`}>
      <Icon size={11} className={status === 'running' ? 'animate-spin' : ''} />
      {m.label}
    </span>
  )
}

function ProgressBar({ value, status }) {
  const color = status === 'complete' ? 'bg-green-500' : status === 'failed' ? 'bg-red-500' : 'bg-sky-500'
  return (
    <div className="w-full bg-navy-700 rounded-full h-1.5">
      <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${value ?? 0}%` }} />
    </div>
  )
}

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ── main component ────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (!b) return '—'
  if (b > 1024 ** 3) return `${(b / 1024 ** 3).toFixed(1)} GB`
  return `${(b / 1024 ** 2).toFixed(0)} MB`
}

function IsoCachePanel() {
  const [isos, setIsos]           = useState([])
  const [open, setOpen]           = useState(false)
  const [showForm, setShowForm]   = useState(false)
  const [versions, setVersions]   = useState([])
  const [form, setForm]           = useState({ ocp_version: '', pull_secret: '', ssh_public_key: '' })
  const [fetching, setFetching]   = useState(false)
  const [deleting, setDeleting]   = useState(null)
  const [pollFp, setPollFp]       = useState(null)

  const loadIsos = useCallback(async () => {
    try { const r = await api.get('/openshift/isos'); setIsos(r.data.isos || []) } catch (_) {}
  }, [])

  useEffect(() => { loadIsos() }, [loadIsos])

  // Poll until the pre-fetching ISO appears
  useEffect(() => {
    if (!pollFp) return
    const t = setInterval(async () => {
      await loadIsos()
      setIsos(prev => {
        const found = prev.find(i => i.fingerprint === pollFp && i.exists)
        if (found) { setPollFp(null); setFetching(false) }
        return prev
      })
    }, 3000)
    return () => clearInterval(t)
  }, [pollFp, loadIsos])

  useEffect(() => {
    if (!open || versions.length) return
    api.get('/openshift/versions').then(r => setVersions(r.data.versions || [])).catch(() => {})
  }, [open, versions.length])

  const prefetch = async () => {
    if (!form.ocp_version || !form.pull_secret) return
    setFetching(true)
    try {
      const r = await api.post('/openshift/isos/prefetch', form)
      if (r.data.status === 'cached') { await loadIsos(); setFetching(false) }
      else setPollFp(r.data.fingerprint)
      setShowForm(false)
    } catch (e) {
      alert(e.response?.data?.error || 'Pre-fetch failed')
      setFetching(false)
    }
  }

  const deleteIso = async (fp) => {
    setDeleting(fp)
    try { await api.delete(`/openshift/isos/${fp}`); await loadIsos() } catch (_) {}
    setDeleting(null)
  }

  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-navy-700/50 transition-colors">
        <div className="flex items-center gap-2 text-slate-300 text-sm font-medium">
          <HardDrive size={15} className="text-sky-400" />
          Discovery ISO Cache
          {isos.length > 0 && (
            <span className="text-xs bg-sky-500/20 text-sky-300 px-2 py-0.5 rounded-full">{isos.length}</span>
          )}
        </div>
        <ChevronDown size={14} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="border-t border-navy-600 p-4 space-y-3">
          <p className="text-slate-500 text-xs">
            Pre-download discovery ISOs so deployments skip the download step. ISOs are reused automatically
            when OCP version, pull secret, and SSH key match.
          </p>

          {isos.length > 0 && (
            <div className="space-y-2">
              {isos.map(iso => (
                <div key={iso.fingerprint} className="flex items-center justify-between bg-navy-700 rounded-lg px-3 py-2.5">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${iso.exists ? 'bg-green-400' : 'bg-yellow-400 animate-pulse'}`} />
                    <div>
                      <div className="text-slate-200 text-sm font-medium">{iso.ocp_version}</div>
                      <div className="text-slate-500 text-xs font-mono">
                        {iso.exists ? fmtBytes(iso.size) : 'downloading…'} · {iso.ps_hint}
                        {' · '}{Math.floor((Date.now() / 1000 - iso.downloaded_at) / 3600)}h ago
                      </div>
                    </div>
                  </div>
                  <button onClick={() => deleteIso(iso.fingerprint)} disabled={deleting === iso.fingerprint}
                    className="p-1.5 rounded text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                    {deleting === iso.fingerprint ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {showForm ? (
            <div className="bg-navy-700 rounded-lg p-3 space-y-2">
              <select value={form.ocp_version} onChange={e => setForm(f => ({ ...f, ocp_version: e.target.value }))}
                className="w-full bg-navy-800 border border-navy-500 text-slate-200 text-sm rounded px-2 py-1.5">
                <option value="">Select OCP version…</option>
                {versions.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <textarea
                rows={3}
                placeholder="Pull secret (paste from cloud.redhat.com)"
                value={form.pull_secret}
                onChange={e => setForm(f => ({ ...f, pull_secret: e.target.value }))}
                className="w-full bg-navy-800 border border-navy-500 text-slate-200 text-xs rounded px-2 py-1.5 font-mono resize-none"
              />
              <input
                placeholder="SSH public key (optional)"
                value={form.ssh_public_key}
                onChange={e => setForm(f => ({ ...f, ssh_public_key: e.target.value }))}
                className="w-full bg-navy-800 border border-navy-500 text-slate-200 text-sm rounded px-2 py-1.5"
              />
              <div className="flex gap-2">
                <button onClick={prefetch} disabled={fetching || !form.ocp_version || !form.pull_secret}
                  className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-sm px-3 py-1.5 rounded disabled:opacity-50">
                  {fetching ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  {fetching ? 'Downloading…' : 'Download ISO'}
                </button>
                <button onClick={() => setShowForm(false)} className="text-slate-400 text-sm px-3 py-1.5">Cancel</button>
              </div>
            </div>
          ) : (
            <button onClick={() => setShowForm(true)}
              className="flex items-center gap-1.5 text-sky-400 hover:text-sky-300 text-sm transition-colors">
              <Download size={13} /> Pre-fetch ISO
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function OpenShiftList() {
  const navigate = useNavigate()
  const [jobs, setJobs]       = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDel]    = useState(null)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const r = await api.get('/openshift/jobs')
      setJobs(r.data.jobs || [])
    } catch (_) {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    refresh()
    // Auto-refresh every 10s if any job is running
    const t = setInterval(() => {
      setJobs(prev => {
        const hasRunning = prev.some(j => j.status === 'running' || j.status === 'pending')
        if (hasRunning) refresh(true)
        return prev
      })
    }, 10000)
    return () => clearInterval(t)
  }, [refresh])

  const deleteJob = async (id) => {
    if (!confirm('Remove this deployment record?')) return
    setDel(id)
    try {
      await api.delete(`/openshift/jobs/${id}`)
      setJobs(prev => prev.filter(j => j.id !== id))
    } catch (_) {}
    finally { setDel(null) }
  }

  // ── summary counts ──────────────────────────────────────────────────────────
  const total    = jobs.length
  const running  = jobs.filter(j => j.status === 'running' || j.status === 'pending').length
  const complete = jobs.filter(j => j.status === 'complete').length
  const failed   = jobs.filter(j => j.status === 'failed').length

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-red-500/10 rounded-xl">
            <Boxes size={20} className="text-red-400" />
          </div>
          <div>
            <h1 className="text-slate-100 font-bold text-lg">OpenShift Clusters</h1>
            <p className="text-slate-500 text-xs">SNO and multi-node deployments via Assisted Installer</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refresh()}
            className="p-2 rounded-md text-slate-400 hover:text-sky-400 hover:bg-navy-700 transition-colors"
            title="Refresh">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={() => navigate('/openshift/deploy')}
            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold px-4 py-2 rounded-md text-sm transition-colors">
            <PlusCircle size={15} /> New Deployment
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {total > 0 && (
        <div className="grid grid-cols-4 gap-3">
          {[
            { label: 'Total',    value: total,    color: 'text-slate-200' },
            { label: 'Running',  value: running,  color: 'text-sky-400'   },
            { label: 'Complete', value: complete, color: 'text-green-400' },
            { label: 'Failed',   value: failed,   color: 'text-red-400'   },
          ].map(c => (
            <div key={c.label} className="bg-navy-700 border border-navy-500 rounded-xl px-4 py-3 text-center">
              <div className={`text-2xl font-bold ${c.color}`}>{c.value}</div>
              <div className="text-slate-500 text-xs mt-0.5">{c.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Job list */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">

        {loading && jobs.length === 0 ? (
          <div className="flex items-center justify-center py-16 text-slate-500 gap-2">
            <Loader2 size={16} className="animate-spin" /> Loading…
          </div>
        ) : jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-4">
            <div className="p-4 bg-navy-700 rounded-full">
              <Boxes size={28} className="text-slate-600" />
            </div>
            <div className="text-center">
              <div className="text-slate-400 font-medium">No deployments yet</div>
              <div className="text-slate-600 text-sm mt-1">Deploy your first OpenShift cluster to get started</div>
            </div>
            <button onClick={() => navigate('/openshift/deploy')}
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold px-5 py-2.5 rounded-md text-sm transition-colors">
              <PlusCircle size={15} /> New Deployment
            </button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-600 bg-navy-700/50 text-slate-400 text-xs">
                <th className="text-left px-5 py-3 font-medium">Cluster</th>
                <th className="text-left px-5 py-3 font-medium">Type</th>
                <th className="text-left px-5 py-3 font-medium">Version</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium w-36">Progress</th>
                <th className="text-left px-5 py-3 font-medium">Phase</th>
                <th className="text-left px-5 py-3 font-medium">Started</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => (
                <tr key={j.id}
                  onClick={() => navigate(`/openshift/jobs/${j.id}`)}
                  className="border-b border-navy-700/50 hover:bg-navy-700/30 cursor-pointer transition-colors">

                  <td className="px-5 py-3.5">
                    <div className="font-semibold text-slate-100 text-sm">
                      {j.config?.cluster_name || '—'}
                    </div>
                    <div className="text-slate-500 text-xs font-mono">{j.id}</div>
                  </td>

                  <td className="px-5 py-3.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      j.config?.deployment_type === 'sno'
                        ? 'bg-purple-500/15 text-purple-300'
                        : 'bg-blue-500/15 text-blue-300'
                    }`}>
                      {j.config?.deployment_type === 'sno' ? 'SNO' : 'Multi-node'}
                    </span>
                  </td>

                  <td className="px-5 py-3.5 text-slate-400 text-xs font-mono">
                    {j.config?.ocp_version || '—'}
                  </td>

                  <td className="px-5 py-3.5">
                    <StatusBadge status={j.status} />
                  </td>

                  <td className="px-5 py-3.5 w-36">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={j.progress} status={j.status} />
                      <span className="text-slate-400 text-xs w-8 text-right flex-shrink-0">{j.progress ?? 0}%</span>
                    </div>
                  </td>

                  <td className="px-5 py-3.5 text-slate-400 text-xs max-w-[180px] truncate">
                    {j.phase || '—'}
                  </td>

                  <td className="px-5 py-3.5 text-slate-500 text-xs whitespace-nowrap">
                    {timeAgo(j.created)}
                  </td>

                  <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      <button onClick={() => navigate(`/openshift/jobs/${j.id}`)}
                        className="p-1.5 rounded text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 transition-colors"
                        title="View details">
                        <ChevronRight size={14} />
                      </button>
                      <button onClick={() => deleteJob(j.id)}
                        disabled={deleting === j.id}
                        className="px-3 py-1.5 rounded text-sm font-medium text-red-400 hover:text-white hover:bg-red-600 border border-red-500/30 hover:border-red-600 transition-all disabled:opacity-40 flex items-center gap-1.5"
                        title="Delete record">
                        {deleting === j.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                        <span>Delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ISO cache panel */}
      <IsoCachePanel />

      {/* Warning if running jobs */}
      {running > 0 && (
        <div className="flex items-center gap-2 text-yellow-400 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-2.5">
          <AlertTriangle size={13} />
          {running} deployment{running > 1 ? 's' : ''} in progress — auto-refreshing every 10s
        </div>
      )}
    </div>
  )
}
