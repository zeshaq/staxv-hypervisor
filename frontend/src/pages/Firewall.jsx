import { useState, useEffect, useCallback } from 'react'
import { Shield, ShieldOff, Plus, Trash2, RefreshCw, Loader2, Terminal, ToggleLeft, ToggleRight } from 'lucide-react'
import api from '../api'

function RuleBadge({ rule }) {
  const lower = rule.toLowerCase()
  const isAllow = lower.includes('allow')
  const isDeny  = lower.includes('deny') || lower.includes('reject')
  const isLimit = lower.includes('limit')
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
      isAllow ? 'bg-green-500/15 text-green-400'
    : isDeny  ? 'bg-red-500/15 text-red-400'
    : isLimit ? 'bg-yellow-500/15 text-yellow-400'
    :           'bg-slate-500/15 text-slate-400'
    }`}>
      {isAllow ? 'ALLOW' : isDeny ? 'DENY' : isLimit ? 'LIMIT' : 'RULE'}
    </span>
  )
}

function AddRuleForm({ onAdd, onCancel }) {
  const [form, setForm] = useState({ action: 'allow', direction: 'in', port: '', proto: '', comment: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError]   = useState('')
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await api.post('/system/ufw/rules', form)
      onAdd()
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to add rule')
    } finally {
      setSaving(false)
    }
  }

  const inputCls = 'bg-navy-700 border border-navy-500 text-slate-200 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500'

  return (
    <div className="bg-navy-800 border border-sky-500/30 rounded-xl p-5">
      <h3 className="text-slate-200 font-semibold text-sm mb-4 flex items-center gap-2">
        <Plus size={15} className="text-sky-400" /> Add UFW Rule
      </h3>

      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 text-xs rounded-md px-3 py-2 mb-4">{error}</div>
      )}

      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Action</label>
            <select value={form.action} onChange={e => set('action', e.target.value)} className={inputCls + ' w-full'}>
              <option value="allow">Allow</option>
              <option value="deny">Deny</option>
              <option value="limit">Limit (rate-limit)</option>
              <option value="reject">Reject</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Direction</label>
            <select value={form.direction} onChange={e => set('direction', e.target.value)} className={inputCls + ' w-full'}>
              <option value="in">In</option>
              <option value="out">Out</option>
              <option value="">Any</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Port / Range <span className="text-red-400">*</span></label>
            <input
              required
              value={form.port}
              onChange={e => set('port', e.target.value)}
              placeholder="22, 8080:8090"
              className={inputCls + ' w-full'}
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Protocol</label>
            <select value={form.proto} onChange={e => set('proto', e.target.value)} className={inputCls + ' w-full'}>
              <option value="">Any</option>
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Comment (optional)</label>
          <input
            value={form.comment}
            onChange={e => set('comment', e.target.value)}
            placeholder="e.g. SSH access"
            maxLength={64}
            className={inputCls + ' w-full'}
          />
        </div>

        <div className="flex gap-3">
          <button type="submit" disabled={saving}
            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-semibold px-4 py-2 rounded-md text-sm transition-colors">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add Rule
          </button>
          <button type="button" onClick={onCancel}
            className="bg-navy-700 hover:bg-navy-600 border border-navy-500 text-slate-300 px-4 py-2 rounded-md text-sm transition-colors">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}

export default function Firewall() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [toggling, setTog]    = useState(false)
  const [deleting, setDel]    = useState(null)
  const [showRaw, setShowRaw] = useState(false)
  const [toast, setToast]     = useState({ msg: '', ok: true })

  const notify = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast({ msg: '' }), 4000)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/system/ufw')
      setData(r.data)
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load UFW status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = async () => {
    setTog(true)
    try {
      await api.post('/system/ufw/toggle', { enable: !data.enabled })
      notify(`UFW ${data.enabled ? 'disabled' : 'enabled'}`)
      load()
    } catch (e) {
      notify(e.response?.data?.error || 'Toggle failed', false)
    } finally {
      setTog(false)
    }
  }

  const deleteRule = async (num) => {
    setDel(num)
    try {
      await api.delete('/system/ufw/rules', { data: { num } })
      notify(`Rule #${num} deleted`)
      load()
    } catch (e) {
      notify(e.response?.data?.error || 'Delete failed', false)
    } finally {
      setDel(null)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
      <Loader2 size={20} className="animate-spin" /> Loading firewall status…
    </div>
  )

  if (error) return (
    <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-xl px-5 py-4 text-sm">
      {error}
      <p className="text-xs mt-1 opacity-70">Ensure ufw is installed and the app user has sudo access.</p>
    </div>
  )

  return (
    <div className="space-y-5">
      {/* Status header */}
      <div className={`flex items-center justify-between bg-navy-800 border rounded-xl px-6 py-5 ${
        data.enabled ? 'border-green-500/30' : 'border-red-500/30'
      }`}>
        <div className="flex items-center gap-4">
          <div className={`p-3 rounded-xl ${data.enabled ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
            {data.enabled
              ? <Shield size={24} className="text-green-400" />
              : <ShieldOff size={24} className="text-red-400" />
            }
          </div>
          <div>
            <h2 className="text-slate-100 font-bold text-lg">
              UFW Firewall — {data.enabled ? 'Active' : 'Inactive'}
            </h2>
            <p className="text-slate-400 text-sm">
              {data.rules.length} rule{data.rules.length !== 1 ? 's' : ''} configured
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button onClick={() => setShowRaw(v => !v)}
            className="flex items-center gap-2 bg-navy-700 hover:bg-navy-600 border border-navy-500 text-slate-300 px-3 py-2 rounded-md text-sm transition-colors">
            <Terminal size={14} /> {showRaw ? 'Hide' : 'Raw'} Output
          </button>
          <button onClick={load}
            className="p-2 bg-navy-700 hover:bg-navy-600 border border-navy-500 rounded-md text-slate-300 transition-colors">
            <RefreshCw size={14} />
          </button>
          <button
            onClick={toggle}
            disabled={toggling}
            className={`flex items-center gap-2 font-semibold px-4 py-2 rounded-md text-sm transition-colors ${
              data.enabled
                ? 'bg-red-600/80 hover:bg-red-600 text-white'
                : 'bg-green-600/80 hover:bg-green-600 text-white'
            } disabled:opacity-50`}
          >
            {toggling
              ? <Loader2 size={14} className="animate-spin" />
              : data.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />
            }
            {data.enabled ? 'Disable' : 'Enable'}
          </button>
        </div>
      </div>

      {/* Raw output */}
      {showRaw && (
        <div className="bg-navy-900 border border-navy-600 rounded-xl p-4">
          <pre className="text-xs text-green-400 font-mono whitespace-pre-wrap">{data.raw}</pre>
        </div>
      )}

      {/* Add rule */}
      {showAdd
        ? <AddRuleForm onAdd={() => { setShowAdd(false); load(); notify('Rule added') }} onCancel={() => setShowAdd(false)} />
        : (
          <button onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 text-white font-semibold px-4 py-2.5 rounded-md text-sm transition-colors">
            <Plus size={15} /> Add Rule
          </button>
        )
      }

      {/* Rules table */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-navy-600 flex items-center gap-2">
          <Shield size={15} className="text-sky-400" />
          <span className="text-slate-200 text-sm font-semibold">Active Rules</span>
          <span className="text-xs bg-navy-600 text-slate-400 px-2 py-0.5 rounded-full ml-1">
            {data.rules.length}
          </span>
        </div>

        {data.rules.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-slate-500">
            <Shield size={32} className="mb-3 opacity-30" />
            <p className="text-sm">No rules configured.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-navy-700 bg-navy-700/40 text-slate-400 text-xs">
                <th className="text-left px-5 py-3 font-medium">#</th>
                <th className="text-left px-5 py-3 font-medium">Type</th>
                <th className="text-left px-5 py-3 font-medium">Rule</th>
                <th className="text-right px-5 py-3 font-medium">Remove</th>
              </tr>
            </thead>
            <tbody>
              {data.rules.map(r => (
                <tr key={r.num} className="border-b border-navy-700/50 hover:bg-navy-700/20 transition-colors">
                  <td className="px-5 py-3 text-slate-500 font-mono text-xs">{r.num}</td>
                  <td className="px-5 py-3"><RuleBadge rule={r.rule} /></td>
                  <td className="px-5 py-3 font-mono text-slate-200 text-xs">{r.rule}</td>
                  <td className="px-5 py-3 text-right">
                    <button
                      onClick={() => deleteRule(r.num)}
                      disabled={deleting === r.num}
                      className="p-1.5 rounded text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    >
                      {deleting === r.num ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-slate-600 text-xs">
        UFW operations require <code className="bg-navy-700 px-1 rounded">sudo -n</code> access.
        Add <code className="bg-navy-700 px-1 rounded">NOPASSWD: /usr/sbin/ufw</code> to sudoers if needed.
      </p>

      {toast.msg && (
        <div className={`fixed bottom-5 right-5 flex items-center gap-2 px-4 py-3 rounded-lg border text-sm z-50 shadow-xl ${
          toast.ok ? 'bg-green-900/90 border-green-700 text-green-200' : 'bg-red-900/90 border-red-700 text-red-200'
        }`}>
          {toast.msg}
          <button onClick={() => setToast({ msg: '' })} className="ml-2 opacity-70 hover:opacity-100">✕</button>
        </div>
      )}
    </div>
  )
}
