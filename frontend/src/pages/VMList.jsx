import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Play, Square, Trash2, Eye, PlusCircle, RefreshCw, Monitor, Lock, Unlock } from 'lucide-react'
import api from '../api'

function StateBadge({ state }) {
  const variants = {
    Running: 'bg-green-900 text-green-300',
    Shutoff: 'bg-navy-500 text-slate-400',
    Paused: 'bg-yellow-900 text-yellow-300',
    'Shutting Down': 'bg-yellow-900 text-yellow-300',
    Crashed: 'bg-red-900 text-red-300',
  }
  const cls = variants[state] || 'bg-yellow-900 text-yellow-300'
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {state}
    </span>
  )
}

export default function VMList() {
  const [vms, setVms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState([])
  const [actionLoading, setActionLoading] = useState({})
  const navigate = useNavigate()

  const fetchVMs = () => {
    setLoading(true)
    api.get('/vms')
      .then(r => setVms(r.data))
      .catch(e => setError(e.response?.data?.error || 'Failed to load VMs'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchVMs() }, [])

  const filtered = vms

  const setLoading_ = (uuid, val) => setActionLoading(prev => ({ ...prev, [uuid]: val }))

  const handleStart = async uuid => {
    setLoading_(uuid, true)
    try { await api.post(`/vms/${uuid}/start`); fetchVMs() } catch(e) { alert(e.response?.data?.error || 'Error') }
    setLoading_(uuid, false)
  }

  const handleStop = async uuid => {
    if (!confirm('Force stop this VM?')) return
    setLoading_(uuid, true)
    try { await api.post(`/vms/${uuid}/stop`); fetchVMs() } catch(e) { alert(e.response?.data?.error || 'Error') }
    setLoading_(uuid, false)
  }

  const handleDelete = async uuid => {
    if (!confirm('Delete this VM? This cannot be undone.')) return
    setLoading_(uuid, true)
    try { await api.delete(`/vms/${uuid}`); fetchVMs() }
    catch(e) { alert(e.response?.data?.error || 'Error') }
    setLoading_(uuid, false)
  }

  const handleLock = async uuid => {
    setLoading_(uuid, true)
    try { await api.post(`/vms/${uuid}/lock`); fetchVMs() }
    catch(e) { alert(e.response?.data?.error || 'Error') }
    setLoading_(uuid, false)
  }

  const handleUnlock = async uuid => {
    setLoading_(uuid, true)
    try { await api.post(`/vms/${uuid}/unlock`); fetchVMs() }
    catch(e) { alert(e.response?.data?.error || 'Error') }
    setLoading_(uuid, false)
  }

  const handleBulkAction = async action => {
    if (selected.length === 0) return
    if (action === 'delete') {
      const locked = vms.filter(v => selected.includes(v.uuid) && v.locked)
      if (locked.length > 0) {
        alert(`Cannot delete: ${locked.map(v => v.name).join(', ')} ${locked.length === 1 ? 'is' : 'are'} locked.`)
        return
      }
    }
    if (!confirm(`${action} ${selected.length} VM(s)?`)) return
    await Promise.all(selected.map(uuid => {
      if (action === 'start') return api.post(`/vms/${uuid}/start`).catch(() => {})
      if (action === 'stop') return api.post(`/vms/${uuid}/stop`).catch(() => {})
      if (action === 'delete') return api.delete(`/vms/${uuid}`).catch(() => {})
    }))
    setSelected([])
    fetchVMs()
  }

  const toggleSelect = uuid => setSelected(prev =>
    prev.includes(uuid) ? prev.filter(u => u !== uuid) : [...prev, uuid]
  )

  const toggleAll = () => setSelected(selected.length === filtered.length ? [] : filtered.map(v => v.uuid))

  if (loading) return <div className="text-sky-400 text-center py-20">Loading virtual machines...</div>
  if (error) return <div className="text-red-400 text-center py-20">{error}</div>

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/vms/create"
            className="flex items-center gap-2 bg-sky-500 hover:bg-sky-400 text-white px-4 py-2 rounded-md text-sm font-medium transition-colors"
          >
            <PlusCircle size={16} /> Create VM
          </Link>
          <button
            onClick={fetchVMs}
            className="flex items-center gap-2 bg-navy-500 hover:bg-navy-400 border border-navy-300 text-slate-300 px-3 py-2 rounded-md text-sm transition-colors"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      </div>

      {/* Bulk actions */}
      {selected.length > 0 && (
        <div className="flex items-center gap-3 bg-navy-700 border border-sky-500 rounded-lg px-4 py-3">
          <span className="text-sky-400 text-sm font-medium">{selected.length} selected</span>
          <button onClick={() => handleBulkAction('start')} className="flex items-center gap-1.5 bg-green-800 hover:bg-green-700 text-green-300 px-3 py-1.5 rounded text-sm">
            <Play size={12} /> Start
          </button>
          <button onClick={() => handleBulkAction('stop')} className="flex items-center gap-1.5 bg-yellow-800 hover:bg-yellow-700 text-yellow-300 px-3 py-1.5 rounded text-sm">
            <Square size={12} /> Stop
          </button>
          <button onClick={() => handleBulkAction('delete')} className="flex items-center gap-1.5 bg-red-800 hover:bg-red-700 text-red-300 px-3 py-1.5 rounded text-sm">
            <Trash2 size={12} /> Delete
          </button>
          <button onClick={() => setSelected([])} className="text-slate-400 hover:text-slate-200 text-sm ml-auto">
            Clear
          </button>
        </div>
      )}

      {/* Table */}
      <div className="bg-navy-700 border border-navy-400 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            No virtual machines found.{' '}
            <Link to="/vms/create" className="text-sky-400 hover:underline">Create one</Link>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-navy-800 text-sky-400">
                <th className="px-4 py-3 text-left w-10">
                  <input
                    type="checkbox"
                    checked={selected.length === filtered.length && filtered.length > 0}
                    onChange={toggleAll}
                    className="rounded"
                  />
                </th>
                <th className="px-4 py-3 text-left">Name</th>
                <th className="px-4 py-3 text-left">State</th>
                <th className="px-4 py-3 text-right">Memory</th>
                <th className="px-4 py-3 text-right">vCPUs</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(vm => (
                <tr key={vm.uuid} className="border-b border-navy-500 hover:bg-navy-600 transition-colors">
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.includes(vm.uuid)}
                      onChange={() => toggleSelect(vm.uuid)}
                      className="rounded"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link to={`/vms/${vm.uuid}`} className="text-slate-200 hover:text-sky-400 font-medium transition-colors">
                        {vm.name}
                      </Link>
                      {vm.locked && (
                        <span title="Locked — delete prevented" className="text-amber-400">
                          <Lock size={12} />
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3"><StateBadge state={vm.state} /></td>
                  <td className="px-4 py-3 text-right text-slate-300">{vm.memory_mb} MB</td>
                  <td className="px-4 py-3 text-right text-slate-300">{vm.vcpus}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1.5">
                      {vm.state_code !== 1 ? (
                        <button
                          onClick={() => handleStart(vm.uuid)}
                          disabled={actionLoading[vm.uuid]}
                          title="Start"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-green-900/60 hover:bg-green-800 text-green-400 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          <Play size={13} /> Start
                        </button>
                      ) : (
                        <button
                          onClick={() => handleStop(vm.uuid)}
                          disabled={actionLoading[vm.uuid]}
                          title="Stop"
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-yellow-900/60 hover:bg-yellow-800 text-yellow-400 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          <Square size={13} /> Stop
                        </button>
                      )}
                      <Link to={`/vms/${vm.uuid}`} title="View" className="p-1.5 rounded bg-navy-500 hover:bg-navy-400 text-sky-400 transition-colors">
                        <Eye size={13} />
                      </Link>
                      {vm.state_code === 1 && (
                        <a href={`/vnc-view/${vm.uuid}`} target="_blank" rel="noopener noreferrer"
                          title="VNC Console"
                          className="p-1.5 rounded bg-sky-900/60 hover:bg-sky-800 text-sky-400 transition-colors">
                          <Monitor size={13} />
                        </a>
                      )}
                      {vm.locked ? (
                        <button
                          onClick={() => handleUnlock(vm.uuid)}
                          disabled={actionLoading[vm.uuid]}
                          title="Unlock VM"
                          className="p-1.5 rounded bg-amber-900/60 hover:bg-amber-800 text-amber-400 transition-colors disabled:opacity-50"
                        >
                          <Unlock size={13} />
                        </button>
                      ) : (
                        <button
                          onClick={() => handleLock(vm.uuid)}
                          disabled={actionLoading[vm.uuid]}
                          title="Lock VM (prevent deletion)"
                          className="p-1.5 rounded bg-navy-500 hover:bg-navy-400 text-slate-400 hover:text-amber-400 transition-colors disabled:opacity-50"
                        >
                          <Lock size={13} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-slate-400 text-sm">{filtered.length} VM{filtered.length !== 1 ? 's' : ''}</div>
    </div>
  )
}
