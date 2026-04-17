import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Clock, Cpu, MemoryStick, HardDrive, Network, RefreshCw,
  Activity, Shield, ShieldOff, Settings, Users, Package,
  AlertTriangle, CheckCircle, Server, Zap, TrendingUp, UserX,
  PlusCircle,
} from 'lucide-react'
import api from '../api'

// ── helpers ───────────────────────────────────────────────────────────────────

function bytesHuman(b) {
  if (b == null) return '—'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = b, i = 0
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(1)} ${u[i]}`
}

// ── reusable components ───────────────────────────────────────────────────────

function StatCard({ icon: Icon, title, value, sub, progress, color = 'sky', linkTo, alert }) {
  const colorMap = {
    sky:    { text: 'text-sky-400',    bg: 'bg-sky-400/10',    bar: 'bg-sky-500' },
    purple: { text: 'text-purple-400', bg: 'bg-purple-400/10', bar: 'bg-purple-500' },
    green:  { text: 'text-green-400',  bg: 'bg-green-400/10',  bar: 'bg-green-500' },
    orange: { text: 'text-orange-400', bg: 'bg-orange-400/10', bar: 'bg-orange-500' },
    red:    { text: 'text-red-400',    bg: 'bg-red-400/10',    bar: 'bg-red-500' },
    yellow: { text: 'text-yellow-400', bg: 'bg-yellow-400/10', bar: 'bg-yellow-500' },
  }
  const c = colorMap[color] || colorMap.sky
  const barColor = progress > 85 ? 'bg-red-500' : progress > 65 ? 'bg-yellow-500' : c.bar

  const inner = (
    <div className={`bg-navy-700 border border-navy-400 rounded-xl p-5 h-full ${linkTo ? 'hover:border-sky-500/40 transition-colors cursor-pointer' : ''}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded-lg ${c.bg}`}>
            <Icon size={15} className={c.text} />
          </div>
          <span className="text-slate-400 text-xs font-medium">{title}</span>
        </div>
        {alert && <AlertTriangle size={13} className="text-red-400 animate-pulse" />}
      </div>
      <div className={`text-2xl font-bold ${c.text} mb-1`}>{value ?? '—'}</div>
      {sub && <div className="text-slate-500 text-xs">{sub}</div>}
      {progress !== undefined && (
        <div className="mt-3">
          <div className="bg-navy-900 rounded-full h-1.5 overflow-hidden">
            <div className={`${barColor} h-1.5 rounded-full transition-all`} style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  )

  return linkTo ? <Link to={linkTo}>{inner}</Link> : inner
}

function SectionHeader({ icon: Icon, title, linkTo, linkLabel }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-slate-300 font-semibold text-sm flex items-center gap-2">
        <Icon size={15} className="text-sky-400" />{title}
      </h3>
      {linkTo && (
        <Link to={linkTo} className="text-xs text-sky-400 hover:text-sky-300 transition-colors">{linkLabel} →</Link>
      )}
    </div>
  )
}

// ── main page ─────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [dash, setDash]       = useState(null)
  const [svc, setSvc]         = useState(null)
  const [sec, setSec]         = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')

  const fetchAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [dashRes, svcRes, secRes] = await Promise.allSettled([
        api.get('/dashboard'),
        api.get('/system/services'),
        api.get('/system/security'),
      ])
      if (dashRes.status === 'fulfilled') setDash(dashRes.value.data)
      else setError(dashRes.reason?.response?.data?.error || 'Failed to load dashboard')
      if (svcRes.status === 'fulfilled')  setSvc(svcRes.value.data)
      if (secRes.status === 'fulfilled')  setSec(secRes.value.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  if (loading) return <div className="text-sky-400 text-center py-20 flex items-center justify-center gap-2"><RefreshCw size={16} className="animate-spin" /> Loading dashboard…</div>
  if (error)   return <div className="text-red-400 text-center py-20">{error}</div>
  if (!dash)   return null

  const { uptime_str, cpu_percent, load_avg, mem, disk, net, processes } = dash

  const activeSvc   = svc?.services?.filter(s => s.active === 'active').length
  const failedSvc   = svc?.services?.filter(s => s.active === 'failed').length
  const totalSvc    = svc?.count

  const ufwOn       = sec?.ufw_enabled
  const failedLogin = sec?.failed_logins ?? null
  const secUpdates  = sec?.updates?.security ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-100">System Dashboard</h2>
        <button onClick={fetchAll} className="flex items-center gap-2 bg-navy-600 hover:bg-navy-500 border border-navy-400 text-slate-300 px-3 py-2 rounded-md text-sm transition-colors">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      {/* Alerts bar */}
      {(failedSvc > 0 || secUpdates > 0 || !ufwOn) && (
        <div className="flex flex-wrap gap-2">
          {failedSvc > 0 && (
            <Link to="/system/services" className="flex items-center gap-2 bg-red-900/30 border border-red-700/50 text-red-300 px-3 py-2 rounded-lg text-xs hover:bg-red-900/50 transition-colors">
              <AlertTriangle size={13} /> {failedSvc} failed service{failedSvc > 1 ? 's' : ''}
            </Link>
          )}
          {secUpdates > 0 && (
            <Link to="/system/security" className="flex items-center gap-2 bg-yellow-900/30 border border-yellow-700/50 text-yellow-300 px-3 py-2 rounded-lg text-xs hover:bg-yellow-900/50 transition-colors">
              <Package size={13} /> {secUpdates} security update{secUpdates > 1 ? 's' : ''} pending
            </Link>
          )}
          {!ufwOn && ufwOn !== null && (
            <Link to="/system/firewall" className="flex items-center gap-2 bg-orange-900/30 border border-orange-700/50 text-orange-300 px-3 py-2 rounded-lg text-xs hover:bg-orange-900/50 transition-colors">
              <ShieldOff size={13} /> Firewall is disabled
            </Link>
          )}
        </div>
      )}

      {/* Resource cards */}
      <div>
        <SectionHeader icon={Cpu} title="System Resources" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard icon={Clock}      title="Uptime"    value={uptime_str}         color="sky" />
          <StatCard icon={Cpu}        title="CPU"       value={`${cpu_percent}%`}
            sub={`Load: ${load_avg?.[0]} / ${load_avg?.[1]} / ${load_avg?.[2]}`}
            progress={cpu_percent} color="sky" />
          <StatCard icon={MemoryStick} title="Memory"   value={`${mem?.percent}%`}
            sub={`${mem?.used_gb} / ${mem?.total_gb} GB`}
            progress={mem?.percent} color="purple" />
          <StatCard icon={HardDrive}  title="Disk (/)"  value={`${disk?.percent}%`}
            sub={`${disk?.used_gb} / ${disk?.total_gb} GB`}
            progress={disk?.percent} color="orange" />
        </div>
      </div>

      {/* System status */}
      <div>
        <SectionHeader icon={Settings} title="System Status" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            icon={Settings} title="Active Services" color="green"
            value={activeSvc ?? '—'}
            sub={totalSvc ? `of ${totalSvc} total` : ''}
            alert={failedSvc > 0}
            linkTo="/system/services"
          />
          <StatCard
            icon={failedSvc > 0 ? AlertTriangle : CheckCircle}
            title="Failed Services" color={failedSvc > 0 ? 'red' : 'green'}
            value={failedSvc ?? 0}
            sub={failedSvc > 0 ? 'Needs attention' : 'All healthy'}
            linkTo="/system/services"
          />
          <StatCard
            icon={ufwOn ? Shield : ShieldOff}
            title="Firewall" color={ufwOn ? 'green' : 'red'}
            value={ufwOn ? 'Active' : ufwOn === null ? '—' : 'Inactive'}
            sub={ufwOn ? 'UFW enabled' : 'UFW disabled'}
            linkTo="/system/firewall"
          />
          <StatCard
            icon={UserX} title="Failed Logins" color={failedLogin > 100 ? 'red' : failedLogin > 20 ? 'yellow' : 'green'}
            value={failedLogin ?? '—'}
            sub="SSH attempts in auth.log"
            linkTo="/system/security"
          />
        </div>
      </div>

      {/* Network & security updates */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-navy-700 border border-navy-400 rounded-xl p-5">
          <SectionHeader icon={Network} title="Network I/O (cumulative)" />
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-navy-800 rounded-lg px-4 py-3">
              <div className="text-slate-400 text-xs mb-1">↓ Received</div>
              <div className="text-slate-100 font-semibold">{bytesHuman(net?.bytes_recv)}</div>
            </div>
            <div className="bg-navy-800 rounded-lg px-4 py-3">
              <div className="text-slate-400 text-xs mb-1">↑ Sent</div>
              <div className="text-slate-100 font-semibold">{bytesHuman(net?.bytes_sent)}</div>
            </div>
          </div>
        </div>

        <div className="bg-navy-700 border border-navy-400 rounded-xl p-5">
          <SectionHeader icon={Shield} title="Security Summary" linkTo="/system/security" linkLabel="View details" />
          <div className="space-y-2">
            {[
              { label: 'UFW Firewall',   ok: ufwOn,           sub: ufwOn ? 'Active' : 'Disabled' },
              { label: 'fail2ban',       ok: sec?.fail2ban,   sub: sec?.fail2ban ? 'Running' : 'Not running' },
              { label: 'Security updates', ok: secUpdates === 0, sub: secUpdates > 0 ? `${secUpdates} pending` : 'Up to date' },
              { label: 'Root SSH login', ok: sec?.ssh?.permit_root_login !== 'yes', sub: sec?.ssh?.permit_root_login === 'yes' ? 'Allowed ⚠' : 'Disabled' },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between py-1">
                <span className="text-slate-300 text-sm">{item.label}</span>
                <span className={`text-xs font-medium ${item.ok ? 'text-green-400' : item.ok === null || item.ok === undefined ? 'text-slate-500' : 'text-red-400'}`}>
                  {item.sub ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Top processes */}
      <div className="bg-navy-700 border border-navy-400 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-navy-500 flex items-center justify-between">
          <h3 className="text-slate-300 font-semibold text-sm flex items-center gap-2">
            <Activity size={15} className="text-sky-400" /> Top Processes
          </h3>
          <Link to="/system/processes" className="text-xs text-sky-400 hover:text-sky-300 transition-colors">
            View all →
          </Link>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-navy-800 text-slate-400 text-xs">
              <th className="px-4 py-2.5 text-left font-medium">PID</th>
              <th className="px-4 py-2.5 text-left font-medium">Name</th>
              <th className="px-4 py-2.5 text-left font-medium hidden md:table-cell">User</th>
              <th className="px-4 py-2.5 text-right font-medium">CPU %</th>
              <th className="px-4 py-2.5 text-right font-medium">MEM %</th>
            </tr>
          </thead>
          <tbody>
            {(processes || []).slice(0, 8).map((p, i) => (
              <tr key={`${p.pid}-${i}`} className="border-b border-navy-500 hover:bg-navy-600 transition-colors">
                <td className="px-4 py-2.5 text-slate-400 font-mono text-xs">{p.pid}</td>
                <td className="px-4 py-2.5 text-slate-200 text-xs">{p.name}</td>
                <td className="px-4 py-2.5 text-slate-400 text-xs hidden md:table-cell">{p.username}</td>
                <td className="px-4 py-2.5 text-right">
                  <span className={`font-medium text-xs font-mono ${(p.cpu_percent || 0) > 10 ? 'text-yellow-400' : 'text-slate-300'}`}>
                    {(p.cpu_percent || 0).toFixed(1)}%
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right text-slate-300 text-xs font-mono">
                  {(p.memory_percent || 0).toFixed(1)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Storage Pools (libvirt — renders only when /api/dashboard returns storage_pools) */}
      {dash.storage_pools && dash.storage_pools.length > 0 && (
        <div className="bg-navy-700 border border-navy-400 rounded-xl p-5">
          <h3 className="text-sky-400 font-semibold mb-4 flex items-center gap-2">
            <HardDrive size={16} /> Storage Pools
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-800 text-sky-400">
                  <th className="px-4 py-2.5 text-left rounded-l">Pool Name</th>
                  <th className="px-4 py-2.5 text-right">Capacity</th>
                  <th className="px-4 py-2.5 text-right">Used</th>
                  <th className="px-4 py-2.5 text-right rounded-r">Available</th>
                </tr>
              </thead>
              <tbody>
                {dash.storage_pools.map(pool => {
                  const pct = pool.capacity_gb > 0 ? Math.round((pool.allocation_gb / pool.capacity_gb) * 100) : 0
                  return (
                    <tr key={pool.name} className="border-b border-navy-500 hover:bg-navy-600 transition-colors">
                      <td className="px-4 py-3 text-slate-200 font-medium">{pool.name}</td>
                      <td className="px-4 py-3 text-right text-slate-300">{pool.capacity_gb} GB</td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-slate-300">{pool.allocation_gb} GB</span>
                        <span className="text-slate-500 ml-2">({pct}%)</span>
                      </td>
                      <td className="px-4 py-3 text-right text-green-400">{pool.available_gb} GB</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Quick links */}
      <div className="grid grid-cols-2 gap-4">
        <Link
          to="/vms"
          className="bg-navy-700 border border-navy-400 hover:border-sky-500 rounded-xl p-5 flex items-center gap-4 transition-all group"
        >
          <div className="w-10 h-10 bg-sky-500/20 rounded-lg flex items-center justify-center group-hover:bg-sky-500/30">
            <Server size={20} className="text-sky-400" />
          </div>
          <div>
            <div className="text-slate-200 font-semibold">View VMs</div>
            <div className="text-slate-400 text-sm">Manage all virtual machines</div>
          </div>
        </Link>
        <Link
          to="/vms/create"
          className="bg-navy-700 border border-navy-400 hover:border-sky-500 rounded-xl p-5 flex items-center gap-4 transition-all group"
        >
          <div className="w-10 h-10 bg-green-500/20 rounded-lg flex items-center justify-center group-hover:bg-green-500/30">
            <PlusCircle size={20} className="text-green-400" />
          </div>
          <div>
            <div className="text-slate-200 font-semibold">Create VM</div>
            <div className="text-slate-400 text-sm">Deploy a new virtual machine</div>
          </div>
        </Link>
      </div>
    </div>
  )
}
