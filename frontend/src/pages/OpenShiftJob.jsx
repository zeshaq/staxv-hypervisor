import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Boxes, ArrowLeft, CheckCircle, XCircle, Loader2,
  Terminal, Download, Copy, Check, ExternalLink, RefreshCw,
  AlertTriangle, ChevronDown, ChevronRight,
  KeyRound, Disc3, Server, Network, Cpu, Trophy, ShieldCheck,
  Upload, X, Search, ChevronsDown, Maximize2, Minimize2, RotateCcw,
  Layers, Activity, Zap, Clock, AlertCircle, SkipForward,
  HardDrive, Radio,
} from 'lucide-react'
import api from '../api'

// ── Deployment phase definitions ──────────────────────────────────────────────
const STEPS = [
  { id: 'auth',    label: 'Auth',        Icon: KeyRound,    min: 0,  max: 17  },
  { id: 'iso',     label: 'ISO',         Icon: Disc3,       min: 18, max: 34  },
  { id: 'vms',     label: 'VMs',         Icon: Server,      min: 35, max: 44  },
  { id: 'nodes',   label: 'Nodes',       Icon: Network,     min: 45, max: 59  },
  { id: 'install', label: 'Install',     Icon: Cpu,         min: 60, max: 97  },
  { id: 'done',    label: 'Done',        Icon: Trophy,      min: 98, max: 101 },
]

// ── Log parsing helpers ───────────────────────────────────────────────────────
function parseLogs(logs, config) {
  const isSNO = config?.deployment_type === 'sno'
  const configTotal = isSNO ? 1
    : (parseInt(config?.control_plane_count || 3) + parseInt(config?.worker_count || 2))

  let nodeRegistered = 0
  let nodeTotal = configTotal || 0
  let installPct = 0
  let installStatus = ''
  let installInfo = ''
  let vmsCreated = 0
  const warnings = []
  const errors = []

  for (const entry of logs) {
    const msg = entry.msg || ''

    // "  3/5 node(s) discovered"
    const nm = msg.match(/(\d+)\/(\d+) node\(s\) (discovered|ready)/)
    if (nm) {
      nodeRegistered = parseInt(nm[1])
      nodeTotal = parseInt(nm[2])
    }

    // "All 5 node(s) ready ✓"
    const allReady = msg.match(/All (\d+) node\(s\) ready/)
    if (allReady) {
      nodeRegistered = parseInt(allReady[1])
      nodeTotal = parseInt(allReady[1])
    }

    // "  Status: installing-in-progress (45%) — ..."
    const im = msg.match(/Status:\s+(\S+)\s+\((\d+)%\)\s*(?:—\s*(.*))?/)
    if (im) {
      installStatus = im[1]
      installPct = parseInt(im[2])
      installInfo = (im[3] || '').trim()
    }

    // "VM xxx-master-0 started ... ✓"
    if (/^VM \S+ started /.test(msg)) vmsCreated++

    if (entry.level === 'warn')  warnings.push(entry)
    if (entry.level === 'error') errors.push(entry)
  }

  return { nodeRegistered, nodeTotal, installPct, installStatus, installInfo, vmsCreated, warnings, errors }
}

// ── Sub-component: horizontal step timeline ───────────────────────────────────
function StepTimeline({ progress, isComplete, isFailed }) {
  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl p-4">
      <div className="flex items-center justify-between">
        {STEPS.map((step, idx) => {
          const done   = isComplete || progress > step.max
          const active = !isComplete && !isFailed && progress >= step.min && progress <= step.max
          const failed = isFailed && active
          const pending = !done && !active && !failed

          return (
            <div key={step.id} className="flex items-center flex-1">
              {/* Step circle */}
              <div className="flex flex-col items-center gap-1 flex-shrink-0">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                  failed  ? 'bg-red-500/20 border border-red-500/50' :
                  done    ? 'bg-green-500/20 border border-green-500/50' :
                  active  ? 'bg-sky-500/20 border border-sky-500/50' :
                            'bg-navy-700 border border-navy-600'
                }`}>
                  {failed  ? <XCircle     size={14} className="text-red-400" /> :
                   done    ? <CheckCircle size={14} className="text-green-400" /> :
                   active  ? <Loader2     size={14} className="text-sky-400 animate-spin" /> :
                             <step.Icon  size={14} className="text-slate-600" />}
                </div>
                <span className={`text-[10px] font-medium whitespace-nowrap ${
                  failed  ? 'text-red-400' :
                  done    ? 'text-green-400' :
                  active  ? 'text-sky-300' :
                            'text-slate-600'
                }`}>{step.label}</span>
              </div>
              {/* Connector line (not after last) */}
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

// ── Sub-component: ISO download progress bar with speed ──────────────────────
function IsoDownloadBar({ isoDl, fallbackPct }) {
  const pct      = isoDl?.pct      ?? fallbackPct ?? 0
  const speed    = isoDl?.speed_mbs ?? null
  const doneMb   = isoDl?.done_mb  ?? null
  const totalMb  = isoDl?.total_mb ?? null
  const etaSec   = isoDl?.eta_s    ?? null

  const etaLabel = etaSec != null && etaSec > 0
    ? etaSec >= 60
      ? `${Math.floor(etaSec / 60)}m ${etaSec % 60}s left`
      : `${etaSec}s left`
    : null

  return (
    <div className="space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400 font-medium flex items-center gap-1.5">
          <span>Full ISO Download</span>
        </span>
        <div className="flex items-center gap-3">
          {speed != null && (
            <span className="font-mono text-purple-300 font-semibold">
              {speed} <span className="text-purple-500 font-normal">MB/s</span>
            </span>
          )}
          {etaLabel && (
            <span className="text-slate-500 font-mono">{etaLabel}</span>
          )}
          <span className="font-bold text-purple-400">{pct}%</span>
        </div>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-navy-700 rounded-full h-2.5 overflow-hidden">
        <div
          className="h-2.5 rounded-full bg-gradient-to-r from-purple-500 to-violet-400 transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Size row */}
      {doneMb != null && totalMb != null && totalMb > 0 && (
        <div className="flex items-center justify-between text-[11px] text-slate-600 font-mono">
          <span>{doneMb.toFixed(0)} MB downloaded</span>
          <span>{totalMb.toFixed(0)} MB total</span>
        </div>
      )}
    </div>
  )
}

// ── Sub-component: labeled progress bar ──────────────────────────────────────
function ProgressBar({ label, value, max, color = 'sky', suffix, sublabel }) {
  const pct = max > 0 ? Math.min(100, Math.round(value / max * 100)) : (value || 0)
  const colorMap = {
    sky:    'bg-sky-500',
    green:  'bg-green-500',
    purple: 'bg-purple-500',
    amber:  'bg-amber-500',
  }
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-400 font-medium">{label}</span>
        <div className="flex items-center gap-2">
          {sublabel && <span className="text-slate-500 text-[11px] font-mono">{sublabel}</span>}
          <span className={`font-bold text-${color}-400`}>
            {max > 0 ? `${value}/${max}` : `${pct}%`}{suffix}
          </span>
        </div>
      </div>
      <div className="w-full bg-navy-700 rounded-full h-2 overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-700 ${colorMap[color] || colorMap.sky}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ── Sub-component: warnings panel ────────────────────────────────────────────
function WarningsPanel({ warnings, errors }) {
  const [open, setOpen] = useState(true)
  const all = [...errors, ...warnings]
  if (!all.length) return null

  const hasErrors = errors.length > 0
  return (
    <div className={`border rounded-xl overflow-hidden ${
      hasErrors ? 'border-red-500/40 bg-red-500/5' : 'border-amber-500/40 bg-amber-500/5'
    }`}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left"
      >
        <AlertTriangle size={14} className={hasErrors ? 'text-red-400' : 'text-amber-400'} />
        <span className={`text-sm font-semibold ${hasErrors ? 'text-red-300' : 'text-amber-300'}`}>
          {errors.length > 0 && `${errors.length} error${errors.length > 1 ? 's' : ''}`}
          {errors.length > 0 && warnings.length > 0 && ', '}
          {warnings.length > 0 && `${warnings.length} warning${warnings.length > 1 ? 's' : ''}`}
        </span>
        <div className="ml-auto">
          {open ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
        </div>
      </button>
      {open && (
        <div className="px-4 pb-3 space-y-1 max-h-48 overflow-y-auto">
          {all.map((entry, i) => (
            <div key={i} className={`flex gap-2 text-xs font-mono ${
              entry.level === 'error' ? 'text-red-400' : 'text-amber-300'
            }`}>
              <span className="text-slate-600 flex-shrink-0">{entry.ts}</span>
              <span className="break-all">{entry.msg}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Interactive deployment log ────────────────────────────────────────────────
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
  const [filter,    setFilter]    = useState('all')   // all | info | warn | error
  const [search,    setSearch]    = useState('')
  const [expanded,  setExpanded]  = useState(false)
  const [pinned,    setPinned]    = useState(true)    // auto-scroll to bottom
  const [copied,    setCopied]    = useState(false)
  const [newCount,  setNewCount]  = useState(0)       // entries added since unpin
  const logRef    = useRef(null)
  const prevLen   = useRef(0)

  // Count by level
  const warnCount  = useMemo(() => logs.filter(e => e.level === 'warn').length,  [logs])
  const errorCount = useMemo(() => logs.filter(e => e.level === 'error').length, [logs])

  // Filtered entries
  const visible = useMemo(() => {
    let out = logs
    if (filter !== 'all') out = out.filter(e => e.level === filter)
    if (search.trim())    out = out.filter(e => e.msg?.toLowerCase().includes(search.toLowerCase()))
    return out
  }, [logs, filter, search])

  // Auto-scroll when pinned and new entries arrive
  useEffect(() => {
    if (logs.length !== prevLen.current) {
      const added = logs.length - prevLen.current
      prevLen.current = logs.length
      if (!pinned) {
        setNewCount(c => c + added)
      }
    }
  }, [logs.length, pinned])

  useEffect(() => {
    if (pinned && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [visible.length, pinned])

  // Detect manual scroll away from bottom → unpin
  const handleScroll = () => {
    const el = logRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (atBottom && !pinned) {
      setPinned(true)
      setNewCount(0)
    } else if (!atBottom && pinned) {
      setPinned(false)
    }
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

      {/* ── Toolbar ── */}
      <div className="px-3 py-2 border-b border-navy-700 flex items-center gap-2 flex-wrap">
        <Terminal size={13} className="text-sky-400 flex-shrink-0" />
        <span className="text-slate-300 text-xs font-semibold">Deployment Log</span>

        {/* Level filter tabs */}
        <div className="flex items-center gap-1 ml-1">
          {[
            { key: 'all',   label: `All ${logs.length}` },
            { key: 'info',  label: `Info` },
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

        {/* Search */}
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
          {/* Running indicator */}
          {isRunning && (
            <span className="flex items-center gap-1 text-[11px] text-slate-500">
              <span className="w-1.5 h-1.5 bg-green-400 rounded-full animate-pulse" />
              live
            </span>
          )}
          {/* Copy */}
          <button onClick={copyLogs} title="Copy all logs"
            className="p-1.5 rounded text-slate-500 hover:text-slate-300 transition-colors">
            {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
          </button>
          {/* Expand / collapse */}
          <button onClick={() => setExpanded(e => !e)} title={expanded ? 'Collapse' : 'Expand'}
            className="p-1.5 rounded text-slate-500 hover:text-slate-300 transition-colors">
            {expanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
        </div>
      </div>

      {/* ── Log body ── */}
      <div className="relative">
        <div
          ref={logRef}
          onScroll={handleScroll}
          className={`${height} overflow-y-auto p-3 font-mono text-xs space-y-px transition-all duration-200`}
        >
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

        {/* Jump-to-bottom button when unpinned */}
        {!pinned && (
          <button
            onClick={jumpToBottom}
            className="absolute bottom-3 right-3 flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-full shadow-lg transition-colors"
          >
            <ChevronsDown size={12} />
            {newCount > 0 ? `${newCount} new` : 'Latest'}
          </button>
        )}
      </div>

      {/* ── Status bar ── */}
      <div className="px-3 py-1.5 border-t border-navy-800 flex items-center gap-3 text-[11px] text-slate-600">
        <span>{visible.length}{visible.length !== logs.length ? ` / ${logs.length}` : ''} entries</span>
        {warnCount  > 0 && <span className="text-yellow-500/70">⚠ {warnCount} warning{warnCount  > 1 ? 's' : ''}</span>}
        {errorCount > 0 && <span className="text-red-500/70">✕ {errorCount} error{errorCount > 1 ? 's' : ''}</span>}
        <span className="ml-auto">{pinned ? '↓ auto-scroll on' : '⏸ auto-scroll paused'}</span>
      </div>
    </div>
  )
}

// ── Node stage helpers ────────────────────────────────────────────────────────

const STAGE_ORDER = [
  'Starting installation', 'Installing', 'Writing image to disk',
  'Rebooting', 'Waiting for control plane', 'Waiting for bootkube',
  'Configuring', 'Joined', 'Done',
]

const STAGE_PCT = {
  'Starting installation':     5,
  'Installing':                20,
  'Writing image to disk':     45,
  'Rebooting':                 65,
  'Waiting for control plane': 75,
  'Waiting for bootkube':      82,
  'Configuring':               90,
  'Joined':                    97,
  'Done':                      100,
}

function stagePct(stage) {
  return STAGE_PCT[stage] ?? 0
}

// ── Node Card ─────────────────────────────────────────────────────────────────

function NodeCard({ node }) {
  const isInstalled = node.status === 'installed'
  const isFailed    = node.status?.includes('error') || node.status?.includes('failed')
  const isPending   = node.status?.includes('pending-user-action')
  const isActive    = !isInstalled && !isFailed

  const roleBadge = node.role === 'master'
    ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
    : 'bg-blue-500/20 text-blue-300 border-blue-500/30'

  const cardBorder = node.stuck    ? 'border-amber-500/50 bg-amber-500/5'
    : isFailed                     ? 'border-red-500/40 bg-red-500/5'
    : isPending                    ? 'border-sky-500/40 bg-sky-500/5'
    : isInstalled                  ? 'border-green-500/30 bg-green-500/5'
    :                                'border-navy-600 bg-navy-800'

  const pct = isInstalled ? 100 : stagePct(node.stage)

  return (
    <div className={`rounded-xl border p-3 space-y-2.5 transition-all ${cardBorder}`}>
      {/* Header row */}
      <div className="flex items-center gap-2">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
          node.stuck    ? 'bg-amber-500/20' :
          isFailed      ? 'bg-red-500/20'   :
          isInstalled   ? 'bg-green-500/20' :
          isPending     ? 'bg-sky-500/20'   : 'bg-navy-700'
        }`}>
          {node.stuck    ? <AlertCircle size={12} className="text-amber-400" />
          : isFailed     ? <XCircle     size={12} className="text-red-400" />
          : isInstalled  ? <CheckCircle size={12} className="text-green-400" />
          : isPending    ? <Radio       size={12} className="text-sky-400 animate-pulse" />
          :                <Loader2     size={12} className="text-sky-400 animate-spin" />}
        </div>
        <span className="text-slate-100 text-xs font-semibold flex-1 truncate" title={node.vm || node.name}>
          {node.vm || node.name}
        </span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${roleBadge}`}>
          {node.role === 'master' ? 'CP' : 'W'}
        </span>
      </div>

      {/* Stage bar */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className={`font-medium truncate max-w-[130px] ${
            node.stuck   ? 'text-amber-300' :
            isFailed     ? 'text-red-400'   :
            isInstalled  ? 'text-green-400' : 'text-slate-400'
          }`}>
            {isInstalled ? 'Done' : (node.stage || (isActive ? 'Starting…' : node.status))}
          </span>
          <span className="text-slate-600 font-mono ml-1 flex-shrink-0">{pct}%</span>
        </div>
        <div className="w-full bg-navy-700 rounded-full h-1.5 overflow-hidden">
          <div
            className={`h-1.5 rounded-full transition-all duration-700 ${
              node.stuck   ? 'bg-amber-500' :
              isFailed     ? 'bg-red-500'   :
              isInstalled  ? 'bg-green-500' : 'bg-sky-500'
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Stuck warning */}
      {node.stuck && (
        <div className="flex items-center gap-1 text-[10px] text-amber-400 font-medium">
          <Clock size={10} />
          Stuck for {node.stuck_min}min — may need manual intervention
        </div>
      )}

      {/* Pending user action */}
      {isPending && (
        <div className="flex items-center gap-1 text-[10px] text-sky-400">
          <Radio size={10} />
          Rebooting — auto-eject in progress…
        </div>
      )}
    </div>
  )
}

// ── Node Grid ─────────────────────────────────────────────────────────────────

function NodeGrid({ nodes }) {
  if (!nodes?.length) return null

  const installed  = nodes.filter(n => n.status === 'installed').length
  const stuck      = nodes.filter(n => n.stuck).length
  const pending    = nodes.filter(n => n.status?.includes('pending-user-action')).length

  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-navy-700">
        <Server size={14} className="text-sky-400" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Node Progress
        </span>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          {pending > 0 && (
            <span className="text-sky-400 flex items-center gap-1">
              <Radio size={10} className="animate-pulse" /> {pending} rebooting
            </span>
          )}
          {stuck > 0 && (
            <span className="text-amber-400 flex items-center gap-1">
              <AlertCircle size={10} /> {stuck} stuck
            </span>
          )}
          <span className="text-slate-500">{installed}/{nodes.length} done</span>
        </div>
      </div>
      <div className="p-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {nodes.map(n => <NodeCard key={n.id} node={n} />)}
      </div>
    </div>
  )
}

// ── Operator Panel ────────────────────────────────────────────────────────────

function OperatorPanel({ operators }) {
  if (!operators?.length) return null

  const available   = operators.filter(o => o.status === 'available').length
  const progressing = operators.filter(o => o.status === 'progressing').length
  const failed      = operators.filter(o => o.status === 'failed' || o.status === 'degraded').length

  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-navy-700">
        <Zap size={14} className="text-sky-400" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Cluster Operators
        </span>
        <div className="ml-auto flex items-center gap-3 text-[11px]">
          <span className="text-green-400">{available} available</span>
          {progressing > 0 && <span className="text-amber-400">{progressing} progressing</span>}
          {failed      > 0 && <span className="text-red-400">{failed} failed</span>}
          <span className="text-slate-600">{operators.length} total</span>
        </div>
      </div>
      <div className="p-3 flex flex-wrap gap-1.5">
        {operators.map(op => {
          const isOk   = op.status === 'available'
          const isProg = op.status === 'progressing'
          const isFail = op.status === 'failed' || op.status === 'degraded'
          return (
            <span
              key={op.name}
              title={op.info || op.name}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border transition-all ${
                isFail ? 'bg-red-500/15 text-red-300 border-red-500/30' :
                isProg ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                isOk   ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                         'bg-slate-500/10 text-slate-500 border-slate-600/30'
              }`}>
              {isFail ? '✗' : isProg ? <Loader2 size={8} className="animate-spin inline" /> : '✓'} {op.name}
            </span>
          )
        })}
      </div>
      {/* Progress bar: available / total */}
      <div className="px-3 pb-3">
        <div className="w-full bg-navy-700 rounded-full h-1.5 overflow-hidden">
          <div
            className="h-1.5 rounded-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-700"
            style={{ width: `${operators.length ? Math.round(available / operators.length * 100) : 0}%` }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Event Feed ────────────────────────────────────────────────────────────────

const EVENT_CFG = {
  status_change:       { icon: Activity,    color: 'text-sky-400',    bg: 'bg-sky-500/10',    label: e => e.status },
  stage_change:        { icon: SkipForward, color: 'text-slate-400',  bg: 'bg-navy-700/50',   label: e => `${e.node}: ${e.from_stage || '—'} → ${e.to_stage}` },
  operator_available:  { icon: CheckCircle, color: 'text-green-400',  bg: 'bg-green-500/10',  label: e => `Operator ready: ${e.name}` },
  operator_update:     { icon: Zap,         color: 'text-amber-400',  bg: 'bg-amber-500/10',  label: e => `${e.name}: ${e.status}` },
  stuck:               { icon: AlertCircle, color: 'text-amber-400',  bg: 'bg-amber-500/10',  label: e => `${e.node} stuck on "${e.stage}" for ${e.minutes}min` },
  pending_user_action: { icon: Radio,       color: 'text-sky-400',    bg: 'bg-sky-500/10',    label: e => `${e.node}: rebooted into ISO — ejecting` },
  host_failed:         { icon: XCircle,     color: 'text-red-400',    bg: 'bg-red-500/10',    label: e => `${e.node} failed: ${e.info || e.status}` },
}

function EventFeed({ events }) {
  const [expanded, setExpanded] = useState(false)
  if (!events?.length) return null

  const shown = expanded ? events : events.slice(-12)

  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-navy-700">
        <Activity size={14} className="text-sky-400" />
        <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
          Event Timeline
        </span>
        <span className="text-[11px] text-slate-600 ml-1">{events.length} events</span>
        {events.length > 12 && (
          <button
            onClick={() => setExpanded(e => !e)}
            className="ml-auto text-[11px] text-slate-500 hover:text-sky-400 transition-colors">
            {expanded ? '↑ Show recent' : `↓ Show all ${events.length}`}
          </button>
        )}
      </div>
      <div className="divide-y divide-navy-700/40 max-h-72 overflow-y-auto">
        {[...shown].reverse().map((ev, i) => {
          const cfg  = EVENT_CFG[ev.type] || { icon: Activity, color: 'text-slate-400', bg: 'bg-navy-700/30', label: e => e.type }
          const Icon = cfg.icon
          return (
            <div key={i} className={`flex items-start gap-3 px-4 py-2.5 ${cfg.bg} hover:brightness-110 transition-all`}>
              <Icon size={13} className={`${cfg.color} flex-shrink-0 mt-0.5`} />
              <span className="flex-1 text-xs text-slate-300">{cfg.label(ev)}</span>
              <span className="text-[10px] text-slate-600 font-mono flex-shrink-0">{ev.ts}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Sync-from-AI modal (only shown when no stored credentials) ────────────────
function SyncModal({ jobId, onClose, onSynced }) {
  const [offlineToken, setOfflineToken] = useState('')
  const [pullSecret,   setPullSecret]   = useState('')
  const [busy,  setBusy]  = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const submit = async (body = {}) => {
    setBusy(true)
    setError('')
    try {
      const r = await api.post(`/openshift/jobs/${jobId}/sync`, body)
      setResult(r.data)
      onSynced()
    } catch (e) {
      setError(e.response?.data?.message || e.response?.data?.error || 'Sync failed')
    } finally {
      setBusy(false)
    }
  }

  const submitForm = () => {
    if (!offlineToken.trim() || !pullSecret.trim()) {
      setError('Both fields are required')
      return
    }
    submit({ offline_token: offlineToken.trim(), pull_secret: pullSecret.trim() })
  }

  const ACTION_LABEL = {
    collecting_credentials: 'Cluster already installed — collecting credentials…',
    monitoring_installation: 'Installation in progress — monitoring resumed.',
    marked_failed:           'Cluster failed in Assisted Installer — marked failed.',
    full_resume:             'Resuming full deployment from saved state.',
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-navy-800 border border-navy-600 rounded-xl w-full max-w-lg shadow-2xl">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-navy-700">
          <Upload size={16} className="text-sky-400" />
          <span className="text-slate-100 font-semibold text-sm">Sync from Assisted Installer</span>
          <button onClick={onClose} className="ml-auto p-1 rounded text-slate-500 hover:text-slate-300">
            <X size={15} />
          </button>
        </div>

        {result ? (
          <div className="p-5 space-y-4">
            <div className="flex items-start gap-3 bg-green-500/10 border border-green-500/30 rounded-lg p-3">
              <CheckCircle size={16} className="text-green-400 flex-shrink-0 mt-0.5" />
              <p className="text-green-300 text-sm">{ACTION_LABEL[result.action] || `Action: ${result.action}`}</p>
            </div>
            <p className="text-slate-400 text-xs">AI reported status: <code className="text-sky-300">{result.ai_status}</code></p>
            <button onClick={onClose}
              className="w-full bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold py-2 rounded-md transition-colors">
              Close
            </button>
          </div>
        ) : (
          <div className="p-5 space-y-4">
            <p className="text-slate-400 text-sm">
              Provide your Red Hat credentials to query the Assisted Installer and sync this job's real status.
            </p>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Offline Token</label>
              <textarea
                rows={3}
                value={offlineToken}
                onChange={e => setOfflineToken(e.target.value)}
                placeholder="eyJhbGciO… (from console.redhat.com/openshift/token)"
                className="w-full bg-navy-900 border border-navy-600 rounded-md px-3 py-2 text-slate-200 text-xs font-mono resize-none focus:outline-none focus:border-sky-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-400 font-medium">Pull Secret</label>
              <textarea
                rows={3}
                value={pullSecret}
                onChange={e => setPullSecret(e.target.value)}
                placeholder='{"auths":{"cloud.openshift.com":…}}'
                className="w-full bg-navy-900 border border-navy-600 rounded-md px-3 py-2 text-slate-200 text-xs font-mono resize-none focus:outline-none focus:border-sky-500"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
                <AlertTriangle size={13} /> {error}
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={onClose}
                className="flex-1 bg-navy-700 hover:bg-navy-600 text-slate-300 text-sm font-medium py-2 rounded-md transition-colors">
                Cancel
              </button>
              <button onClick={submitForm} disabled={busy}
                className="flex-1 flex items-center justify-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-md transition-colors">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                {busy ? 'Syncing…' : 'Sync Now'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Reset / Reinstall confirmation modal ─────────────────────────────────────
function ResetModal({ jobId, clusterName, isReinstall, onClose, onReset }) {
  const [busy,         setBusy]         = useState(false)
  const [error,        setError]        = useState('')
  const [offlineToken, setOfflineToken] = useState('')
  const [pullSecret,   setPullSecret]   = useState('')

  const confirm = async () => {
    if (isReinstall && (!offlineToken.trim() || !pullSecret.trim())) {
      setError('Both credentials are required for reinstall')
      return
    }
    setBusy(true)
    setError('')
    try {
      const body = isReinstall
        ? { offline_token: offlineToken.trim(), pull_secret: pullSecret.trim() }
        : {}
      await api.post(`/openshift/jobs/${jobId}/reset`, body)
      onReset()
    } catch (e) {
      const msg = e.response?.data?.error
      if (msg === 'no_stored_credentials') {
        onClose('need_creds')
      } else {
        setError(e.response?.data?.message || msg || 'Operation failed')
        setBusy(false)
      }
    }
  }

  const title  = isReinstall ? 'Reinstall Cluster' : 'Reset Cluster'
  const icon   = isReinstall ? 'text-red-400' : 'text-orange-400'
  const btnCls = isReinstall ? 'bg-red-700 hover:bg-red-600' : 'bg-orange-600 hover:bg-orange-500'
  const btnLbl = isReinstall ? (busy ? 'Reinstalling…' : 'Reinstall') : (busy ? 'Resetting…' : 'Reset Cluster')

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-navy-800 border border-navy-600 rounded-xl w-full max-w-md shadow-2xl">
        <div className="flex items-center gap-3 px-5 py-4 border-b border-navy-700">
          <RotateCcw size={16} className={icon} />
          <span className="text-slate-100 font-semibold text-sm">{title}</span>
          <button onClick={() => onClose()} className="ml-auto p-1 rounded text-slate-500 hover:text-slate-300">
            <X size={15} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          {isReinstall ? (
            <>
              <div className="flex items-start gap-2 bg-red-500/10 border border-red-500/30 rounded-lg p-3">
                <AlertTriangle size={14} className="text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-sm">
                  This will <strong>permanently destroy all VMs</strong> and disk images for{' '}
                  <code className="text-red-200">{clusterName}</code>, delete the cluster from Assisted Installer,
                  and start a completely fresh deployment.
                </p>
              </div>
              <p className="text-slate-500 text-xs">Credentials are required to clean up the AI resources.</p>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">Offline Token</label>
                <textarea rows={2} value={offlineToken} onChange={e => setOfflineToken(e.target.value)}
                  placeholder="eyJhbGciO…"
                  className="w-full bg-navy-900 border border-navy-600 rounded-md px-3 py-2 text-slate-200 text-xs font-mono resize-none focus:outline-none focus:border-red-500" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-medium">Pull Secret</label>
                <textarea rows={2} value={pullSecret} onChange={e => setPullSecret(e.target.value)}
                  placeholder='{"auths":…}'
                  className="w-full bg-navy-900 border border-navy-600 rounded-md px-3 py-2 text-slate-200 text-xs font-mono resize-none focus:outline-none focus:border-red-500" />
              </div>
            </>
          ) : (
            <>
              <p className="text-slate-300 text-sm">
                This will <span className="text-orange-300 font-medium">cancel and reset</span> the{' '}
                <code className="text-sky-300 text-xs">{clusterName}</code> cluster in Assisted Installer,
                re-insert the discovery ISO, and reboot all VMs back into discovery mode.
              </p>
              <p className="text-slate-500 text-xs">
                Any in-progress installation will be interrupted. Use <strong className="text-slate-400">Retry</strong> afterwards to start installation again.
              </p>
            </>
          )}

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/30 rounded px-3 py-2">
              <AlertTriangle size={13} /> {error}
            </div>
          )}

          <div className="flex gap-3">
            <button onClick={() => onClose()}
              className="flex-1 bg-navy-700 hover:bg-navy-600 text-slate-300 text-sm font-medium py-2 rounded-md transition-colors">
              Cancel
            </button>
            <button onClick={confirm} disabled={busy}
              className={`flex-1 flex items-center justify-center gap-2 ${btnCls} disabled:opacity-50 text-white text-sm font-semibold py-2 rounded-md transition-colors`}>
              {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
              {btnLbl}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Cluster Dashboard tab ─────────────────────────────────────────────────────
function ClusterDashboard({ jobId, jobResult, onReinstall }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [copied,  setCopied]  = useState(false)
  const [showAll, setShowAll] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const r = await api.get(`/openshift/jobs/${jobId}/cluster`)
      setData(r.data)
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to reach cluster')
    } finally {
      setLoading(false)
    }
  }, [jobId])

  useEffect(() => { load() }, [load])

  const copyKubeconfig = async () => {
    try {
      const r = await api.get(`/openshift/jobs/${jobId}/kubeconfig`, { responseType: 'text' })
      await navigator.clipboard.writeText(r.data)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {/* ignore */}
  }

  const nodes     = data?.nodes     || []
  const operators = data?.operators || []
  const version   = data?.version

  const opAvail   = operators.filter(o => o.available   === 'True').length
  const opDegraded  = operators.filter(o => o.degraded  === 'True').length
  const opProgress  = operators.filter(o => o.progressing === 'True').length
  const degradedOps = operators.filter(o => o.degraded === 'True')
  const shownOps  = showAll ? operators : operators.slice(0, 30)

  return (
    <div className="space-y-4">
      {/* ── Cluster header ──────────────────────────────────────────── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-4">
        <div className="flex items-center gap-3 flex-wrap">
          {version ? (
            <span className="bg-sky-500/20 text-sky-300 text-xs font-semibold px-2.5 py-1 rounded-full">
              OpenShift {version.version}
            </span>
          ) : null}
          {version?.channel && (
            <span className="bg-navy-700 text-slate-400 text-xs px-2.5 py-1 rounded-full border border-navy-600">
              {version.channel}
            </span>
          )}
          {nodes.length > 0 && (
            <span className="bg-navy-700 text-slate-300 text-xs px-2.5 py-1 rounded-full border border-navy-600">
              {nodes.length} node{nodes.length !== 1 ? 's' : ''}
            </span>
          )}
          {operators.length > 0 && (
            <span className={`text-xs px-2.5 py-1 rounded-full border ${
              opDegraded > 0
                ? 'bg-red-500/15 text-red-300 border-red-500/30'
                : 'bg-green-500/15 text-green-300 border-green-500/30'
            }`}>
              {opAvail}/{operators.length} operators
              {opDegraded > 0 && ` · ${opDegraded} degraded`}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            {jobResult?.console_url && (
              <a href={jobResult.console_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors">
                <ExternalLink size={12} /> Console
              </a>
            )}
            <button onClick={copyKubeconfig}
              className="flex items-center gap-1.5 bg-navy-700 hover:bg-navy-600 border border-navy-600 text-slate-300 hover:text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors">
              {copied ? <Check size={12} className="text-green-400" /> : <Copy size={12} />}
              {copied ? 'Copied' : 'Copy kubeconfig'}
            </button>
            <button onClick={load} title="Refresh"
              className="p-1.5 bg-navy-700 hover:bg-navy-600 border border-navy-600 rounded-md text-slate-400 hover:text-white transition-colors">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {jobResult?.api_url && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
            <span className="text-slate-600">API</span>
            <code className="text-slate-400 font-mono">{jobResult.api_url}</code>
          </div>
        )}
      </div>

      {/* ── Loading / error ──────────────────────────────────────────── */}
      {loading && (
        <div className="flex items-center gap-2 text-slate-500 text-sm py-6 justify-center">
          <Loader2 size={16} className="animate-spin" /> Querying cluster…
        </div>
      )}
      {!loading && error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-sm text-red-300 flex items-start gap-2">
          <AlertTriangle size={15} className="flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium">Could not reach cluster</p>
            <p className="text-red-400/80 text-xs mt-1 font-mono">{error}</p>
          </div>
        </div>
      )}

      {/* ── Nodes ───────────────────────────────────────────────────── */}
      {!loading && nodes.length > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-700 flex items-center gap-2">
            <Server size={14} className="text-slate-400" />
            <span className="text-slate-200 text-sm font-semibold">Nodes</span>
            <span className="ml-auto text-xs text-slate-500">{nodes.filter(n => n.ready === 'Ready').length}/{nodes.length} Ready</span>
          </div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-navy-700 bg-navy-900/40">
                <th className="text-left py-2 px-4 font-medium">Name</th>
                <th className="text-left py-2 px-4 font-medium">Role</th>
                <th className="text-left py-2 px-4 font-medium">Status</th>
                <th className="text-left py-2 px-4 font-medium">kubelet</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map(node => (
                <tr key={node.name} className="border-b border-navy-700/50 hover:bg-navy-700/20">
                  <td className="py-2.5 px-4 font-mono text-slate-200">{node.name}</td>
                  <td className="py-2.5 px-4">
                    {node.roles.map(r => (
                      <span key={r} className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold mr-1 ${
                        r === 'master' || r === 'control-plane'
                          ? 'bg-purple-500/20 text-purple-300'
                          : 'bg-blue-500/20 text-blue-300'
                      }`}>{r}</span>
                    ))}
                  </td>
                  <td className="py-2.5 px-4">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                      node.ready === 'Ready'
                        ? 'bg-green-500/20 text-green-400'
                        : node.ready === 'NotReady'
                        ? 'bg-red-500/20 text-red-400'
                        : 'bg-slate-500/20 text-slate-400'
                    }`}>{node.ready}</span>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-slate-500">{node.kubelet_version}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Operators ───────────────────────────────────────────────── */}
      {!loading && operators.length > 0 && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-700 flex items-center gap-3 flex-wrap">
            <Layers size={14} className="text-slate-400" />
            <span className="text-slate-200 text-sm font-semibold">Cluster Operators</span>
            <div className="flex items-center gap-3 ml-auto text-xs">
              <span className="text-green-400">{opAvail} available</span>
              {opProgress > 0 && <span className="text-amber-400">{opProgress} progressing</span>}
              {opDegraded > 0 && <span className="text-red-400">{opDegraded} degraded</span>}
            </div>
          </div>

          {/* Degraded operators highlighted first */}
          {degradedOps.length > 0 && (
            <div className="px-4 py-3 border-b border-navy-700 space-y-1.5">
              {degradedOps.map(op => (
                <div key={op.name} className="flex items-start gap-2 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                  <XCircle size={12} className="text-red-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <span className="text-red-300 text-xs font-semibold">{op.name}</span>
                    {op.message && <p className="text-red-400/70 text-[10px] mt-0.5 font-mono">{op.message.slice(0, 120)}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* All operators grid */}
          <div className="px-4 py-3">
            <div className="flex flex-wrap gap-1.5">
              {shownOps.map(op => {
                const isDeg  = op.degraded    === 'True'
                const isProg = op.progressing === 'True'
                const isOk   = op.available   === 'True' && !isDeg
                return (
                  <span key={op.name} title={op.message || op.name}
                    className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium border ${
                      isDeg  ? 'bg-red-500/15 text-red-300 border-red-500/30' :
                      isProg ? 'bg-amber-500/15 text-amber-300 border-amber-500/30' :
                      isOk   ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                               'bg-slate-500/10 text-slate-500 border-slate-600/30'
                    }`}>
                    {isDeg ? '✗' : isProg ? '↻' : '✓'} {op.name}
                  </span>
                )
              })}
            </div>
            {operators.length > 30 && (
              <button onClick={() => setShowAll(s => !s)}
                className="mt-2 text-xs text-slate-500 hover:text-sky-400 transition-colors">
                {showAll ? '↑ Show less' : `↓ Show all ${operators.length}`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Danger zone ─────────────────────────────────────────────── */}
      <div className="bg-navy-800 border border-red-900/40 rounded-xl p-4">
        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider mb-3">Danger Zone</p>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-slate-300 text-sm font-medium">Reinstall cluster</p>
            <p className="text-slate-500 text-xs mt-0.5">Permanently destroys all VMs and starts a fresh deployment</p>
          </div>
          <button onClick={onReinstall}
            className="flex items-center gap-1.5 bg-red-900/50 hover:bg-red-800/70 border border-red-700/50 text-red-300 text-xs font-semibold px-3 py-1.5 rounded-md transition-colors">
            <RotateCcw size={12} /> Reinstall
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function OpenShiftJob() {
  const { jobId }           = useParams()
  const navigate            = useNavigate()
  const [job, setJob]       = useState(null)
  const [copied, setCopied] = useState('')
  const [loading, setLoad]  = useState(true)
  const [configOpen, setConfigOpen] = useState(false)
  const [syncOpen,   setSyncOpen]   = useState(false)
  const [syncing,    setSyncing]    = useState(false)
  const [retrying,   setRetrying]   = useState(false)
  const [resetOpen,  setResetOpen]  = useState(false)
  const [activeTab,  setActiveTab]  = useState('deployment')
  const logRef              = useRef(null)
  const timerRef            = useRef(null)

  const poll = useCallback(async (silent = false) => {
    try {
      const r = await api.get(`/openshift/jobs/${jobId}`)
      setJob(r.data)
    } catch (e) {
      if (e.response?.status === 404) navigate('/openshift')
    } finally {
      if (!silent) setLoad(false)
    }
  }, [jobId, navigate])

  useEffect(() => {
    poll()
    timerRef.current = setInterval(() => poll(true), 5000)
    return () => clearInterval(timerRef.current)
  }, [poll])

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [job?.logs?.length])

  // Stop polling when done; restart if job comes back to pending (e.g. after retry)
  useEffect(() => {
    if (job?.status === 'complete' || job?.status === 'failed') {
      clearInterval(timerRef.current)
    } else if (job?.status === 'pending') {
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => poll(true), 5000)
    }
  }, [job?.status])  // eslint-disable-line

  const copy = (text, key) => {
    navigator.clipboard.writeText(text)
    setCopied(key)
    setTimeout(() => setCopied(''), 2000)
  }

  // Parse log data for rich display
  const parsed = useMemo(() => {
    if (!job) return null
    return parseLogs(job.logs || [], job.config)
  }, [job?.logs?.length, job?.config])  // eslint-disable-line

  // Direct sync — uses stored credentials, no modal needed
  const syncDirect = async () => {
    setSyncing(true)
    try {
      await api.post(`/openshift/jobs/${jobId}/sync`, {})
      // Restart polling
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => poll(true), 5000)
      poll(true)
    } catch (e) {
      if (e.response?.data?.error === 'no_stored_credentials') {
        // No stored creds — fall back to modal
        setSyncOpen(true)
      }
      // other errors: job will show in logs
    } finally {
      setSyncing(false)
    }
  }

  // Resume polling when sync modal completes
  const handleSynced = () => {
    setSyncOpen(false)
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => poll(true), 5000)
    poll(true)
  }

  // Handle reset modal close (may need creds)
  const handleResetClose = (reason) => {
    setResetOpen(false)
    if (reason === 'need_creds') setSyncOpen(true)
  }

  const handleResetDone = () => {
    setResetOpen(false)
    clearInterval(timerRef.current)
    timerRef.current = setInterval(() => poll(true), 5000)
    poll(true)
  }

  // Retry a failed deployment (cancel+reset cluster, reinsert ISO, reboot VMs)
  const retryDeploy = async () => {
    setRetrying(true)
    try {
      await api.post(`/openshift/jobs/${jobId}/retry`, {})
      clearInterval(timerRef.current)
      timerRef.current = setInterval(() => poll(true), 5000)
      poll(true)
    } catch (e) {
      if (e.response?.data?.error === 'no_stored_credentials') {
        setSyncOpen(true)
      }
    } finally {
      setRetrying(false)
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

  // ISO download: progress updates from 22→32 during download
  const isDownloadingISO = isRunning && (job.phase || '').includes('Downloading')
  const isoDownloadPct = isDownloadingISO ? Math.min(100, Math.round((progress - 22) / 10 * 100)) : null

  // Node registration phase active or past
  const showNodeBar = progress >= 45 && parsed?.nodeTotal > 0

  // Installation phase active or past
  const showInstallBar = progress >= 60 && parsed?.installPct > 0

  // Total VMs expected
  const isSNO = job.config?.deployment_type === 'sno'
  const totalVMs = isSNO ? 1
    : (parseInt(job.config?.control_plane_count || 3) + parseInt(job.config?.worker_count || 2))

  // Status banner colours
  const bannerBorder = isComplete ? 'border-green-500/30' : isFailed ? 'border-red-500/30' : 'border-sky-500/30'
  const bannerBg     = isComplete ? 'bg-green-500/10'     : isFailed ? 'bg-red-500/10'     : 'bg-sky-500/10'
  const progressColor = isComplete ? 'bg-green-500' : isFailed ? 'bg-red-500' : 'bg-gradient-to-r from-sky-500 to-blue-500'

  return (
    <div className="max-w-4xl space-y-4">

      {/* Sync modal */}
      {syncOpen && (
        <SyncModal
          jobId={jobId}
          onClose={() => setSyncOpen(false)}
          onSynced={handleSynced}
        />
      )}

      {/* Reset / Reinstall modal */}
      {resetOpen && (
        <ResetModal
          jobId={jobId}
          clusterName={job.config?.cluster_name || job.id}
          isReinstall={isComplete}
          onClose={handleResetClose}
          onReset={handleResetDone}
        />
      )}

      {/* ── Back + header ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/openshift')}
          className="p-2 rounded-md text-slate-400 hover:text-sky-400 hover:bg-navy-700 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div className="p-2.5 bg-red-500/10 rounded-xl">
          <Boxes size={18} className="text-red-400" />
        </div>
        <div className="flex-1">
          <h1 className="text-slate-100 font-bold text-lg">
            {job.config?.cluster_name || job.id}
          </h1>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            <span className={`font-mono px-1.5 py-0.5 rounded ${
              isSNO ? 'bg-purple-500/15 text-purple-300' : 'bg-blue-500/15 text-blue-300'
            }`}>
              {isSNO ? 'SNO' : `Multi-node (${totalVMs})`}
            </span>
            <span>OCP {job.config?.ocp_version}</span>
            <span className="font-mono text-slate-600">{job.id}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Reset / Reinstall button: shown for any job with a cluster_id */}
          {job.cluster_id && (
            <button
              onClick={() => setResetOpen(true)}
              title={isComplete
                ? 'Full teardown: destroy VMs, delete cluster, start fresh'
                : 'Cancel installation, reset cluster, reboot VMs into discovery mode'}
              className={`flex items-center gap-1.5 border text-xs font-semibold px-3 py-1.5 rounded-md transition-colors ${
                isComplete
                  ? 'bg-red-900/40 hover:bg-red-900/70 border-red-700/50 hover:border-red-600 text-red-300 hover:text-red-200'
                  : 'bg-navy-700 hover:bg-red-900/60 border-navy-600 hover:border-red-700/60 text-slate-400 hover:text-red-300'
              }`}>
              <RotateCcw size={12} /> {isComplete ? 'Reinstall' : 'Reset'}
            </button>
          )}

          {/* Sync button: shown for running or failed jobs that have a cluster_id */}
          {(isRunning || isFailed) && job.cluster_id && (
            <button
              onClick={syncDirect}
              disabled={syncing}
              title={job.has_credentials ? 'Sync using saved credentials' : 'Credentials required'}
              className="flex items-center gap-1.5 bg-amber-600/80 hover:bg-amber-500 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors">
              {syncing
                ? <Loader2 size={12} className="animate-spin" />
                : <Upload size={12} />}
              {syncing ? 'Syncing…' : 'Sync from AI'}
              {!job.has_credentials && !syncing && (
                <span className="ml-0.5 text-amber-200 opacity-70">*</span>
              )}
            </button>
          )}
          {isFailed && job.cluster_id && (
            <button
              onClick={retryDeploy}
              disabled={retrying}
              title={job.has_credentials ? 'Reset cluster and retry installation' : 'Credentials required'}
              className="flex items-center gap-1.5 bg-orange-600/90 hover:bg-orange-500 disabled:opacity-60 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors">
              {retrying
                ? <Loader2 size={12} className="animate-spin" />
                : <RefreshCw size={12} />}
              {retrying ? 'Retrying…' : 'Retry'}
              {!job.has_credentials && !retrying && (
                <span className="ml-0.5 text-orange-200 opacity-70">*</span>
              )}
            </button>
          )}
          {isFailed && (
            <button onClick={() => navigate('/openshift/deploy')}
              className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold px-3 py-1.5 rounded-md transition-colors">
              <RefreshCw size={12} /> New Deployment
            </button>
          )}
        </div>
      </div>

      {/* ── Tab bar (shown when cluster tab is available) ─────────────── */}
      {isComplete && (
        <div className="flex gap-1 bg-navy-800 border border-navy-600 rounded-lg p-1 w-fit">
          {[
            { id: 'deployment', label: 'Deployment', Icon: Cpu },
            { id: 'cluster',    label: 'Cluster',    Icon: Layers },
          ].map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-1.5 rounded text-sm font-medium transition-all ${
                activeTab === id
                  ? 'bg-sky-600 text-white shadow'
                  : 'text-slate-400 hover:text-sky-300 hover:bg-navy-700'
              }`}>
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>
      )}

      {/* ── Cluster dashboard tab ─────────────────────────────────────── */}
      {activeTab === 'cluster' && isComplete && (
        <ClusterDashboard
          jobId={jobId}
          jobResult={job.result}
          onReinstall={() => setResetOpen(true)}
        />
      )}

      {/* ── Deployment tab content ────────────────────────────────────── */}
      {(activeTab === 'deployment' || !isComplete) && (<>

      {/* ── Status banner ────────────────────────────────────────────── */}
      <div className={`flex items-center gap-4 bg-navy-800 border ${bannerBorder} rounded-xl p-4`}>
        <div className={`p-3 rounded-xl flex-shrink-0 ${bannerBg}`}>
          {isComplete ? <ShieldCheck size={22} className="text-green-400" />
          : isFailed  ? <XCircle    size={22} className="text-red-400" />
          :             <Loader2    size={22} className="text-sky-400 animate-spin" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-slate-100 font-bold text-sm">{job.phase || 'Starting…'}</div>
          <div className="text-slate-400 text-xs mt-0.5">
            {isComplete ? 'Cluster is installed and ready!'
            : isFailed  ? 'Deployment failed — check errors below.'
            : isDownloadingISO ? (job.iso_dl
                ? `Downloading ISO… ${job.iso_dl.pct}% · ${job.iso_dl.speed_mbs} MB/s`
                : `Downloading discovery ISO… ${isoDownloadPct ?? 0}%`)
            : showInstallBar && parsed?.installInfo ? parsed.installInfo
            : 'Deployment in progress — this may take 45–90 minutes.'}
          </div>
        </div>
        <div className="text-3xl font-bold text-sky-400 flex-shrink-0">{progress}%</div>
      </div>

      {/* ── Overall progress bar ─────────────────────────────────────── */}
      <div className="space-y-1">
        <div className="w-full bg-navy-700 rounded-full h-3 overflow-hidden">
          <div className={`h-3 rounded-full transition-all duration-1000 ${progressColor}`}
            style={{ width: `${progress}%` }} />
        </div>
      </div>

      {/* ── Phase timeline ───────────────────────────────────────────── */}
      <StepTimeline progress={progress} isComplete={isComplete} isFailed={isFailed} />

      {/* ── Node progress grid (during + after install) ───────────────── */}
      {progress >= 65 && <NodeGrid nodes={job.nodes} />}

      {/* ── Operator panel (during finalizing + install) ──────────────── */}
      {progress >= 65 && job.ai_operators?.length > 0 && (
        <OperatorPanel operators={job.ai_operators} />
      )}

      {/* ── Event timeline ───────────────────────────────────────────── */}
      {job.events?.length > 0 && <EventFeed events={job.events} />}

      {/* ── Sub-progress panels ──────────────────────────────────────── */}
      {(isDownloadingISO || showNodeBar || showInstallBar || (parsed?.vmsCreated > 0 && progress < 45)) && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl p-4 space-y-4">

          {/* ISO download bar */}
          {isDownloadingISO && (
            <IsoDownloadBar isoDl={job.iso_dl} fallbackPct={isoDownloadPct ?? 0} />
          )}

          {/* VM creation progress */}
          {parsed?.vmsCreated > 0 && progress < 45 && (
            <ProgressBar
              label="Virtual Machines Created"
              value={parsed.vmsCreated}
              max={totalVMs}
              color="amber"
            />
          )}

          {/* Node registration bar */}
          {showNodeBar && (
            <ProgressBar
              label="Node Registration"
              value={parsed.nodeRegistered}
              max={parsed.nodeTotal}
              color={parsed.nodeRegistered >= parsed.nodeTotal ? 'green' : 'sky'}
              sublabel={parsed.nodeRegistered >= parsed.nodeTotal ? 'All registered ✓' : 'Waiting for nodes to boot…'}
            />
          )}

          {/* Installation progress bar */}
          {showInstallBar && (
            <ProgressBar
              label="OpenShift Installation"
              value={parsed.installPct}
              color={parsed.installStatus === 'installed' ? 'green' : 'sky'}
              sublabel={parsed.installStatus
                ? parsed.installStatus.replace(/-/g, ' ')
                : 'preparing…'}
            />
          )}
        </div>
      )}

      {/* ── Warnings / errors panel ──────────────────────────────────── */}
      {parsed && (parsed.warnings.length > 0 || parsed.errors.length > 0) && (
        <WarningsPanel warnings={parsed.warnings} errors={parsed.errors} />
      )}

      {/* ── Configuration (collapsible) ───────────────────────────────── */}
      {job.config && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
          <button
            onClick={() => setConfigOpen(o => !o)}
            className="w-full flex items-center gap-2 px-4 py-3 border-b border-navy-700 text-left hover:bg-navy-700/30 transition-colors"
          >
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
                ['Cluster Name',     job.config.cluster_name],
                ['Base Domain',      job.config.base_domain],
                ['OCP Version',      job.config.ocp_version],
                ['Type',             isSNO ? 'Single Node (SNO)' : `Multi-node (${job.config.control_plane_count}CP + ${job.config.worker_count}W)`],
                ['Network',          job.config.libvirt_network],
                ['Machine CIDR',     job.config.machine_cidr],
                ['Cluster CIDR',     job.config.cluster_cidr],
                ['Service CIDR',     job.config.service_cidr],
                ['Storage Path',     job.config.storage_path],
                ['Static IP',        job.config.static_ip_enabled ? 'Enabled' : null],
                ['API VIP',          job.config.api_vip],
                ['Ingress VIP',      job.config.ingress_vip],
              ].map(([k, v]) => v ? (
                <div key={k} className="px-4 py-2.5 border-b border-navy-700/50 flex gap-3">
                  <span className="text-slate-500 text-xs w-28 flex-shrink-0">{k}</span>
                  <span className="text-slate-200 text-xs font-mono">{v}</span>
                </div>
              ) : null)}
            </div>
          )}
        </div>
      )}

      {/* ── Deployment log ────────────────────────────────────────────── */}
      <DeployLog logs={job.logs || []} isRunning={isRunning} />

      {/* ── Results (complete) ───────────────────────────────────────── */}
      {isComplete && job.result && (
        <div className="bg-green-900/10 border border-green-700/40 rounded-xl p-5 space-y-4">
          <h3 className="text-green-400 font-semibold text-sm flex items-center gap-2">
            <CheckCircle size={15} /> Cluster Ready
          </h3>

          {[
            { label: 'Console URL', key: 'console_url', value: job.result.console_url, link: true },
            { label: 'API URL',     key: 'api_url',     value: job.result.api_url },
          ].filter(i => i.value).map(item => (
            <div key={item.key}>
              <div className="text-slate-400 text-xs mb-1">{item.label}</div>
              <div className="flex items-center gap-2">
                <code className="text-sky-300 text-xs font-mono bg-navy-900 px-3 py-1.5 rounded flex-1 overflow-x-auto">
                  {item.value}
                </code>
                {item.link && (
                  <a href={item.value} target="_blank" rel="noopener noreferrer"
                    className="p-1.5 rounded text-sky-400 hover:bg-sky-500/10 transition-colors">
                    <ExternalLink size={14} />
                  </a>
                )}
                <button onClick={() => copy(item.value, item.key)}
                  className="p-1.5 rounded text-slate-400 hover:text-sky-300 transition-colors">
                  {copied === item.key ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          ))}

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

          <a href={`/api/openshift/jobs/${jobId}/kubeconfig`}
            className="inline-flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold px-4 py-2 rounded-md text-sm transition-colors">
            <Download size={14} /> Download kubeconfig
          </a>
        </div>
      )}

      </>)} {/* end deployment tab */}
    </div>
  )
}
