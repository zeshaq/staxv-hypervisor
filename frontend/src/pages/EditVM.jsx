import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Save, ArrowLeft } from 'lucide-react'
import api from '../api'

export default function EditVM() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState({ ram: '', cpu: '' })
  const [vmName, setVmName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.get(`/vms/${uuid}`)
      .then(r => {
        setVmName(r.data.name)
        setForm({ ram: r.data.memory_mb, cpu: r.data.vcpus })
      })
      .catch(e => setError(e.response?.data?.error || 'Failed to load VM'))
      .finally(() => setLoading(false))
  }, [uuid])

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const handleSubmit = async e => {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await api.put(`/vms/${uuid}`, {
        ram: parseInt(form.ram),
        cpu: parseInt(form.cpu),
      })
      navigate(`/vms/${uuid}`)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to update VM')
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="text-sky-400 text-center py-20">Loading...</div>

  return (
    <div className="max-w-xl">
      <div className="bg-navy-700 border border-navy-400 rounded-xl p-6">
        <div className="flex items-center gap-3 mb-6">
          <Link to={`/vms/${uuid}`} className="text-slate-400 hover:text-sky-400 transition-colors">
            <ArrowLeft size={18} />
          </Link>
          <h2 className="text-sky-400 font-semibold text-lg">Edit VM: {vmName}</h2>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-300 text-sm rounded-md px-4 py-3 mb-5">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">RAM (MB)</label>
              <input
                type="number"
                value={form.ram}
                onChange={e => set('ram', e.target.value)}
                min="256"
                step="256"
                className="w-full bg-navy-800 border border-navy-400 text-slate-200 focus:border-sky-500 focus:outline-none rounded-md px-3 py-2"
                required
              />
              {form.ram && (
                <p className="text-slate-500 text-xs mt-1">{Math.round(form.ram / 1024 * 10) / 10} GB</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-1.5">vCPUs</label>
              <input
                type="number"
                value={form.cpu}
                onChange={e => set('cpu', e.target.value)}
                min="1"
                max="128"
                className="w-full bg-navy-800 border border-navy-400 text-slate-200 focus:border-sky-500 focus:outline-none rounded-md px-3 py-2"
                required
              />
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-md transition-colors"
            >
              <Save size={16} />
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <Link
              to={`/vms/${uuid}`}
              className="bg-navy-500 hover:bg-navy-400 border border-navy-300 text-slate-300 px-5 py-2.5 rounded-md text-sm transition-colors inline-flex items-center"
            >
              Cancel
            </Link>
          </div>
        </form>
      </div>
    </div>
  )
}
