import { useEffect, useState, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Activity, Cpu, MemoryStick, HardDrive, Network } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import api from '../api'

const MAX_POINTS = 30

function bytesHuman(b) {
  if (!b) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let val = b
  let i = 0
  while (val >= 1024 && i < units.length - 1) { val /= 1024; i++ }
  return `${val.toFixed(1)} ${units[i]}`
}

function StatCard({ icon: Icon, label, value, color = 'sky' }) {
  return (
    <div className="bg-navy-700 border border-navy-400 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2">
        <Icon size={14} className={`text-${color}-400`} />
        <span className="text-slate-400 text-xs font-medium">{label}</span>
      </div>
      <div className="text-xl font-bold text-slate-100">{value}</div>
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload?.length) {
    return (
      <div className="bg-navy-800 border border-navy-400 rounded-lg px-3 py-2 text-xs">
        <div className="text-slate-400 mb-1">{label}</div>
        <div className="text-sky-400 font-medium">{payload[0]?.value?.toFixed(2)}%</div>
      </div>
    )
  }
  return null
}

export default function Monitor() {
  const { uuid } = useParams()
  const [vmName, setVmName] = useState('')
  const [stats, setStats] = useState(null)
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [ticks, setTicks] = useState(0)
  const intervalRef = useRef(null)

  useEffect(() => {
    api.get(`/vms/${uuid}`)
      .then(r => setVmName(r.data.name))
      .catch(() => {})
  }, [uuid])

  const fetchStats = () => {
    api.get(`/vms/${uuid}/stats`)
      .then(r => {
        setStats(r.data)
        setError('')
        setTicks(t => {
          const newTick = t + 1
          setHistory(prev => {
            const next = [...prev, { t: newTick, cpu: r.data.cpu_usage }]
            return next.slice(-MAX_POINTS)
          })
          return newTick
        })
      })
      .catch(e => {
        const msg = e.response?.data?.error || 'Error fetching stats'
        setError(msg)
      })
  }

  useEffect(() => {
    fetchStats()
    intervalRef.current = setInterval(fetchStats, 2000)
    return () => clearInterval(intervalRef.current)
  }, [uuid])

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to={`/vms/${uuid}`} className="text-slate-400 hover:text-sky-400 transition-colors">
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
            <Activity size={18} className="text-sky-400" />
            Monitor: {vmName || uuid}
          </h2>
          <p className="text-slate-400 text-sm mt-0.5">Live stats — polling every 2 seconds</p>
        </div>
      </div>

      {error && (
        <div className="bg-yellow-900/50 border border-yellow-700 text-yellow-300 text-sm rounded-xl px-4 py-3">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <StatCard icon={Cpu} label="CPU Usage" value={stats ? `${stats.cpu_usage}%` : '—'} color="sky" />
        <StatCard icon={MemoryStick} label="Memory Used" value={stats ? `${(stats.mem_used / 1024).toFixed(1)} GB` : '—'} color="purple" />
        <StatCard icon={HardDrive} label="Disk Read" value={stats ? bytesHuman(stats.disk_read) : '—'} color="green" />
        <StatCard icon={HardDrive} label="Disk Write" value={stats ? bytesHuman(stats.disk_write) : '—'} color="yellow" />
        <StatCard icon={Network} label="Net RX" value={stats ? bytesHuman(stats.net_rx) : '—'} color="blue" />
        <StatCard icon={Network} label="Net TX" value={stats ? bytesHuman(stats.net_tx) : '—'} color="orange" />
      </div>

      {/* CPU chart */}
      <div className="bg-navy-700 border border-navy-400 rounded-xl p-5">
        <h3 className="text-sky-400 font-semibold mb-4 flex items-center gap-2">
          <Cpu size={15} /> CPU Usage Over Time
        </h3>
        {history.length > 1 ? (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={history} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1a3a5c" />
              <XAxis dataKey="t" tick={false} axisLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: '#64748b', fontSize: 11 }} tickFormatter={v => `${v}%`} />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="cpu"
                stroke="#0ea5e9"
                strokeWidth={2}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
            Collecting data...
          </div>
        )}
      </div>
    </div>
  )
}
