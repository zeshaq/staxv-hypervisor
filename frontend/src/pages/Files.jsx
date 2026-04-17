import { useState, useEffect, useRef, useCallback } from 'react'
import api from '../api'
import {
  Folder, FolderOpen, File, FileText, FileCode, FileImage,
  Upload, Download, Trash2, Edit3, FolderPlus, FilePlus, RotateCcw,
  Home, ChevronRight, ArrowLeft, X, Save, AlertCircle,
  Loader2, RefreshCw, HardDrive, Copy, Check, Lock, Unlock, ShieldAlert, Eye, EyeOff
} from 'lucide-react'

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtSize(bytes) {
  if (bytes == null) return ''
  if (bytes === 0) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), u.length - 1)
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${u[i]}`
}

function fmtDate(ts) {
  if (!ts) return ''
  return new Date(ts * 1000).toLocaleString([], {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

const TEXT_EXTS = new Set([
  'py','js','jsx','ts','tsx','json','yaml','yml','toml','ini','cfg','conf',
  'sh','bash','env','md','txt','log','xml','html','htm','css','csv','sql',
  'rs','go','c','cpp','h','java','rb','php','pl','dockerfile','gitignore',
  'service','timer','socket','mount','tf','hcl',
])

function isEditable(name) {
  const ext = name.split('.').pop().toLowerCase()
  return TEXT_EXTS.has(ext) || [
    'dockerfile','makefile','rakefile','readme','license','authors',
  ].includes(name.toLowerCase())
}

function FileIcon({ entry, open, size = 16 }) {
  const cls = `flex-shrink-0`
  if (entry.type === 'dir')
    return open
      ? <FolderOpen size={size} className={`${cls} text-sky-400`} />
      : <Folder    size={size} className={`${cls} text-sky-400/80`} />
  const n = entry.name.toLowerCase()
  if (/\.(jpg|jpeg|png|gif|svg|webp|ico|bmp)$/.test(n))
    return <FileImage size={size} className={`${cls} text-pink-400`} />
  if (isEditable(n))
    return <FileCode  size={size} className={`${cls} text-green-400`} />
  if (/\.(txt|log|csv|md)$/.test(n))
    return <FileText  size={size} className={`${cls} text-slate-300`} />
  return   <File      size={size} className={`${cls} text-slate-500`} />
}

const BOOKMARKS = [
  { label: '/', path: '/', icon: HardDrive },
  { label: 'home', path: '/home' },
  { label: 'etc',  path: '/etc' },
  { label: 'var',  path: '/var' },
  { label: 'opt',  path: '/opt' },
  { label: 'srv',  path: '/srv' },
  { label: 'tmp',  path: '/tmp' },
  { label: 'root', path: '/root' },
]

// ── Editor modal ──────────────────────────────────────────────────────────────

// ── Sudo password modal ───────────────────────────────────────────────────────

function SudoModal({ onSuccess, onClose }) {
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = async e => {
    e?.preventDefault()
    if (!password) return
    setLoading(true)
    setError('')
    try {
      await api.post('/files/sudo/enable', { password })
      onSuccess()
    } catch (e) {
      setError(e.response?.data?.error || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-navy-800 border border-navy-500 rounded-xl shadow-2xl w-full max-w-sm mx-4 p-6">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-lg bg-yellow-400/10">
            <ShieldAlert size={20} className="text-yellow-400" />
          </div>
          <div>
            <h2 className="text-slate-200 font-semibold text-sm">Enable Sudo Mode</h2>
            <p className="text-slate-500 text-xs mt-0.5">Elevated access for 10 minutes</p>
          </div>
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-white p-1">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs text-slate-400 mb-1.5">Password for <span className="text-sky-400 font-mono">sudo</span></label>
            <div className="relative">
              <input
                ref={inputRef}
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Your login password"
                className="w-full bg-navy-900 border border-navy-500 focus:border-yellow-500 text-slate-200
                           rounded-md px-3 py-2.5 text-sm pr-10 focus:outline-none"
                autoComplete="current-password"
              />
              <button type="button" onClick={() => setShowPass(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300">
                {showPass ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-300 text-xs bg-red-900/30 border border-red-800 rounded px-3 py-2">
              <AlertCircle size={13} /> {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading || !password}
              className="flex-1 flex items-center justify-center gap-2 bg-yellow-600 hover:bg-yellow-500
                         disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-md transition-colors">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Unlock size={14} />}
              Authenticate
            </button>
            <button type="button" onClick={onClose}
              className="px-4 py-2.5 text-sm text-slate-400 hover:text-white rounded-md hover:bg-navy-700 transition-colors">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Editor modal ──────────────────────────────────────────────────────────────

function EditorModal({ path, onClose, onSaved, notify }) {
  const [content, setContent]   = useState('')
  const [original, setOriginal] = useState('')
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')
  const textareaRef = useRef(null)

  useEffect(() => {
    setLoading(true)
    setErr('')
    api.get(`/files/read?path=${encodeURIComponent(path)}`)
      .then(r => {
        setContent(r.data.content)
        setOriginal(r.data.content)
      })
      .catch(e => setErr(e.response?.data?.error || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [path])

  const save = async () => {
    setSaving(true)
    try {
      await api.post('/files/write', { path, content })
      setOriginal(content)
      notify('Saved', 'ok')
      onSaved?.()
    } catch (e) {
      notify(e.response?.data?.error || 'Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const handleKey = e => {
    if (e.key === 'Tab') {
      e.preventDefault()
      const ta = textareaRef.current
      const { selectionStart: s, selectionEnd: end } = ta
      const newVal = content.slice(0, s) + '  ' + content.slice(end)
      setContent(newVal)
      requestAnimationFrame(() => { ta.selectionStart = ta.selectionEnd = s + 2 })
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save() }
  }

  const dirty = content !== original

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-navy-900/95 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 bg-navy-800 border-b border-navy-600 flex-shrink-0">
        <FileCode size={16} className="text-sky-400" />
        <span className="text-slate-300 text-sm font-mono flex-1 truncate">{path}</span>
        {dirty && <span className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-0.5 rounded">unsaved</span>}
        <button
          onClick={save}
          disabled={saving || loading}
          className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-xs font-medium px-3 py-1.5 rounded transition-colors"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
          Save
        </button>
        <button onClick={onClose}
          className="text-slate-400 hover:text-white p-1 rounded transition-colors">
          <X size={18} />
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {loading && (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <Loader2 size={20} className="animate-spin mr-2" /> Loading…
          </div>
        )}
        {!loading && err && (
          <div className="flex-1 flex items-center justify-center text-red-400">
            <AlertCircle size={18} className="mr-2" /> {err}
          </div>
        )}
        {!loading && !err && (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={e => setContent(e.target.value)}
            onKeyDown={handleKey}
            className="flex-1 w-full bg-navy-950 text-slate-200 font-mono text-sm p-5 resize-none
                       focus:outline-none leading-relaxed"
            spellCheck={false}
            style={{ tabSize: 2, backgroundColor: '#040c1e' }}
          />
        )}
      </div>
    </div>
  )
}

// ── Rename inline ─────────────────────────────────────────────────────────────

function RenameInput({ entry, onDone, onCancel }) {
  const [name, setName] = useState(entry.name)
  const inputRef = useRef(null)

  useEffect(() => { inputRef.current?.select() }, [])

  const commit = async () => {
    const newName = name.trim()
    if (!newName || newName === entry.name) { onCancel(); return }
    const dir = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/'
    const dst = (dir === '/' ? '' : dir) + '/' + newName
    onDone(dst)
  }

  return (
    <input
      ref={inputRef}
      value={name}
      onChange={e => setName(e.target.value)}
      onKeyDown={e => {
        if (e.key === 'Enter')  commit()
        if (e.key === 'Escape') onCancel()
      }}
      onBlur={commit}
      className="bg-navy-600 border border-sky-500 text-slate-100 text-sm rounded px-2 py-0.5
                 focus:outline-none w-48"
      onClick={e => e.stopPropagation()}
    />
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Files() {
  const [cwd, setCwd]             = useState('/home')
  const [entries, setEntries]     = useState([])
  const [parent, setParent]       = useState(null)
  const [selected, setSelected]   = useState(null)
  const [loading, setLoading]     = useState(true)
  const [loadErr, setLoadErr]     = useState('')
  const [editor, setEditor]       = useState(null)    // path string
  const [renaming, setRenaming]   = useState(null)    // entry
  const [newFolderMode, setNewFolderMode] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [newFileMode, setNewFileMode]   = useState(false)
  const [newFileName, setNewFileName]   = useState('')
  const [sudoModal, setSudoModal]       = useState(false)
  const [sudoRemaining, setSudoRemaining] = useState(0)
  const [toast, setToast]         = useState({ msg: '', type: 'ok' })
  const [deleting, setDeleting]   = useState(false)
  const [copied, setCopied]       = useState(false)
  const uploadRef = useRef(null)
  const newFolderRef = useRef(null)
  const newFileRef   = useRef(null)

  const notify = useCallback((msg, type = 'ok') => {
    setToast({ msg, type })
    setTimeout(() => setToast({ msg: '' }), 3500)
  }, [])

  const loadDir = useCallback(async (path, opts = {}) => {
    setLoading(true)
    setLoadErr('')
    if (!opts.keepSel) setSelected(null)
    try {
      const r = await api.get(`/files/list?path=${encodeURIComponent(path)}`)
      setCwd(r.data.path)
      setParent(r.data.parent)
      setEntries(r.data.entries)
    } catch (e) {
      setLoadErr(e.response?.data?.error || 'Failed to load directory')
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll sudo status on mount and keep countdown ticking
  useEffect(() => {
    const syncSudo = async () => {
      try {
        const r = await api.get('/files/sudo/status')
        setSudoRemaining(r.data.remaining)
      } catch {}
    }
    syncSudo()
    const iv = setInterval(() => {
      setSudoRemaining(s => {
        if (s <= 0) return 0
        const next = s - 1
        if (next === 0) notify('Sudo mode expired', 'error')
        return next
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [])

  const doSudoDisable = async () => {
    try {
      await api.post('/files/sudo/disable')
      setSudoRemaining(0)
      notify('Sudo mode disabled')
    } catch {}
  }

  const onSudoSuccess = () => {
    setSudoModal(false)
    setSudoRemaining(600)
    notify('Sudo mode active — 10 minutes', 'ok')
  }

  useEffect(() => { loadDir('/home') }, [])

  // Breadcrumb parts from cwd
  const crumbs = cwd === '/'
    ? [{ label: '/', path: '/' }]
    : ['/', ...cwd.split('/').filter(Boolean)].reduce((acc, part, i, arr) => {
        const path = i === 0 ? '/' : '/' + arr.slice(1, i + 1).join('/')
        return [...acc, { label: part === '/' ? '/' : part, path }]
      }, [])

  const open = (entry) => {
    if (entry.type === 'dir') { loadDir(entry.path); return }
    if (isEditable(entry.name)) { setEditor(entry.path); return }
    // For binary/large files, offer download
    window.open(`/api/files/download?path=${encodeURIComponent(entry.path)}`, '_blank')
  }

  const doDelete = async () => {
    if (!selected) return
    if (!confirm(`Delete "${selected.name}"?`)) return
    setDeleting(true)
    try {
      await api.post('/files/delete', { path: selected.path })
      setSelected(null)
      notify(`Deleted ${selected.name}`)
      loadDir(cwd)
    } catch (e) {
      notify(e.response?.data?.error || 'Delete failed', 'error')
    } finally {
      setDeleting(false)
    }
  }

  const doRename = async (dst) => {
    const entry = renaming
    setRenaming(null)
    try {
      await api.post('/files/rename', { src: entry.path, dst })
      notify(`Renamed to ${dst.split('/').pop()}`)
      loadDir(cwd)
    } catch (e) {
      notify(e.response?.data?.error || 'Rename failed', 'error')
    }
  }

  const doMkdir = async () => {
    const name = newFolderName.trim()
    if (!name) { setNewFolderMode(false); return }
    const path = (cwd === '/' ? '' : cwd) + '/' + name
    setNewFolderMode(false)
    setNewFolderName('')
    try {
      await api.post('/files/mkdir', { path })
      notify(`Created ${name}`)
      loadDir(cwd)
    } catch (e) {
      notify(e.response?.data?.error || 'Failed to create folder', 'error')
    }
  }

  const doNewFile = () => {
    const name = newFileName.trim()
    if (!name) { setNewFileMode(false); return }
    const path = (cwd === '/' ? '' : cwd) + '/' + name
    setNewFileMode(false)
    setNewFileName('')
    setEditor(path)   // open editor; first save creates the file
  }

  const doUpload = async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    const form = new FormData()
    form.append('path', cwd)
    files.forEach(f => form.append('files', f))
    try {
      const r = await api.post('/files/upload', form)
      notify(`Uploaded ${r.data.saved.join(', ')}`)
      loadDir(cwd)
    } catch (e) {
      notify(e.response?.data?.error || 'Upload failed', 'error')
    }
    e.target.value = ''
  }

  const copyPath = () => {
    navigator.clipboard.writeText(selected?.path || cwd)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex h-full gap-0 -m-6 overflow-hidden" style={{ height: 'calc(100vh - 72px)' }}>

      {/* ── Sidebar ── */}
      <aside className="w-44 bg-navy-800 border-r border-navy-600 flex-shrink-0 flex flex-col overflow-y-auto">
        <div className="px-3 py-3 border-b border-navy-600">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Quick access</span>
        </div>
        <nav className="py-2">
          {BOOKMARKS.map(b => (
            <button key={b.path}
              onClick={() => loadDir(b.path)}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors
                ${cwd === b.path || cwd.startsWith(b.path + '/')
                  ? 'text-sky-400 bg-sky-400/10'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-navy-700'
                }`}
            >
              {b.icon
                ? <b.icon size={14} className="flex-shrink-0" />
                : <Folder size={14} className="flex-shrink-0" />}
              <span className="font-mono text-xs">{b.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* ── Main panel ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Toolbar */}
        <div className="flex items-center gap-2 px-4 py-2.5 bg-navy-800 border-b border-navy-600 flex-shrink-0">

          {/* Back */}
          <button onClick={() => parent && loadDir(parent)}
            disabled={!parent}
            className="p-1.5 rounded text-slate-400 hover:text-sky-300 hover:bg-navy-700 disabled:opacity-30 transition-colors">
            <ArrowLeft size={15} />
          </button>

          {/* Refresh */}
          <button onClick={() => loadDir(cwd)}
            className="p-1.5 rounded text-slate-400 hover:text-sky-300 hover:bg-navy-700 transition-colors">
            <RefreshCw size={14} />
          </button>

          {/* Breadcrumb */}
          <div className="flex items-center gap-0.5 flex-1 overflow-x-auto scrollbar-none">
            {crumbs.map((c, i) => (
              <span key={c.path} className="flex items-center gap-0.5 flex-shrink-0">
                {i > 0 && <ChevronRight size={12} className="text-slate-600" />}
                <button
                  onClick={() => loadDir(c.path)}
                  className={`text-xs px-1.5 py-0.5 rounded transition-colors font-mono
                    ${c.path === cwd
                      ? 'text-sky-300'
                      : 'text-slate-500 hover:text-sky-400'
                    }`}
                >{c.label}</button>
              </span>
            ))}
          </div>

          {/* Copy path */}
          <button onClick={copyPath}
            className="p-1.5 rounded text-slate-400 hover:text-sky-300 hover:bg-navy-700 transition-colors"
            title="Copy path">
            {copied ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}
          </button>

          {/* Sudo mode toggle */}
          <div className="w-px h-5 bg-navy-600" />
          {sudoRemaining > 0 ? (
            <button onClick={doSudoDisable}
              className="flex items-center gap-1.5 text-xs font-medium text-yellow-300 bg-yellow-500/10
                         hover:bg-yellow-500/20 border border-yellow-500/30 px-2.5 py-1.5 rounded transition-colors">
              <Unlock size={13} />
              Sudo {Math.floor(sudoRemaining / 60)}:{String(sudoRemaining % 60).padStart(2, '0')}
            </button>
          ) : (
            <button onClick={() => setSudoModal(true)}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-yellow-300
                         hover:bg-navy-700 px-2 py-1.5 rounded transition-colors">
              <Lock size={13} /> Sudo
            </button>
          )}

          <div className="w-px h-5 bg-navy-600" />

          {/* New file */}
          <button onClick={() => { setNewFolderMode(false); setNewFileMode(true); setTimeout(() => newFileRef.current?.focus(), 50) }}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-300 hover:bg-navy-700 px-2 py-1.5 rounded transition-colors">
            <FilePlus size={14} /> New file
          </button>

          {/* New folder */}
          <button onClick={() => { setNewFileMode(false); setNewFolderMode(true); setTimeout(() => newFolderRef.current?.focus(), 50) }}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-300 hover:bg-navy-700 px-2 py-1.5 rounded transition-colors">
            <FolderPlus size={14} /> New folder
          </button>

          {/* Upload */}
          <button onClick={() => uploadRef.current?.click()}
            className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-300 hover:bg-navy-700 px-2 py-1.5 rounded transition-colors">
            <Upload size={14} /> Upload
          </button>
          <input ref={uploadRef} type="file" multiple className="hidden" onChange={doUpload} />

          {/* Edit (selected text file) */}
          {selected && selected.type === 'file' && isEditable(selected.name) && (
            <button onClick={() => setEditor(selected.path)}
              className="flex items-center gap-1.5 text-xs text-sky-400 hover:text-sky-300 hover:bg-navy-700 px-2 py-1.5 rounded transition-colors">
              <Edit3 size={14} /> Edit
            </button>
          )}

          {/* Download (selected file) */}
          {selected && selected.type === 'file' && (
            <a href={`/api/files/download?path=${encodeURIComponent(selected.path)}`}
               download
               className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-300 hover:bg-navy-700 px-2 py-1.5 rounded transition-colors">
              <Download size={14} /> Download
            </a>
          )}

          {/* Rename */}
          {selected && (
            <button onClick={() => setRenaming(selected)}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-sky-300 hover:bg-navy-700 px-2 py-1.5 rounded transition-colors">
              <Edit3 size={14} /> Rename
            </button>
          )}

          {/* Delete */}
          {selected && (
            <button onClick={doDelete} disabled={deleting}
              className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-900/20 px-2 py-1.5 rounded transition-colors disabled:opacity-40">
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Delete
            </button>
          )}
        </div>

        {/* New folder inline input */}
        {newFolderMode && (
          <div className="flex items-center gap-2 px-4 py-2 bg-navy-700/50 border-b border-navy-600">
            <FolderPlus size={14} className="text-sky-400" />
            <input
              ref={newFolderRef}
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  doMkdir()
                if (e.key === 'Escape') { setNewFolderMode(false); setNewFolderName('') }
              }}
              placeholder="New folder name…"
              className="bg-navy-800 border border-sky-500 rounded px-2 py-1 text-sm text-slate-200
                         focus:outline-none w-64"
            />
            <button onClick={doMkdir}
              className="text-xs bg-sky-600 hover:bg-sky-500 text-white px-3 py-1 rounded">
              Create
            </button>
            <button onClick={() => { setNewFolderMode(false); setNewFolderName('') }}
              className="text-slate-400 hover:text-white p-1">
              <X size={14} />
            </button>
          </div>
        )}

        {/* New file inline input */}
        {newFileMode && (
          <div className="flex items-center gap-2 px-4 py-2 bg-navy-700/50 border-b border-navy-600">
            <FilePlus size={14} className="text-green-400" />
            <input
              ref={newFileRef}
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter')  doNewFile()
                if (e.key === 'Escape') { setNewFileMode(false); setNewFileName('') }
              }}
              placeholder="filename.txt"
              className="bg-navy-800 border border-green-500 rounded px-2 py-1 text-sm text-slate-200
                         focus:outline-none w-64 font-mono"
            />
            <button onClick={doNewFile}
              className="text-xs bg-green-700 hover:bg-green-600 text-white px-3 py-1 rounded">
              Create &amp; edit
            </button>
            <button onClick={() => { setNewFileMode(false); setNewFileName('') }}
              className="text-slate-400 hover:text-white p-1">
              <X size={14} />
            </button>
          </div>
        )}

        {/* File list */}
        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center py-20 text-slate-400">
              <Loader2 size={20} className="animate-spin mr-2" /> Loading…
            </div>
          )}
          {!loading && loadErr && (
            <div className="flex flex-col items-center justify-center py-20 text-slate-500">
              <AlertCircle size={32} className="mb-3 text-red-400" />
              <p className="text-sm text-red-300">{loadErr}</p>
              <button onClick={() => loadDir(cwd)}
                className="mt-4 text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1">
                <RefreshCw size={12} /> Retry
              </button>
            </div>
          )}
          {!loading && !loadErr && (
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-navy-800 border-b border-navy-700">
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 w-8"></th>
                  <th className="text-left px-2 py-2.5 text-xs font-medium text-slate-500">Name</th>
                  <th className="text-right px-4 py-2.5 text-xs font-medium text-slate-500 w-24">Size</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 w-44">Modified</th>
                  <th className="text-left px-4 py-2.5 text-xs font-medium text-slate-500 w-20">Mode</th>
                </tr>
              </thead>
              <tbody>
                {/* Parent dir row */}
                {parent && (
                  <tr className="border-b border-navy-700/40 hover:bg-navy-700/20 cursor-pointer transition-colors"
                      onDoubleClick={() => loadDir(parent)}>
                    <td className="px-4 py-2.5">
                      <FolderOpen size={15} className="text-sky-400/50" />
                    </td>
                    <td className="px-2 py-2.5 text-slate-500 font-mono text-xs" colSpan={4}>..</td>
                  </tr>
                )}
                {entries.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-slate-600 text-sm">
                      Empty directory
                    </td>
                  </tr>
                )}
                {entries.map(entry => {
                  const isSel = selected?.path === entry.path
                  return (
                    <tr
                      key={entry.path}
                      onClick={() => setSelected(isSel ? null : entry)}
                      onDoubleClick={() => open(entry)}
                      className={`border-b border-navy-700/30 cursor-pointer transition-colors select-none
                        ${isSel
                          ? 'bg-sky-600/15 border-l-2 border-l-sky-500'
                          : 'hover:bg-navy-700/20'
                        }`}
                    >
                      {/* Icon */}
                      <td className="px-4 py-2">
                        <FileIcon entry={entry} open={isSel} size={15} />
                      </td>
                      {/* Name */}
                      <td className="px-2 py-2">
                        {renaming?.path === entry.path
                          ? <RenameInput entry={entry} onDone={doRename}
                              onCancel={() => setRenaming(null)} />
                          : (
                            <div className="flex items-center gap-2">
                              <span className={`font-mono text-xs
                                ${entry.type === 'dir' ? 'text-sky-300' : 'text-slate-200'}`}>
                                {entry.name}
                              </span>
                              {entry.link_to && (
                                <span className="text-slate-600 text-xs">→ {entry.link_to}</span>
                              )}
                            </div>
                          )
                        }
                      </td>
                      {/* Size */}
                      <td className="px-4 py-2 text-right text-slate-500 font-mono text-xs tabular-nums">
                        {fmtSize(entry.size)}
                      </td>
                      {/* Modified */}
                      <td className="px-4 py-2 text-slate-600 text-xs tabular-nums">
                        {fmtDate(entry.modified)}
                      </td>
                      {/* Mode */}
                      <td className="px-4 py-2 text-slate-600 font-mono text-xs">
                        {entry.mode}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Status bar */}
        <div className="px-4 py-1.5 bg-navy-800 border-t border-navy-700 flex items-center gap-4 flex-shrink-0">
          <span className="text-xs text-slate-600 font-mono">{cwd}</span>
          <span className="text-xs text-slate-700">{entries.length} items</span>
          {selected && (
            <span className="text-xs text-slate-500 ml-auto font-mono">
              {selected.name}
              {selected.size != null && ` · ${fmtSize(selected.size)}`}
            </span>
          )}
        </div>
      </div>

      {/* Sudo modal */}
      {sudoModal && (
        <SudoModal onSuccess={onSudoSuccess} onClose={() => setSudoModal(false)} />
      )}

      {/* Editor overlay */}
      {editor && (
        <EditorModal
          path={editor}
          onClose={() => setEditor(null)}
          onSaved={() => loadDir(cwd, { keepSel: true })}
          notify={notify}
        />
      )}

      {/* Toast */}
      {toast.msg && (
        <div className={`fixed bottom-5 right-5 flex items-center gap-2 px-4 py-3 rounded-lg border text-sm z-50 shadow-xl
          ${toast.type === 'error'
            ? 'bg-red-900/90 border-red-700 text-red-200'
            : 'bg-green-900/90 border-green-700 text-green-200'
          }`}>
          {toast.msg}
          <button onClick={() => setToast({ msg: '' })} className="ml-1 opacity-60 hover:opacity-100">
            <X size={13} />
          </button>
        </div>
      )}
    </div>
  )
}
