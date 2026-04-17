import { useEffect, useState, useCallback } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ChevronLeft, Play, Square, RotateCw, RefreshCw, Trash2, Lock, Unlock,
  UserPlus, Monitor, Disc3, XCircle, Copy, Check,
  HardDrive, Network, Cpu, MemoryStick, Settings2,
} from 'lucide-react'
import api from '../api'

// ─────────────────────────────────────────────────────────────────────
// Small display helpers — kept local so this page stays independent of
// the rest of the app (VMList.jsx has its own StateBadge inline; same
// pattern here).
// ─────────────────────────────────────────────────────────────────────

function StateBadge({ state, stateCode, big = false }) {
  // Map both string (human) and state_code (libvirt enum) so callers
  // can drive coloring off whichever they prefer. stateCode wins when
  // both are set; state string is the visible label.
  const variant = (() => {
    if (stateCode === 1) return 'bg-green-900 text-green-300'
    if (stateCode === 5) return 'bg-navy-500 text-slate-400'
    if (stateCode === 3) return 'bg-yellow-900 text-yellow-300'
    if (stateCode === 6) return 'bg-red-900 text-red-300'
    return 'bg-yellow-900 text-yellow-300'
  })()
  const size = big ? 'px-3 py-1 text-sm' : 'px-2.5 py-0.5 text-xs'
  return (
    <span className={`inline-block rounded-full font-medium ${variant} ${size}`}>
      {state || 'Unknown'}
    </span>
  )
}

// Spec card — one labeled stat with a big value + small sub-line.
function SpecCard({ icon: Icon, label, value, sub }) {
  return (
    <div className="bg-navy-700 border border-navy-400 rounded-xl p-4">
      <div className="flex items-center gap-2 text-slate-400 text-xs uppercase tracking-wider">
        {Icon && <Icon size={12} />} {label}
      </div>
      <div className="text-white text-2xl font-semibold mt-1.5">{value ?? <span className="text-slate-600 text-lg">—</span>}</div>
      {sub && <div className="text-slate-500 text-xs mt-0.5">{sub}</div>}
    </div>
  )
}

// One dense table for disks / NICs / graphics. Columns passed in.
function Table({ cols, rows, empty = 'None' }) {
  if (!rows || rows.length === 0) {
    return <div className="text-slate-500 text-sm italic py-4">{empty}</div>
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-sky-400 border-b border-navy-400">
            {cols.map((c, i) => (
              <th key={i} className="py-2 pr-4 text-xs uppercase tracking-wider font-medium whitespace-nowrap">{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-navy-500 last:border-0 text-slate-300">
              {cols.map((c, j) => (
                <td key={j} className="py-2 pr-4 align-top">{c.render(row) ?? <span className="text-slate-600">—</span>}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Action button — consistent styling for the power bar + footer
// actions. Shows a spinner while `busy` matches `name`.
function ActionButton({ onClick, disabled, busy, name, icon: Icon, children, variant = 'default' }) {
  const tone = {
    default: 'bg-navy-500 hover:bg-navy-400 text-slate-200 border-navy-300',
    primary: 'bg-sky-600 hover:bg-sky-500 text-white border-sky-400',
    green:   'bg-green-800 hover:bg-green-700 text-green-200 border-green-700',
    yellow:  'bg-yellow-800 hover:bg-yellow-700 text-yellow-200 border-yellow-700',
    red:     'bg-red-800 hover:bg-red-700 text-red-200 border-red-700',
  }[variant] || 'bg-navy-500 text-slate-200 border-navy-300'

  return (
    <button
      onClick={onClick}
      disabled={disabled || busy === name}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${tone}`}
    >
      {busy === name ? <RefreshCw size={12} className="animate-spin" /> : (Icon && <Icon size={12} />)}
      {children}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────
// ISO picker modal — opens on "Attach ISO", fetches /api/images,
// filters to status=ready, hands the pick back to the caller.
// ─────────────────────────────────────────────────────────────────────
function ISOPickerModal({ open, onCancel, onPick }) {
  const [isos, setIsos] = useState([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!open) return
    setLoading(true); setErr('')
    api.get('/images')
      .then(r => {
        // hypervisor's image handler returns {"images": [...]} — filter
        // to ready only; uploads-in-progress aren't mountable.
        const rows = (r.data.images || []).filter(i => (i.status || 'ready') === 'ready')
        setIsos(rows)
      })
      .catch(e => setErr(e.response?.data?.error || 'Failed to load ISOs'))
      .finally(() => setLoading(false))
  }, [open])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCancel}>
      <div className="bg-navy-700 border border-navy-300 rounded-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-3 border-b border-navy-400 flex items-center justify-between">
          <h3 className="text-white font-semibold">Attach ISO</h3>
          <button onClick={onCancel} className="text-slate-500 hover:text-slate-200"><XCircle size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {loading && <div className="text-slate-400 py-6 text-center text-sm">Loading…</div>}
          {err && <div className="bg-red-900/30 border border-red-700/50 text-red-300 text-sm rounded px-3 py-2">{err}</div>}
          {!loading && !err && isos.length === 0 && (
            <div className="text-slate-500 py-6 text-center text-sm">
              No ready ISOs. Upload one on the <Link to="/images" className="text-sky-400 hover:underline">Images</Link> page first.
            </div>
          )}
          {!loading && isos.length > 0 && (
            <div className="space-y-1">
              {isos.map(iso => (
                <button
                  key={iso.id}
                  onClick={() => onPick(iso)}
                  className="w-full text-left bg-navy-800 hover:bg-navy-600 border border-navy-400 rounded p-3 flex items-center gap-3 transition-colors"
                >
                  <Disc3 size={18} className="text-sky-400 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-slate-200 text-sm font-medium truncate">{iso.name}</div>
                    <div className="text-slate-500 text-xs font-mono truncate">{iso.path}</div>
                  </div>
                  <div className="text-slate-500 text-xs whitespace-nowrap">{fmtBytes(iso.size)}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function fmtBytes(n) {
  if (!n || n === 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n, u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v.toFixed(v < 10 && u > 0 ? 1 : 0)} ${units[u]}`
}

// ─────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────
export default function VMDetail() {
  const { uuid } = useParams()
  const navigate = useNavigate()
  const [vm, setVm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(null) // action name currently in flight
  const [copied, setCopied] = useState(false)
  const [isoModalOpen, setIsoModalOpen] = useState(false)
  const [me, setMe] = useState(null)

  const fetchVM = useCallback(async () => {
    try {
      const r = await api.get(`/vms/${uuid}`)
      setVm(r.data)
      setErr('')
    } catch (e) {
      setErr(e.response?.data?.error || (e.response?.status === 404 ? 'VM not found' : 'Load failed'))
      setVm(null)
    } finally {
      setLoading(false)
    }
  }, [uuid])

  useEffect(() => { fetchVM() }, [fetchVM])

  // Fetch the current user once — detail page needs is_admin + id for
  // ownership badge + claim-button logic. /auth/me is a cheap cookie
  // check; no loading spinner for this.
  useEffect(() => {
    api.get('/auth/me').then(r => setMe(r.data)).catch(() => {})
  }, [])

  // Generic "run this action, refresh, mark busy" helper. Keeps the
  // main body free of repetitive try/catch/finally.
  const run = async (name, fn, { refresh = true, confirmMsg } = {}) => {
    if (confirmMsg && !confirm(confirmMsg)) return
    setBusy(name)
    try {
      await fn()
      if (refresh) await fetchVM()
    } catch (e) {
      alert(e.response?.data?.error || `${name} failed`)
    } finally {
      setBusy(null)
    }
  }

  const start    = () => run('start',    () => api.post(`/vms/${uuid}/start`))
  const shutdown = () => run('shutdown', () => api.post(`/vms/${uuid}/shutdown`),
                              { confirmMsg: 'Send ACPI shutdown? (guest may take a minute to power off)' })
  const forceOff = () => run('stop',     () => api.post(`/vms/${uuid}/stop`),
                              { confirmMsg: 'Force-stop? Unsaved guest data may be lost.' })
  const reboot   = () => run('reboot',   () => api.post(`/vms/${uuid}/reboot`))
  const lock     = () => run('lock',     () => api.post(`/vms/${uuid}/lock`))
  const unlock   = () => run('unlock',   () => api.post(`/vms/${uuid}/unlock`))
  const claim    = () => run('claim',    () => api.post(`/vms/${uuid}/claim`, {}),
                              { confirmMsg: `Claim "${vm?.name}" for yourself?` })
  const release  = () => run('release',  () => api.post(`/vms/${uuid}/release`),
                              { confirmMsg: 'Release ownership? VM stays running in libvirt; staxv just forgets it.' })
  const detachISO = () => run('detach-iso', () => api.post(`/vms/${uuid}/detach-iso`))

  const attachISO = async (iso) => {
    setIsoModalOpen(false)
    await run('attach-iso', () => api.post(`/vms/${uuid}/attach-iso`, { iso_id: iso.id }))
  }

  const del = async () => {
    if (!confirm(`Delete "${vm.name}"? Disks will be wiped. This is irreversible.`)) return
    setBusy('delete')
    try {
      await api.delete(`/vms/${uuid}`)
      navigate('/vms', { replace: true })
    } catch (e) {
      alert(e.response?.data?.error || 'Delete failed')
      setBusy(null)
    }
  }

  const copyUUID = () => {
    navigator.clipboard?.writeText(uuid).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  if (loading && !vm) {
    return <div className="text-sky-400 text-center py-16">Loading…</div>
  }
  if (err) {
    return (
      <div className="max-w-3xl mx-auto">
        <Link to="/vms" className="inline-flex items-center gap-2 text-slate-400 hover:text-sky-400 text-sm mb-4">
          <ChevronLeft size={14} /> Back to VMs
        </Link>
        <div className="bg-red-900/30 border border-red-700/50 text-red-300 rounded-lg px-4 py-3">{err}</div>
      </div>
    )
  }
  if (!vm) return null

  // Derived flags — used across the header + footer.
  const running = vm.state_code === 1
  const canEditOwnership = me?.is_admin
  // CDROM row is the source of truth for "is an ISO mounted" — grab
  // the first cdrom disk (there's usually only one slot).
  const cdrom = vm.disks?.find(d => d.device === 'cdrom')
  const isoMounted = !!(cdrom && cdrom.source)

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      <Link to="/vms" className="inline-flex items-center gap-2 text-slate-400 hover:text-sky-400 text-sm">
        <ChevronLeft size={14} /> VMs
      </Link>

      {/* ─── Header card ───────────────────────────────────────── */}
      <div className="bg-navy-700 border border-navy-400 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-white text-2xl font-bold truncate">{vm.name}</h1>
              <StateBadge state={vm.state} stateCode={vm.state_code} big />
              {vm.locked && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-900/40 text-amber-300 border border-amber-700/50">
                  <Lock size={10} /> Locked
                </span>
              )}
              {vm.adopted && (
                <span
                  title="Pre-existing libvirt VM with no staxv owner"
                  className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-amber-900/40 text-amber-300 border border-amber-700/50"
                >
                  Adopted
                </span>
              )}
            </div>
            <button
              onClick={copyUUID}
              title="Copy UUID"
              className="mt-2 inline-flex items-center gap-1.5 text-slate-500 hover:text-sky-400 font-mono text-xs transition-colors"
            >
              {copied ? <Check size={11} className="text-green-400" /> : <Copy size={11} />}
              {uuid}
            </button>
          </div>

          {/* Power + destructive actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {running ? (
              <>
                <ActionButton onClick={shutdown} busy={busy} name="shutdown" icon={Square} variant="yellow">Shutdown</ActionButton>
                <ActionButton onClick={reboot}   busy={busy} name="reboot"   icon={RotateCw} variant="default">Reboot</ActionButton>
                <ActionButton onClick={forceOff} busy={busy} name="stop"     icon={Square} variant="red">Force stop</ActionButton>
              </>
            ) : (
              <ActionButton onClick={start} busy={busy} name="start" icon={Play} variant="green">Start</ActionButton>
            )}
            <button
              onClick={fetchVM}
              title="Refresh"
              className="p-1.5 rounded border border-navy-300 bg-navy-500 hover:bg-navy-400 text-slate-300 transition-colors"
            >
              <RefreshCw size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* ─── Spec grid ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SpecCard icon={Cpu}         label="vCPUs"   value={vm.vcpus} />
        <SpecCard icon={MemoryStick} label="Memory"  value={vm.memory_mb ? `${vm.memory_mb} MiB` : null}
                  sub={vm.max_memory_mb && vm.max_memory_mb !== vm.memory_mb ? `max ${vm.max_memory_mb} MiB` : null} />
        <SpecCard icon={HardDrive}   label="Disks"   value={vm.disks?.filter(d => d.device === 'disk').length || 0}
                  sub={vm.disks?.length ? `${vm.disks.length} total (incl. cdrom)` : null} />
        <SpecCard icon={Network}     label="NICs"    value={vm.nics?.length || 0}
                  sub={vm.nics?.[0]?.source} />
      </div>

      {/* ─── OS / machine info ────────────────────────────────── */}
      <div className="bg-navy-700 border border-navy-400 rounded-xl p-5">
        <h3 className="text-sky-400 text-xs uppercase tracking-wider font-semibold mb-3 flex items-center gap-2">
          <Settings2 size={12} /> Machine
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-6 text-sm">
          <InfoRow label="OS type"      value={vm.os_type} />
          <InfoRow label="Architecture" value={vm.arch} mono />
          <InfoRow label="Machine"      value={vm.machine} mono />
          <InfoRow label="Boot order"   value={vm.boot_order?.length ? vm.boot_order.join(' → ') : null} />
        </div>
      </div>

      {/* ─── Disks section ────────────────────────────────────── */}
      <div className="bg-navy-700 border border-navy-400 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-navy-400 flex items-center justify-between">
          <h3 className="text-sky-400 text-xs uppercase tracking-wider font-semibold flex items-center gap-2">
            <HardDrive size={12} /> Disks & CD-ROMs
          </h3>
          {/* Attach/Detach ISO lives here — CDROM management is disk-level */}
          <div className="flex items-center gap-2">
            {isoMounted && (
              <ActionButton onClick={detachISO} busy={busy} name="detach-iso" icon={XCircle} variant="yellow">
                Detach ISO
              </ActionButton>
            )}
            <ActionButton onClick={() => setIsoModalOpen(true)} busy={busy} name="attach-iso" icon={Disc3} variant="default">
              {isoMounted ? 'Replace ISO' : 'Attach ISO'}
            </ActionButton>
          </div>
        </div>
        <div className="p-5">
          <Table
            rows={vm.disks}
            empty="No disks attached"
            cols={[
              { header: 'Target', render: d => <span className="font-mono text-slate-200">{d.target}</span> },
              { header: 'Device', render: d => (
                <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide border ${
                  d.device === 'cdrom'
                    ? 'bg-sky-900/30 text-sky-300 border-sky-700/50'
                    : 'bg-navy-800 text-slate-300 border-navy-400'
                }`}>{d.device}</span>
              ) },
              { header: 'Bus', render: d => d.bus ? <span className="font-mono text-slate-400 text-xs">{d.bus}</span> : null },
              { header: 'Source', render: d => d.source
                ? <span className="font-mono text-xs break-all" title={d.source}>{d.source}</span>
                : (d.device === 'cdrom' ? <span className="text-slate-600 italic">empty slot</span> : null)
              },
              { header: 'R/O', render: d => d.read_only
                ? <span className="text-amber-300 text-[10px] font-semibold">RO</span>
                : null
              },
              { header: 'Boot', render: d => d.boot_order ? <span className="text-slate-400 text-xs">#{d.boot_order}</span> : null },
            ]}
          />
        </div>
      </div>

      {/* ─── Network interfaces ───────────────────────────────── */}
      <div className="bg-navy-700 border border-navy-400 rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-navy-400">
          <h3 className="text-sky-400 text-xs uppercase tracking-wider font-semibold flex items-center gap-2">
            <Network size={12} /> Network interfaces
          </h3>
        </div>
        <div className="p-5">
          <Table
            rows={vm.nics}
            empty="No NICs attached"
            cols={[
              { header: 'MAC', render: n => <span className="font-mono text-slate-200">{n.mac}</span> },
              { header: 'Type', render: n => <span className="text-slate-300">{n.type}</span> },
              { header: 'Source', render: n => n.source ? <span className="font-mono text-slate-300">{n.source}</span> : null },
              { header: 'Model', render: n => n.model ? <span className="font-mono text-slate-400 text-xs">{n.model}</span> : null },
              { header: 'Host dev', render: n => n.target ? <span className="font-mono text-slate-500 text-xs">{n.target}</span> : null },
            ]}
          />
        </div>
      </div>

      {/* ─── Console (VNC / SPICE) ────────────────────────────── */}
      {vm.graphics?.length > 0 && (
        <div className="bg-navy-700 border border-navy-400 rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sky-400 text-xs uppercase tracking-wider font-semibold flex items-center gap-2">
              <Monitor size={12} /> Console
            </h3>
            {running && (
              <a href={`/vnc-view/${uuid}`} target="_blank" rel="noopener noreferrer"
                 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border bg-sky-900/40 hover:bg-sky-800 text-sky-300 border-sky-700/50 transition-colors">
                <Monitor size={12} /> Open VNC
              </a>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-6 text-sm">
            <InfoRow label="Type"     value={vm.graphics[0].type} />
            <InfoRow label="Port"     value={vm.graphics[0].port} mono />
            <InfoRow label="Listen"   value={vm.graphics[0].listen} mono />
            <InfoRow label="Password" value={vm.graphics[0].has_password ? 'set' : 'none'} />
          </div>
        </div>
      )}

      {/* ─── Ownership & footer actions ──────────────────────── */}
      <div className="bg-navy-700 border border-navy-400 rounded-xl p-5 flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-slate-400">
          {vm.adopted
            ? <>This VM exists in libvirt but has no staxv owner. {canEditOwnership ? 'Claim it to grant ownership.' : ''}</>
            : vm.owner_id != null
              ? <>Owner: <span className="font-mono text-slate-200">user #{vm.owner_id}</span>{me?.id === vm.owner_id ? ' (you)' : ''}</>
              : <>Ownership: <span className="text-slate-500">none</span></>
          }
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {vm.adopted && canEditOwnership && (
            <ActionButton onClick={claim} busy={busy} name="claim" icon={UserPlus} variant="primary">Claim</ActionButton>
          )}
          {!vm.adopted && canEditOwnership && (
            <ActionButton onClick={release} busy={busy} name="release" icon={UserPlus} variant="default">Release</ActionButton>
          )}
          {!vm.adopted && (vm.locked
            ? <ActionButton onClick={unlock} busy={busy} name="unlock" icon={Unlock} variant="yellow">Unlock</ActionButton>
            : <ActionButton onClick={lock}   busy={busy} name="lock"   icon={Lock}   variant="default">Lock</ActionButton>
          )}
          <ActionButton onClick={del} busy={busy} name="delete" icon={Trash2} variant="red" disabled={vm.locked}>
            Delete
          </ActionButton>
        </div>
      </div>

      <ISOPickerModal
        open={isoModalOpen}
        onCancel={() => setIsoModalOpen(false)}
        onPick={attachISO}
      />
    </div>
  )
}

// Mini key/value row used inside the Machine + Console cards. Label
// subdued; value in slate-200 mono when requested.
function InfoRow({ label, value, mono = false }) {
  return (
    <div>
      <div className="text-slate-500 text-[10px] uppercase tracking-wider font-medium">{label}</div>
      <div className={`text-slate-200 ${mono ? 'font-mono text-xs' : ''}`}>
        {value ?? <span className="text-slate-600">—</span>}
      </div>
    </div>
  )
}
