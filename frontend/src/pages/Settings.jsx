/**
 * Settings — system-wide credential & token store.
 *
 * FEATURE: system-settings
 *
 * Stores sensitive values server-side in secrets.json (0o600).
 * Installer forms (Assisted + Agent) auto-prefill from these defaults.
 */

import { useState, useEffect, useCallback } from 'react'
import {
  Settings as SettingsIcon,
  Save, Trash2, Eye, EyeOff, CheckCircle, XCircle,
  RefreshCw, AlertTriangle, Lock, Key, Globe, Server,
  ChevronDown, ChevronRight, Info, Copy, Check,
  Shield, Layers, Terminal,
} from 'lucide-react'
import api from '../api'

// ── field definitions ─────────────────────────────────────────────────────────

const FIELD_GROUPS = [
  {
    id:    'redhat',
    label: 'Red Hat Credentials',
    icon:  Shield,
    color: 'text-red-400 bg-red-500/10',
    desc:  'Used by the Assisted Installer and image pull operations.',
    fields: [
      {
        key:   'pull_secret',
        label: 'Pull Secret',
        desc:  'Red Hat container registry pull secret (JSON blob from console.redhat.com). Required by both Assisted and Agent installers.',
        type:  'textarea',
        rows:  5,
        placeholder: '{"auths":{"cloud.openshift.com":{"auth":"…"}}}',
        hint:  'Download from console.redhat.com → OpenShift → Downloads → Pull secret',
      },
      {
        key:   'rh_offline_token',
        label: 'Offline API Token',
        desc:  'Red Hat offline token for Assisted Installer authentication. Used to create/manage clusters via the RH API.',
        type:  'textarea',
        rows:  3,
        placeholder: 'eyJhbGciOiJSUzI1NiJ9…',
        hint:  'Get from console.redhat.com → Settings → Offline token',
      },
    ],
  },
  {
    id:    'ssh',
    label: 'SSH Access',
    icon:  Key,
    color: 'text-sky-400 bg-sky-500/10',
    desc:  'Public key injected into all deployed VMs and cluster nodes.',
    fields: [
      {
        key:   'ssh_public_key',
        label: 'SSH Public Key',
        desc:  'Public key injected into every VM and cluster node at deploy time, enabling password-less access.',
        type:  'textarea',
        rows:  3,
        placeholder: 'ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAAB… user@host',
        hint:  'Run: ssh-keygen -t rsa -b 4096  →  cat ~/.ssh/id_rsa.pub',
      },
    ],
  },
  {
    id:    'infra',
    label: 'Infrastructure & DNS',
    icon:  Globe,
    color: 'text-teal-400 bg-teal-500/10',
    desc:  'Tokens for DNS automation and infrastructure providers.',
    fields: [
      {
        key:   'cloudflare_token',
        label: 'Cloudflare API Token',
        desc:  "Cloudflare API token for automated DNS record management. Used for Let's Encrypt DNS-01 challenges and cluster ingress DNS.",
        type:  'password',
        placeholder: '••••••••••••••••••••••••••••••••••••••••',
        hint:  'Cloudflare dashboard → My Profile → API Tokens → Create Token (Zone:DNS edit)',
      },
    ],
  },
]

// ── helpers ───────────────────────────────────────────────────────────────────

function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
      className="text-slate-500 hover:text-sky-400 transition-colors"
      title="Copy"
    >
      {copied ? <Check size={13} className="text-green-400" /> : <Copy size={13} />}
    </button>
  )
}

function StatusBadge({ isSet }) {
  return isSet
    ? <span className="inline-flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/25 rounded-full px-2.5 py-0.5 font-medium"><CheckCircle size={10} /> Configured</span>
    : <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-navy-700 border border-navy-600 rounded-full px-2.5 py-0.5 font-medium"><XCircle size={10} /> Not set</span>
}

// ── FieldEditor component ─────────────────────────────────────────────────────

function FieldEditor({ fieldDef, isSet, masked, onSave, onClear, onReveal }) {
  const [editing,  setEditing]  = useState(false)
  const [value,    setValue]    = useState('')
  const [show,     setShow]     = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [clearing, setClearing] = useState(false)
  const [success,  setSuccess]  = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)

  const handleEdit = async () => {
    // Pre-load current value when entering edit mode
    if (!value && isSet) {
      const current = await onReveal(fieldDef.key)
      setValue(current || '')
    }
    setEditing(true)
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(fieldDef.key, value)
      setSuccess(true)
      setEditing(false)
      setTimeout(() => setSuccess(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const handleClear = async () => {
    if (!confirm(`Clear "${fieldDef.label}"? This removes the stored value permanently.`)) return
    setClearing(true)
    try {
      await onClear(fieldDef.key)
      setValue('')
      setEditing(false)
    } finally {
      setClearing(false)
    }
  }

  const handleCancel = () => {
    setEditing(false)
    setValue('')
  }

  const isMultiLine = fieldDef.type === 'textarea'

  return (
    <div className="py-5 border-b border-navy-700 last:border-0">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-slate-200 font-semibold text-sm">{fieldDef.label}</span>
            <StatusBadge isSet={isSet} />
            {success && (
              <span className="inline-flex items-center gap-1 text-xs text-green-400 animate-pulse">
                <CheckCircle size={10} /> Saved
              </span>
            )}
          </div>
          <p className="text-slate-500 text-xs mt-1 leading-relaxed">{fieldDef.desc}</p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {!editing && (
            <>
              {isSet && (
                <button
                  onClick={handleClear}
                  disabled={clearing}
                  className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-navy-700 rounded-md transition-colors disabled:opacity-40"
                  title="Clear value"
                >
                  <Trash2 size={13} />
                </button>
              )}
              <button
                onClick={handleEdit}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-sky-400 border border-sky-500/40 hover:bg-sky-500/10 rounded-md transition-colors"
              >
                {isSet ? 'Edit' : 'Set value'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Current masked value */}
      {!editing && isSet && masked && (
        <div className="flex items-center gap-2 mt-2 px-3 py-2 bg-navy-750 border border-navy-600 rounded-md">
          <Lock size={11} className="text-slate-600 flex-shrink-0" />
          <span className="font-mono text-xs text-slate-500 flex-1 truncate">{masked}</span>
        </div>
      )}

      {/* Edit form */}
      {editing && (
        <div className="mt-3 space-y-2">
          <div className="relative">
            {isMultiLine ? (
              <textarea
                value={value}
                onChange={e => setValue(e.target.value)}
                rows={fieldDef.rows || 3}
                placeholder={fieldDef.placeholder}
                className="w-full bg-navy-700 border border-navy-500 focus:border-sky-500 text-slate-200 text-xs font-mono rounded-md px-3 py-2.5 resize-y focus:outline-none focus:ring-1 focus:ring-sky-500/30 placeholder-slate-600"
                autoFocus
              />
            ) : (
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={value}
                  onChange={e => setValue(e.target.value)}
                  placeholder={fieldDef.placeholder}
                  className="w-full bg-navy-700 border border-navy-500 focus:border-sky-500 text-slate-200 text-sm font-mono rounded-md px-3 py-2.5 pr-10 focus:outline-none focus:ring-1 focus:ring-sky-500/30 placeholder-slate-600"
                  autoFocus
                />
                <button
                  onClick={() => setShow(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-sky-400 transition-colors"
                >
                  {show ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            )}
          </div>

          {/* Hint */}
          {fieldDef.hint && (
            <p className="text-xs text-slate-600 flex items-start gap-1.5">
              <Info size={11} className="mt-0.5 flex-shrink-0" />
              {fieldDef.hint}
            </p>
          )}

          {/* Save / Cancel */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={saving || !value.trim()}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-sm font-semibold rounded-md transition-colors"
            >
              {saving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
              Save
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-slate-400 hover:text-slate-200 text-sm rounded-md transition-colors"
            >
              Cancel
            </button>
            {value.trim() && <CopyBtn value={value.trim()} />}
          </div>
        </div>
      )}
    </div>
  )
}

// ── GroupCard ─────────────────────────────────────────────────────────────────

function GroupCard({ group, has, masked, onSave, onClear, onReveal }) {
  const [open, setOpen] = useState(true)
  const Icon  = group.icon
  const allSet = group.fields.every(f => has[f.key])
  const anySet = group.fields.some(f => has[f.key])

  return (
    <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
      {/* Group header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-navy-750 transition-colors text-left"
      >
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${group.color}`}>
            <Icon size={16} className="opacity-80" />
          </div>
          <div>
            <div className="text-slate-200 font-semibold text-sm">{group.label}</div>
            <div className="text-slate-500 text-xs mt-0.5">{group.desc}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {allSet
            ? <span className="text-xs text-green-400 flex items-center gap-1"><CheckCircle size={11} /> All set</span>
            : anySet
              ? <span className="text-xs text-yellow-400 flex items-center gap-1"><AlertTriangle size={11} /> Partial</span>
              : <span className="text-xs text-slate-600 flex items-center gap-1"><XCircle size={11} /> Not configured</span>
          }
          {open ? <ChevronDown size={14} className="text-slate-500" /> : <ChevronRight size={14} className="text-slate-500" />}
        </div>
      </button>

      {/* Fields */}
      {open && (
        <div className="px-5 border-t border-navy-700">
          {group.fields.map(field => (
            <FieldEditor
              key={field.key}
              fieldDef={field}
              isSet={!!has[field.key]}
              masked={masked[field.key] || ''}
              onSave={onSave}
              onClear={onClear}
              onReveal={onReveal}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Settings() {
  const [has,     setHas]     = useState({})
  const [masked,  setMasked]  = useState({})
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [toast,   setToast]   = useState(null)

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  // ── fetch current state ─────────────────────────────────────────────────────

  const fetchSettings = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/settings')
      setHas(r.data.has || {})
      setMasked(r.data.masked || {})
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchSettings() }, [fetchSettings])

  // ── handlers ────────────────────────────────────────────────────────────────

  const handleReveal = async (key) => {
    try {
      const r = await api.get('/settings/reveal')
      return r.data[key] || ''
    } catch {
      return ''
    }
  }

  const handleSave = async (key, value) => {
    await api.post('/settings', { [key]: value })
    await fetchSettings()
    showToast('Saved successfully')
  }

  const handleClear = async (key) => {
    await api.delete(`/settings/${key}`)
    await fetchSettings()
    showToast('Cleared', 'info')
  }

  // ── total configured count ──────────────────────────────────────────────────

  const allKeys    = FIELD_GROUPS.flatMap(g => g.fields).map(f => f.key)
  const setCount   = allKeys.filter(k => has[k]).length
  const totalCount = allKeys.length

  // ── render ──────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-3xl space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-slate-500/10 rounded-xl">
            <SettingsIcon size={20} className="text-slate-400" />
          </div>
          <div>
            <h1 className="text-slate-100 font-bold text-lg">System Settings</h1>
            <p className="text-slate-500 text-xs mt-0.5">
              Global credentials &amp; tokens — shared across all installer workflows
            </p>
          </div>
        </div>
        <button
          onClick={fetchSettings}
          className="p-2 text-slate-500 hover:text-sky-400 hover:bg-navy-700 rounded-md transition-colors"
          title="Refresh"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Summary strip */}
      <div className="flex items-center gap-4 px-4 py-3 bg-navy-800 border border-navy-600 rounded-xl">
        <div className="flex-1 flex items-center gap-3">
          <div className="flex gap-1.5">
            {allKeys.map(k => (
              <div
                key={k}
                className={`w-2.5 h-2.5 rounded-full ${has[k] ? 'bg-green-400' : 'bg-navy-600 border border-navy-500'}`}
                title={k}
              />
            ))}
          </div>
          <span className="text-sm text-slate-400">
            <span className="text-slate-200 font-semibold">{setCount}</span>
            <span className="text-slate-600"> / {totalCount} credentials configured</span>
          </span>
        </div>
        {setCount < totalCount && (
          <span className="text-xs text-yellow-500 flex items-center gap-1.5">
            <AlertTriangle size={11} />
            Installer forms will prompt for missing values
          </span>
        )}
        {setCount === totalCount && (
          <span className="text-xs text-green-400 flex items-center gap-1.5">
            <CheckCircle size={11} />
            All credentials configured
          </span>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 rounded-lg px-4 py-3 text-sm">
          <AlertTriangle size={15} />
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[1,2,3].map(i => (
            <div key={i} className="h-24 bg-navy-800 border border-navy-600 rounded-xl animate-pulse" />
          ))}
        </div>
      )}

      {/* Groups */}
      {!loading && FIELD_GROUPS.map(group => (
        <GroupCard
          key={group.id}
          group={group}
          has={has}
          masked={masked}
          onSave={handleSave}
          onClear={handleClear}
          onReveal={handleReveal}
        />
      ))}

      {/* How it works */}
      {!loading && (
        <div className="bg-navy-800 border border-navy-600 rounded-xl overflow-hidden">
          <button
            onClick={() => {}}
            className="w-full flex items-center gap-3 px-5 py-4 text-left"
          >
            <Info size={15} className="text-slate-500 flex-shrink-0" />
            <span className="text-slate-400 text-sm font-medium">How system settings work</span>
          </button>
          <div className="px-5 pb-5 space-y-3 text-sm text-slate-500 border-t border-navy-700">
            <div className="flex items-start gap-3 pt-3">
              <Lock size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-slate-300 font-medium mb-0.5">Stored securely on server</div>
                Values are saved to <code className="text-slate-400 bg-navy-700 px-1.5 py-0.5 rounded text-xs">secrets.json</code> with <code className="text-slate-400 bg-navy-700 px-1.5 py-0.5 rounded text-xs">0o600</code> file permissions. The file is excluded from version control.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Layers size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-slate-300 font-medium mb-0.5">Auto-filled in installer forms</div>
                Both the Assisted Installer and Agent Installer forms will pre-populate <em>Pull Secret</em>, <em>SSH Public Key</em>, and <em>Offline Token</em> from these defaults. You can still override them per-deployment.
              </div>
            </div>
            <div className="flex items-start gap-3">
              <Terminal size={14} className="text-sky-400 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-slate-300 font-medium mb-0.5">Available to all modules</div>
                Other modules (network automation, DNS management, etc.) can access these credentials via the <code className="text-slate-400 bg-navy-700 px-1.5 py-0.5 rounded text-xs">get_secret(key)</code> Python helper.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium border transition-all ${
          toast.type === 'success'
            ? 'bg-green-500/15 border-green-500/30 text-green-300'
            : 'bg-sky-500/15 border-sky-500/30 text-sky-300'
        }`}>
          <CheckCircle size={15} />
          {toast.msg}
        </div>
      )}
    </div>
  )
}
