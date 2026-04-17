import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api'
import {
  Download, Trash2, RefreshCw,
  CheckCircle, ChevronDown, ChevronRight, Cloud, Plus, Settings, Play, X,
} from 'lucide-react'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(bytes) {
  if (!bytes) return '—'
  const gb = bytes / 1024 ** 3
  if (gb >= 1)  return `${gb.toFixed(1)} GB`
  const mb = bytes / 1024 ** 2
  if (mb >= 1)  return `${mb.toFixed(0)} MB`
  return `${(bytes / 1024).toFixed(0)} KB`
}

const OS_COLORS = {
  ubuntu:    'bg-orange-500/20 text-orange-300 border-orange-500/30',
  debian:    'bg-red-500/20   text-red-300   border-red-500/30',
  rocky:     'bg-green-500/20 text-green-300  border-green-500/30',
  almalinux: 'bg-blue-500/20  text-blue-300   border-blue-500/30',
  centos:    'bg-purple-500/20 text-purple-300 border-purple-500/30',
  fedora:    'bg-sky-500/20   text-sky-300    border-sky-500/30',
  linux:     'bg-slate-500/20 text-slate-300  border-slate-500/30',
}

function OsBadge({ os }) {
  const cls = OS_COLORS[os] || OS_COLORS.linux
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded border text-xs font-medium ${cls}`}>
      {os}
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

// ── Download progress bar ─────────────────────────────────────────────────────

function ProgressBar({ jobId, onDone }) {
  const [prog, setProg] = useState({ downloaded: 0, total: 0, status: 'running' })

  useEffect(() => {
    if (!jobId) return
    const es = new EventSource(`/api/images/jobs/${jobId}/progress`)
    es.onmessage = evt => {
      const d = JSON.parse(evt.data)
      setProg(d)
      if (d.status === 'done' || d.status === 'error') {
        es.close()
        onDone?.(d.status)
      }
    }
    es.onerror = () => { es.close(); onDone?.('error') }
    return () => es.close()
  }, [jobId])

  const pct = prog.total > 0 ? Math.round((prog.downloaded / prog.total) * 100) : null
  return (
    <div className="mt-2">
      <div className="flex justify-between text-xs text-slate-400 mb-1">
        <span>{prog.status === 'error' ? prog.error || 'Download failed' : `${fmt(prog.downloaded)} / ${fmt(prog.total)}`}</span>
        {pct !== null && <span>{pct}%</span>}
      </div>
      <div className="h-1.5 bg-navy-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${prog.status === 'error' ? 'bg-red-500' : 'bg-sky-500'}`}
          style={{ width: `${pct ?? 100}%` }}
        />
      </div>
    </div>
  )
}

function prepareScript(image) {
  return `virt-customize -a ${image.path} \\
  --run-command 'useradd -m -s /bin/bash ze || true' \\
  --password ze:password:ze \\
  --run-command 'usermod -aG sudo,adm,wheel ze 2>/dev/null || true' \\
  --run-command 'echo "ze ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ze && chmod 440 /etc/sudoers.d/ze' \\
  --run-command 'systemctl disable cloud-init cloud-init-local cloud-config cloud-final 2>/dev/null || true' \\
  --run-command 'touch /etc/cloud/cloud-init.disabled' \\
  --run-command 'mkdir -p /etc/netplan && printf "network:\\n  version: 2\\n  ethernets:\\n    all-en:\\n      match:\\n        name: \\"en*\\"\\n      dhcp4: true\\n    all-eth:\\n      match:\\n        name: \\"eth*\\"\\n      dhcp4: true\\n" > /etc/netplan/99-dhcp.yaml && chmod 600 /etc/netplan/99-dhcp.yaml' \\
  --run-command 'mkdir -p /etc/NetworkManager/system-connections && printf "[connection]\\nid=dhcp\\ntype=ethernet\\nautoconnect=true\\n\\n[ipv4]\\nmethod=auto\\n\\n[ipv6]\\nmethod=auto\\n" > /etc/NetworkManager/system-connections/dhcp.nmconnection && chmod 600 /etc/NetworkManager/system-connections/dhcp.nmconnection' \\
  --run-command 'test -f /etc/systemd/resolved.conf && ln -sf /run/systemd/resolve/stub-resolv.conf /etc/resolv.conf || true' \\
  --run-command 'systemctl enable qemu-guest-agent 2>/dev/null || true' \\
  --run-command 'systemctl enable ssh 2>/dev/null || systemctl enable sshd 2>/dev/null || true' \\
  --run-command 'rm -f /etc/ssh/ssh_host_*' \\
  --selinux-relabel`
}

// ── Image card ────────────────────────────────────────────────────────────────

function ImageCard({ image, onDeleted }) {
  const [confirming, setConfirming] = useState(false)
  const [deleteFile, setDeleteFile] = useState(true)
  const [deleting,   setDeleting]   = useState(false)
  const [jobDone,    setJobDone]    = useState(false)

  const [showPrepare, setShowPrepare] = useState(false)
  const [script,      setScript]      = useState('')
  const [running,     setRunning]     = useState(false)
  const [output,      setOutput]      = useState([])
  const [runStatus,   setRunStatus]   = useState(null) // null | 'done' | 'error'
  const outputRef = useRef(null)

  const openPrepare = () => {
    setScript(prepareScript(image))
    setOutput([])
    setRunStatus(null)
    setShowPrepare(true)
  }

  const runScript = () => {
    setRunning(true)
    setOutput([])
    setRunStatus(null)

    const es = new EventSource(`/api/images/${image.id}/run-script-stream`)
    // use fetch + SSE manually since we need to POST
    es.close()

    fetch(`/api/images/${image.id}/run-script`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ script }),
      credentials: 'same-origin',
    }).then(async res => {
      // Non-streaming error (e.g. 409 image locked)
      if (!res.ok || res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json().catch(() => ({}))
        setOutput([data.error || `HTTP ${res.status}`])
        setRunStatus('error')
        setRunning(false)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop()
        for (const part of parts) {
          const line = part.replace(/^data: /, '').trim()
          if (!line) continue
          try {
            const msg = JSON.parse(line)
            if (msg.line !== undefined) {
              setOutput(o => [...o, msg.line])
              setTimeout(() => outputRef.current?.scrollTo(0, outputRef.current.scrollHeight), 50)
            }
            if (msg.status) {
              setRunStatus(msg.status)
              setRunning(false)
            }
          } catch {}
        }
      }
      setRunning(false)
    }).catch(e => {
      setOutput(o => [...o, `Error: ${e.message}`])
      setRunStatus('error')
      setRunning(false)
    })
  }

  const handleDelete = async () => {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try {
      await api.delete(`/images/${image.id}?delete_file=${deleteFile}`)
      onDeleted()
    } catch (ex) {
      alert(ex.response?.data?.error || 'Delete failed')
      setDeleting(false)
      setConfirming(false)
    }
  }

  const isDownloading = image.status === 'downloading' && !jobDone

  return (
    <div className="bg-navy-750 border border-navy-500 rounded-lg hover:border-navy-400 transition-colors">
      <div className="flex items-start gap-4 p-4">
        <div className="w-10 h-10 rounded-lg bg-navy-700 flex items-center justify-center flex-shrink-0">
          <Cloud size={20} className="text-sky-400"/>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {isDownloading
              ? <span className="w-2 h-2 rounded-full bg-sky-400 animate-pulse inline-block"/>
              : image.status === 'failed'
                ? <span className="w-2 h-2 rounded-full bg-red-400 inline-block"/>
                : <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block"/>
            }
            <span className="text-slate-100 font-medium text-sm">{image.name}</span>
            <OsBadge os={image.os}/>
            {image.version && <span className="text-xs text-slate-500">v{image.version}</span>}
          </div>
          <p className="text-slate-500 text-xs mt-0.5 font-mono truncate">{image.path}</p>
          <div className="flex gap-4 mt-1 text-xs text-slate-500">
            {image.format && image.format !== 'unknown' && <span>{image.format}</span>}
            {image.size > 0 && <span>{fmt(image.size)} on disk</span>}
            {image.virtual_size > 0 && <span>{fmt(image.virtual_size)} virtual</span>}
          </div>
          {isDownloading && (
            <ProgressBar jobId={image.job_id} onDone={() => { setJobDone(true); onDeleted() }}/>
          )}
          {image.status === 'failed' && image.error && (
            <p className="text-red-400 text-xs mt-1">{image.error}</p>
          )}
        </div>

        {image.status !== 'downloading' && (
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={showPrepare ? () => setShowPrepare(false) : openPrepare}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
                showPrepare
                  ? 'bg-navy-600 text-slate-300'
                  : 'bg-navy-700 hover:bg-navy-600 text-slate-400 hover:text-slate-200'
              }`}
              title="Prepare image with virt-customize"
            >
              <Settings size={13}/> Prepare
            </button>
            {confirming && (
              <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
                <input type="checkbox" checked={deleteFile} onChange={e => setDeleteFile(e.target.checked)} className="accent-red-500"/>
                file
              </label>
            )}
            {confirming && (
              <button onClick={() => setConfirming(false)}
                className="text-xs px-2 py-1 rounded text-slate-400 hover:text-slate-200 hover:bg-navy-700 transition-colors">
                Cancel
              </button>
            )}
            <button onClick={handleDelete} disabled={deleting}
              className={`p-1.5 rounded transition-colors disabled:opacity-40 ${
                confirming
                  ? 'text-red-400 bg-red-400/10 hover:bg-red-400/20 border border-red-400/30'
                  : 'text-slate-500 hover:text-red-400 hover:bg-navy-700'
              }`}
              title={confirming ? 'Confirm delete' : 'Delete'}>
              <Trash2 size={14}/>
            </button>
          </div>
        )}
      </div>

      {/* Prepare panel */}
      {showPrepare && (
        <div className="border-t border-navy-600 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-slate-400">Edit and run the <code className="text-sky-400">virt-customize</code> script to bake credentials into this image. Make sure <code className="text-sky-400">libguestfs-tools</code> is installed.</p>
          </div>
          <textarea
            value={script}
            onChange={e => setScript(e.target.value)}
            rows={9}
            spellCheck={false}
            className="w-full bg-navy-900 border border-navy-500 rounded-md px-3 py-2.5 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500 resize-y"
          />
          {output.length > 0 && (
            <div
              ref={outputRef}
              className="bg-black rounded-md p-3 text-xs font-mono text-slate-300 max-h-48 overflow-y-auto"
            >
              {output.map((line, i) => (
                <div key={i} className={line.toLowerCase().includes('error') ? 'text-red-400' : ''}>{line || '\u00a0'}</div>
              ))}
              {runStatus === 'done' && <div className="text-emerald-400 mt-1">✓ Done</div>}
              {runStatus === 'error' && <div className="text-red-400 mt-1">✗ Failed</div>}
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={runScript}
              disabled={running || !script.trim()}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs rounded font-medium transition-colors"
            >
              {running ? <RefreshCw size={12} className="animate-spin"/> : <Play size={12}/>}
              {running ? 'Running…' : 'Run'}
            </button>
            <button onClick={() => setShowPrepare(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-navy-700 hover:bg-navy-600 text-slate-400 text-xs rounded transition-colors">
              <X size={12}/> Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Catalog ───────────────────────────────────────────────────────────────────

function CatalogItem({ item, onDownload }) {
  const [loading, setLoading] = useState(false)

  const handle = async () => {
    setLoading(true)
    try { await onDownload(item) }
    finally { setLoading(false) }
  }

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-navy-600 last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-200 text-sm font-medium">{item.name}</span>
        </div>
        <p className="text-slate-500 text-xs mt-0.5">{item.description}</p>
      </div>
      {item.downloaded ? (
        <span className="inline-flex items-center gap-1 text-emerald-400 text-xs">
          <CheckCircle size={13}/> Downloaded
        </span>
      ) : (
        <button onClick={handle} disabled={loading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs rounded font-medium transition-colors">
          {loading ? <RefreshCw size={12} className="animate-spin"/> : <Download size={12}/>}
          Download
        </button>
      )}
    </div>
  )
}

// ── Add custom image form ─────────────────────────────────────────────────────

function AddImageForm({ onAdded }) {
  const [open,    setOpen]    = useState(false)
  const [form,    setForm]    = useState({ name: '', url: '' })
  const [err,     setErr]     = useState('')
  const [loading, setLoading] = useState(false)
  const fileRef = useRef(null)
  const [mode,  setMode]  = useState('url')

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const submit = async e => {
    e.preventDefault()
    setErr('')
    if (!form.name.trim()) { setErr('Name required'); return }
    setLoading(true)
    try {
      if (mode === 'upload') {
        const file = fileRef.current?.files?.[0]
        if (!file) { setErr('Select a file'); setLoading(false); return }
        const fd = new FormData()
        fd.append('file', file)
        fd.append('name', form.name)
        await api.post('/images/upload', fd)
      } else {
        if (!form.url.trim()) { setErr('URL required'); setLoading(false); return }
        await api.post('/images', { name: form.name, url: form.url.trim() })
      }
      setForm({ name: '', url: '' })
      setOpen(false)
      onAdded()
    } catch (ex) {
      setErr(ex.response?.data?.error || ex.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="mb-5">
      <button className="flex items-center gap-2 w-full text-left" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
        <span className="text-slate-200 font-semibold">Add Custom Image</span>
        {!open && <Plus size={14} className="text-sky-400 ml-1"/>}
      </button>

      {open && (
        <div className="mt-4">
          <div className="flex gap-1 mb-4 bg-navy-900 rounded p-1 w-fit">
            {[['url','Download from URL'], ['upload','Upload file']].map(([m, label]) => (
              <button key={m} onClick={() => setMode(m)}
                className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                  mode === m ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
                }`}>{label}</button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Name</label>
              <input
                className="w-full bg-navy-700 border border-navy-400 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                placeholder="my-custom-image"
                value={form.name}
                onChange={e => set('name', e.target.value)}
              />
            </div>

            {mode === 'url' ? (
              <div>
                <label className="block text-xs text-slate-400 mb-1">URL</label>
                <input
                  className="w-full bg-navy-700 border border-navy-400 rounded px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-500 font-mono"
                  placeholder="https://cloud-images.ubuntu.com/..."
                  value={form.url}
                  onChange={e => set('url', e.target.value)}
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs text-slate-400 mb-1">File (.img / .qcow2)</label>
                <input ref={fileRef} type="file" accept=".img,.qcow2,.raw"
                  className="block w-full text-sm text-slate-300 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:bg-navy-600 file:text-slate-200 file:text-xs hover:file:bg-navy-500"
                />
              </div>
            )}

            {err && <p className="text-red-400 text-sm">{err}</p>}

            <button type="submit" disabled={loading}
              className="inline-flex items-center gap-2 px-4 py-2 bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm rounded font-medium transition-colors">
              {loading
                ? <><RefreshCw size={13} className="animate-spin"/>Processing…</>
                : <><Download size={13}/>{mode === 'upload' ? 'Upload' : 'Download'}</>
              }
            </button>
          </form>
        </div>
      )}
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Images() {
  const [images,  setImages]  = useState([])
  const [catalog, setCatalog] = useState([])
  const [loading, setLoading] = useState(true)
  const [catOpen, setCatOpen] = useState(true)

  const load = useCallback(async () => {
    try {
      const [img, cat] = await Promise.all([
        api.get('/images'),
        api.get('/images/catalog'),
      ])
      setImages(img.data.images || [])
      setCatalog(cat.data.catalog || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const anyDl = images.some(i => i.status === 'downloading')
    if (!anyDl) return
    const t = setInterval(() => {
      api.get('/images').then(r => setImages(r.data.images || []))
    }, 5000)
    return () => clearInterval(t)
  }, [images])

  const handleCatalogDownload = async (item) => {
    await api.post('/images', {
      name: item.name, url: item.url, filename: item.filename,
      os: item.os, version: item.version, description: item.description,
    })
    await load()
  }

  const available  = images.filter(i => i.status === 'available')
  const inProgress = images.filter(i => i.status === 'downloading' || i.status === 'failed')

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <RefreshCw size={20} className="text-sky-400 animate-spin"/>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto">

      <div className="mb-5">
        <p className="text-slate-400 text-sm">
          Cloud images are stored in <code className="text-sky-400 bg-navy-800 px-1.5 py-0.5 rounded text-xs">/var/lib/libvirt/images/cloud-images/</code> and used as base images when attaching a cloud image to a VM.
        </p>
      </div>

      {/* Catalog */}
      <Card className="mb-5">
        <button className="flex items-center gap-2 w-full text-left" onClick={() => setCatOpen(o => !o)}>
          {catOpen ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
          <span className="text-slate-200 font-semibold">Image Catalog</span>
          <span className="text-slate-500 text-xs ml-1">
            — {catalog.filter(c => c.downloaded).length}/{catalog.length} downloaded
          </span>
        </button>
        {catOpen && (
          <div className="mt-4">
            {catalog.map(item => (
              <CatalogItem key={item.filename} item={item} onDownload={handleCatalogDownload}/>
            ))}
          </div>
        )}
      </Card>

      {/* Custom add */}
      <AddImageForm onAdded={load}/>

      {/* In-progress */}
      {inProgress.length > 0 && (
        <div className="mb-5">
          <h2 className="text-slate-400 text-sm font-medium mb-2">Downloading</h2>
          <div className="space-y-2">
            {inProgress.map(img => <ImageCard key={img.id} image={img} onDeleted={load}/>)}
          </div>
        </div>
      )}

      {/* Available */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-slate-200 font-semibold text-base">
            Cloud Images ({available.length})
          </h2>
          <button onClick={load} className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-400 transition-colors">
            <RefreshCw size={13}/> Refresh
          </button>
        </div>

        {available.length === 0 ? (
          <Card>
            <p className="text-slate-500 text-sm text-center py-6">
              No cloud images yet. Download one from the catalog above.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {available.map(img => <ImageCard key={img.id} image={img} onDeleted={load}/>)}
          </div>
        )}
      </div>
    </div>
  )
}
