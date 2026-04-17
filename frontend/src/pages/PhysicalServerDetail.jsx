import { useState, useEffect, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Server, ArrowLeft, RefreshCw, ExternalLink, Thermometer,
  Wind, Zap, FileText, Power, AlertTriangle, CheckCircle,
  Cpu, MemoryStick, Info, Activity, ChevronDown, ChevronUp
} from 'lucide-react'
import api from '../api'

// ── Shared components ─────────────────────────────────────────────────────────

const healthBadge = h => {
  if (!h) return <span className="text-slate-500">—</span>
  const s = h.toLowerCase()
  const cls = s === 'ok'
    ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700'
    : s === 'warning'
    ? 'bg-amber-900/60 text-amber-300 border-amber-700'
    : 'bg-red-900/60 text-red-300 border-red-700'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${cls}`}>{h}</span>
  )
}

const powerBadge = p => {
  if (!p) return <span className="text-slate-500">—</span>
  const cls = p.toLowerCase() === 'on'
    ? 'bg-emerald-900/60 text-emerald-300 border-emerald-700'
    : 'bg-slate-700 text-slate-400 border-slate-600'
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${cls}`}>{p}</span>
  )
}

const InfoRow = ({ label, value, mono = false }) => (
  <div className="flex items-start justify-between py-2.5 border-b border-slate-700/50 last:border-0">
    <span className="text-slate-400 text-sm">{label}</span>
    <span className={`text-sm text-right ml-4 ${mono ? 'font-mono text-slate-300' : 'text-white'}`}>
      {value || '—'}
    </span>
  </div>
)

const Card = ({ title, icon: Icon, children, className = '' }) => (
  <div className={`bg-slate-800 border border-slate-700 rounded-xl overflow-hidden ${className}`}>
    <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-700 bg-slate-800/80">
      <Icon size={15} className="text-blue-400" />
      <span className="text-slate-200 text-sm font-medium">{title}</span>
    </div>
    <div className="p-4">{children}</div>
  </div>
)

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS = ['Overview', 'Health', 'Event Log', 'Power']

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ system }) {
  if (!system) return null
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <Card title="System" icon={Server}>
        <InfoRow label="Model"          value={system.model} />
        <InfoRow label="Serial Number"  value={system.serial} mono />
        <InfoRow label="SKU"            value={system.sku} mono />
        <InfoRow label="BIOS Version"   value={system.bios_version} />
        <InfoRow label="POST State"     value={system.post_state} />
        <InfoRow label="Power State"    value={<>{powerBadge(system.power_state)}</>} />
        <InfoRow label="Health"         value={<>{healthBadge(system.health_rollup)}</>} />
      </Card>

      <Card title="iLO Management" icon={Activity}>
        <InfoRow label="iLO Model"      value={system.ilo_model} />
        <InfoRow label="iLO Firmware"   value={system.ilo_firmware} />
        <InfoRow label="iLO IP"         value={system.ilo_ip} mono />
        <div className="mt-3">
          <a href={system.console_url} target="_blank" rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2 rounded-lg
                       bg-blue-600/20 border border-blue-600/40 text-blue-300
                       hover:bg-blue-600/30 transition-colors text-sm">
            <ExternalLink size={14} /> Open iLO Web Console
          </a>
        </div>
      </Card>

      <Card title="Processor" icon={Cpu}>
        <InfoRow label="Model"  value={system.cpu_model?.trim()} />
        <InfoRow label="Count"  value={system.cpu_count} />
        <InfoRow label="Health" value={<>{healthBadge(system.cpu_health)}</>} />
      </Card>

      <Card title="Memory" icon={MemoryStick}>
        <InfoRow label="Total RAM" value={system.ram_gib ? `${system.ram_gib} GiB` : '—'} />
        <InfoRow label="Health"    value={<>{healthBadge(system.ram_health)}</>} />
      </Card>
    </div>
  )
}

// ── Health tab ────────────────────────────────────────────────────────────────

function TempBar({ reading, warn, crit }) {
  const max   = crit ? crit + 10 : 100
  const pct   = Math.min((reading / max) * 100, 100)
  const color = crit && reading >= crit
    ? 'bg-red-500'
    : warn && reading >= warn
    ? 'bg-amber-500'
    : 'bg-emerald-500'
  return (
    <div className="w-full bg-slate-700 rounded-full h-1.5 mt-1">
      <div className={`h-1.5 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function HealthTab({ health }) {
  if (!health) return <p className="text-slate-400 text-sm">Loading…</p>
  if (health.error) return (
    <div className="text-center py-10">
      <AlertTriangle size={32} className="text-red-400 mx-auto mb-2" />
      <p className="text-red-400">{health.error}</p>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Power summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Current Draw', value: health.power_consumed_watts, unit: 'W', icon: Zap, color: 'text-amber-400' },
          { label: 'Average Draw',  value: health.power_avg_watts,     unit: 'W', icon: Activity, color: 'text-blue-400' },
          { label: 'Capacity',      value: health.power_capacity_watts, unit: 'W', icon: Zap, color: 'text-slate-400' },
        ].map(({ label, value, unit, icon: Icon, color }) => (
          <div key={label} className="bg-slate-900/50 border border-slate-700 rounded-lg p-3">
            <div className="flex items-center gap-1.5 text-slate-400 text-xs mb-1">
              <Icon size={12} className={color} /> {label}
            </div>
            <p className="text-white font-semibold text-lg">
              {value != null ? `${value}${unit}` : '—'}
            </p>
          </div>
        ))}
      </div>

      {/* Power supplies */}
      {health.power_supplies?.length > 0 && (
        <Card title="Power Supplies" icon={Zap}>
          <div className="space-y-2">
            {health.power_supplies.map((ps, i) => (
              <div key={i} className="flex items-center justify-between py-1.5
                                       border-b border-slate-700/50 last:border-0">
                <div>
                  <p className="text-white text-sm">{ps.name}</p>
                  <p className="text-slate-500 text-xs">{ps.state}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-400">
                  {ps.input_watts != null && <span>{ps.input_watts}W in</span>}
                  {ps.output_watts != null && <span>{ps.output_watts}W out</span>}
                  {healthBadge(ps.health)}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Temperatures */}
      {health.temperatures?.length > 0 && (
        <Card title="Temperatures" icon={Thermometer}>
          <div className="space-y-3">
            {health.temperatures.map((t, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-300">{t.name}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{t.location}</span>
                    <span className={`font-medium ${
                      t.upper_crit && t.reading_c >= t.upper_crit ? 'text-red-400' :
                      t.upper_warn && t.reading_c >= t.upper_warn ? 'text-amber-400' :
                      'text-white'}`}>
                      {t.reading_c}°C
                    </span>
                    {healthBadge(t.health)}
                  </div>
                </div>
                <TempBar reading={t.reading_c} warn={t.upper_warn} crit={t.upper_crit} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Fans */}
      {health.fans?.length > 0 && (
        <Card title="Fans" icon={Wind}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {health.fans.map((f, i) => (
              <div key={i} className="bg-slate-900/50 rounded-lg p-2.5 border border-slate-700">
                <p className="text-slate-400 text-xs truncate">{f.name}</p>
                <p className="text-white font-medium text-sm mt-0.5">
                  {f.reading != null ? `${f.reading} ${f.units}` : '—'}
                </p>
                <div className="mt-1">{healthBadge(f.health)}</div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

// ── Event Log tab ─────────────────────────────────────────────────────────────

const severityColor = s => {
  if (!s) return 'text-slate-400'
  const v = s.toLowerCase()
  if (v === 'ok')       return 'text-emerald-400'
  if (v === 'warning')  return 'text-amber-400'
  if (v === 'critical') return 'text-red-400'
  return 'text-slate-400'
}

const severityDot = s => {
  const v = (s || '').toLowerCase()
  const cls = v === 'ok' ? 'bg-emerald-400' : v === 'warning' ? 'bg-amber-400' :
              v === 'critical' ? 'bg-red-400' : 'bg-slate-500'
  return <span className={`inline-block w-2 h-2 rounded-full ${cls} shrink-0 mt-1.5`} />
}

function EventLogTab({ logs }) {
  if (!logs) return <p className="text-slate-400 text-sm">Loading…</p>
  if (logs.error) return (
    <div className="text-center py-10">
      <AlertTriangle size={32} className="text-red-400 mx-auto mb-2" />
      <p className="text-red-400">{logs.error}</p>
    </div>
  )

  return (
    <div>
      <p className="text-slate-400 text-xs mb-3">
        Showing {logs.entries?.length} of {logs.total} entries (most recent first)
      </p>
      <div className="space-y-1">
        {(logs.entries || []).map((e, i) => (
          <div key={i} className="flex gap-3 p-3 bg-slate-900/40 rounded-lg
                                   border border-slate-700/50 hover:border-slate-600 transition-colors">
            {severityDot(e.severity)}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-xs font-medium ${severityColor(e.severity)}`}>
                  {e.severity}
                </span>
                {e.category && (
                  <span className="text-xs text-slate-500 bg-slate-700 px-1.5 py-0.5 rounded">
                    {e.category}
                  </span>
                )}
                <span className="text-xs text-slate-500 ml-auto shrink-0">
                  {e.created ? new Date(e.created).toLocaleString() : ''}
                </span>
              </div>
              <p className="text-slate-300 text-sm mt-1">{e.message}</p>
            </div>
          </div>
        ))}
        {logs.entries?.length === 0 && (
          <div className="text-center py-10">
            <CheckCircle size={32} className="text-emerald-400 mx-auto mb-2" />
            <p className="text-slate-400">No log entries found</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Power tab ─────────────────────────────────────────────────────────────────

const POWER_ACTIONS = [
  { action: 'on',           label: 'Power On',         desc: 'Start the server',                   color: 'emerald', icon: Power },
  { action: 'graceful_off', label: 'Graceful Shutdown', desc: 'OS-controlled shutdown',             color: 'amber',   icon: Power },
  { action: 'off',          label: 'Force Off',         desc: 'Immediate power cut',               color: 'red',     icon: Power },
  { action: 'restart',      label: 'Graceful Restart',  desc: 'OS-controlled reboot',              color: 'blue',    icon: RefreshCw },
  { action: 'force_restart',label: 'Force Restart',     desc: 'Hard reset',                        color: 'orange',  icon: RefreshCw },
  { action: 'cold_boot',    label: 'Cold Boot',         desc: 'Full power cycle (off then on)',    color: 'purple',  icon: RefreshCw },
]

const colorMap = {
  emerald: 'border-emerald-700 hover:bg-emerald-900/30 text-emerald-300',
  amber:   'border-amber-700   hover:bg-amber-900/30   text-amber-300',
  red:     'border-red-700     hover:bg-red-900/30     text-red-300',
  blue:    'border-blue-700    hover:bg-blue-900/30    text-blue-300',
  orange:  'border-orange-700  hover:bg-orange-900/30  text-orange-300',
  purple:  'border-purple-700  hover:bg-purple-900/30  text-purple-300',
}

function PowerTab({ serverId, powerState, onPowerAction }) {
  const [pending, setPending] = useState(null)
  const [result, setResult]   = useState(null)

  const handleAction = async action => {
    const a = POWER_ACTIONS.find(x => x.action === action)
    if (!confirm(`${a.label} — are you sure?`)) return
    setPending(action)
    setResult(null)
    try {
      await api.post(`/bmc/servers/${serverId}/power`, { action })
      setResult({ ok: true, msg: `${a.label} command sent successfully` })
      setTimeout(() => onPowerAction(), 3000)
    } catch (e) {
      setResult({ ok: false, msg: e.response?.data?.error || 'Command failed' })
    } finally {
      setPending(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-slate-900/50 border border-slate-700 rounded-xl p-4 flex items-center gap-3">
        <div className={`w-3 h-3 rounded-full ${powerState === 'On' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
        <span className="text-white font-medium">Current state: {powerState || '—'}</span>
      </div>

      {result && (
        <div className={`p-3 rounded-lg border text-sm flex items-center gap-2 ${
          result.ok
            ? 'bg-emerald-900/30 border-emerald-700 text-emerald-300'
            : 'bg-red-900/30 border-red-700 text-red-300'
        }`}>
          {result.ok ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
          {result.msg}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {POWER_ACTIONS.map(({ action, label, desc, color, icon: Icon }) => (
          <button key={action} onClick={() => handleAction(action)}
            disabled={!!pending}
            className={`flex items-start gap-3 p-4 rounded-xl bg-slate-800 border
                        transition-colors text-left disabled:opacity-50 ${colorMap[color]}`}>
            <Icon size={18} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">
                {pending === action ? 'Sending…' : label}
              </p>
              <p className="text-xs opacity-70 mt-0.5">{desc}</p>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PhysicalServerDetail() {
  const { serverId } = useParams()
  const [tab, setTab]       = useState('Overview')
  const [system, setSystem] = useState(null)
  const [health, setHealth] = useState(null)
  const [logs, setLogs]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  const fetchSystem = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const r = await api.get(`/bmc/servers/${serverId}/system`)
      setSystem(r.data)
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load server')
    } finally {
      setLoading(false)
    }
  }, [serverId])

  const fetchHealth = useCallback(async () => {
    try {
      const r = await api.get(`/bmc/servers/${serverId}/health`)
      setHealth(r.data)
    } catch (e) {
      setHealth({ error: e.response?.data?.error || 'Failed to load health data' })
    }
  }, [serverId])

  const fetchLogs = useCallback(async () => {
    try {
      const r = await api.get(`/bmc/servers/${serverId}/logs`)
      setLogs(r.data)
    } catch (e) {
      setLogs({ error: e.response?.data?.error || 'Failed to load logs' })
    }
  }, [serverId])

  useEffect(() => { fetchSystem() }, [fetchSystem])

  useEffect(() => {
    if (tab === 'Health' && !health)   fetchHealth()
    if (tab === 'Event Log' && !logs)  fetchLogs()
  }, [tab])

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-6">
        <Link to="/physical-servers" className="flex items-center gap-1 hover:text-white transition-colors">
          <ArrowLeft size={14} /> Physical Servers
        </Link>
        <span>/</span>
        <span className="text-white">{system?.name || serverId}</span>
      </div>

      {loading ? (
        <div className="space-y-4">
          {[1,2,3].map(i => <div key={i} className="h-20 bg-slate-800 rounded-xl animate-pulse" />)}
        </div>
      ) : error ? (
        <div className="text-center py-20">
          <AlertTriangle size={40} className="text-red-400 mx-auto mb-3" />
          <p className="text-red-400 font-medium">{error}</p>
          <button onClick={fetchSystem} className="mt-4 text-sm text-blue-400 hover:text-blue-300">
            Try again
          </button>
        </div>
      ) : (
        <>
          {/* Header */}
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-6">
            <div className="flex items-start justify-between flex-wrap gap-4">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-blue-900/40 rounded-xl border border-blue-800/40">
                  <Server size={28} className="text-blue-400" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-white">{system?.name}</h1>
                  <p className="text-slate-400 text-sm">{system?.model}</p>
                  {system?.description && (
                    <p className="text-slate-500 text-xs mt-0.5">{system.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {healthBadge(system?.health_rollup)}
                {powerBadge(system?.power_state)}
                <button onClick={fetchSystem}
                  className="p-2 rounded-lg border border-slate-600 text-slate-400
                             hover:text-white hover:bg-slate-700 transition-colors">
                  <RefreshCw size={14} />
                </button>
                <a href={system?.console_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-600
                             hover:bg-blue-500 text-white text-sm font-medium transition-colors">
                  <ExternalLink size={14} /> iLO Console
                </a>
              </div>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-slate-700 mb-5 overflow-x-auto">
            {TABS.map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors
                  ${tab === t
                    ? 'text-blue-400 border-b-2 border-blue-400'
                    : 'text-slate-400 hover:text-white'}`}>
                {t}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'Overview'  && <OverviewTab system={system} />}
          {tab === 'Health'    && <HealthTab health={health} />}
          {tab === 'Event Log' && <EventLogTab logs={logs} />}
          {tab === 'Power'     && (
            <PowerTab
              serverId={serverId}
              powerState={system?.power_state}
              onPowerAction={fetchSystem}
            />
          )}
        </>
      )}
    </div>
  )
}
