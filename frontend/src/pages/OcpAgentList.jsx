import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Server, PlusCircle, RefreshCw, Trash2, CheckCircle,
  XCircle, Loader2, Clock, ChevronRight, AlertTriangle,
} from 'lucide-react'
import api from '../api'

// ── helpers ───────────────────────────────────────────────────────────────────

const STATUS_META = {
  complete: { color: 'text-green-400 bg-green-500/10 border-green-500/20', icon: CheckCircle, label: 'Complete' },
  failed:   { color: 'text-red-400   bg-red-500/10   border-red-500/20',   icon: XCircle,     label: 'Failed'   },
  running:  { color: 'text-sky-400   bg-sky-500/10   border-sky-500/20',   icon: Loader2,     label: 'Running'  },
  pending:  { color: 'text-blue-400  bg-blue-500/10  border-blue-500/20',  icon: Clock,       label: 'Pending'  },
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

const TYPE_META = {
  sno:     { label: 'SNO',     color: 'bg-purple-500/15 text-purple-300' },
  compact: { label: 'Compact', color: 'bg-blue-500/15 text-blue-300'     },
  full:    { label: 'Full',    color: 'bg-teal-500/15 text-teal-300'     },
}

function TypeBadge({ type }) {
  const m = TYPE_META[type] || { label: type || '—', color: 'bg-slate-500/15 text-slate-300' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${m.color}`}>
      {m.label}
    </span>
  )
}

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Math.floor((Date.now() / 1000) - ts)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

// ── main component ────────────────────────────────────────────────────────────

export default function OcpAgentList() {
  const navigate          = useNavigate()
  const [jobs, setJobs]   = useState([])
  const [loading, setLoad] = useState(true)
  const [deleting, setDel] = useState(null)

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoad(true)
    try {
      const r = await api.get('/ocp-agent/jobs')
      setJobs(r.data.jobs || [])
    } catch (_) {}
    finally { setLoad(false) }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(() => refresh(true), 5000)
    return () => clearInterval(t)
  }, [refresh])

  const deleteJob = async (id) => {
    if (!confirm('Remove this agent deployment record?')) return
    setDel(id)
    try {
      await api.delete(`/ocp-agent/jobs/${id}`)
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
          <div className="p-2.5 bg-sky-500/10 rounded-xl">
            <Server size={20} className="text-sky-400" />
          </div>
          <div>
            <h1 className="text-slate-100 font-bold text-lg">Agent-Based Deployments</h1>
            <p className="text-slate-500 text-xs">SNO, Compact, and Full cluster deployments via Agent Installer</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => refresh()}
            className="p-2 rounded-md text-slate-400 hover:text-sky-400 hover:bg-navy-700 transition-colors"
            title="Refresh">
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => navigate('/ocp-agent/deploy')}
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
              <Server size={28} className="text-slate-600" />
            </div>
            <div className="text-center">
              <div className="text-slate-400 font-medium">No agent deployments yet</div>
              <div className="text-slate-600 text-sm mt-1">Deploy your first cluster using the Agent-Based Installer</div>
            </div>
            <button
              onClick={() => navigate('/ocp-agent/deploy')}
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
                <th className="text-left px-5 py-3 font-medium">Phase</th>
                <th className="text-left px-5 py-3 font-medium">Created</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {jobs.map(j => (
                <tr
                  key={j.id}
                  onClick={() => navigate(`/ocp-agent/jobs/${j.id}`)}
                  className="border-b border-navy-700/50 hover:bg-navy-700/30 cursor-pointer transition-colors">

                  <td className="px-5 py-3.5">
                    <div className="font-semibold text-slate-100 text-sm">
                      {j.cluster_name || '—'}
                    </div>
                    <div className="text-slate-500 text-xs font-mono">{j.id}</div>
                  </td>

                  <td className="px-5 py-3.5">
                    <TypeBadge type={j.deployment_type} />
                  </td>

                  <td className="px-5 py-3.5 text-slate-400 text-xs font-mono">
                    {j.ocp_version || '—'}
                  </td>

                  <td className="px-5 py-3.5">
                    <StatusBadge status={j.status} />
                  </td>

                  <td className="px-5 py-3.5 text-slate-400 text-xs max-w-[200px] truncate">
                    {j.phase || '—'}
                  </td>

                  <td className="px-5 py-3.5 text-slate-500 text-xs whitespace-nowrap">
                    {timeAgo(j.created)}
                  </td>

                  <td className="px-5 py-3.5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1 justify-end">
                      <button
                        onClick={() => navigate(`/ocp-agent/jobs/${j.id}`)}
                        className="p-1.5 rounded text-slate-400 hover:text-sky-400 hover:bg-sky-500/10 transition-colors"
                        title="View details">
                        <ChevronRight size={14} />
                      </button>
                      <button
                        onClick={() => deleteJob(j.id)}
                        disabled={deleting === j.id}
                        className="px-3 py-1.5 rounded text-sm font-medium text-red-400 hover:text-white hover:bg-red-600 border border-red-500/30 hover:border-red-600 transition-all disabled:opacity-40 flex items-center gap-1.5"
                        title="Delete record">
                        {deleting === j.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Trash2 size={14} />}
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

      {/* Running warning */}
      {running > 0 && (
        <div className="flex items-center gap-2 text-yellow-400 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-2.5">
          <AlertTriangle size={13} />
          {running} deployment{running > 1 ? 's' : ''} in progress — auto-refreshing every 5s
        </div>
      )}
    </div>
  )
}
