import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Server, ArrowLeft, CheckCircle, XCircle, Loader2,
  AlertTriangle, Save, Trash2, ExternalLink,
} from 'lucide-react'
import api from '../api'

// ── credential persistence ────────────────────────────────────────────────────
const CRED_KEY = 'ocp_agent_saved_credentials'

function loadSavedCreds() {
  try { return JSON.parse(localStorage.getItem(CRED_KEY)) || {} }
  catch { return {} }
}
function saveCreds(obj) {
  const existing = loadSavedCreds()
  localStorage.setItem(CRED_KEY, JSON.stringify({ ...existing, ...obj }))
}
function clearCreds() {
  localStorage.removeItem(CRED_KEY)
}

// ── shared field/input helpers ────────────────────────────────────────────────
const inputCls = 'w-full bg-navy-700 border border-navy-500 text-slate-100 rounded-md px-3 py-2 text-sm focus:outline-none focus:border-sky-500 placeholder-slate-600'
const labelCls = 'block text-xs font-medium text-slate-400 mb-1'

function Field({ label, hint, required, children }) {
  return (
    <div>
      <label className={labelCls}>
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-slate-600 text-xs mt-1">{hint}</p>}
    </div>
  )
}

// ── defaults ──────────────────────────────────────────────────────────────────
const DEFAULTS = {
  cluster_name:     '',
  base_domain:      '',
  ocp_version:      '',
  deployment_type:  'sno',
  n_workers:        2,
  network:          '',
  ssh_public_key:   '',
  pull_secret:      '',
  // Control plane resources
  cp_vcpus:         8,
  cp_ram_gb:        32,
  cp_disk_gb:       120,
  // Worker resources
  w_vcpus:          4,
  w_ram_gb:         16,
  w_disk_gb:        100,
}

// ── Deployment type cards ─────────────────────────────────────────────────────
const DEPLOY_TYPES = [
  {
    id:    'sno',
    title: 'Single Node (SNO)',
    sub:   '1 node — all roles. Min 8 vCPU / 32 GB RAM.',
    color: 'text-purple-300',
  },
  {
    id:    'compact',
    title: 'Compact (3-node)',
    sub:   '3 masters with worker capability. No separate workers.',
    color: 'text-blue-300',
  },
  {
    id:    'full',
    title: 'Full Cluster',
    sub:   '3 masters + N dedicated worker nodes.',
    color: 'text-teal-300',
  },
]

// ── main page ─────────────────────────────────────────────────────────────────
export default function OcpAgentDeploy() {
  const navigate          = useNavigate()
  const [form, setForm]   = useState(() => {
    const saved = loadSavedCreds()
    return {
      ...DEFAULTS,
      pull_secret:   saved.pull_secret   || '',
      ssh_public_key: saved.ssh_public_key || '',
    }
  })
  const [versions, setVersions]     = useState([])
  const [networks, setNetworks]     = useState([])
  const [loadingV, setLoadingV]     = useState(true)
  const [loadingN, setLoadingN]     = useState(true)
  const [savedCreds, setSavedCreds] = useState(() => {
    const c = loadSavedCreds()
    return !!(c.pull_secret || c.ssh_public_key)
  })
  const [deploying, setDeploying]   = useState(false)
  const [error, setError]           = useState('')

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }))

  useEffect(() => {
    api.get('/ocp-agent/versions')
      .then(r => {
        const v = r.data.versions || []
        setVersions(v)
        if (v.length > 0 && !form.ocp_version) set('ocp_version', v[0])
      })
      .catch(() => {})
      .finally(() => setLoadingV(false))
  }, []) // eslint-disable-line

  useEffect(() => {
    api.get('/ocp-agent/networks')
      .then(r => {
        const nets = r.data.networks || []
        setNetworks(nets)
        if (!form.network && nets.length > 0) {
          set('network', nets[0].name)
        }
      })
      .catch(() => {})
      .finally(() => setLoadingN(false))
  }, []) // eslint-disable-line

  // Pre-fill from system settings (pull_secret, ssh_public_key)
  useEffect(() => {
    api.get('/settings/reveal')
      .then(r => {
        if (r.data.pull_secret    && !form.pull_secret)    set('pull_secret',    r.data.pull_secret)
        if (r.data.ssh_public_key && !form.ssh_public_key) set('ssh_public_key', r.data.ssh_public_key)
      })
      .catch(() => {})
  }, []) // eslint-disable-line

  const handleSaveCreds = () => {
    saveCreds({ pull_secret: form.pull_secret, ssh_public_key: form.ssh_public_key })
    setSavedCreds(true)
  }

  const handleClearCreds = () => {
    clearCreds()
    setSavedCreds(false)
    set('pull_secret', '')
    set('ssh_public_key', '')
  }

  const handleDeploy = async () => {
    setDeploying(true)
    setError('')
    try {
      const payload = {
        cluster_name:    form.cluster_name,
        base_domain:     form.base_domain,
        pull_secret:     form.pull_secret,
        ocp_version:     form.ocp_version,
        ssh_public_key:  form.ssh_public_key,
        deployment_type: form.deployment_type,
        n_workers:       form.deployment_type === 'full' ? parseInt(form.n_workers) : 0,
        network:         form.network,
        cp_vcpus:        parseInt(form.cp_vcpus),
        cp_ram_gb:       parseInt(form.cp_ram_gb),
        cp_disk_gb:      parseInt(form.cp_disk_gb),
        w_vcpus:         parseInt(form.w_vcpus),
        w_ram_gb:        parseInt(form.w_ram_gb),
        w_disk_gb:       parseInt(form.w_disk_gb),
      }
      const r = await api.post('/ocp-agent/deploy', payload)
      navigate(`/ocp-agent/jobs/${r.data.job_id}`)
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to start deployment')
    } finally {
      setDeploying(false)
    }
  }

  const canDeploy =
    form.cluster_name.trim() &&
    form.base_domain.trim() &&
    form.ocp_version &&
    form.pull_secret.trim() &&
    form.network

  const isFull = form.deployment_type === 'full'
  const isSNO  = form.deployment_type === 'sno'

  return (
    <div className="max-w-3xl space-y-6">

      {/* Page header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/ocp-agent')}
          className="p-2 rounded-md text-slate-400 hover:text-sky-400 hover:bg-navy-700 transition-colors">
          <ArrowLeft size={16} />
        </button>
        <div className="p-3 bg-sky-500/10 rounded-xl">
          <Server size={22} className="text-sky-400" />
        </div>
        <div>
          <h1 className="text-slate-100 font-bold text-xl">New Agent-Based Deployment</h1>
          <p className="text-slate-400 text-sm">Deploy OpenShift using the Agent-Based Installer on KVM</p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 text-red-300 text-sm rounded-xl px-4 py-3 flex gap-2">
          <XCircle size={15} className="flex-shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* ── Section: Cluster Identity ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-5 space-y-5">
        <h2 className="text-slate-200 font-semibold text-sm">Cluster Identity</h2>

        {/* Deployment type */}
        <Field label="Deployment Type" required>
          <div className="grid grid-cols-3 gap-3 mt-1">
            {DEPLOY_TYPES.map(opt => (
              <button
                key={opt.id}
                type="button"
                onClick={() => set('deployment_type', opt.id)}
                className={`text-left p-4 rounded-xl border transition-all ${
                  form.deployment_type === opt.id
                    ? 'border-sky-500 bg-sky-500/10'
                    : 'border-navy-500 bg-navy-700 hover:border-navy-400'
                }`}>
                <div className={`font-semibold text-sm mb-1 ${
                  form.deployment_type === opt.id ? opt.color : 'text-slate-100'
                }`}>{opt.title}</div>
                <div className="text-slate-500 text-xs">{opt.sub}</div>
              </button>
            ))}
          </div>
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Cluster Name" required hint="Lowercase letters, numbers, hyphens only">
            <input
              value={form.cluster_name}
              onChange={e => set('cluster_name', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
              placeholder="ocp-lab"
              className={inputCls}
            />
          </Field>
          <Field label="Base Domain" required hint="e.g. example.com">
            <input
              value={form.base_domain}
              onChange={e => set('base_domain', e.target.value)}
              placeholder="example.com"
              className={inputCls}
            />
          </Field>
        </div>

        <Field label="OpenShift Version" required>
          {loadingV ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm h-10">
              <Loader2 size={14} className="animate-spin" /> Loading versions…
            </div>
          ) : (
            <select
              value={form.ocp_version}
              onChange={e => set('ocp_version', e.target.value)}
              className={inputCls}>
              {versions.length === 0 && <option value="">No versions available</option>}
              {versions.map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
        </Field>
      </div>

      {/* ── Section: Credentials ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-5 space-y-5">
        <div className="flex items-start justify-between">
          <h2 className="text-slate-200 font-semibold text-sm">Credentials</h2>
          <div className="flex items-center gap-2">
            {savedCreds && (
              <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-1 rounded-md">
                <CheckCircle size={11} /> Saved
              </span>
            )}
            <button
              onClick={handleSaveCreds}
              disabled={!form.pull_secret}
              title="Save to browser storage"
              className="flex items-center gap-1.5 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white px-3 py-1.5 rounded-md transition-colors">
              <Save size={12} /> Save
            </button>
            {savedCreds && (
              <button
                onClick={handleClearCreds}
                title="Clear saved credentials"
                className="flex items-center gap-1.5 text-xs bg-navy-600 hover:bg-red-900/50 border border-navy-500 hover:border-red-700 text-slate-400 hover:text-red-400 px-2 py-1.5 rounded-md transition-colors">
                <Trash2 size={12} />
              </button>
            )}
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <label className={labelCls + ' mb-0'}>
              Pull Secret <span className="text-red-400">*</span>
            </label>
            <a
              href="https://console.redhat.com/openshift/install/pull-secret"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-sky-400 hover:underline inline-flex items-center gap-1">
              Get pull secret <ExternalLink size={11} />
            </a>
          </div>
          <textarea
            value={form.pull_secret}
            onChange={e => set('pull_secret', e.target.value)}
            rows={4}
            placeholder='{"auths":{"cloud.openshift.com":{"auth":"..."},...}}'
            className={inputCls + ' font-mono text-xs resize-none'}
          />
        </div>

        <Field label="SSH Public Key" hint="Paste your ~/.ssh/id_rsa.pub — allows SSH access to nodes post-install">
          <textarea
            value={form.ssh_public_key}
            onChange={e => set('ssh_public_key', e.target.value)}
            rows={3}
            placeholder="ssh-rsa AAAA…"
            className={inputCls + ' font-mono text-xs resize-none'}
          />
        </Field>
      </div>

      {/* ── Section: Network ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-5 space-y-5">
        <h2 className="text-slate-200 font-semibold text-sm">Network</h2>

        <Field label="Network" required hint="libvirt network or host bridge for VM connectivity">
          {loadingN ? (
            <div className="flex items-center gap-2 text-slate-500 text-sm h-10">
              <Loader2 size={14} className="animate-spin" /> Loading networks…
            </div>
          ) : networks.length > 0 ? (
            <div className="space-y-2">
              {networks.map(net => (
                <button
                  key={net.name}
                  type="button"
                  onClick={() => set('network', net.name)}
                  className={`w-full flex items-center gap-4 px-4 py-3 rounded-lg border text-left transition-all ${
                    form.network === net.name
                      ? 'border-sky-500 bg-sky-500/10'
                      : 'border-navy-500 bg-navy-700 hover:border-navy-400'
                  }`}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className="text-slate-100 font-semibold text-sm">{net.name}</span>
                      {net.bridge && net.bridge !== net.name && (
                        <span className="text-slate-500 text-xs font-mono">({net.bridge})</span>
                      )}
                      {net.type && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-sky-500/15 text-sky-400">
                          {net.type}
                        </span>
                      )}
                    </div>
                  </div>
                  {form.network === net.name && (
                    <CheckCircle size={16} className="text-sky-400 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          ) : (
            <input
              value={form.network}
              onChange={e => set('network', e.target.value)}
              placeholder="default"
              className={inputCls}
            />
          )}
        </Field>
      </div>

      {/* ── Section: Node Resources ── */}
      <div className="bg-navy-800 border border-navy-600 rounded-xl p-5 space-y-5">
        <h2 className="text-slate-200 font-semibold text-sm">Node Resources</h2>

        {/* Control plane */}
        <div className="space-y-3">
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wide">
            {isSNO ? 'Single Node' : 'Control Plane Nodes'}
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <Field label="vCPUs" required hint={isSNO ? 'Min 8' : 'Min 4'}>
              <input
                type="number"
                value={form.cp_vcpus}
                onChange={e => set('cp_vcpus', e.target.value)}
                min={isSNO ? 8 : 4}
                className={inputCls}
              />
            </Field>
            <Field label="RAM (GB)" required hint={isSNO ? 'Min 32' : 'Min 16'}>
              <input
                type="number"
                value={form.cp_ram_gb}
                onChange={e => set('cp_ram_gb', e.target.value)}
                min={isSNO ? 32 : 16}
                className={inputCls}
              />
            </Field>
            <Field label="Disk (GB)" required hint={isSNO ? 'Min 120' : 'Min 100'}>
              <input
                type="number"
                value={form.cp_disk_gb}
                onChange={e => set('cp_disk_gb', e.target.value)}
                min={isSNO ? 120 : 100}
                step={10}
                className={inputCls}
              />
            </Field>
          </div>
          {isSNO && (
            <p className="text-slate-600 text-xs">
              Recommended: 8 vCPU / 32 GB RAM / 120 GB disk
            </p>
          )}
          {!isSNO && (
            <p className="text-slate-600 text-xs">
              Recommended: 8 vCPU / 32 GB RAM / 120 GB disk · 3 nodes for HA
            </p>
          )}
        </div>

        {/* Workers (full only) */}
        {isFull && (
          <div className="space-y-3 pt-4 border-t border-navy-700">
            <div className="flex items-center justify-between">
              <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wide">Worker Nodes</h3>
              <Field label="Count">
                <select
                  value={form.n_workers}
                  onChange={e => set('n_workers', e.target.value)}
                  className="bg-navy-700 border border-navy-500 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-sky-500">
                  {[1,2,3,4,5,6].map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <Field label="vCPUs" required hint="Min 2">
                <input
                  type="number"
                  value={form.w_vcpus}
                  onChange={e => set('w_vcpus', e.target.value)}
                  min={2}
                  className={inputCls}
                />
              </Field>
              <Field label="RAM (GB)" required hint="Min 8">
                <input
                  type="number"
                  value={form.w_ram_gb}
                  onChange={e => set('w_ram_gb', e.target.value)}
                  min={8}
                  className={inputCls}
                />
              </Field>
              <Field label="Disk (GB)" required hint="Min 50">
                <input
                  type="number"
                  value={form.w_disk_gb}
                  onChange={e => set('w_disk_gb', e.target.value)}
                  min={50}
                  step={10}
                  className={inputCls}
                />
              </Field>
            </div>
            <p className="text-slate-600 text-xs">
              Recommended: 4 vCPU / 16 GB RAM / 100 GB disk
            </p>
          </div>
        )}
      </div>

      {/* ── Review summary ── */}
      {form.cluster_name && form.base_domain && form.ocp_version && (
        <div className="bg-navy-700/50 border border-navy-600 rounded-xl p-4 space-y-2">
          <h3 className="text-slate-400 text-xs font-semibold uppercase tracking-wide mb-3">Summary</h3>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
            {[
              ['Cluster',  `${form.cluster_name}.${form.base_domain}`],
              ['Type',     DEPLOY_TYPES.find(t => t.id === form.deployment_type)?.title],
              ['Version',  form.ocp_version],
              ['Network',  form.network || '—'],
              ['CP Resources', `${form.cp_vcpus} vCPU / ${form.cp_ram_gb} GB RAM / ${form.cp_disk_gb} GB disk`],
              ...(isFull ? [['Workers', `${form.n_workers} × ${form.w_vcpus} vCPU / ${form.w_ram_gb} GB RAM`]] : []),
            ].map(([k, v]) => (
              <div key={k} className="flex gap-3">
                <span className="text-slate-500 w-28 flex-shrink-0">{k}</span>
                <span className="text-slate-200 font-mono">{v}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Deploy warning + button ── */}
      <div className="space-y-4">
        <div className="flex items-start gap-2 text-yellow-400 text-xs bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-4 py-3">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Deployment will create KVM VMs and run the OpenShift Agent-Based Installer.
            Installation typically takes <strong>45–90 minutes</strong>.
          </span>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/ocp-agent')}
            className="flex items-center gap-2 bg-navy-700 hover:bg-navy-600 border border-navy-500 text-slate-300 px-5 py-2.5 rounded-md text-sm transition-colors">
            <ArrowLeft size={15} /> Cancel
          </button>
          <button
            onClick={handleDeploy}
            disabled={!canDeploy || deploying}
            className="flex items-center gap-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white font-bold px-6 py-2.5 rounded-md text-sm transition-colors">
            {deploying ? <Loader2 size={15} className="animate-spin" /> : <Server size={15} />}
            {deploying ? 'Starting…' : 'Deploy Cluster'}
          </button>
          {!canDeploy && !deploying && (
            <span className="text-slate-600 text-xs">
              Fill in cluster name, domain, version, pull secret, and network to deploy.
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
