import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PlusCircle, Cpu } from 'lucide-react'
import api from '../api'

export default function CreateVM() {
  const navigate = useNavigate()
  const RAM_OPTIONS = [2, 4, 8, 16, 32, 64, 128]

  const [form, setForm] = useState({
    name:     '',
    ram:      8192,
    cpu:      '2',
    host_cpu: true,
  })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post('/vms', {
        name:     form.name,
        ram:      form.ram,
        cpu:      parseInt(form.cpu),
        host_cpu: form.host_cpu,
        disks:    [],
        devices:  [],
      })
      navigate(`/vms/${res.data.uuid}`)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create VM')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full">
      <div className="bg-navy-700 border border-navy-400 rounded-xl p-8">
        <h2 className="text-sky-400 font-semibold text-lg mb-8 flex items-center gap-2">
          <PlusCircle size={18} /> New Virtual Machine
        </h2>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 text-sm rounded-md px-4 py-3 mb-6">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">

          {/* VM Name */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              VM Name <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="e.g. my-ubuntu-vm"
              className="w-full bg-navy-800 border border-navy-400 text-slate-200 focus:border-sky-500 focus:outline-none rounded-md px-3 py-2.5"
              required
            />
          </div>

          {/* RAM */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              RAM <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {RAM_OPTIONS.map(gb => (
                <button
                  key={gb}
                  type="button"
                  onClick={() => set('ram', gb * 1024)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    form.ram === gb * 1024
                      ? 'bg-sky-500 text-white'
                      : 'bg-navy-800 border border-navy-400 text-slate-300 hover:border-sky-500 hover:text-sky-400'
                  }`}
                >
                  {gb} GB
                </button>
              ))}
            </div>
          </div>

          {/* CPU */}
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1.5">
              vCPUs <span className="text-red-400">*</span>
            </label>
            <input
              type="number"
              value={form.cpu}
              onChange={e => set('cpu', e.target.value)}
              min="1"
              max="256"
              className="w-full bg-navy-800 border border-navy-400 text-slate-200 focus:border-sky-500 focus:outline-none rounded-md px-3 py-2.5"
              required
            />
          </div>

          {/* Host CPU passthrough */}
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="host_cpu"
              checked={form.host_cpu}
              onChange={e => set('host_cpu', e.target.checked)}
              className="w-4 h-4 rounded"
            />
            <label htmlFor="host_cpu" className="text-sm text-slate-300 cursor-pointer flex items-center gap-2">
              <Cpu size={14} className="text-sky-400" />
              Host CPU Passthrough
              <span className="text-slate-500 text-xs">(host-passthrough mode)</span>
            </label>
          </div>

          {/* Submit */}
          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold px-6 py-2.5 rounded-md transition-colors"
            >
              <PlusCircle size={16} />
              {loading ? 'Creating…' : 'Create VM'}
            </button>
            <button
              type="button"
              onClick={() => navigate('/vms')}
              className="bg-navy-500 hover:bg-navy-400 border border-navy-300 text-slate-300 px-6 py-2.5 rounded-md text-sm transition-colors"
            >
              Cancel
            </button>
          </div>

        </form>
      </div>
    </div>
  )
}
