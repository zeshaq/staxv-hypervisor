import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Server, ArrowLeft, CheckCircle, XCircle, Loader2,
  Terminal, Download, Copy, Check, ExternalLink, RefreshCw,
  AlertTriangle, ChevronDown, ChevronRight,
  Trash2, Search, ChevronsDown, Maximize2, Minimize2,
  Binary, Settings, Disc3, Cpu, Package, Trophy, X,
  Clock, SkipForward, ListChecks,
} from 'lucide-react'
import api from '../api'

// ── Phase stepper definitions ─────────────────────────────────────────────────
const STEPS = [
  { id: 'binary',    label: 'Binary',    Icon: Binary,    min: 0,  max: 14  },
  { id: 'config',    label: 'Config',    Icon: Settings,  min: 15, max: 28  },
  { id: 'iso',       label: 'ISO',       Icon: Disc3,     min: 29, max: 42  },
  { id: 'vms',       label: 'VMs',       Icon: Server,    min: 43, max: 56  },
  { id: 'bootstrap', label: 'Bootstrap', Icon: Package,   min: 57, max: 70  },
  { id: 'install',   label: 'Install',   Icon: Cpu,       min: 71, max: 97  },
  { id: 'done',      label: 'Done',      Icon: Trophy,    min: 98, max: 101 },
]

// ── Step timeline ─────────────────────────────────────────────────────────────
function StepTimeline({ progress, isComplete, isFailed }) {
  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl p-4">
      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const done    = isComplete || progress > step.max
          const active  = !isComplete && !isFailed && progress >= step.min && progress <= step.max
          const failed  = isFailed && active
          const pending = !done && !active && !failed

          return (
            <div key={step.id} className="flex items-center flex-1">
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  failed  ? 'bg-red-500/20 border border-red-500/50' :
                  done    ? 'bg-green-500/20 border border-green-500/50' :
                  active  ? 'bg-sky-500/20 border border-sky-500/50' :
                            'bg-navy-700 border border-navy-600'
                }`}>
                  {failed  ? <XCircle     size={14} className="text-red-400" />
                  : done   ? <CheckCircle size={14} className="text-green-400" />
                  : active ? <Loader2     size={14} className="text-sky-400 animate-spin" />
                  :          <step.Icon  size={14} className="text-slate-600" />}
                </div>
                <span className={`text-[10px] font-medium whitespace-nowrap ${
                  failed  ? 'text-red-400' :
                  done    ? 'text-green-400' :
                  active  ? 'text-sky-300' :
                            'text-slate-600'
                }`}>{step.label}</span>
              </div>
              {idx < STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 mx-1 rounded transition-all ${
                  progress > step.max ? 'bg-green-500/40' : 'bg-navy-600'
                }`} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Task table ────────────────────────────────────────────────────────────────

const TASK_STATUS_CFG = {
  pending:  { icon: Clock,        color: 'text-slate-500',  bg: 'bg-slate-700/30',   label: 'Pending'     },
  running:  { icon: Loader2,      color: 'text-sky-400',    bg: 'bg-sky-500/15',     label: 'Running',  spin: true },
  done:     { icon: CheckCircle,  color: 'text-green-400',  bg: 'bg-green-500/15',   label: 'Done'        },
  failed:   { icon: XCircle,      color: 'text-red-400',    bg: 'bg-red-500/15',     label: 'Failed'      },
  skipped:  { icon: SkipForward,  color: 'text-slate-500',  bg: 'bg-slate-700/20',   label: 'Skipped'     },
}

function TaskStatusIcon({ status }) {
  const cfg = TASK_STATUS_CFG[status] || TASK_STATUS_CFG.pending
  const Icon = cfg.icon
  return (
    <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${cfg.bg}`}>
      <Icon size={13} className={`${cfg.color}${cfg.spin ? ' animate-spin' : ''}`} />
    </div>
  )
}

function TaskDuration({ startedAt, completedAt, status }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (status !== 'running') return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [status])

  if (!startedAt) return <span className="text-slate-700 text-[11px]">—</span>

  // Parse HH:MM:SS from started_at
  const parseTime = (ts) => {
    if (!ts) return null
    const parts = ts.split(':').map(Number)
    if (parts.length !== 3) return null
    return parts[0] * 3600 + parts[1] * 60 + parts[2]
  }

  const startSec = parseTime(startedAt)
  const endSec   = completedAt ? parseTime(completedAt) : null

  if (startSec === null) return <span className="text-slate-700 text-[11px]">—</span>

  const todaySec = Math.floor(now / 1000) % 86400
  const elapsedSec = endSec !== null
    ? Math.max(0, endSec - startSec)
    : Math.max(0, todaySec - startSec)

  if (elapsedSec >= 3600) {
    const h = Math.floor(elapsedSec / 3600)
    const m = Math.floor((elapsedSec % 3600) / 60)
    return <span className="text-slate-500 text-[11px] font-mono">{h}h {m}m</span>
  }
  if (elapsedSec >= 60) {
    const m = Math.floor(elapsedSec / 60)
    const s = elapsedSec % 60
    return <span className="text-slate-500 text-[11px] font-mono">{m}m {s}s</span>
  }
  return <span className="text-slate-500 text-[11px] font-mono">{elapsedSec}s</span>
}

function TaskTable({ tasks }) {
  // Show empty slate when no tasks defined yet
  if (!tasks || tasks.length === 0) {
    return (
      <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-navy-700">
          <ListChecks size={14} className="text-sky-400" />
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Deployment Tasks
          </span>
        </div>
        <div className="flex flex-col items-center justify-center py-10 text-slate-600 text-sm gap-2">
          <ListChecks size={24} className="opacity-30" />
          <span>No active deployment — tasks will appear here when a cluster starts building.</span>
        </div>
      </div>
    )
  }

  const doneCount    = tasks.filter(t => t.status === 'done' || t.status === 'skipped').length
  const failedCount  = tasks.filter(t => t.status === 'failed').length
  const runningCount = tasks.filter(t => t.status === 'running').length

  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-navy-700">
        <ListChecks size={14} className="text-sky-400" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Deployment Tasks
        </span>
        <div className="ml-auto flex items-center gap-2 text-[11px]">
          {runningCount > 0 && (
            <span className="flex items-center gap-1 text-sky-400">
              <span className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-pulse" />
              {runningCount} running
            </span>
          )}
          <span className="text-slate-600">{doneCount}/{tasks.length} done</span>
          {failedCount > 0 && <span className="text-red-400">{failedCount} failed</span>}
        </div>
      </div>

      {/* Task rows */}
      <div className="divide-y divide-navy-700/60">
        {tasks.map((task, idx) => {
          const cfg = TASK_STATUS_CFG[task.status] || TASK_STATUS_CFG.pending
          const rowBg = task.status === 'running'
            ? 'bg-sky-500/5'
            : task.status === 'failed'
            ? 'bg-red-500/5'
            : ''

          return (
            <div key={task.id} className={`flex items-center gap-3 px-4 py-3 ${rowBg}`}>
              {/* Step number */}
              <span className="text-[11px] text-slate-600 w-4 text-right flex-shrink-0">
                {idx + 1}
              </span>

              {/* Status icon */}
              <TaskStatusIcon status={task.status} />

              {/* Task name */}
              <span className={`flex-1 text-sm font-medium ${
                task.status === 'pending' ? 'text-slate-500'
                : task.status === 'skipped' ? 'text-slate-500'
                : task.status === 'failed' ? 'text-red-300'
                : task.status === 'running' ? 'text-slate-100'
                : 'text-slate-300'
              }`}>
                {task.name}
              </span>

              {/* Detail */}
              {task.detail && (
                <span className="text-[11px] text-slate-500 font-mono max-w-[220px] truncate" title={task.detail}>
                  {task.detail}
                </span>
              )}

              {/* Duration */}
              <div className="w-14 text-right flex-shrink-0">
                <TaskDuration
                  startedAt={task.started_at}
                  completedAt={task.completed_at}
                  status={task.status}
                />
              </div>

              {/* Status badge */}
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0 ${cfg.bg} ${cfg.color}`}>
                {cfg.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Log component ─────────────────────────────────────────────────────────────
const LEVEL_COLOR = {
  info:  'text-slate-300',
  warn:  'text-yellow-300',
  error: 'text-red-400',
}
const LEVEL_BADGE = {
  warn:  'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30',
  error: 'bg-red-500/20 text-red-400 border border-red-500/30',
}

function DeployLog({ logs, isRunning }) {
  const [filter,   setFilter]   = useState('all')
  const [search,   setSearch]   = useState('')
  const [expanded, setExpanded] = useState(false)
  const [pinned,   setPinned]   = useState(true)
  const [copied,   setCopied]   = useState(false)
  const [newCount, setNewCount] = useState(0)
  const logRef   = useRef(null)
  const prevLen  = useRef(0)

  const warnCount  = useMemo(() => logs.filter(e => e.level === 'warn').length,  [logs])
  const errorCount = useMemo(() => logs.filter(e => e.level === 'error').length, [logs])

  const visible = useMemo(() => {
    let out = logs
    if (filter !== 'all') out = out.filter(e => e.level === filter)
    if (search.trim())    out = out.filter(e => e.msg?.toLowerCase().includes(search.toLowerCase()))
    return out
  }, [logs, filter, search])

  useEffect(() => {
    if (logs.length !== prevLen.current) {
      const added = logs.length - prevLen.current
      prevLen.current = logs.length
      if (!pinned) setNewCount(c => c + added)
    }
  }, [logs.length, pinned])

  useEffect(() => {
    if (pinned && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [visible.length, pinned])

  const handleScroll = () => {
    const el = logRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom && !pinned) { setPinned(true); setNewCount(0) }
    else if (!atBottom && pinned) { setPinned(false) }
  }

  const jumpToBottom = () => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    setPinned(true)
    setNewCount(0)
  }

  const copyLogs = () => {
    const text = logs.map(e => `[${e.level}] ${e.ts} ${e.msg}`).join('\n')
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const height = expanded ? 'h-[36rem]' : 'h-80'

  return (
    <div className="bg-navy-900 border border-navy-600 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-navy-700 flex items-center gap-2 flex-wrap">
        <Terminal size={13} className="text-sky-400 flex-shrink-0" />
        <span className="text-slate-300 text-xs font-semibold">Deployment Log</span>

        <div className="flex items-center gap-1 ml-1">
          {[
            { key: 'all',   label: `All ${logs.length}` },
            { key: 'info',  label: 'Info' },
            { key: 'warn',  label: `⚠ ${warnCount}`,  disabled: warnCount === 0 },
            { key: 'error', label: `✕ ${errorCount}`, disabled: errorCount === 0 },
          ].map(({ key, label, disabled }) => (
            <button key={key}
              onClick={() => setFilter(key)}
              disabled={disabled}
              className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors disabled:opacity-30 ${
                filter === key
                  ? key === 'error' ? 'bg-red-500/25 text-red-300'
                  : key === 'warn'  ? 'bg-yellow-500/25 text-yellow-300'
                  : 'bg-sky-500/20 text-sky-300'
                  : 'text-slate-500 hover:text-slate-300'
              }`}>
              {label}
            </button>
          ))}
        </div>

        <div className="relative flex items-center ml-1">
          <Search size={11} className="absolute left-2 text-slate-600 pointer-events-none" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter…"
            className="bg-navy-800 border border-navy-600 rounded pl-6 pr-2 py-0.5 text-xs text-slate-300 placeholder-slate-600 focus:outline-none focus:border-sky-600 w-28"
          />
          {search && (
            <button onClick={() => setSearch('')}
              className="absolute right-1.5 text-slate-600 hover:text-slate-400">
              <X size={10} />
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {isRunning && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              live
            </span>
          )}
          <button onClick={copyLogs} title="Copy all logs"
            className="p-1.5 rounded text-slate-500 hover:text-slate-300 transition-colors">
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
          <button onClick={() => setExpanded(e => !e)} title={expanded ? 'Collapse' : 'Expand'}
            className="p-1.5 rounded text-slate-500 hover:text-slate-300 transition-colors">
            {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      {/* Log body */}
      <div className="relative">
        <div
          ref={logRef}
          onScroll={handleScroll}
          className={`${height} overflow-y-auto p-3 font-mono text-xs space-y-px transition-all duration-200`}>
          {visible.length === 0 && (
            <span className="text-slate-600">
              {search || filter !== 'all' ? 'No matching entries.' : 'Waiting for first log entry…'}
            </span>
          )}
          {visible.map((entry, i) => (
            <div key={i} className={`flex gap-2 items-baseline group py-px hover:bg-white/[0.03] rounded px-1 -mx-1 ${
              LEVEL_COLOR[entry.level] || 'text-slate-300'
            }`}>
              <span className="text-slate-600 flex-shrink-0 w-14 text-right">{entry.ts}</span>
              {entry.level !== 'info' && (
                <span className={`flex-shrink-0 text-[10px] px-1 rounded font-semibold ${LEVEL_BADGE[entry.level] || ''}`}>
                  {entry.level?.toUpperCase()}
                </span>
              )}
              <span className="break-all leading-relaxed">{entry.msg}</span>
            </div>
          ))}
        </div>

        {!pinned && (
          <button
            onClick={jumpToBottom}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-full shadow-lg transition-colors">
            <ChevronsDown size={12} />
            {newCount > 0 ? `${newCount} new` : 'Latest'}
          </button>
        )}
      </div>

      {/* Status bar */}
      <div className="px-3 py-1.5 border-t border-navy-800 flex items-center gap-3 text-[11px] text-slate-600">
        <span>{visible.length}{visible.length !== logs.length ? ` / ${logs.length}` : ''} entries</span>
        {warnCount  > 0 && <span className="text-yellow-500/70">⚠ {warnCount} warning{warnCount  > 1 ? 's' : ''}</span>}
        {errorCount > 0 && <span className="text-red-500/70">✕ {errorCount} error{errorCount > 1 ? 's' : ''}</span>}
        <span className="ml-auto">{pinned ? '↓ auto-scroll on' : '⏸ auto-scroll paused'}</span>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OcpAgentJob() {
  const { jobId }             = useParams()
  const navigate              = useNavigate()
  const [job, setJob]         = useState(null)
  const [copied, setCopied]   = useState('')
  const [loading, setLoad]    = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [resetting, setResetting]   = useState(false)
  const [deleting, setDeleting]     = useState(false)
  const timerRef              = useRef(null)

  const poll = useCallback(async (silent = false) => {
    try {
      const r = await api.get(`/ocp-agent/jobs/${jobId}`)
      setJob(r.data)
    } catch (e) {
      if (e.response?.status === 404) navigate('/ocp-agent')
    } finally {
      if (!silent) setLoad(false)
    }
  }, [jobId, navigate])

  useEffect(() => {
    poll()
    timerRef.current = setInterval(() => poll(true), 3000)
    return () => clearInterval(timerRef.current)
  }, [poll])

  // Stop polling when done
  useEffect(() => {
    if (job?.status === 'complete' || job?.status === 'failed') {
      clearInterval(timerRef.current)
    }
  }, [job?.status])

  const copy = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  const handleReset = async () => {
    if (!confirm('Reset this deployment? This will re-run the job from the beginning.')) return
    setResetting(true)
    try {
      await api.post(`/ocp-agent/jobs/${jobId}/reset`)
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => poll(true), 3000)
      poll(true)
    } catch (e) {
      alert(e.response?.data?.error || 'Reset failed')
    } finally {
      setResetting(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this deployment record?')) return
    setDeleting(true)
    try {
      await api.delete(`/ocp-agent/jobs/${jobId}`)
      navigate('/ocp-agent')
    } catch (e) {
      alert(e.response?.data?.error || 'Delete failed')
      setDeleting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-500 gap-2">
        <Loader2 size={16} className="animate-spin" /> Loading…
      </div>
    )
  }
  if (!job) return null

  const isComplete = job.status === 'complete'
  const isFailed   = job.status === 'failed'
  const isRunning  = !isComplete && !isFailed
  const progress   = job.progress ?? 0

  const config = job.config || {}
  const deployType  = config.deployment_type || job.deployment_type || 'sno'
  const clusterName = config.cluster_name    || job.cluster_name    || job.id
  const ocpVersion  = config.ocp_version     || job.ocp_version     || '—'

  const TYPE_BADGE = {
    sno:     'bg-purple-500/15 text-purple-300',
    compact: 'bg-blue-500/15 text-blue-300',
    full:    'bg-teal-500/15 text-teal-300',
  }
  const TYPE_LABEL = { sno: 'SNO', compact: 'Compact', full: 'Full' }

  const bannerBorder   = isComplete ? 'border-green-500/30' : isFailed ? 'border-red-500/30' : 'border-sky-500/30'
  const bannerBg       = isComplete ? 'bg-green-500/10'     : isFailed ? 'bg-red-500/10'     : 'bg-sky-500/10'
  const progressColor  = isComplete ? 'bg-green-500'        : isFailed ? 'bg-red-500'        : 'bg-gradient-to-r from-sky-500 to-blue-500'

  return (
    <div className="max-w-4xl space-y-4">

      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/ocp-agent')}
          className="p-2 rounded-md text-slate-400 hover:text-sky-400 hover:bg-navy-700 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div className="p-2.5 bg-sky-500/10 rounded-xl">
          <Server size={18} className="text-sky-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-slate-100 font-bold text-lg">{clusterName}</h1>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className={`font-mono px-1.5 py-0.5 rounded ${TYPE_BADGE[deployType] || 'bg-slate-500/15 text-slate-300'}`}>
              {TYPE_LABEL[deployType] || deployType}
            </span>
            <span>OCP {ocpVersion}</span>
            <span className="font-mono text-slate-600">{job.id}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isRunning && (
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-1.5 bg-amber-600/80 hover:bg-amber-500 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors">
              {resetting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {resetting ? 'Resetting…' : 'Reset'}
            </button>
          )}
          {isFailed && (
            <button
              onClick={handleReset}
              disabled={resetting}
              className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors">
              {resetting ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
              {resetting ? 'Resetting…' : 'Reset & Retry'}
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex items-center gap-1.5 text-red-400 hover:text-white hover:bg-red-600 border border-red-500/30 hover:border-red-600 disabled:opacity-40 text-xs font-semibold px-3 py-1.5 rounded-md transition-all">
            {deleting ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>

      {/* Status banner */}
      <div className={`flex items-center gap-4 bg-navy-800 border ${bannerBorder} rounded-xl p-4`}>
        <div className={`p-3 rounded-xl flex-shrink-0 ${bannerBg}`}>
          {isComplete ? <CheckCircle size={22} className="text-green-400" />
          : isFailed  ? <XCircle    size={22} className="text-red-400" />
          :             <Loader2    size={22} className="text-sky-400 animate-spin" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-slate-100 font-bold text-sm">{job.phase || 'Starting…'}</div>
          <div className="text-slate-400 text-xs mt-0.5">
            {isComplete ? 'Cluster is installed and ready!'
            : isFailed  ? 'Deployment failed — check logs below.'
            :             'Deployment in progress — this may take 45–90 minutes.'}
          </div>
        </div>
        <div className="text-3xl font-bold text-sky-400 flex-shrink-0">{progress}%</div>
      </div>

      {/* Overall progress bar */}
      <div className="w-full bg-navy-700 rounded-full h-3 overflow-hidden">
        <div
          className={`h-3 rounded-full transition-all duration-1000 ${progressColor}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Phase stepper */}
      <StepTimeline progress={progress} isComplete={isComplete} isFailed={isFailed} />

      {/* Task table */}
      <TaskTable tasks={job.tasks} />

      {/* Configuration (collapsible) */}
      {Object.keys(config).length > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
          <button
            onClick={() => setConfigOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 border-b border-navy-700 text-left hover:bg-navy-700/30 transition-colors">
            {configOpen
              ? <ChevronDown  size={13} className="text-slate-500" />
              : <ChevronRight size={13} className="text-slate-500" />}
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Configuration
            </span>
          </button>
          {configOpen && (
            <div className="grid grid-cols-2 gap-0">
              {[
                ['Cluster Name',    config.cluster_name],
                ['Base Domain',     config.base_domain],
                ['OCP Version',     config.ocp_version],
                ['Deployment Type', config.deployment_type],
                ['Network',         config.network],
                ['Workers',         config.n_workers != null ? String(config.n_workers) : null],
                ['CP vCPUs',        config.cp_vcpus  != null ? String(config.cp_vcpus)  : null],
                ['CP RAM',          config.cp_ram_gb != null ? `${config.cp_ram_gb} GB` : null],
                ['CP Disk',         config.cp_disk_gb != null ? `${config.cp_disk_gb} GB` : null],
              ].map(([k, v]) => v ? (
                <div key={k} className="px-4 py-2.5 border-b border-navy-700/50 flex gap-3">
                  <span className="text-slate-500 text-xs w-32 flex-shrink-0">{k}</span>
                  <span className="text-slate-200 text-xs font-mono">{v}</span>
                </div>
              ) : null)}
            </div>
          )}
        </div>
      )}

      {/* Live log */}
      <DeployLog logs={job.logs || []} isRunning={isRunning} />

      {/* Completed result panel */}
      {isComplete && job.result && (
        <div className="bg-green-900/10 border border-green-700/40 rounded-xl p-5 space-y-4">
          <h3 className="text-green-400 font-semibold text-sm flex items-center gap-2">
            <CheckCircle size={15} /> Cluster Ready
          </h3>

          {job.result.console_url && (
            <div>
              <div className="text-slate-400 text-xs mb-1">Console URL</div>
              <div className="flex items-center gap-2">
                <code className="text-sky-300 text-xs font-mono bg-navy-900 px-3 py-1.5 rounded flex-1 overflow-x-auto">
                  {job.result.console_url}
                </code>
                <a href={job.result.console_url} target="_blank" rel="noopener noreferrer"
                  className="p-1.5 rounded text-sky-400 hover:bg-sky-500/10 transition-colors">
                  <ExternalLink size={14} />
                </a>
                <button onClick={() => copy(job.result.console_url, 'console_url')}
                  className="p-1.5 rounded text-slate-400 hover:text-sky-300 transition-colors">
                  {copied === 'console_url' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}

          {job.result.kubeadmin_password && (
            <div>
              <div className="text-slate-400 text-xs mb-1">kubeadmin password</div>
              <div className="flex items-center gap-2">
                <code className="text-yellow-300 text-xs font-mono bg-navy-900 px-3 py-1.5 rounded flex-1">
                  {job.result.kubeadmin_password}
                </code>
                <button onClick={() => copy(job.result.kubeadmin_password, 'pw')}
                  className="p-1.5 rounded text-slate-400 hover:text-sky-300 transition-colors">
                  {copied === 'pw' ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          )}

          {job.result.kubeconfig_path && (
            <a
              href={`/api/ocp-agent/jobs/${jobId}/kubeconfig`}
              className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold px-4 py-2 rounded-md text-sm transition-colors">
              <Download size={14} /> Download kubeconfig
            </a>
          )}
        </div>
      )}

      {/* Failed with no result */}
      {isFailed && (
        <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3">
          <AlertTriangle size={14} />
          Deployment failed. Check the log above for details, then use Reset to retry.
        </div>
      )}
    </div>
  )
}
