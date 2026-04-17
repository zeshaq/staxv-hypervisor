import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Cpu, MemoryStick, Activity, HardDrive, Server, PlusCircle, RefreshCw } from 'lucide-react'
import api from '../api'

function StatCard({ icon: Icon, label, value, sub, color = 'sky' }) {
  return (
    <div className="bg-navy-700 border border-navy-400 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <span className="text-slate-400 text-sm font-medium">{label}</span>
        <Icon size={18} className={`text-${color}-400`} />
      </div>
      <div className="text-2xl font-bold text-slate-100">{value}</div>
      {sub && <div className="text-slate-400 text-xs mt-1">{sub}</div>}
    </div>
  )
}

export default function Home() {
  const [host, setHost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const fetchHost = () => {
    setLoading(true)
    api.get('/host')
      .then(r => setHost(r.data))
      .catch(e => setError(e.response?.data?.error || 'Failed to load host info'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchHost() }, [])

  if (loading) return <div className="text-sky-400 text-center py-20">Loading host info...</div>
  if (error) return <div className="text-red-400 text-center py-20">{error}</div>

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-slate-100">Host Overview</h2>
          <p className="text-slate-400 text-sm mt-0.5">Hardware and resource summary</p>
        </div>
        <button
          onClick={fetchHost}
          className="flex items-center gap-2 bg-navy-500 hover:bg-navy-400 border border-navy-300 text-slate-300 px-3 py-2 rounded-md text-sm transition-colors"
        >
          <RefreshCw size={14} /> Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <StatCard
          icon={Cpu}
          label="CPU Usage"
          value={`${host.cpu_percent}%`}
          sub={`${host.cpu_cores} cores`}
        />
        <StatCard
          icon={MemoryStick}
          label="Memory Used"
          value={`${host.mem_used_gb} GB`}
          sub={`of ${host.mem_total_gb} GB (${host.mem_percent_used}%)`}
          color="purple"
        />
        <StatCard
          icon={Activity}
          label="Load 1m"
          value={host.load_1}
          sub="1-minute average"
          color="green"
        />
        <StatCard
          icon={Activity}
          label="Load 5m"
          value={host.load_5}
          sub="5-minute average"
          color="yellow"
        />
        <StatCard
          icon={Activity}
          label="Load 15m"
          value={host.load_15}
          sub="15-minute average"
          color="orange"
        />
      </div>

      {/* Memory bar */}
      <div className="bg-navy-700 border border-navy-400 rounded-xl p-5">
        <h3 className="text-sky-400 font-semibold mb-3">Memory Usage</h3>
        <div className="flex items-center gap-4">
          <div className="flex-1 bg-navy-900 rounded-full h-3 overflow-hidden">
            <div
              className="bg-sky-500 h-3 rounded-full transition-all"
              style={{ width: `${host.mem_percent_used}%` }}
            />
          </div>
          <span className="text-slate-300 text-sm w-16 text-right">{host.mem_percent_used}%</span>
        </div>
        <div className="flex justify-between text-xs text-slate-400 mt-1.5">
          <span>Used: {host.mem_used_gb} GB</span>
          <span>Free: {host.mem_free_gb} GB</span>
          <span>Total: {host.mem_total_gb} GB</span>
        </div>
      </div>

      {/* Storage Pools */}
      {host.storage_pools && host.storage_pools.length > 0 && (
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
                {host.storage_pools.map(pool => {
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
