/**
 * OpenShift Clusters — unified view across Assisted Installer and Agent-based jobs.
 *
 * FEATURE: openshift-clusters-unified-view
 *
 * Fetches both /api/openshift/jobs (Assisted Installer) and /api/ocp-agent/jobs
 * (Agent-based installer) in parallel, merges them into a single sorted list,
 * and provides navigation to the correct detail page per installer type.
 */

import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Layers, PlusCircle, RefreshCw, Trash2,
  CheckCircle, XCircle, Loader2, Clock,
  ChevronRight, AlertTriangle, Server, Cpu,
  Users, Zap, FileText,
} from 'lucide-react'
import api from '../api'

// ── helpers ───────────────────────────────────────────────────────────────────

const STATUS_META = {
  complete: { color: 'text-green-400 bg-green-500/10 border-green-500/20', icon: CheckCircle, label: 'Complete'    },
  failed:   { color: 'text-red-400   bg-red-500/10   border-red-500/20',   icon: XCircle,     label: 'Failed'      },
  running:  { color: 'text-sky-400   bg-sky-500/10   border-sky-500/20',   icon: Loader2,     label: 'Running'     },
  pending:  { color: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/20', icon: Clock,    label: 'Pending'     },
}

const DEPLOYMENT_META = {
  sno:     { label: 'SNO',      color: 'bg-purple-500/15 text-purple-300 border-purple-500/25' },
  compact: { label: 'Compact',  color: 'bg-blue-500/15   text-blue-300   border-blue-500/25'   },
  full:    { label: 'Full HA',  color: 'bg-teal-500/15   text-teal-300   border-teal-500/25'   },
  multi:   { label: 'Full HA',  color: 'bg-teal-500/15   text-teal-300   border-teal-500/25'   },
}

const INSTALLER_META = {
  assisted: { label: 'Assisted', color: 'bg-red-500/15 text-red-300 border-red-500/25' },
  agent:    { label: 'Agent',    color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/25' },
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

function TypeBadge({ type }) {
  const m = DEPLOYMENT_META[type] || { label: type || '—', color: 'bg-slate-500/15 text-slate-300 border-slate-500/25' }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${m.color}`}>
      {m.label}
    </span>
  )
}

function InstallerBadge({ source }) {
  const m = INSTALLER_META[source] || INSTALLER_META.assisted
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${m.color}`}>
      {m.label}
    </span>
  )
}

function ProgressBar({ value, status }) {
  const color =
    status === 'complete' ? 'bg-green-500' :
    status === 'failed'   ? 'bg-red-500'   : 'bg-sky-500'
  return (
    <div className="w-full bg-navy-700 rounded-full h-1.5">
      <div
        className={`h-1.5 rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(value ?? 0, 100)}%` }}
      />
    </div>
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

/**
 * Normalise a job from either installer into a common shape for the unified list.
 * Assisted Installer puts metadata inside `config{}`.
 * Agent Installer flattens cluster_name / ocp_version / deployment_type to top-level.
 */
function normalise(job, source) {
  const cfg = job.config || {}
  return {
    id:              job.id,
    source,                               // 'assisted' | 'agent'
    status:          job.status  || 'pending',
    phase:           job.phase   || '',
    progress:        job.progress ?? 0,
    created:         job.created || 0,
    cluster_name:    cfg.cluster_name    || job.cluster_name    || '—',
    base_domain:     cfg.base_domain     || job.base_domain     || '',
    ocp_version:     cfg.ocp_version     || job.ocp_version     || '—',
    deployment_type: cfg.deployment_type || job.deployment_type || 'sno',
    node_count: source === 'assisted'
      ? (Number(cfg.control_plane_count || 1) + Number(cfg.worker_count || 0))
      : (Number(cfg.control_plane_count || cfg.master_count || 1) +
         Number(cfg.worker_count        || cfg.workers       || 0)),
  }
}

/** Navigate to the new unified Cluster Dashboard */
function clusterDashPath(job) {
  return `/openshift/clusters/${job.source}/${job.id}`
}

/** Navigate to the installer-specific deployment log page */
function deployLogPath(job) {
  return job.source === 'assisted'
    ? `/openshift/jobs/${job.id}`
    : `/ocp-agent/jobs/${job.id}`
}

// ── stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl p-4 flex items-center gap-4">
      <div className={`p-2.5 rounded-lg ${color}`}>
        <Icon size={18} className="opacity-80" />
      </div>
      <div>
        <div className="text-2xl font-bold text-slate-100">{value}</div>
        <div className="text-xs text-slate-500 mt-0.5">{label}</div>
      </div>
    </div>
  )
}

// ── empty state ───────────────────────────────────────────────────────────────

function EmptyState({ navigate }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="p-4 bg-navy-700 rounded-2xl mb-4">
        <Layers size={32} className="text-slate-500" />
      </div>
      <h3 className="text-slate-300 font-semibold text-lg mb-1">No clusters yet</h3>
      <p className="text-slate-500 text-sm max-w-xs mb-6">
        Deploy your first OpenShift cluster using the Assisted Installer
        (cloud-connected) or the Agent-based installer (air-gapped).
      </p>
      <div className="flex gap-3 flex-wrap justify-center">
        <button
          onClick={() => navigate('/openshift/deploy')}
          className="flex items-center gap-2 bg-red-600/80 hover:bg-red-600 text-white font-semibold px-4 py-2 rounded-md text-sm transition-colors"
        >
          <PlusCircle size={14} /> Assisted Installer
        </button>
        <button
          onClick={() => navigate('/ocp-agent/deploy')}
          className="flex items-center gap-2 bg-indigo-600/80 hover:bg-indigo-600 text-white font-semibold px-4 py-2 rounded-md text-sm transition-colors"
        >
          <PlusCircle size={14} /> Agent Installer
        </button>
      </div>
    </div>
  )
}

// ── main component ────────────────────────────────────────────────────────────

export default function OpenShiftClusters() {
  const navigate = useNavigate()
  const [clusters, setClusters] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [showDeploy, setShowDeploy] = useState(false)

  // ── data fetching ───────────────────────────────────────────────────────────

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      // Fetch both installers in parallel
      const [aiRes, agentRes] = await Promise.allSettled([
        api.get('/openshift/jobs'),
        api.get('/ocp-agent/jobs'),
      ])

      const aiJobs    = aiRes.status    === 'fulfilled' ? (aiRes.value.data.jobs    || []) : []
      const agentJobs = agentRes.status === 'fulfilled' ? (agentRes.value.data.jobs || []) : []

      const merged = [
        ...aiJobs.map(j    => normalise(j, 'assisted')),
        ...agentJobs.map(j => normalise(j, 'agent')),
      ].sort((a, b) => (b.created || 0) - (a.created || 0))

      setClusters(merged)

      if (aiRes.status === 'rejected' && agentRes.status === 'rejected') {
        setError('Could not reach either API endpoint.')
      }
    } catch (e) {
      setError(e.message || 'Failed to load clusters')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const t = setInterval(() => refresh(true), 5000)
    return () => clearInterval(t)
  }, [refresh])

  // ── delete ──────────────────────────────────────────────────────────────────

  const deleteCluster = async (job) => {
    const label = job.source === 'assisted' ? 'Assisted Installer' : 'Agent'
    if (!confirm(`Delete cluster "${job.cluster_name}" (${label})? This will destroy VMs and disk images.`)) return
    setDeleting(job.id)
    try {
      const path = job.source === 'assisted'
        ? `/openshift/jobs/${job.id}`
        : `/ocp-agent/jobs/${job.id}`
      await api.delete(path)
      setClusters(prev => prev.filter(c => c.id !== job.id))
    } catch (e) {
      alert(e.response?.data?.error || 'Delete failed')
    } finally {
      setDeleting(null)
    }
  }

  // ── summary counts ──────────────────────────────────────────────────────────

  const total    = clusters.length
  const running  = clusters.filter(c => c.status === 'running' || c.status === 'pending').length
  const complete = clusters.filter(c => c.status === 'complete').length
  const failed   = clusters.filter(c => c.status === 'failed').length

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-sky-500/10 rounded-xl">
            <Layers size={20} className="text-sky-400" />
          </div>
          <div>
            <h1 className="text-slate-100 font-bold text-lg">OpenShift Clusters</h1>
            <p className="text-slate-500 text-xs">All clusters — Assisted Installer and Agent-based</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => refresh()}
            className="p-2 rounded-md text-slate-400 hover:text-sky-400 hover:bg-navy-700 transition-colors"
            title="Refresh"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>

          {/* Deploy split button */}
          <div className="relative">
            <button
              onClick={() => setShowDeploy(v => !v)}
              className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold px-4 py-2 rounded-md text-sm transition-colors"
            >
              <PlusCircle size={15} />
              New Cluster
              <svg className="w-3 h-3 ml-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="6 9 12 15 18 9"/>
              </svg>
            </button>
            {showDeploy && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowDeploy(false)} />
                <div className="absolute right-0 top-full mt-1 z-20 w-52 bg-navy-700 border border-navy-500 rounded-lg shadow-xl overflow-hidden">
                  <button
                    onClick={() => { setShowDeploy(false); navigate('/openshift/deploy') }}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-navy-600 transition-colors text-left"
                  >
                    <span className="w-2 h-2 rounded-full bg-red-400 mt-1.5 flex-shrink-0" />
                    <div>
                      <div className="text-slate-200 text-sm font-medium">Assisted Installer</div>
                      <div className="text-slate-500 text-xs">Requires internet + RH account</div>
                    </div>
                  </button>
                  <button
                    onClick={() => { setShowDeploy(false); navigate('/ocp-agent/deploy') }}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-navy-600 transition-colors text-left border-t border-navy-600"
                  >
                    <span className="w-2 h-2 rounded-full bg-indigo-400 mt-1.5 flex-shrink-0" />
                    <div>
                      <div className="text-slate-200 text-sm font-medium">Agent Installer</div>
                      <div className="text-slate-500 text-xs">Air-gapped / disconnected</div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Total Clusters"   value={total}    icon={Layers}  color="bg-sky-500/10 text-sky-400"    />
        <StatCard label="Active"           value={running}  icon={Zap}     color="bg-yellow-500/10 text-yellow-400" />
        <StatCard label="Complete"         value={complete} icon={CheckCircle} color="bg-green-500/10 text-green-400" />
        <StatCard label="Failed"           value={failed}   icon={XCircle} color="bg-red-500/10 text-red-400"    />
      </div>

      {/* Loading skeleton */}
      {loading && clusters.length === 0 && (
        <div className="space-y-2">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-20 bg-navy-800 border border-navy-600 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && clusters.length === 0 && !error && (
        <EmptyState navigate={navigate} />
      )}

      {/* Cluster table */}
      {clusters.length > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_2fr_auto] gap-4 px-5 py-2.5 border-b border-navy-600 text-xs font-semibold text-slate-500 uppercase tracking-wide">
            <span>Cluster</span>
            <span>Installer</span>
            <span>Type</span>
            <span>Status</span>
            <span>Progress</span>
            <span />
          </div>

          {clusters.map((job, idx) => (
            <div
              key={job.id}
              onClick={() => navigate(clusterDashPath(job))}
              className={`grid grid-cols-[2fr_1fr_1fr_1fr_2fr_auto] gap-4 px-5 py-4 items-center cursor-pointer hover:bg-navy-700/60 transition-colors ${
                idx < clusters.length - 1 ? 'border-b border-navy-700' : ''
              }`}
            >
              {/* Name + meta */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-slate-100 font-semibold text-sm truncate">
                    {job.cluster_name}
                  </span>
                  {job.base_domain && (
                    <span className="text-slate-600 text-xs truncate hidden sm:block">
                      .{job.base_domain}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 mt-0.5">
                  <span className="text-xs text-slate-500 font-mono">{job.ocp_version}</span>
                  <span className="text-xs text-slate-600 flex items-center gap-1">
                    <Users size={10} />
                    {job.node_count} node{job.node_count !== 1 ? 's' : ''}
                  </span>
                  <span className="text-xs text-slate-600">{timeAgo(job.created)}</span>
                </div>
              </div>

              {/* Installer badge */}
              <div><InstallerBadge source={job.source} /></div>

              {/* Type badge */}
              <div><TypeBadge type={job.deployment_type} /></div>

              {/* Status badge */}
              <div><StatusBadge status={job.status} /></div>

              {/* Progress */}
              <div className="space-y-1 min-w-0">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-500 truncate">{job.phase || '—'}</span>
                  <span className="text-slate-400 ml-2 flex-shrink-0">{job.progress}%</span>
                </div>
                <ProgressBar value={job.progress} status={job.status} />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                <button
                  onClick={() => navigate(clusterDashPath(job))}
                  className="p-1.5 text-slate-500 hover:text-sky-400 hover:bg-navy-600 rounded transition-colors"
                  title="Cluster dashboard"
                >
                  <ChevronRight size={15} />
                </button>
                <button
                  onClick={() => navigate(deployLogPath(job))}
                  className="p-1.5 text-slate-500 hover:text-indigo-400 hover:bg-navy-600 rounded transition-colors"
                  title="Deployment log"
                >
                  <FileText size={13} />
                </button>
                <button
                  onClick={() => deleteCluster(job)}
                  disabled={deleting === job.id}
                  className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-navy-600 rounded transition-colors disabled:opacity-40"
                  title="Delete cluster"
                >
                  {deleting === job.id
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Trash2 size={14} />
                  }
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Legend */}
      {clusters.length > 0 && (
        <div className="flex items-center gap-4 text-xs text-slate-600 pt-1">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-red-400" /> Assisted Installer
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-indigo-400" /> Agent Installer
          </span>
        </div>
      )}
    </div>
  )
}
