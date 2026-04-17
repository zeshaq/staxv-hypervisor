import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api'
import {
  Server, Plus, Trash2, Download, Terminal, CheckCircle,
  XCircle, Clock, RefreshCw, ChevronDown, ChevronRight,
  AlertTriangle, Cpu, MemoryStick, Network, Globe,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLORS = {
  running:   'text-emerald-400 bg-emerald-400/10 border-emerald-400/30',
  deploying: 'text-sky-400   bg-sky-400/10   border-sky-400/30',
  failed:    'text-red-400   bg-red-400/10   border-red-400/30',
  deleted:   'text-slate-400 bg-slate-400/10 border-slate-400/30',
}

const STATUS_ICONS = {
  running:   <CheckCircle size={13} />,
  deploying: <RefreshCw   size={13} className="animate-spin" />,
  failed:    <XCircle     size={13} />,
  deleted:   <XCircle     size={13} />,
}

function StatusBadge({ status }) {
  const cls  = STATUS_COLORS[status] || STATUS_COLORS.deleted
  const icon = STATUS_ICONS[status]  || null
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {icon}{status}
    </span>
  )
}

function Card({ children, className = '' }) {
  return (
    <div className={`bg-navy-800 border border-navy-500 rounded-lg p-5 ${className}`}>
      {children}
    </div>
  )
}

function SectionTitle({ children }) {
  return <h2 className="text-slate-200 font-semibold text-base mb-4">{children}</h2>
}

// ── Prerequisite check ────────────────────────────────────────────────────────

function PrereqBadge({ ok, label }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
      ok ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/30'
         : 'text-red-400 bg-red-400/10 border-red-400/30'
    }`}>
      {ok ? <CheckCircle size={11}/> : <XCircle size={11}/>}{label}
    </span>
  )
}

function PrereqCard({ prereqs }) {
  if (!prereqs) return null
  const items = [
    { key: 'base_image', label: `Base image (${prereqs.base_image_path})` },
    { key: 'iso_tool',   label: 'ISO tool (cloud-localds / genisoimage)' },
    { key: 'qemu_img',   label: 'qemu-img' },
    { key: 'libvirt',    label: 'libvirt-python' },
    { key: 'ssh',        label: 'ssh client' },
  ]
  const failing = items.filter(({ key }) => !prereqs[key])
  if (prereqs.ready) return null    // hide when all good
  return (
    <Card className="mb-6 border-amber-500/40 bg-amber-500/5">
      <div className="flex gap-3">
        <AlertTriangle size={20} className="text-amber-400 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="text-amber-300 font-semibold mb-1">Prerequisites missing</p>
          <p className="text-slate-400 text-sm mb-3">
            The following items are needed before you can deploy a cluster:
          </p>
          <div className="flex flex-wrap gap-2 mb-3">
            {failing.map(({ key, label }) => (
              <span key={key} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border text-red-400 bg-red-400/10 border-red-400/30">
                <XCircle size={11}/>{label}
              </span>
            ))}
          </div>
          {(!prereqs.iso_tool) && (
            <p className="text-slate-500 text-xs">
              Install ISO tools: <code className="text-sky-400">sudo apt install cloud-image-utils</code>
            </p>
          )}
          {(!prereqs.qemu_img) && (
            <p className="text-slate-500 text-xs mt-1">
              Install qemu-utils: <code className="text-sky-400">sudo apt install qemu-utils</code>
            </p>
          )}
          {(!prereqs.base_image) && (
            <p className="text-slate-500 text-xs mt-1">
              Download base image: <code className="text-sky-400 break-all">wget -O /var/lib/libvirt/images/ubuntu-22.04-cloudimg.img https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img</code>
            </p>
          )}
        </div>
      </div>
    </Card>
  )
}

// ── Create cluster form ───────────────────────────────────────────────────────

const DEFAULT_FORM = {
  name:            '',
  k8s_version:     '1.29',
  cni:             'flannel',
  worker_count:    1,
  node_size:       'small',
  base_image_path: '',
}

function CreateForm({ options, onCreate, disabled, availableImages }) {
  const [form, setForm] = useState(DEFAULT_FORM)
  const [open, setOpen]   = useState(true)
  const [err,  setErr]    = useState('')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async e => {
    e.preventDefault()
    setErr('')
    if (!form.name.trim()) { setErr('Cluster name is required'); return }
    try {
      await onCreate(form)
      setForm(DEFAULT_FORM)
      setOpen(false)
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message)
    }
  }

  return (
    <Card className="mb-6">
      <button
        className="flex items-center gap-2 w-full text-left"
        onClick={() => setOpen(o => !o)}
      >
        {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
        <span className="text-slate-200 font-semibold">New Cluster</span>
        {!open && <Plus size={14} className="text-sky-400 ml-1"/>}
      </button>

      {open && (
        <form onSubmit={submit} className="mt-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Cluster name</label>
            <input
              className="w-full bg-navy-700 border border-navy-400 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
              placeholder="my-cluster"
              value={form.name}
              onChange={e => set('name', e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {/* K8s version */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Kubernetes version</label>
              <select
                className="w-full bg-navy-700 border border-navy-400 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                value={form.k8s_version}
                onChange={e => set('k8s_version', e.target.value)}
              >
                {(options?.k8s_versions || ['1.30','1.29','1.28']).map(v => (
                  <option key={v} value={v}>v{v}</option>
                ))}
              </select>
            </div>

            {/* CNI */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">CNI</label>
              <select
                className="w-full bg-navy-700 border border-navy-400 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                value={form.cni}
                onChange={e => set('cni', e.target.value)}
              >
                {Object.entries(options?.cni_options || { flannel: 'Flannel', calico: 'Calico' }).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>

            {/* Worker count */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Workers (0–5)</label>
              <input
                type="number" min="0" max="5"
                className="w-full bg-navy-700 border border-navy-400 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                value={form.worker_count}
                onChange={e => set('worker_count', Number(e.target.value))}
              />
            </div>

            {/* Node size */}
            <div>
              <label className="block text-xs text-slate-400 mb-1">Node size</label>
              <select
                className="w-full bg-navy-700 border border-navy-400 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                value={form.node_size}
                onChange={e => set('node_size', e.target.value)}
              >
                {Object.entries(options?.node_sizes || {
                  small:  'Small  (2 vCPU / 2 GB)',
                  medium: 'Medium (2 vCPU / 4 GB)',
                  large:  'Large  (4 vCPU / 8 GB)',
                }).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Base image */}
          {availableImages && availableImages.length > 0 && (
            <div>
              <label className="block text-xs text-slate-400 mb-1">Base image</label>
              <select
                className="w-full bg-navy-700 border border-navy-400 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                value={form.base_image_path}
                onChange={e => set('base_image_path', e.target.value)}
              >
                <option value="">Default (ubuntu-22.04)</option>
                {availableImages.map(img => (
                  <option key={img.id} value={img.path}>
                    {img.name}{img.version ? ` ${img.version}` : ''} — {img.path.split('/').pop()}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Summary */}
          <p className="text-slate-500 text-xs">
            {1 + form.worker_count} VM{1 + form.worker_count !== 1 ? 's' : ''} will be created &mdash;
            control plane + {form.worker_count} worker{form.worker_count !== 1 ? 's' : ''}.
            {form.worker_count === 0 && ' Control plane will be untainted for workloads.'}
          </p>

          {err && <p className="text-red-400 text-sm">{err}</p>}

          <button
            type="submit"
            disabled={disabled}
            className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm rounded font-medium transition-colors"
          >
            <Plus size={15}/>
            Deploy cluster
          </button>
        </form>
      )}
    </Card>
  )
}

// ── SSE Log viewer ────────────────────────────────────────────────────────────

function LogViewer({ jobId, onDone }) {
  const [lines, setLines] = useState([])
  const [done,  setDone]  = useState(false)
  const [status, setStatus] = useState('running')
  const bottomRef = useRef(null)

  useEffect(() => {
    if (!jobId) return
    const es = new EventSource(`/api/k8s/jobs/${jobId}/logs`)
    es.onmessage = evt => {
      const data = JSON.parse(evt.data)
      if (data.log  !== undefined) setLines(l => [...l, data.log])
      if (data.status) {
        setStatus(data.status)
        setDone(true)
        es.close()
        onDone?.(data.status)
      }
      if (data.error) {
        setLines(l => [...l, `ERROR: ${data.error}`])
        setDone(true)
        es.close()
        onDone?.('error')
      }
    }
    es.onerror = () => { es.close(); setDone(true) }
    return () => es.close()
  }, [jobId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-slate-400 font-mono">Deployment log</span>
        {done && (
          <span className={`text-xs font-medium ${status === 'done' ? 'text-emerald-400' : 'text-red-400'}`}>
            {status === 'done' ? '✓ Complete' : '✗ Failed'}
          </span>
        )}
      </div>
      <div className="bg-slate-950 rounded border border-navy-500 p-3 h-72 overflow-y-auto font-mono text-xs">
        {lines.map((ln, i) => (
          <div key={i} className={`leading-5 ${
            ln.includes('✗') || ln.includes('ERROR') ? 'text-red-400' :
            ln.includes('✓') || ln.includes('successfully') ? 'text-emerald-400' :
            ln.startsWith('  ') ? 'text-slate-400' : 'text-slate-200'
          }`}>{ln}</div>
        ))}
        {!done && <div className="text-sky-400 animate-pulse mt-1">▋</div>}
        <div ref={bottomRef}/>
      </div>
    </div>
  )
}

// ── Cluster row / card ────────────────────────────────────────────────────────

function NodeChip({ node }) {
  if (!node) return null
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-navy-700 border border-navy-500 rounded text-xs text-slate-300">
      <Server size={11}/>{node.name} <span className="text-slate-500">{node.ip}</span>
    </span>
  )
}

function ClusterCard({ cluster, onDelete, onRefresh }) {
  const [expanded, setExpanded] = useState(cluster.status === 'deploying')
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await api.delete(`/k8s/clusters/${cluster.id}`)
      onRefresh()
    } catch(ex) {
      alert(ex.response?.data?.error || 'Delete failed')
    } finally {
      setDeleting(false)
      setConfirming(false)
    }
  }

  const cfg = cluster.config || {}
  const ctrl = cluster.nodes?.control
  const workers = cluster.nodes?.workers || []

  return (
    <Card className="mb-3">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => setExpanded(e => !e)} className="text-slate-500 hover:text-slate-300">
          {expanded ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
        </button>
        <span className="text-slate-100 font-semibold text-sm flex-1">{cluster.name}</span>
        <StatusBadge status={cluster.status}/>
        <div className="flex items-center gap-2 ml-2">
          {cluster.status === 'running' && cluster.kubeconfig && (
            <a
              href={`/api/k8s/clusters/${cluster.id}/kubeconfig`}
              className="p-1.5 text-slate-400 hover:text-sky-400 rounded hover:bg-navy-700 transition-colors"
              title="Download kubeconfig"
            >
              <Download size={15}/>
            </a>
          )}
          {cluster.status === 'running' && (
            <a
              href={`/api/k8s/clusters/${cluster.id}/ssh-key`}
              className="p-1.5 text-slate-400 hover:text-sky-400 rounded hover:bg-navy-700 transition-colors"
              title="Download SSH key"
            >
              <Terminal size={15}/>
            </a>
          )}
          {cluster.status !== 'deleted' && (
            <button
              onClick={handleDelete}
              disabled={deleting || cluster.status === 'deploying'}
              className={`p-1.5 rounded transition-colors disabled:opacity-40 ${
                confirming
                  ? 'text-red-400 bg-red-400/10 hover:bg-red-400/20'
                  : 'text-slate-400 hover:text-red-400 hover:bg-navy-700'
              }`}
              title={confirming ? 'Click again to confirm delete' : 'Delete cluster'}
            >
              <Trash2 size={15}/>
            </button>
          )}
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap gap-3 mt-2 ml-7 text-xs text-slate-500">
        <span className="flex items-center gap-1"><Globe size={11}/> v{cfg.k8s_version}</span>
        <span className="flex items-center gap-1"><Network size={11}/> {cfg.cni}</span>
        <span className="flex items-center gap-1"><Cpu size={11}/> {cfg.node_cpu} vCPU</span>
        <span className="flex items-center gap-1"><Server size={11}/> {1 + (cfg.worker_count || 0)} node{(1+(cfg.worker_count||0)) > 1 ? 's' : ''}</span>
      </div>

      {expanded && (
        <div className="mt-4 ml-7 space-y-3">
          {/* Nodes */}
          {(ctrl || workers.length > 0) && (
            <div>
              <p className="text-xs text-slate-500 mb-2">Nodes</p>
              <div className="flex flex-wrap gap-2">
                {ctrl && <NodeChip node={ctrl}/>}
                {workers.map(w => <NodeChip key={w.name} node={w}/>)}
              </div>
            </div>
          )}

          {/* Deployment log (active job) */}
          {cluster.status === 'deploying' && cluster.job_id && (
            <LogViewer
              key={cluster.job_id}
              jobId={cluster.job_id}
              onDone={() => onRefresh()}
            />
          )}

          {/* Error detail */}
          {cluster.status === 'failed' && cluster.error && (
            <div className="bg-red-900/20 border border-red-500/30 rounded p-3 text-xs text-red-400 font-mono whitespace-pre-wrap">
              {cluster.error}
            </div>
          )}

          {/* kubectl hint */}
          {cluster.status === 'running' && ctrl && (
            <div className="text-xs text-slate-500 space-y-1">
              <p>SSH: <code className="text-sky-400">ssh -i &lt;key&gt; ubuntu@{ctrl.ip}</code></p>
              <p>Download kubeconfig and run: <code className="text-sky-400">kubectl --kubeconfig=./{cluster.name}-kubeconfig.yaml get nodes</code></p>
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Kubernetes() {
  const [clusters,  setClusters]  = useState([])
  const [prereqs,   setPrereqs]   = useState(null)
  const [options,   setOptions]   = useState(null)
  const [images,    setImages]    = useState([])
  const [loading,   setLoading]   = useState(true)
  const [deploying, setDeploying] = useState(false)
  const [activeJob, setActiveJob] = useState(null)   // { cluster_id, job_id }

  const load = useCallback(async () => {
    try {
      const [c, p, o, img] = await Promise.all([
        api.get('/k8s/clusters'),
        api.get('/k8s/prereqs'),
        api.get('/k8s/options'),
        api.get('/images').catch(() => ({ data: { images: [] } })),
      ])
      setClusters(c.data.clusters || [])
      setPrereqs(p.data)
      setOptions(o.data)
      setImages((img.data.images || []).filter(i => i.status === 'available'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh while any cluster is deploying
  useEffect(() => {
    const anyDeploying = clusters.some(c => c.status === 'deploying')
    if (!anyDeploying) return
    const t = setInterval(() => {
      api.get('/k8s/clusters').then(r => setClusters(r.data.clusters || []))
    }, 15_000)
    return () => clearInterval(t)
  }, [clusters])

  const handleCreate = async (form) => {
    setDeploying(true)
    try {
      const res = await api.post('/k8s/clusters', form)
      const { cluster_id, job_id } = res.data
      setActiveJob({ cluster_id, job_id })
      await load()
    } finally {
      setDeploying(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw size={20} className="text-sky-400 animate-spin"/>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-2">
      <PrereqCard prereqs={prereqs} />

      <CreateForm
        options={options}
        onCreate={handleCreate}
        disabled={deploying || !prereqs?.ready}
        availableImages={images}
      />

      {/* Active job log (just created) */}
      {activeJob && !clusters.some(c => c.id === activeJob.cluster_id && c.status !== 'deploying') && (
        <Card className="mb-4">
          <SectionTitle>Deployment in progress</SectionTitle>
          <LogViewer
            key={activeJob.job_id}
            jobId={activeJob.job_id}
            onDone={() => { load(); setActiveJob(null) }}
          />
        </Card>
      )}

      {/* Cluster list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <SectionTitle>Clusters ({clusters.filter(c => c.status !== 'deleted').length})</SectionTitle>
          <button
            onClick={load}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-400 transition-colors"
          >
            <RefreshCw size={13}/>Refresh
          </button>
        </div>

        {clusters.filter(c => c.status !== 'deleted').length === 0 ? (
          <Card>
            <p className="text-slate-500 text-sm text-center py-6">
              No clusters yet. Use the form above to deploy your first cluster.
            </p>
          </Card>
        ) : (
          clusters
            .filter(c => c.status !== 'deleted')
            .map(c => (
              <ClusterCard
                key={c.id}
                cluster={c}
                onDelete={() => load()}
                onRefresh={load}
              />
            ))
        )}
      </div>
    </div>
  )
}
