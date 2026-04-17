import { useState, useEffect, useRef, useCallback } from 'react'
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import api from '../api'
import {
  Cpu, MemoryStick, HardDrive, Network, RefreshCw,
  Activity, Loader2, TrendingUp, Server
} from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────

function bytes(n, decimals = 1) {
  if (n == null || isNaN(n)) return '—'
  if (n === 0) return '0 B'
  const k = 1024
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(Math.abs(n)) / Math.log(k))
  return `${(n / Math.pow(k, i)).toFixed(decimals)} ${u[Math.min(i, u.length - 1)]}`
}

function pct(n) { return n != null ? `${n.toFixed(1)}%` : '—' }

function fmtTs(ts) {
  const d = new Date(ts * 1000)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// Convert raw [[ts, val], ...] to recharts-friendly [{t, v}]
function toPoints(series) {
  if (!series?.length) return []
  return series.map(([ts, v]) => ({ t: ts, v: parseFloat(v.toFixed(3)) }))
}

// Merge multiple named series onto shared timestamps
function mergeSeries(map) {
  const tsSet = new Set()
  Object.values(map).forEach(s => s.forEach(([ts]) => tsSet.add(ts)))
  const sorted = [...tsSet].sort()
  const lookup = {}
  Object.entries(map).forEach(([name, s]) => {
    lookup[name] = Object.fromEntries(s.map(([ts, v]) => [ts, parseFloat(v.toFixed(3))]))
  })
  return sorted.map(ts => {
    const pt = { t: ts }
    Object.keys(map).forEach(name => { pt[name] = lookup[name][ts] ?? null })
    return pt
  })
}

// ── chart theme ───────────────────────────────────────────────────────────────

const CHART_COLORS = [
  '#38bdf8', '#4ade80', '#f472b6', '#fb923c', '#a78bfa',
  '#facc15', '#34d399', '#f87171',
]

const AXIS_STYLE  = { fill: '#64748b', fontSize: 11 }
const GRID_STROKE = '#1e293b'

function ChartTooltip({ active, payload, label, formatter }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-navy-900 border border-navy-600 rounded px-3 py-2 text-xs shadow-xl">
      <p className="text-slate-400 mb-1">{fmtTs(label)}</p>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span className="text-slate-300">{p.name}:</span>
          <span className="text-slate-100 font-mono">{formatter ? formatter(p.value, p.name) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

// ── reusable components ───────────────────────────────────────────────────────

function StatCard({ label, value, sub, color = 'sky', icon: Icon, pctValue }) {
  const colors = {
    sky:    { text: 'text-sky-400',    bg: 'bg-sky-400/10',    ring: 'ring-sky-400/20' },
    green:  { text: 'text-green-400',  bg: 'bg-green-400/10',  ring: 'ring-green-400/20' },
    purple: { text: 'text-purple-400', bg: 'bg-purple-400/10', ring: 'ring-purple-400/20' },
    orange: { text: 'text-orange-400', bg: 'bg-orange-400/10', ring: 'ring-orange-400/20' },
    red:    { text: 'text-red-400',    bg: 'bg-red-400/10',    ring: 'ring-red-400/20' },
  }
  const c = colors[color] || colors.sky
  const barColor = pctValue > 85 ? 'bg-red-500' : pctValue > 65 ? 'bg-yellow-500' : `bg-${color}-500`

  return (
    <div className={`bg-navy-800 border border-navy-600 rounded-xl p-5 ring-1 ${c.ring}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-slate-400 text-sm font-medium">{label}</span>
        {Icon && <div className={`p-2 rounded-lg ${c.bg}`}><Icon size={16} className={c.text} /></div>}
      </div>
      <div className={`text-3xl font-bold ${c.text} mb-1`}>{value ?? '—'}</div>
      {sub && <div className="text-slate-500 text-xs">{sub}</div>}
      {pctValue != null && (
        <div className="mt-3">
          <div className="w-full bg-navy-600 rounded-full h-1.5">
            <div className={`${barColor} h-1.5 rounded-full transition-all`}
              style={{ width: `${Math.min(pctValue, 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}

function ChartCard({ title, icon: Icon, children, className = '' }) {
  return (
    <div className={`bg-navy-800 border border-navy-600 rounded-xl p-5 ${className}`}>
      <h3 className="text-slate-300 text-sm font-semibold flex items-center gap-2 mb-4">
        {Icon && <Icon size={15} className="text-sky-400" />}
        {title}
      </h3>
      {children}
    </div>
  )
}

// ── time range selector ────────────────────────────────────────────────────────

const RANGES = [
  { label: '15m', minutes: 15 },
  { label: '1h',  minutes: 60 },
  { label: '6h',  minutes: 360 },
  { label: '24h', minutes: 1440 },
]

// ── System metrics tab ────────────────────────────────────────────────────────

function SystemTab({ minutes, refreshMs, notify }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const timerRef = useRef(null)

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      const r = await api.get(`/metrics/dashboard?minutes=${minutes}`)
      setData(r.data)
    } catch (e) {
      notify(e.response?.data?.error || 'Failed to load metrics', 'error')
    } finally {
      setLoading(false)
    }
  }, [minutes])

  useEffect(() => {
    load(true)
    timerRef.current = setInterval(() => load(false), refreshMs)
    return () => clearInterval(timerRef.current)
  }, [load, refreshMs])

  if (loading) return (
    <div className="flex items-center gap-2 text-slate-400 py-16 justify-center">
      <Loader2 size={20} className="animate-spin" /> Loading metrics…
    </div>
  )
  if (!data) return null

  const h = data.history
  const cpuPoints  = toPoints(h.cpu)
  const memPoints  = toPoints(h.memory)
  const loadPoints = toPoints(h.load)
  const netPoints  = mergeSeries({ rx: h.net_rx, tx: h.net_tx })
  const diskPoints = mergeSeries({ read: h.disk_read, write: h.disk_write })

  return (
    <div className="space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="CPU Usage"    value={pct(data.cpu_pct)}  color="sky"    icon={Cpu}
          sub={`Load: ${data.load1} / ${data.load5} / ${data.load15}`} pctValue={data.cpu_pct} />
        <StatCard label="Memory"       value={pct(data.mem_pct)}  color="purple" icon={MemoryStick}
          sub={`${bytes(data.mem_used, 0)} / ${bytes(data.mem_total, 0)}`} pctValue={data.mem_pct} />
        <StatCard label="Disk (/)"     value={pct(data.disk_pct)} color="orange" icon={HardDrive}
          sub={`${bytes(data.disk_used, 0)} / ${bytes(data.disk_total, 0)}`} pctValue={data.disk_pct} />
        <StatCard label="Load Avg"     value={data.load1 ?? '—'}  color="green"  icon={TrendingUp}
          sub={`5m: ${data.load5}  15m: ${data.load15}`} />
      </div>

      {/* Charts — 2 column grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">

        {/* CPU */}
        <ChartCard title="CPU Usage %" icon={Cpu}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={cpuPoints}>
              <defs>
                <linearGradient id="gCpu" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#38bdf8" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="t" tickFormatter={fmtTs} tick={AXIS_STYLE} minTickGap={60} />
              <YAxis tick={AXIS_STYLE} domain={[0, 100]} tickFormatter={v => `${v}%`} width={42} />
              <Tooltip content={<ChartTooltip formatter={v => `${v?.toFixed(1)}%`} />} />
              <Area type="monotone" dataKey="v" name="CPU" stroke="#38bdf8" fill="url(#gCpu)"
                strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Memory */}
        <ChartCard title="Memory Usage %" icon={MemoryStick}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={memPoints}>
              <defs>
                <linearGradient id="gMem" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#c084fc" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#c084fc" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="t" tickFormatter={fmtTs} tick={AXIS_STYLE} minTickGap={60} />
              <YAxis tick={AXIS_STYLE} domain={[0, 100]} tickFormatter={v => `${v}%`} width={42} />
              <Tooltip content={<ChartTooltip formatter={v => `${v?.toFixed(1)}%`} />} />
              <Area type="monotone" dataKey="v" name="Memory" stroke="#c084fc" fill="url(#gMem)"
                strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Network I/O */}
        <ChartCard title="Network I/O (external interfaces)" icon={Network}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={netPoints}>
              <defs>
                <linearGradient id="gRx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#4ade80" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#4ade80" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gTx" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#fb923c" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#fb923c" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="t" tickFormatter={fmtTs} tick={AXIS_STYLE} minTickGap={60} />
              <YAxis tick={AXIS_STYLE} tickFormatter={v => bytes(v, 0) + '/s'} width={68} />
              <Tooltip content={<ChartTooltip formatter={(v, n) => bytes(v) + '/s'} />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Area type="monotone" dataKey="rx" name="↓ RX" stroke="#4ade80" fill="url(#gRx)"
                strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="tx" name="↑ TX" stroke="#fb923c" fill="url(#gTx)"
                strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Disk I/O */}
        <ChartCard title="Disk I/O" icon={HardDrive}>
          <ResponsiveContainer width="100%" height={200}>
            <AreaChart data={diskPoints}>
              <defs>
                <linearGradient id="gDr" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#38bdf8" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gDw" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f472b6" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#f472b6" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="t" tickFormatter={fmtTs} tick={AXIS_STYLE} minTickGap={60} />
              <YAxis tick={AXIS_STYLE} tickFormatter={v => bytes(v, 0) + '/s'} width={68} />
              <Tooltip content={<ChartTooltip formatter={v => bytes(v) + '/s'} />} />
              <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
              <Area type="monotone" dataKey="read"  name="Read"  stroke="#38bdf8" fill="url(#gDr)"
                strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Area type="monotone" dataKey="write" name="Write" stroke="#f472b6" fill="url(#gDw)"
                strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Load average — full width */}
        <ChartCard title="Load Average" icon={Activity} className="xl:col-span-2">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={loadPoints}>
              <CartesianGrid stroke={GRID_STROKE} vertical={false} />
              <XAxis dataKey="t" tickFormatter={fmtTs} tick={AXIS_STYLE} minTickGap={60} />
              <YAxis tick={AXIS_STYLE} width={36} />
              <Tooltip content={<ChartTooltip formatter={v => v?.toFixed(2)} />} />
              <Line type="monotone" dataKey="v" name="load1" stroke="#38bdf8"
                strokeWidth={2} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

      </div>
    </div>
  )
}

// ── VM metrics tab ────────────────────────────────────────────────────────────

function VMsTab({ refreshMs, notify }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [history, setHistory] = useState({})   // { uuid: [{t, cpu, net_rx, net_tx, disk_r, disk_w}] }
  const timerRef = useRef(null)
  const MAX_HIST = 120  // keep last 120 points per VM

  const load = useCallback(async (showSpinner = false) => {
    if (showSpinner) setLoading(true)
    try {
      const r = await api.get('/metrics/vms')
      const vms = r.data.vms
      setData(vms)

      // Append new data points to per-VM history
      setHistory(prev => {
        const next = { ...prev }
        const ts = Math.floor(r.data.ts)
        vms.forEach(vm => {
          const pts = next[vm.uuid] ? [...next[vm.uuid]] : []
          pts.push({
            t:       ts,
            cpu:     vm.cpu_pct,
            net_rx:  vm.net_rx_rate,
            net_tx:  vm.net_tx_rate,
            disk_r:  vm.disk_r_rate,
            disk_w:  vm.disk_w_rate,
          })
          if (pts.length > MAX_HIST) pts.splice(0, pts.length - MAX_HIST)
          next[vm.uuid] = pts
        })
        // Purge stale VMs not in this response
        const uuids = new Set(vms.map(v => v.uuid))
        Object.keys(next).forEach(k => { if (!uuids.has(k)) delete next[k] })
        return next
      })
    } catch (e) {
      notify(e.response?.data?.error || 'Failed to load VM metrics', 'error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(true)
    timerRef.current = setInterval(() => load(false), refreshMs)
    return () => clearInterval(timerRef.current)
  }, [load, refreshMs])

  if (loading) return (
    <div className="flex items-center gap-2 text-slate-400 py-16 justify-center">
      <Loader2 size={20} className="animate-spin" /> Loading VM metrics…
    </div>
  )
  if (!data) return null

  if (data.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 text-slate-500">
      <Server size={40} className="mb-4 opacity-30" />
      <p className="text-sm">No running VMs found.</p>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Summary cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {data.map((vm, i) => (
          <div key={vm.uuid}
            className="bg-navy-800 border border-navy-600 rounded-xl p-5 ring-1 ring-sky-400/10">
            <div className="flex items-center gap-2 mb-4">
              <div className="p-2 rounded-lg bg-sky-400/10">
                <Server size={14} className="text-sky-400" />
              </div>
              <div>
                <div className="text-slate-200 text-sm font-semibold">{vm.name}</div>
                <div className="text-slate-500 text-xs font-mono truncate w-40" title={vm.uuid}>
                  {vm.uuid.slice(0, 8)}…
                </div>
              </div>
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-3 mb-4">
              {/* CPU */}
              <div className="bg-navy-700/50 rounded-lg p-3">
                <div className="text-slate-400 text-xs mb-1 flex items-center gap-1">
                  <Cpu size={11} /> CPU
                </div>
                <div className="text-sky-300 text-lg font-bold font-mono">
                  {vm.cpu_pct != null ? `${vm.cpu_pct.toFixed(1)}%` : '—'}
                </div>
                {vm.cpu_pct != null && (
                  <div className="mt-1.5 w-full bg-navy-600 rounded-full h-1">
                    <div className={`h-1 rounded-full ${vm.cpu_pct > 85 ? 'bg-red-500' : vm.cpu_pct > 65 ? 'bg-yellow-500' : 'bg-sky-500'}`}
                      style={{ width: `${Math.min(vm.cpu_pct, 100)}%` }} />
                  </div>
                )}
              </div>

              {/* Memory */}
              <div className="bg-navy-700/50 rounded-lg p-3">
                <div className="text-slate-400 text-xs mb-1 flex items-center gap-1">
                  <MemoryStick size={11} /> Mem
                </div>
                <div className="text-purple-300 text-lg font-bold font-mono">
                  {vm.mem_pct != null ? `${vm.mem_pct.toFixed(1)}%` : '—'}
                </div>
                <div className="text-slate-500 text-xs mt-0.5">
                  {vm.mem_used != null ? `${bytes(vm.mem_used, 0)} / ${bytes(vm.mem_total, 0)}` : ''}
                </div>
                {vm.mem_pct != null && (
                  <div className="mt-1.5 w-full bg-navy-600 rounded-full h-1">
                    <div className={`h-1 rounded-full ${vm.mem_pct > 85 ? 'bg-red-500' : vm.mem_pct > 65 ? 'bg-yellow-500' : 'bg-purple-500'}`}
                      style={{ width: `${Math.min(vm.mem_pct, 100)}%` }} />
                  </div>
                )}
              </div>

              {/* Network */}
              <div className="bg-navy-700/50 rounded-lg p-3">
                <div className="text-slate-400 text-xs mb-1 flex items-center gap-1">
                  <Network size={11} /> Network
                </div>
                <div className="text-green-300 text-xs font-mono space-y-0.5">
                  <div>↓ {vm.net_rx_rate != null ? bytes(vm.net_rx_rate) + '/s' : '—'}</div>
                  <div>↑ {vm.net_tx_rate != null ? bytes(vm.net_tx_rate) + '/s' : '—'}</div>
                </div>
              </div>

              {/* Disk */}
              <div className="bg-navy-700/50 rounded-lg p-3">
                <div className="text-slate-400 text-xs mb-1 flex items-center gap-1">
                  <HardDrive size={11} /> Disk I/O
                </div>
                <div className="text-orange-300 text-xs font-mono space-y-0.5">
                  <div>R {vm.disk_r_rate != null ? bytes(vm.disk_r_rate) + '/s' : '—'}</div>
                  <div>W {vm.disk_w_rate != null ? bytes(vm.disk_w_rate) + '/s' : '—'}</div>
                </div>
              </div>
            </div>

            {/* Mini CPU history sparkline for this VM */}
            {history[vm.uuid]?.length > 2 && (
              <ResponsiveContainer width="100%" height={60}>
                <AreaChart data={history[vm.uuid]} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={`gvm${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.3} />
                      <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis domain={[0, 100]} hide />
                  <Tooltip content={<ChartTooltip formatter={v => `${v?.toFixed(1)}%`} />} />
                  <Area type="monotone" dataKey="cpu" name="CPU"
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    fill={`url(#gvm${i})`}
                    strokeWidth={1.5} dot={false} isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        ))}
      </div>

      {/* Combined CPU chart — all VMs */}
      {data.length > 0 && Object.keys(history).length > 0 && (() => {
        // Build merged dataset keyed by timestamp
        const tsSet = new Set()
        Object.values(history).forEach(pts => pts.forEach(p => tsSet.add(p.t)))
        const sorted = [...tsSet].sort()
        const byUuid = {}
        Object.entries(history).forEach(([uuid, pts]) => {
          byUuid[uuid] = Object.fromEntries(pts.map(p => [p.t, p.cpu]))
        })
        const merged = sorted.map(ts => {
          const pt = { t: ts }
          data.forEach(vm => { pt[vm.name] = byUuid[vm.uuid]?.[ts] ?? null })
          return pt
        })
        return (
          <ChartCard title="CPU % — All VMs" icon={Cpu}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={merged}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="t" tickFormatter={fmtTs} tick={AXIS_STYLE} minTickGap={60} />
                <YAxis tick={AXIS_STYLE} domain={[0, 100]} tickFormatter={v => `${v}%`} width={42} />
                <Tooltip content={<ChartTooltip formatter={v => `${v?.toFixed(1)}%`} />} />
                <Legend wrapperStyle={{ fontSize: 11, color: '#94a3b8' }} />
                {data.map((vm, i) => (
                  <Line key={vm.uuid} type="monotone" dataKey={vm.name}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    strokeWidth={1.5} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        )
      })()}

      {/* Combined network chart */}
      {data.length > 0 && Object.keys(history).length > 0 && (() => {
        const tsSet = new Set()
        Object.values(history).forEach(pts => pts.forEach(p => tsSet.add(p.t)))
        const sorted = [...tsSet].sort()
        const byUuid = {}
        Object.entries(history).forEach(([uuid, pts]) => {
          byUuid[uuid] = Object.fromEntries(pts.map(p => [p.t, { rx: p.net_rx, tx: p.net_tx }]))
        })
        const merged = sorted.map(ts => {
          const pt = { t: ts }
          data.forEach(vm => {
            pt[`${vm.name} ↓`] = byUuid[vm.uuid]?.[ts]?.rx ?? null
            pt[`${vm.name} ↑`] = byUuid[vm.uuid]?.[ts]?.tx ?? null
          })
          return pt
        })
        const keys = data.flatMap((vm, i) => [
          { key: `${vm.name} ↓`, color: CHART_COLORS[i % CHART_COLORS.length] },
          { key: `${vm.name} ↑`, color: CHART_COLORS[(i + 4) % CHART_COLORS.length] },
        ])
        return (
          <ChartCard title="Network I/O — All VMs" icon={Network}>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={merged}>
                <CartesianGrid stroke={GRID_STROKE} vertical={false} />
                <XAxis dataKey="t" tickFormatter={fmtTs} tick={AXIS_STYLE} minTickGap={60} />
                <YAxis tick={AXIS_STYLE} tickFormatter={v => bytes(v, 0) + '/s'} width={68} />
                <Tooltip content={<ChartTooltip formatter={v => bytes(v) + '/s'} />} />
                <Legend wrapperStyle={{ fontSize: 10, color: '#94a3b8' }} />
                {keys.map(({ key, color }) => (
                  <Line key={key} type="monotone" dataKey={key}
                    stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        )
      })()}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: 'system', label: 'System', icon: Activity },
  { id: 'vms',    label: 'VMs',    icon: Server },
]

export default function Metrics() {
  const [tab, setTab]           = useState('system')
  const [minutes, setMinutes]   = useState(60)
  const [refreshMs, setRefreshMs] = useState(3000)
  const [toast, setToast]       = useState({ msg: '', type: 'ok' })

  const REFRESH_OPTIONS = [
    { label: '3s',  ms: 3000 },
    { label: '5s',  ms: 5000 },
    { label: '10s', ms: 10000 },
    { label: '15s', ms: 15000 },
    { label: '30s', ms: 30000 },
    { label: '60s', ms: 60000 },
  ]

  const notify = (msg, type = 'ok') => setToast({ msg, type })

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Tabs */}
        <div className="flex gap-1 bg-navy-800 border border-navy-600 rounded-lg p-1">
          {TABS.map(t => {
            const Icon = t.icon
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all ${
                  tab === t.id
                    ? 'bg-sky-600 text-white shadow'
                    : 'text-slate-400 hover:text-sky-300 hover:bg-navy-700'
                }`}>
                <Icon size={14} />{t.label}
              </button>
            )
          })}
        </div>

        {/* Time range */}
        <div className="flex gap-1 bg-navy-800 border border-navy-600 rounded-lg p-1">
          {RANGES.map(r => (
            <button key={r.minutes} onClick={() => setMinutes(r.minutes)}
              className={`px-3 py-2 rounded text-xs font-medium transition-all ${
                minutes === r.minutes
                  ? 'bg-navy-500 text-sky-300'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-navy-700'
              }`}>
              {r.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* Refresh interval */}
        <div className="flex items-center gap-2">
          <RefreshCw size={12} className="text-slate-500" />
          <select
            value={refreshMs}
            onChange={e => setRefreshMs(Number(e.target.value))}
            className="bg-navy-800 border border-navy-600 rounded px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-sky-500 cursor-pointer"
          >
            {REFRESH_OPTIONS.map(o => (
              <option key={o.ms} value={o.ms}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Tab content — key forces remount on range or refresh change */}
      {tab === 'system' && <SystemTab key={`sys-${minutes}-${refreshMs}`} minutes={minutes} refreshMs={refreshMs} notify={notify} />}
      {tab === 'vms'    && <VMsTab   key={`vms-${refreshMs}`}                                refreshMs={refreshMs} notify={notify} />}

      {/* Toast */}
      {toast.msg && (
        <div className={`fixed bottom-5 right-5 flex items-center gap-2 px-4 py-3 rounded-lg border text-sm z-50 shadow-xl ${
          toast.type === 'error'
            ? 'bg-red-900/90 border-red-700 text-red-200'
            : 'bg-green-900/90 border-green-700 text-green-200'
        }`}>
          {toast.msg}
          <button onClick={() => setToast({ msg: '' })} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  )
}
