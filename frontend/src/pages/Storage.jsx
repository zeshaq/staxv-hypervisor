import { useEffect, useState, useRef } from 'react'
import {
  HardDrive, Upload, Plus, Trash2, RefreshCw, FolderOpen,
  Cloud, Disc, Camera, Database, ChevronRight, File,
  CheckCircle, AlertCircle, X, Loader2,
} from 'lucide-react'
import api from '../api'

// ── Folder meta ───────────────────────────────────────────────────────────────

const FOLDERS = [
  {
    id: 'cloud',
    label: 'Cloud Images',
    desc: 'qcow2 cloud-init base images downloaded from distro registries',
    icon: Cloud,
    accent: 'sky',
    color: 'text-sky-400',
    bg: 'bg-sky-500/10',
    border: 'border-sky-500/30',
    activeBg: 'bg-sky-500/20',
    activeBorder: 'border-sky-500',
    ext: '.qcow2, .img',
  },
  {
    id: 'iso',
    label: 'ISO Images',
    desc: 'Installation media for operating systems',
    icon: Disc,
    accent: 'violet',
    color: 'text-violet-400',
    bg: 'bg-violet-500/10',
    border: 'border-violet-500/30',
    activeBg: 'bg-violet-500/20',
    activeBorder: 'border-violet-500',
    ext: '.iso',
  },
  {
    id: 'disks',
    label: 'VM Disks',
    desc: 'Virtual machine disk images (qcow2, raw)',
    icon: HardDrive,
    accent: 'emerald',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/10',
    border: 'border-emerald-500/30',
    activeBg: 'bg-emerald-500/20',
    activeBorder: 'border-emerald-500',
    ext: '.qcow2, .raw',
  },
  {
    id: 'snapshots',
    label: 'Snapshots',
    desc: 'Point-in-time VM snapshots for backup and rollback',
    icon: Camera,
    accent: 'amber',
    color: 'text-amber-400',
    bg: 'bg-amber-500/10',
    border: 'border-amber-500/30',
    activeBg: 'bg-amber-500/20',
    activeBorder: 'border-amber-500',
    ext: '.qcow2',
  },
]

// ── Type badge ─────────────────────────────────────────────────────────────────

function TypeBadge({ type }) {
  const styles = {
    iso:   'bg-violet-900/60 text-violet-300',
    qcow2: 'bg-emerald-900/60 text-emerald-300',
    img:   'bg-sky-900/60 text-sky-300',
    raw:   'bg-orange-900/60 text-orange-300',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-mono font-semibold ${styles[type] || 'bg-navy-600 text-slate-400'}`}>
      {type}
    </span>
  )
}

// ── Create Disk modal ─────────────────────────────────────────────────────────

function CreateDiskModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ name: '', size: '20', format: 'qcow2', folder: 'disks' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async e => {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await api.post('/storage/disks', form)
      onCreated()
    } catch (ex) {
      setErr(ex.response?.data?.error || 'Failed to create disk')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-navy-800 border border-navy-500 rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-navy-600">
          <h3 className="text-slate-100 font-semibold flex items-center gap-2">
            <HardDrive size={16} className="text-sky-400" /> Create Disk Image
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-navy-700 transition-colors">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={submit} className="p-6 space-y-4">
          {err && (
            <div className="flex items-center gap-2 text-red-300 text-sm bg-red-900/30 border border-red-700/50 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {err}
            </div>
          )}
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Disk Name</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="my-disk (extension added automatically)"
              className="w-full bg-navy-900 border border-navy-500 text-slate-200 placeholder-slate-600 focus:border-sky-500 focus:outline-none rounded-lg px-3 py-2.5 text-sm"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">Size (GB)</label>
              <input
                type="number"
                value={form.size}
                onChange={e => setForm(p => ({ ...p, size: e.target.value }))}
                min="1"
                className="w-full bg-navy-900 border border-navy-500 text-slate-200 focus:border-sky-500 focus:outline-none rounded-lg px-3 py-2.5 text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1.5 font-medium">Format</label>
              <select
                value={form.format}
                onChange={e => setForm(p => ({ ...p, format: e.target.value }))}
                className="w-full bg-navy-900 border border-navy-500 text-slate-200 focus:border-sky-500 focus:outline-none rounded-lg px-3 py-2.5 text-sm"
              >
                <option value="qcow2">qcow2</option>
                <option value="raw">raw</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1.5 font-medium">Destination Folder</label>
            <select
              value={form.folder}
              onChange={e => setForm(p => ({ ...p, folder: e.target.value }))}
              className="w-full bg-navy-900 border border-navy-500 text-slate-200 focus:border-sky-500 focus:outline-none rounded-lg px-3 py-2.5 text-sm"
            >
              <option value="disks">VM Disks</option>
              <option value="cloud">Cloud Images</option>
              <option value="snapshots">Snapshots</option>
            </select>
          </div>
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-navy-500 text-slate-400 hover:text-slate-200 hover:border-navy-400 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              {busy ? 'Creating…' : 'Create Disk'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function Storage() {
  const [folders, setFolders]     = useState([])
  const [basePath, setBasePath]   = useState('')
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState('')
  const [activeFolder, setActive] = useState('cloud')
  const [deleting, setDeleting]   = useState({})
  const [uploading, setUploading] = useState(false)
  const [uploadFolder, setUploadFolder] = useState(null) // folder id targeted for upload
  const [showCreate, setShowCreate] = useState(false)
  const [toast, setToast]         = useState(null)
  const fileRef = useRef(null)

  const showToast = (msg, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 3500)
  }

  const fetchStorage = () => {
    setLoading(true)
    api.get('/storage')
      .then(r => {
        const data = r.data
        // Handle both old format {files} and new format {folders}
        if (data.folders) {
          setFolders(data.folders)
          setBasePath(data.base_path || '')
        } else {
          // Fallback: wrap old format into a single "all" folder
          setFolders([{ id: 'all', label: 'All Files', files: data.files || [], path: data.storage_path || '' }])
          setBasePath(data.storage_path || '')
        }
      })
      .catch(e => setError(e.response?.data?.error || 'Failed to load storage'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchStorage() }, [])

  // Trigger upload for a specific folder
  const startUpload = (folderId) => {
    setUploadFolder(folderId)
    setTimeout(() => fileRef.current?.click(), 50)
  }

  const handleUpload = async e => {
    const file = e.target.files[0]
    if (!file) return
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      if (uploadFolder) formData.append('folder', uploadFolder)
      await api.post('/storage/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      showToast(`Uploaded ${file.name}`)
      fetchStorage()
    } catch (err) {
      showToast(err.response?.data?.error || 'Upload failed', false)
    } finally {
      setUploading(false)
      e.target.value = ''
      setUploadFolder(null)
    }
  }

  const handleDelete = async (file) => {
    if (!confirm(`Delete ${file.name}?`)) return
    setDeleting(p => ({ ...p, [file.path]: true }))
    try {
      await api.delete('/storage/files', { data: { path: file.path } })
      showToast(`Deleted ${file.name}`)
      fetchStorage()
    } catch (err) {
      showToast(err.response?.data?.error || 'Delete failed', false)
    } finally {
      setDeleting(p => ({ ...p, [file.path]: false }))
    }
  }

  // Get the active folder's data
  const activeMeta  = FOLDERS.find(f => f.id === activeFolder) || FOLDERS[0]
  const folderData  = folders.find(f => f.id === activeFolder)
  const files       = folderData?.files || []
  const totalSize   = folderData?.total_size || '—'
  const fileCount   = folderData?.count ?? files.length

  // Sidebar summary numbers
  const getSummary = (id) => folders.find(f => f.id === id) || {}

  if (loading) return (
    <div className="flex items-center justify-center py-32 gap-3 text-sky-400">
      <Loader2 size={20} className="animate-spin" /> Loading storage…
    </div>
  )
  if (error) return (
    <div className="flex items-center justify-center py-32 gap-2 text-red-400">
      <AlertCircle size={18} /> {error}
    </div>
  )

  return (
    <div className="flex gap-5 min-h-[calc(100vh-8rem)]">

      {/* ── Sidebar ────────────────────────────────────────────────────────── */}
      <aside className="w-60 flex-shrink-0 space-y-1.5">
        <div className="mb-4">
          <div className="text-xs font-semibold text-slate-500 uppercase tracking-widest px-2 mb-2">
            Storage Folders
          </div>
          <div className="text-xs text-slate-600 px-2 font-mono truncate" title={basePath}>
            {basePath || '/var/lib/libvirt/images'}
          </div>
        </div>

        {FOLDERS.map(f => {
          const summary = getSummary(f.id)
          const active  = f.id === activeFolder
          const Icon    = f.icon
          return (
            <button
              key={f.id}
              onClick={() => setActive(f.id)}
              className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl border text-left transition-all ${
                active
                  ? `${f.activeBg} ${f.activeBorder} ${f.color}`
                  : `bg-navy-800/50 border-navy-700 text-slate-400 hover:bg-navy-700 hover:text-slate-200 hover:border-navy-600`
              }`}
            >
              <span className={`p-1.5 rounded-lg ${active ? f.bg : 'bg-navy-700'}`}>
                <Icon size={15} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium leading-tight">{f.label}</div>
                <div className={`text-xs mt-0.5 ${active ? 'opacity-70' : 'text-slate-600'}`}>
                  {summary.count ?? 0} files · {summary.total_size || '0 B'}
                </div>
              </div>
              {active && <ChevronRight size={14} className="flex-shrink-0 opacity-60" />}
            </button>
          )
        })}

        {/* Total storage */}
        <div className="mt-4 pt-4 border-t border-navy-700 px-2">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <Database size={12} />
            <span>
              Total:{' '}
              <span className="text-slate-400 font-medium">
                {folders.reduce((acc, f) => acc + (f.total_bytes || 0), 0) > 0
                  ? formatBytes(folders.reduce((acc, f) => acc + (f.total_bytes || 0), 0))
                  : '—'}
              </span>
            </span>
          </div>
        </div>
      </aside>

      {/* ── Main content ────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* Folder header */}
        <div className={`bg-navy-800 border ${activeMeta.border} rounded-2xl p-5`}>
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl ${activeMeta.bg} border ${activeMeta.border}`}>
                <activeMeta.icon size={22} className={activeMeta.color} />
              </div>
              <div>
                <h2 className={`text-lg font-bold ${activeMeta.color}`}>{activeMeta.label}</h2>
                <p className="text-slate-500 text-sm mt-0.5">{activeMeta.desc}</p>
                <p className="text-slate-600 text-xs mt-1 font-mono">{folderData?.path || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={fetchStorage}
                className="p-2 rounded-lg text-slate-400 hover:text-sky-400 hover:bg-navy-700 transition-colors"
                title="Refresh"
              >
                <RefreshCw size={15} />
              </button>
              {/* Upload button — shown for cloud, iso */}
              {(activeFolder === 'cloud' || activeFolder === 'iso') && (
                <button
                  onClick={() => startUpload(activeFolder)}
                  disabled={uploading}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors border ${
                    activeMeta.border
                  } ${activeMeta.bg} ${activeMeta.color} hover:opacity-90 disabled:opacity-50`}
                >
                  {uploading && uploadFolder === activeFolder
                    ? <Loader2 size={14} className="animate-spin" />
                    : <Upload size={14} />}
                  Upload
                </button>
              )}
              {/* Create disk button — shown for disks, snapshots */}
              {(activeFolder === 'disks' || activeFolder === 'snapshots') && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-sky-500 hover:bg-sky-400 text-white transition-colors"
                >
                  <Plus size={14} /> Create Disk
                </button>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-6 mt-4 pt-4 border-t border-navy-700">
            <Stat label="Files" value={fileCount} />
            <Stat label="Total Size" value={totalSize} />
            <Stat label="Accepted" value={activeMeta.ext} />
          </div>
        </div>

        {/* File table */}
        <div className="bg-navy-800 border border-navy-600 rounded-2xl overflow-hidden">
          {files.length === 0 ? (
            <div className="py-20 text-center">
              <activeMeta.icon size={40} className={`mx-auto mb-3 opacity-20 ${activeMeta.color}`} />
              <p className="text-slate-500 text-sm font-medium">No files in this folder</p>
              <p className="text-slate-600 text-xs mt-1">{activeMeta.ext} files go here</p>
              {(activeFolder === 'cloud' || activeFolder === 'iso') && (
                <button
                  onClick={() => startUpload(activeFolder)}
                  className={`mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border ${activeMeta.border} ${activeMeta.bg} ${activeMeta.color} transition-colors`}
                >
                  <Upload size={14} /> Upload a file
                </button>
              )}
              {(activeFolder === 'disks') && (
                <button
                  onClick={() => setShowCreate(true)}
                  className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-sky-500 hover:bg-sky-400 text-white transition-colors"
                >
                  <Plus size={14} /> Create a disk
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-navy-900/60 text-slate-500 text-xs uppercase tracking-wider">
                  <th className="px-5 py-3 text-left font-semibold">Name</th>
                  <th className="px-5 py-3 text-left font-semibold">Type</th>
                  <th className="px-5 py-3 text-right font-semibold">Size</th>
                  <th className="px-5 py-3 text-left font-semibold hidden lg:table-cell">Path</th>
                  <th className="px-5 py-3 text-left font-semibold hidden md:table-cell">Modified</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-700">
                {files.map(file => (
                  <tr key={file.path} className="hover:bg-navy-700/40 transition-colors group">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <File size={14} className="text-slate-600 flex-shrink-0" />
                        <span className="text-slate-200 font-medium text-sm">{file.name}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5">
                      <TypeBadge type={file.type} />
                    </td>
                    <td className="px-5 py-3.5 text-right text-slate-400 font-mono text-xs">{file.size}</td>
                    <td className="px-5 py-3.5 hidden lg:table-cell">
                      <span className="text-slate-600 font-mono text-xs truncate max-w-[260px] block" title={file.path}>
                        {file.path}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 text-xs hidden md:table-cell">
                      {file.modified ? new Date(file.modified * 1000).toLocaleDateString() : '—'}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button
                        onClick={() => handleDelete(file)}
                        disabled={deleting[file.path]}
                        className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg bg-red-900/50 hover:bg-red-800 text-red-400 transition-all disabled:opacity-50"
                        title="Delete"
                      >
                        {deleting[file.path]
                          ? <Loader2 size={13} className="animate-spin" />
                          : <Trash2 size={13} />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {/* ── Hidden file input ─────────────────────────────────────────────── */}
      <input
        ref={fileRef}
        type="file"
        accept=".iso,.img,.qcow2,.raw"
        onChange={handleUpload}
        className="hidden"
      />

      {/* ── Create disk modal ─────────────────────────────────────────────── */}
      {showCreate && (
        <CreateDiskModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchStorage() }}
        />
      )}

      {/* ── Toast ─────────────────────────────────────────────────────────── */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl shadow-2xl text-sm font-medium border transition-all ${
          toast.ok
            ? 'bg-emerald-900/90 border-emerald-700 text-emerald-300'
            : 'bg-red-900/90 border-red-700 text-red-300'
        }`}>
          {toast.ok ? <CheckCircle size={15} /> : <AlertCircle size={15} />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Stat({ label, value }) {
  return (
    <div className="text-center">
      <div className="text-slate-200 font-semibold text-sm">{value}</div>
      <div className="text-slate-600 text-xs mt-0.5">{label}</div>
    </div>
  )
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
