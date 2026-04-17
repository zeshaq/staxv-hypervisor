/**
 * ClusterDetail — unified per-cluster dashboard.
 *
 * Route: /openshift/clusters/:source/:jobId
 *   source = "assisted" | "agent"
 *
 * FEATURE: cluster-dashboard
 *
 * Shows live cluster health (nodes, operators), access credentials,
 * network configuration, and the full deployment log — all in one place,
 * for clusters deployed by either the Assisted or Agent installer.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import api from '../api'
import {
  ArrowLeft, RefreshCw, Download, ExternalLink, Copy, Check,
  Server, Activity, Network, Settings, FileText, Shield,
  AlertTriangle, CheckCircle, XCircle, Clock, Loader2,
  Eye, EyeOff, Terminal, Layers, Cpu, HardDrive, Users,
  Wifi, Globe, Database, Zap, ChevronDown, ChevronRight,
  RotateCcw, Trash2, MonitorDot, Lock,
} from 'lucide-react'

// ── constants ─────────────────────────────────────────────────────────────────

const INSTALLER_META = {
  assisted: { label: 'Assisted Installer', color: 'bg-red-500/15 text-red-300 border-red-500/30' },
  agent:    { label: 'Agent Installer',    color: 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30' },
}

const DEPLOYMENT_META = {
  sno:     { label: 'Single Node (SNO)', color: 'bg-purple-500/15 text-purple-300 border-purple-500/25' },
  compact: { label: 'Compact (3-node)',  color: 'bg-blue-500/15 text-blue-300 border-blue-500/25' },
  full:    { label: 'Full HA',           color: 'bg-teal-500/15 text-teal-300 border-teal-500/25' },
  multi:   { label: 'Full HA',           color: 'bg-teal-500/15 text-teal-300 border-teal-500/25' },
}

const STATUS_COLORS = {
  complete: 'text-green-400 bg-green-500/10 border-green-500/20',
  failed:   'text-red-400 bg-red-500/10 border-red-500/20',
  running:  'text-sky-400 bg-sky-500/10 border-sky-500/20',
  pending:  'text-yellow-400 bg-yellow-500/10 border-yellow-500/20',
}

const TABS = [
  { id: 'overview',       label: 'Overview',       icon: MonitorDot },
  { id: 'nodes',          label: 'Nodes',           icon: Server },
  { id: 'operators',      label: 'Operators',       icon: Layers },
  { id: 'network',        label: 'Network',         icon: Network },
  { id: 'configuration',  label: 'Configuration',   icon: Settings },
  { id: 'logs',           label: 'Logs',            icon: FileText },
]

// ── tiny helpers ──────────────────────────────────────────────────────────────

function fmt(ts) {
  if (!ts) return '—'
  return new Date(ts * 1000).toLocaleString()
}

function timeAgo(ts) {
  if (!ts) return '—'
  const diff = Math.floor(Date.now() / 1000 - ts)
  if (diff < 60)    return `${diff}s ago`
  if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

function mask(s) {
  if (!s) return '—'
  return s.slice(0, 4) + '•'.repeat(Math.max(0, s.length - 4))
}

// ── CopyButton ────────────────────────────────────────────────────────────────

function CopyBtn({ value, size = 14 }) {
  const [copied, setCopied] = useState(false)
  const copy = () => {
    navigator.clipboard.writeText(value || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <button
      onClick={copy}
      className="ml-1.5 text-slate-500 hover:text-sky-400 transition-colors flex-shrink-0"
      title="Copy"
    >
      {copied ? <Check size={size} className="text-green-400" /> : <Copy size={size} />}
    </button>
  )
}

// ── badges ────────────────────────────────────────────────────────────────────

function Chip({ color, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium border ${color}`}>
      {children}
    </span>
  )
}

function StatusChip({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.pending
  const Icon = { complete: CheckCircle, failed: XCircle, running: Loader2, pending: Clock }[status] || Clock
  return (
    <Chip color={c}>
      <Icon size={11} className={status === 'running' ? 'animate-spin' : ''} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </Chip>
  )
}

// ── ProgressBar ───────────────────────────────────────────────────────────────

function ProgressBar({ value, status, height = 'h-2' }) {
  const color =
    status === 'complete' ? 'bg-green-500' :
    status === 'failed'   ? 'bg-red-500'   :
    status === 'running'  ? 'bg-sky-500'   : 'bg-yellow-500'
  return (
    <div className={`w-full bg-navy-700 rounded-full ${height}`}>
      <div
        className={`${height} rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(value ?? 0, 100)}%` }}
      />
    </div>
  )
}

// ── InfoRow ───────────────────────────────────────────────────────────────────

function InfoRow({ label, value, mono = false, copy = false, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-navy-700 last:border-0">
      <span className="text-slate-500 text-sm flex-shrink-0 w-44">{label}</span>
      <span className={`text-slate-200 text-sm text-right flex items-center gap-1 min-w-0 ${mono ? 'font-mono text-xs' : ''}`}>
        {children || value || '—'}
        {copy && value && <CopyBtn value={value} />}
      </span>
    </div>
  )
}

// ── Section card ──────────────────────────────────────────────────────────────

function Card({ title, icon: Icon, children, action, className = '' }) {
  return (
    <div className={`bg-navy-800 border border-navy-600 rounded-xl overflow-hidden ${className}`}>
      {title && (
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-navy-700">
          <div className="flex items-center gap-2.5 text-slate-300 font-semibold text-sm">
            {Icon && <Icon size={15} className="text-sky-400" />}
            {title}
          </div>
          {action}
        </div>
      )}
      <div className="px-5 py-4">{children}</div>
    </div>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon: Icon, color, loading }) {
  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl p-4 flex items-center gap-4">
      <div className={`p-2.5 rounded-xl ${color} flex-shrink-0`}>
        <Icon size={18} className="opacity-80" />
      </div>
      <div className="min-w-0">
        {loading
          ? <div className="h-6 w-16 bg-navy-700 rounded animate-pulse mb-1" />
          : <div className="text-xl font-bold text-slate-100 truncate">{value ?? '—'}</div>
        }
        <div className="text-xs text-slate-500">{label}</div>
        {sub && <div className="text-xs text-slate-600 mt-0.5 truncate">{sub}</div>}
      </div>
    </div>
  )
}

// ── CredentialRow (password reveal + copy) ────────────────────────────────────

function CredentialRow({ label, value, mono = true }) {
  const [show, setShow] = useState(false)
  if (!value) return null
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b border-navy-700 last:border-0">
      <span className="text-slate-500 text-sm flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className={`text-slate-200 text-sm ${mono ? 'font-mono' : ''} truncate`}>
          {show ? value : mask(value)}
        </span>
        <button
          onClick={() => setShow(v => !v)}
          className="text-slate-500 hover:text-sky-400 transition-colors flex-shrink-0 ml-1"
          title={show ? 'Hide' : 'Reveal'}
        >
          {show ? <EyeOff size={13} /> : <Eye size={13} />}
        </button>
        <CopyBtn value={value} size={13} />
      </div>
    </div>
  )
}

// ── NodeCard (for AI per-node stage data) ─────────────────────────────────────

function NodeCard({ node }) {
  const roleColor = node.role === 'master' ? 'bg-sky-500/15 text-sky-300' : 'bg-slate-500/15 text-slate-300'
  const stageProgress = node.status === 'Done' ? 100 : node.stage_pct || 0
  const statusColor =
    node.status === 'Done'    ? 'text-green-400' :
    node.status === 'Failed'  ? 'text-red-400'   :
    node.stuck                ? 'text-orange-400' : 'text-sky-400'
  return (
    <div className="bg-navy-750 border border-navy-600 rounded-lg p-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Server size={14} className="text-slate-500 flex-shrink-0" />
          <span className="text-slate-200 text-sm font-medium truncate">{node.vm || node.name || node.id}</span>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${roleColor}`}>{node.role}</span>
      </div>
      <div className="flex items-center justify-between text-xs mb-1.5">
        <span className={statusColor}>{node.stage || node.status || '—'}</span>
        {node.stuck && <span className="text-orange-400 flex items-center gap-1"><AlertTriangle size={10} /> Stuck {node.stuck_min}m</span>}
      </div>
      <ProgressBar value={stageProgress} status={node.status === 'Done' ? 'complete' : 'running'} height="h-1" />
    </div>
  )
}

// ── Operator row ──────────────────────────────────────────────────────────────

function OperatorRow({ op }) {
  const [expanded, setExpanded] = useState(false)
  const available   = op.available   === 'True'
  const progressing = op.progressing === 'True'
  const degraded    = op.degraded    === 'True'

  const status = degraded ? 'degraded' : !available ? 'unavailable' : progressing ? 'progressing' : 'available'
  const statusMeta = {
    available:   { color: 'text-green-400',  label: 'Available',   icon: CheckCircle },
    progressing: { color: 'text-sky-400',    label: 'Progressing', icon: Loader2 },
    unavailable: { color: 'text-yellow-400', label: 'Unavailable', icon: Clock },
    degraded:    { color: 'text-red-400',    label: 'Degraded',    icon: XCircle },
  }[status]

  const Icon = statusMeta.icon
  const hasMsg = op.message && op.message.trim()

  return (
    <div className={`border-b border-navy-700 last:border-0 ${degraded ? 'bg-red-500/5' : ''}`}>
      <button
        className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-navy-700/40 transition-colors text-left"
        onClick={() => hasMsg && setExpanded(v => !v)}
      >
        <Icon size={13} className={`flex-shrink-0 ${statusMeta.color} ${status === 'progressing' ? 'animate-spin' : ''}`} />
        <span className="text-slate-300 text-sm flex-1 font-mono">{op.name}</span>
        <span className={`text-xs ${statusMeta.color}`}>{statusMeta.label}</span>
        {hasMsg && (
          <ChevronRight size={12} className={`text-slate-600 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        )}
      </button>
      {expanded && hasMsg && (
        <div className="px-10 pb-3 text-xs text-slate-500 font-mono leading-relaxed">{op.message}</div>
      )}
    </div>
  )
}

// ── Log viewer ────────────────────────────────────────────────────────────────

function LogViewer({ logs }) {
  const [filter, setFilter]         = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [autoScroll, setAutoScroll]   = useState(true)
  const bottomRef = useRef(null)

  const LEVEL_COLORS = { ERROR: 'text-red-400', WARN: 'text-yellow-400', INFO: 'text-sky-300', DEBUG: 'text-slate-500' }

  const filtered = (logs || []).filter(l => {
    const matchText  = !filter || (l.msg || l.message || '').toLowerCase().includes(filter.toLowerCase())
    const matchLevel = levelFilter === 'all' || (l.level || 'INFO') === levelFilter
    return matchText && matchLevel
  })

  useEffect(() => {
    if (autoScroll && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: 'smooth' })
  }, [logs, autoScroll])

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter logs…"
          className="flex-1 min-w-40 bg-navy-700 border border-navy-500 text-slate-300 text-xs rounded-md px-3 py-1.5 focus:outline-none focus:border-sky-500"
        />
        <select
          value={levelFilter}
          onChange={e => setLevelFilter(e.target.value)}
          className="bg-navy-700 border border-navy-500 text-slate-300 text-xs rounded-md px-2 py-1.5"
        >
          {['all', 'INFO', 'WARN', 'ERROR', 'DEBUG'].map(l => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
          <input type="checkbox" checked={autoScroll} onChange={e => setAutoScroll(e.target.checked)} className="accent-sky-500" />
          Auto-scroll
        </label>
        <span className="text-xs text-slate-600">{filtered.length} / {(logs || []).length} lines</span>
      </div>
      <div className="bg-navy-950 border border-navy-700 rounded-lg h-96 overflow-y-auto font-mono text-xs p-3 space-y-0.5">
        {filtered.length === 0 && (
          <div className="text-slate-600 text-center py-8">No log entries</div>
        )}
        {filtered.map((entry, i) => {
          const level = (entry.level || 'INFO').toUpperCase()
          const color = LEVEL_COLORS[level] || 'text-slate-400'
          const ts = entry.ts ? new Date(entry.ts * 1000).toLocaleTimeString() : ''
          return (
            <div key={i} className="flex gap-2 leading-5">
              <span className="text-slate-700 flex-shrink-0 w-20">{ts}</span>
              <span className={`flex-shrink-0 w-12 ${color}`}>[{level}]</span>
              <span className="text-slate-300 break-all">{entry.msg || entry.message || ''}</span>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

// ── KubectlSnippets ───────────────────────────────────────────────────────────

function KubectlSnippets({ clusterName }) {
  const cmds = [
    { label: 'Export kubeconfig',   cmd: `export KUBECONFIG=~/kubeconfig-${clusterName}` },
    { label: 'Get nodes',           cmd: 'oc get nodes' },
    { label: 'Cluster operators',   cmd: 'oc get co' },
    { label: 'All pods (all ns)',    cmd: 'oc get pods -A' },
    { label: 'Cluster version',     cmd: 'oc get clusterversion' },
    { label: 'Console route',       cmd: 'oc get route console -n openshift-console' },
  ]
  return (
    <div className="space-y-2">
      {cmds.map(({ label, cmd }) => (
        <div key={label} className="flex items-center justify-between gap-3 bg-navy-900 border border-navy-700 rounded-md px-3 py-2">
          <div className="min-w-0">
            <div className="text-xs text-slate-500 mb-0.5">{label}</div>
            <code className="text-xs text-green-300 font-mono">{cmd}</code>
          </div>
          <CopyBtn value={cmd} />
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ClusterDetail() {
  const { source, jobId } = useParams()
  const navigate = useNavigate()

  const apiPrefix = source === 'agent' ? '/ocp-agent' : '/openshift'
  const deployDetailPath = source === 'agent'
    ? `/ocp-agent/jobs/${jobId}`
    : `/openshift/jobs/${jobId}`

  const [job,         setJob]         = useState(null)
  const [cluster,     setCluster]     = useState(null)   // live kubectl data
  const [loading,     setLoading]     = useState(true)
  const [clusterLoading, setClusterLoading] = useState(false)
  const [error,       setError]       = useState(null)
  const [activeTab,   setActiveTab]   = useState('overview')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [deleting,    setDeleting]    = useState(false)

  // ── fetch job ───────────────────────────────────────────────────────────────

  const fetchJob = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const r = await api.get(`${apiPrefix}/jobs/${jobId}`)
      setJob(r.data)
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load cluster details')
    } finally {
      setLoading(false)
    }
  }, [apiPrefix, jobId])

  // ── fetch live cluster status ───────────────────────────────────────────────

  const fetchCluster = useCallback(async () => {
    setClusterLoading(true)
    try {
      const r = await api.get(`${apiPrefix}/jobs/${jobId}/cluster`)
      setCluster(r.data)
    } catch {
      // cluster may not be ready yet — silently ignore
    } finally {
      setClusterLoading(false)
    }
  }, [apiPrefix, jobId])

  useEffect(() => {
    fetchJob()
  }, [fetchJob])

  useEffect(() => {
    if (!job) return
    if (job.status === 'complete') fetchCluster()
  }, [job?.status]) // eslint-disable-line

  // auto-refresh every 10 s when running
  useEffect(() => {
    if (!autoRefresh) return
    const t = setInterval(() => {
      fetchJob(true)
      if (job?.status === 'complete') fetchCluster()
    }, 10_000)
    return () => clearInterval(t)
  }, [autoRefresh, fetchJob, fetchCluster, job?.status])

  // ── download kubeconfig ─────────────────────────────────────────────────────

  const downloadKubeconfig = () => {
    window.location.href = `/api${apiPrefix}/jobs/${jobId}/kubeconfig`
  }

  // ── delete cluster ──────────────────────────────────────────────────────────

  const deleteCluster = async () => {
    if (!confirm(`Delete cluster "${job?.config?.cluster_name}"? This will destroy VMs and disk images.`)) return
    setDeleting(true)
    try {
      await api.delete(`${apiPrefix}/jobs/${jobId}`)
      navigate('/openshift/clusters')
    } catch (e) {
      alert(e.response?.data?.error || 'Delete failed')
      setDeleting(false)
    }
  }

  // ── loading / error states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-8 w-64 bg-navy-700 rounded" />
        <div className="h-40 bg-navy-800 border border-navy-600 rounded-xl" />
        <div className="grid grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-navy-800 border border-navy-600 rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <XCircle size={36} className="text-red-400" />
        <p className="text-red-400 font-medium">{error}</p>
        <button onClick={() => navigate('/openshift/clusters')} className="text-sky-400 hover:underline text-sm flex items-center gap-1">
          <ArrowLeft size={14} /> Back to clusters
        </button>
      </div>
    )
  }

  if (!job) return null

  // ── derived data ────────────────────────────────────────────────────────────

  const cfg     = job.config  || {}
  const result  = job.result  || {}
  const srcMeta = INSTALLER_META[source] || INSTALLER_META.assisted
  const typeMeta = DEPLOYMENT_META[cfg.deployment_type] || { label: cfg.deployment_type || '—', color: 'bg-slate-500/15 text-slate-300 border-slate-500/25' }

  const nodesReady    = cluster ? cluster.nodes?.filter(n => n.ready).length : null
  const nodesTotal    = cluster ? cluster.nodes?.length : null
  const opsAvailable  = cluster ? cluster.operators?.filter(o => o.available === 'True').length : null
  const opsTotal      = cluster ? cluster.operators?.length : null
  const opsDegraded   = cluster ? cluster.operators?.filter(o => o.degraded === 'True').length : 0

  const isComplete = job.status === 'complete'

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <button
            onClick={() => navigate('/openshift/clusters')}
            className="mt-0.5 p-1.5 text-slate-500 hover:text-sky-400 hover:bg-navy-700 rounded-md transition-colors flex-shrink-0"
            title="Back to clusters"
          >
            <ArrowLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-slate-100 font-bold text-xl">
                {cfg.cluster_name || jobId}
              </h1>
              {cfg.base_domain && (
                <span className="text-slate-500 text-sm">.{cfg.base_domain}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <StatusChip status={job.status} />
              <Chip color={srcMeta.color}>{srcMeta.label}</Chip>
              <Chip color={typeMeta.color}>{typeMeta.label}</Chip>
              {cfg.ocp_version && (
                <span className="text-xs text-slate-500 font-mono bg-navy-700 px-2 py-0.5 rounded-md border border-navy-600">
                  OCP {cfg.ocp_version}
                </span>
              )}
              {cluster?.version?.version && (
                <span className="text-xs text-green-400 font-mono bg-green-500/10 px-2 py-0.5 rounded-md border border-green-500/20">
                  ✓ {cluster.version.version}
                </span>
              )}
            </div>
            <div className="text-xs text-slate-600 mt-1.5 flex items-center gap-3">
              <span>ID: <span className="font-mono">{jobId}</span></span>
              <span>Created {fmt(job.created)}</span>
              <span>{timeAgo(job.created)}</span>
            </div>
          </div>
        </div>

        {/* Action bar */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => { fetchJob(true); if (isComplete) fetchCluster() }}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 hover:text-sky-400 border border-navy-600 hover:border-sky-500/50 rounded-md transition-colors"
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>

          {isComplete && result?.kubeconfig_path && (
            <button
              onClick={downloadKubeconfig}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-sky-300 border border-sky-500/40 hover:bg-sky-500/10 rounded-md transition-colors"
            >
              <Download size={13} />
              Kubeconfig
            </button>
          )}

          {isComplete && result?.console_url && (
            <a
              href={result.console_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-green-300 border border-green-500/40 hover:bg-green-500/10 rounded-md transition-colors"
            >
              <ExternalLink size={13} />
              Console
            </a>
          )}

          <Link
            to={deployDetailPath}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-400 border border-navy-600 hover:border-slate-500 rounded-md transition-colors"
          >
            <FileText size={13} />
            Deploy Log
          </Link>

          <button
            onClick={deleteCluster}
            disabled={deleting}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-red-400 border border-red-500/30 hover:bg-red-500/10 rounded-md transition-colors disabled:opacity-40"
          >
            {deleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            Delete
          </button>
        </div>
      </div>

      {/* ── Stat cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          label="Nodes Ready"
          value={nodesTotal !== null ? `${nodesReady} / ${nodesTotal}` : (isComplete ? '…' : '—')}
          icon={Server}
          color="bg-sky-500/10 text-sky-400"
          loading={clusterLoading && !cluster}
        />
        <StatCard
          label="Operators"
          value={opsTotal !== null ? `${opsAvailable} / ${opsTotal}` : (isComplete ? '…' : '—')}
          sub={opsDegraded > 0 ? `${opsDegraded} degraded` : null}
          icon={Layers}
          color={opsDegraded > 0 ? 'bg-red-500/10 text-red-400' : 'bg-teal-500/10 text-teal-400'}
          loading={clusterLoading && !cluster}
        />
        <StatCard
          label="Deployment"
          value={`${job.progress ?? 0}%`}
          sub={job.phase || ''}
          icon={Activity}
          color="bg-indigo-500/10 text-indigo-400"
        />
        <StatCard
          label="Cluster Version"
          value={cluster?.version?.version ? cluster.version.version.split('.').slice(0, 2).join('.') : cfg.ocp_version || '—'}
          sub={cluster?.version?.channel || ''}
          icon={Zap}
          color="bg-amber-500/10 text-amber-400"
        />
      </div>

      {/* ── Tabs ── */}
      <div className="border-b border-navy-600">
        <div className="flex gap-0 -mb-px overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-sky-400 text-sky-400'
                    : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}
              >
                <Icon size={14} />
                {tab.label}
                {tab.id === 'operators' && opsDegraded > 0 && (
                  <span className="ml-0.5 bg-red-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                    {opsDegraded}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: OVERVIEW                                                        */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

          {/* Deployment progress */}
          <Card title="Deployment Status" icon={Activity}>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-slate-400 text-sm">{job.phase || 'Waiting'}</span>
                <span className="text-slate-300 font-bold text-sm">{job.progress ?? 0}%</span>
              </div>
              <ProgressBar value={job.progress} status={job.status} height="h-2.5" />

              {/* Events / errors */}
              {cluster?.errors?.length > 0 && (
                <div className="mt-3 space-y-1.5">
                  {cluster.errors.slice(0, 3).map((e, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-red-400 bg-red-500/10 rounded-md px-3 py-2">
                      <AlertTriangle size={11} className="mt-0.5 flex-shrink-0" />
                      <span className="font-mono break-all">{e}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="pt-2 space-y-0">
                <InfoRow label="Status"  value={job.status} />
                <InfoRow label="Phase"   value={job.phase || '—'} />
                <InfoRow label="Created" value={fmt(job.created)} />
                <InfoRow label="Job ID"  value={jobId} mono copy />
              </div>
            </div>
          </Card>

          {/* Access credentials */}
          <Card
            title="Access &amp; Credentials"
            icon={Lock}
            action={
              isComplete && result?.kubeconfig_path && (
                <button onClick={downloadKubeconfig} className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 transition-colors">
                  <Download size={12} /> Download kubeconfig
                </button>
              )
            }
          >
            {isComplete ? (
              <div className="space-y-0">
                <CredentialRow label="kubeadmin password" value={result?.kubeadmin_password} />
                <div className="flex items-center justify-between gap-3 py-2.5 border-b border-navy-700">
                  <span className="text-slate-500 text-sm flex-shrink-0">Console URL</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    {result?.console_url
                      ? <a href={result.console_url} target="_blank" rel="noopener noreferrer" className="text-sky-400 hover:text-sky-300 text-sm truncate flex items-center gap-1">
                          {result.console_url} <ExternalLink size={11} />
                        </a>
                      : <span className="text-slate-500 text-sm">—</span>
                    }
                    {result?.console_url && <CopyBtn value={result.console_url} />}
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-slate-500 text-sm flex-shrink-0">API URL</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-slate-300 text-sm font-mono text-xs truncate">{result?.api_url || '—'}</span>
                    {result?.api_url && <CopyBtn value={result.api_url} />}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-6 text-center text-slate-500 text-sm">
                <Lock size={24} className="mx-auto mb-2 opacity-30" />
                Credentials available after deployment completes
              </div>
            )}
          </Card>

          {/* AI per-node progress (Assisted Installer only) */}
          {source === 'assisted' && job.nodes && job.nodes.length > 0 && (
            <Card title="Node Install Progress" icon={Server} className="lg:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {job.nodes.map(n => <NodeCard key={n.id || n.vm || n.name} node={n} />)}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: NODES                                                           */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'nodes' && (
        <div className="space-y-4">
          {/* Live nodes from kubectl */}
          {isComplete && (
            <Card
              title="Live Nodes"
              icon={Server}
              action={
                <button onClick={fetchCluster} className="flex items-center gap-1 text-xs text-slate-500 hover:text-sky-400 transition-colors">
                  <RefreshCw size={12} className={clusterLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              }
            >
              {clusterLoading && !cluster && (
                <div className="py-8 text-center text-slate-500 text-sm flex items-center justify-center gap-2">
                  <Loader2 size={16} className="animate-spin" /> Loading live node data…
                </div>
              )}
              {cluster?.nodes?.length > 0 ? (
                <div className="overflow-x-auto -mx-5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-navy-700">
                        {['Node', 'Roles', 'Ready', 'Kubelet Version'].map(h => (
                          <th key={h} className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {cluster.nodes.map(n => (
                        <tr key={n.name} className="border-b border-navy-700 last:border-0 hover:bg-navy-700/30 transition-colors">
                          <td className="px-5 py-3">
                            <span className="font-mono text-slate-200 text-xs">{n.name}</span>
                          </td>
                          <td className="px-5 py-3">
                            <div className="flex gap-1.5 flex-wrap">
                              {(n.roles || []).map(r => (
                                <span key={r} className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                                  r === 'master' || r === 'control-plane'
                                    ? 'bg-sky-500/15 text-sky-300 border-sky-500/25'
                                    : 'bg-slate-500/15 text-slate-300 border-slate-500/25'
                                }`}>{r}</span>
                              ))}
                            </div>
                          </td>
                          <td className="px-5 py-3">
                            {n.ready
                              ? <span className="flex items-center gap-1.5 text-green-400 text-xs"><CheckCircle size={13} /> Ready</span>
                              : <span className="flex items-center gap-1.5 text-yellow-400 text-xs"><Clock size={13} /> Not Ready</span>
                            }
                          </td>
                          <td className="px-5 py-3">
                            <span className="font-mono text-slate-400 text-xs">{n.kubelet_version || '—'}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                !clusterLoading && (
                  <div className="py-8 text-center text-slate-500 text-sm">
                    {isComplete ? 'No node data available. Cluster may still be starting up.' : 'Node data available after deployment.'}
                  </div>
                )
              )}
            </Card>
          )}

          {/* Defined nodes (from config — Agent installer) */}
          {source === 'agent' && cfg.nodes && cfg.nodes.length > 0 && (
            <Card title="Configured Nodes" icon={Cpu}>
              <div className="overflow-x-auto -mx-5">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-navy-700">
                      {['Hostname', 'Role', 'IP', 'MAC', 'vCPU', 'RAM', 'Disk'].map(h => (
                        <th key={h} className="text-left px-5 py-2 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cfg.nodes.map((n, i) => (
                      <tr key={i} className="border-b border-navy-700 last:border-0 hover:bg-navy-700/30">
                        <td className="px-5 py-2.5 font-mono text-slate-200 text-xs">{n.hostname || '—'}</td>
                        <td className="px-5 py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${
                            n.role === 'master'
                              ? 'bg-sky-500/15 text-sky-300 border-sky-500/25'
                              : 'bg-slate-500/15 text-slate-300 border-slate-500/25'
                          }`}>{n.role}</span>
                        </td>
                        <td className="px-5 py-2.5 font-mono text-slate-300 text-xs">{n.ip || '—'}</td>
                        <td className="px-5 py-2.5 font-mono text-slate-400 text-xs">{n.mac || '—'}</td>
                        <td className="px-5 py-2.5 text-slate-400 text-xs">{n.vcpu || '—'}</td>
                        <td className="px-5 py-2.5 text-slate-400 text-xs">{n.ram_mb ? `${n.ram_mb / 1024} GB` : '—'}</td>
                        <td className="px-5 py-2.5 text-slate-400 text-xs">{n.disk_gb ? `${n.disk_gb} GB` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* AI per-node install progress */}
          {source === 'assisted' && job.nodes && job.nodes.length > 0 && (
            <Card title="Install Progress per Node" icon={Activity}>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {job.nodes.map(n => <NodeCard key={n.id || n.vm || n.name} node={n} />)}
              </div>
            </Card>
          )}

          {/* Created VMs list */}
          {job.vms && job.vms.length > 0 && (
            <Card title="Virtual Machines" icon={MonitorDot}>
              <div className="flex flex-wrap gap-2">
                {job.vms.map(vm => (
                  <span key={vm} className="font-mono text-xs bg-navy-700 border border-navy-600 text-slate-300 px-3 py-1.5 rounded-md">
                    {vm}
                  </span>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: OPERATORS                                                       */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'operators' && (
        <div className="space-y-4">
          {/* Operator summary chips */}
          {cluster?.operators && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs text-slate-500">
                {opsAvailable}/{opsTotal} available
              </span>
              {opsDegraded > 0 && (
                <Chip color="text-red-400 bg-red-500/10 border-red-500/20">
                  <AlertTriangle size={11} /> {opsDegraded} degraded
                </Chip>
              )}
              {cluster.operators.filter(o => o.progressing === 'True').length > 0 && (
                <Chip color="text-sky-400 bg-sky-500/10 border-sky-500/20">
                  <Loader2 size={11} className="animate-spin" />
                  {cluster.operators.filter(o => o.progressing === 'True').length} progressing
                </Chip>
              )}
            </div>
          )}

          <Card
            title="Cluster Operators"
            icon={Layers}
            action={
              <button onClick={fetchCluster} className="flex items-center gap-1 text-xs text-slate-500 hover:text-sky-400 transition-colors">
                <RefreshCw size={12} className={clusterLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            }
          >
            {clusterLoading && !cluster && (
              <div className="py-8 text-center text-slate-500 flex items-center justify-center gap-2">
                <Loader2 size={16} className="animate-spin" /> Loading operator status…
              </div>
            )}
            {cluster?.operators?.length > 0 ? (
              <div className="-mx-5 -my-4">
                {[...cluster.operators]
                  .sort((a, b) => {
                    // degraded first, then progressing, then unavailable, then available
                    const score = o => o.degraded === 'True' ? 0 : o.progressing === 'True' ? 1 : o.available !== 'True' ? 2 : 3
                    return score(a) - score(b)
                  })
                  .map(op => <OperatorRow key={op.name} op={op} />)
                }
              </div>
            ) : (
              !clusterLoading && (
                <div className="py-8 text-center text-slate-500 text-sm">
                  {isComplete ? 'No operator data yet. The cluster may still be initializing.' : 'Operator data available after deployment.'}
                </div>
              )
            )}
          </Card>

          {/* Assisted Installer operator tracking */}
          {source === 'assisted' && job.ai_operators && job.ai_operators.length > 0 && (
            <Card title="Installer Operator Tracking" icon={Activity}>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                {job.ai_operators.map(op => {
                  const ok = op.status === 'available'
                  return (
                    <div key={op.name} className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs border ${
                      ok ? 'bg-green-500/8 border-green-500/20 text-green-300' :
                           'bg-navy-750 border-navy-600 text-slate-400'
                    }`}>
                      {ok ? <CheckCircle size={11} /> : <Clock size={11} />}
                      <span className="font-mono truncate">{op.name}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: NETWORK                                                         */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'network' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Cluster Networking" icon={Network}>
            <div className="space-y-0">
              <InfoRow label="Machine CIDR"  value={cfg.machine_cidr}  copy />
              <InfoRow label="Cluster CIDR"  value={cfg.cluster_cidr}  copy />
              <InfoRow label="Service CIDR"  value={cfg.service_cidr}  copy />
              <InfoRow label="API VIP"       value={cfg.api_vip}       copy mono />
              <InfoRow label="Ingress VIP"   value={cfg.ingress_vip}   copy mono />
              <InfoRow label="Libvirt Network" value={cfg.libvirt_network} />
            </div>
          </Card>

          <Card title="DNS &amp; Gateway" icon={Globe}>
            <div className="space-y-0">
              <InfoRow label="Base Domain"  value={cfg.base_domain}   copy />
              <InfoRow label="API URL"      value={result?.api_url}   copy mono />
              <InfoRow label="Console URL"  value={result?.console_url} copy />
              {(cfg.gateway || cfg.dns || cfg.dns_servers) && (
                <>
                  <InfoRow label="Gateway"    value={cfg.gateway}       copy mono />
                  <InfoRow label="DNS"        value={cfg.dns || cfg.dns_servers} copy mono />
                  <InfoRow label="Prefix len" value={cfg.prefix_len?.toString()} />
                </>
              )}
              {cfg.rendezvous_ip && (
                <InfoRow label="Rendezvous IP" value={cfg.rendezvous_ip} copy mono />
              )}
            </div>
          </Card>

          {/* Per-node IPs (Agent) */}
          {source === 'agent' && cfg.nodes && cfg.nodes.length > 0 && (
            <Card title="Node IP Addresses" icon={Wifi} className="lg:col-span-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {cfg.nodes.map((n, i) => (
                  <div key={i} className="bg-navy-750 border border-navy-600 rounded-lg p-3">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono text-sm text-slate-200">{n.hostname || `node-${i}`}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full border ${
                        n.role === 'master'
                          ? 'bg-sky-500/15 text-sky-300 border-sky-500/25'
                          : 'bg-slate-500/15 text-slate-300 border-slate-500/25'
                      }`}>{n.role}</span>
                    </div>
                    <div className="space-y-1 text-xs">
                      {n.ip  && <div className="flex items-center justify-between"><span className="text-slate-500">IP</span><span className="font-mono text-slate-300 flex items-center">{n.ip} <CopyBtn value={n.ip} size={11} /></span></div>}
                      {n.mac && <div className="flex items-center justify-between"><span className="text-slate-500">MAC</span><span className="font-mono text-slate-400">{n.mac}</span></div>}
                      {n.interface && <div className="flex items-center justify-between"><span className="text-slate-500">Interface</span><span className="font-mono text-slate-400">{n.interface}</span></div>}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: CONFIGURATION                                                   */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'configuration' && (
        <div className="space-y-4">
          <Card title="Cluster Config" icon={Settings}>
            <div className="space-y-0">
              <InfoRow label="Cluster Name"        value={cfg.cluster_name}          copy />
              <InfoRow label="Base Domain"         value={cfg.base_domain}           copy />
              <InfoRow label="OCP Version"         value={cfg.ocp_version} />
              <InfoRow label="Deployment Type"     value={cfg.deployment_type} />
              <InfoRow label="Control Plane Nodes" value={String(cfg.control_plane_count ?? cfg.master_count ?? '—')} />
              <InfoRow label="Worker Nodes"        value={String(cfg.worker_count ?? cfg.workers ?? 0)} />
              <InfoRow label="Storage Path"        value={cfg.storage_path}          copy mono />
              {source === 'assisted' && cfg.cluster_id && (
                <InfoRow label="AI Cluster ID"     value={cfg.cluster_id}            copy mono />
              )}
              {source === 'agent' && cfg.binary && (
                <InfoRow label="Installer Binary"  value={cfg.binary}                mono />
              )}
            </div>
          </Card>

          {/* Hardware specs (Agent installer) */}
          {source === 'agent' && (cfg.cp_vcpus || cfg.cp_ram_gb) && (
            <Card title="Hardware Specs" icon={Cpu}>
              <div className="grid grid-cols-2 gap-0">
                <div>
                  <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-2">Control Plane</div>
                  <InfoRow label="vCPUs"  value={String(cfg.cp_vcpus  || '—')} />
                  <InfoRow label="RAM"    value={cfg.cp_ram_gb  ? `${cfg.cp_ram_gb} GB` : '—'} />
                  <InfoRow label="Disk"   value={cfg.cp_disk_gb ? `${cfg.cp_disk_gb} GB` : '—'} />
                </div>
                {(cfg.w_vcpus || cfg.w_ram_gb) && (
                  <div className="pl-6 border-l border-navy-700">
                    <div className="text-xs text-slate-500 font-semibold uppercase tracking-wide mb-2">Workers</div>
                    <InfoRow label="vCPUs"  value={String(cfg.w_vcpus  || '—')} />
                    <InfoRow label="RAM"    value={cfg.w_ram_gb  ? `${cfg.w_ram_gb} GB` : '—'} />
                    <InfoRow label="Disk"   value={cfg.w_disk_gb ? `${cfg.w_disk_gb} GB` : '—'} />
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* kubectl quick-reference */}
          <Card title="kubectl / oc Quick Commands" icon={Terminal}>
            <KubectlSnippets clusterName={cfg.cluster_name || jobId} />
          </Card>

          {/* Installer meta */}
          <Card title="Installer Info" icon={Database}>
            <div className="space-y-0">
              <InfoRow label="Installer"     value={source === 'assisted' ? 'Red Hat Assisted Installer' : 'Agent-based Installer'} />
              <InfoRow label="Job ID"        value={jobId}                   copy mono />
              {source === 'assisted' && job.cluster_id && (
                <InfoRow label="AI Cluster ID"  value={job.cluster_id}       copy mono />
              )}
              {source === 'assisted' && job.infra_env_id && (
                <InfoRow label="InfraEnv ID"    value={job.infra_env_id}     copy mono />
              )}
              {source === 'agent' && job.iso_path && (
                <InfoRow label="Agent ISO"      value={job.iso_path}         mono />
              )}
              <InfoRow label="Created"       value={fmt(job.created)} />
            </div>
          </Card>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════ */}
      {/* TAB: LOGS                                                            */}
      {/* ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === 'logs' && (
        <Card title="Deployment Log" icon={FileText}
          action={
            <Link to={deployDetailPath} className="text-xs text-slate-500 hover:text-sky-400 transition-colors flex items-center gap-1">
              <ExternalLink size={12} /> Full detail page
            </Link>
          }
        >
          <LogViewer logs={job.logs} />
        </Card>
      )}

      {/* ── Footer ── */}
      <div className="flex items-center justify-between text-xs text-slate-700 pt-2 border-t border-navy-700">
        <label className="flex items-center gap-1.5 cursor-pointer hover:text-slate-500 transition-colors">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={e => setAutoRefresh(e.target.checked)}
            className="accent-sky-500"
          />
          Auto-refresh (10 s)
        </label>
        <span>
          {source === 'assisted' ? 'Assisted Installer' : 'Agent Installer'} ·{' '}
          Last updated {new Date().toLocaleTimeString()}
        </span>
      </div>
    </div>
  )
}
