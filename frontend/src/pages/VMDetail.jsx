import { useEffect, useState, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  Play, Square, Pencil, RefreshCw, HardDrive, Network, Cpu, Camera,
  Trash2, PlusCircle, Monitor, Terminal, ChevronDown, X, GripVertical
} from 'lucide-react'
import api from '../api'

/* ── tiny helpers ─────────────────────────────────────────────────────── */

function StateBadge({ state }) {
  const v = {
    Running: 'bg-green-900 text-green-300',
    Shutoff: 'bg-navy-500 text-slate-400',
    Paused: 'bg-yellow-900 text-yellow-300',
    Crashed: 'bg-red-900 text-red-300',
  }
  return (
    <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${v[state] || 'bg-yellow-900 text-yellow-300'}`}>
      {state}
    </span>
  )
}

function Section({ title, icon: Icon, children }) {
  return (
    <div className="bg-navy-700 border border-navy-400 rounded-xl p-5">
      <h3 className="text-sky-400 font-semibold mb-4 flex items-center gap-2">
        {Icon && <Icon size={16} />} {title}
      </h3>
      {children}
    </div>
  )
}

function inputCls(extra = '') {
  return `bg-navy-800 border border-navy-400 text-slate-200 focus:border-sky-500 focus:outline-none rounded-md px-3 py-2 text-sm ${extra}`
}

/* ── disk-path autosuggest ───────────────────────────────────────────── */
function DiskPathInput({ value, onChange, images }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  const filtered = images.filter(f =>
    f.path.toLowerCase().includes(value.toLowerCase()) ||
    f.name.toLowerCase().includes(value.toLowerCase())
  )

  useEffect(() => {
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div className="relative flex-1" ref={ref}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder="Type or select a disk image path…"
        className={inputCls('w-full pr-8')}
      />
      <ChevronDown size={14} className="absolute right-2.5 top-3 text-slate-500 pointer-events-none" />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 left-0 right-0 top-full mt-1 bg-navy-800 border border-navy-400 rounded-md shadow-xl max-h-52 overflow-y-auto">
          {filtered.map(f => (
            <li
              key={f.path}
              onMouseDown={() => { onChange(f.path); setOpen(false) }}
              className="px-3 py-2 hover:bg-navy-600 cursor-pointer"
            >
              <div className="text-slate-200 text-sm">{f.name}</div>
              <div className="text-slate-500 text-xs font-mono">{f.path} · {f.size} · {f.type}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/* ── network source dropdown ─────────────────────────────────────────── */
function NetworkSourceSelect({ mode, value, onChange, networks, bridges }) {
  if (mode === 'bridge') {
    return (
      <select value={value} onChange={e => onChange(e.target.value)} className={inputCls('flex-1')}>
        <option value="">Select bridge…</option>
        {bridges.map(b => <option key={b} value={b}>{b}</option>)}
        <option value="__custom__">Custom…</option>
      </select>
    )
  }
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={inputCls('flex-1')}>
      <option value="">Select network…</option>
      {networks.map(n => (
        <option key={n.name} value={n.name}>
          {n.name}{n.active ? '' : ' (inactive)'}
        </option>
      ))}
      <option value="__custom__">Custom…</option>
    </select>
  )
}

/* ══════════════════════════════════════════════════════════════════════ */
export default function VMDetail() {
  const { uuid } = useParams()
  const [vm, setVm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // supporting data
  const [images, setImages] = useState([])
  const [cloudImages, setCloudImages] = useState([])
  const [networks, setNetworks] = useState([])
  const [bridges, setBridges] = useState([])

  // form states — existing disk attach
  const [diskPath, setDiskPath] = useState('')

  // form states — create & attach new disk
  const [showCreate, setShowCreate] = useState(false)
  const [newDisk, setNewDisk] = useState({ name: '', size: '', format: 'qcow2' })

  // disk tab: 'attach' | 'create' | 'cloud'
  const [diskTab, setDiskTab] = useState('attach')
  const [cloudImage, setCloudImage] = useState('')
  const [cloudDiskSize, setCloudDiskSize] = useState('20')

  // network
  const [newIface, setNewIface] = useState({ mode: 'nat', source: '' })
  const [customSource, setCustomSource] = useState('')

  // PCI / snapshots
  const [newPci, setNewPci] = useState('')
  const [newSnap, setNewSnap] = useState('')

  // drag-to-reorder boot order
  const [diskOrder, setDiskOrder] = useState([])
  const [bootSaving, setBootSaving] = useState(false)
  const dragIdx = useRef(null)
  const dragOverIdx = useRef(null)

  const [saving, setSaving] = useState({})

  /* fetch VM details */
  const fetchVM = () => {
    setLoading(true)
    api.get(`/vms/${uuid}`)
      .then(r => {
        setVm(r.data)
        // Sort disks: those with a boot_order first (ascending), then unordered
        const sorted = [...(r.data.disks || [])].sort((a, b) => {
          const ao = a.boot_order || 999
          const bo = b.boot_order || 999
          return ao - bo
        })
        setDiskOrder(sorted)
      })
      .catch(e => setError(e.response?.data?.error || 'Failed to load VM'))
      .finally(() => setLoading(false))
  }

  /* fetch supporting data once */
  useEffect(() => {
    fetchVM()
    api.get('/storage/images').then(r => setImages(r.data.files || [])).catch(() => {})
    api.get('/cloud-images').then(r => setCloudImages(r.data.files || [])).catch(() => {})
    api.get('/networks').then(r => {
      setNetworks(r.data.networks || [])
      setBridges(r.data.bridges || [])
      // pre-select first available network
      const firstNet = (r.data.networks || [])[0]?.name || 'default'
      setNewIface(p => ({ ...p, source: firstNet }))
    }).catch(() => {})
  }, [uuid])

  /* generic action wrapper — full refresh */
  const act = async (key, fn) => {
    setSaving(p => ({ ...p, [key]: true }))
    try { await fn(); fetchVM() }
    catch (e) { alert(e.response?.data?.error || e.message || 'Error') }
    finally { setSaving(p => ({ ...p, [key]: false })) }
  }

  /* auto-save boot order after drag */
  const saveBootOrder = async (order) => {
    setBootSaving(true)
    try {
      await api.put(`/vms/${uuid}/boot`, {
        devices: order.map(d => `disk|${d.target}`)
      })
    } catch (e) {
      // silent failure — order stays updated in UI
    } finally {
      setBootSaving(false)
    }
  }

  /* drag handlers */
  const handleDragStart = (i) => { dragIdx.current = i }
  const handleDragOver = (e, i) => { e.preventDefault(); dragOverIdx.current = i }
  const handleDrop = () => {
    const from = dragIdx.current
    const to = dragOverIdx.current
    if (from === null || to === null || from === to) return
    const updated = [...diskOrder]
    const [moved] = updated.splice(from, 1)
    updated.splice(to, 0, moved)
    setDiskOrder(updated)
    saveBootOrder(updated)
    dragIdx.current = null
    dragOverIdx.current = null
  }

  /* resolved network source (handle custom input) */
  const resolvedSource = newIface.source === '__custom__' ? customSource : newIface.source

  if (loading) return <div className="text-sky-400 text-center py-20">Loading VM details…</div>
  if (error)   return <div className="text-red-400 text-center py-20">{error}</div>
  if (!vm)     return null

  return (
    <div className="space-y-5">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="bg-navy-700 border border-navy-400 rounded-xl p-5">
        <div className="flex flex-wrap items-start gap-4 justify-between">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h2 className="text-xl font-bold text-slate-100">{vm.name}</h2>
              <StateBadge state={vm.state} />
            </div>
            <div className="text-slate-400 text-sm font-mono">{vm.uuid}</div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {vm.state_code !== 1 ? (
              <button onClick={() => act('start', () => api.post(`/vms/${uuid}/start`))}
                className="flex items-center gap-2 bg-green-800 hover:bg-green-700 text-green-300 px-3 py-2 rounded-md text-sm">
                <Play size={14} /> Start
              </button>
            ) : (
              <button onClick={() => { if (confirm('Force stop?')) act('stop', () => api.post(`/vms/${uuid}/stop`)) }}
                className="flex items-center gap-2 bg-yellow-800 hover:bg-yellow-700 text-yellow-300 px-3 py-2 rounded-md text-sm">
                <Square size={14} /> Stop
              </button>
            )}
            <Link to={`/vms/${uuid}/edit`}
              className="flex items-center gap-2 bg-navy-500 hover:bg-navy-400 border border-navy-300 text-slate-300 px-3 py-2 rounded-md text-sm">
              <Pencil size={14} /> Edit
            </Link>
            <Link to={`/vms/${uuid}/monitor`}
              className="flex items-center gap-2 bg-navy-500 hover:bg-navy-400 border border-navy-300 text-slate-300 px-3 py-2 rounded-md text-sm">
              <Monitor size={14} /> Monitor
            </Link>
            <a href={`/terminal?vm_name=${vm.name}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 bg-navy-500 hover:bg-navy-400 border border-navy-300 text-slate-300 px-3 py-2 rounded-md text-sm">
              <Terminal size={14} /> Console
            </a>
            <a href={`/vnc-view/${uuid}`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 bg-sky-700 hover:bg-sky-600 border border-sky-500 text-white px-3 py-2 rounded-md text-sm">
              <Monitor size={14} /> VNC
            </a>
            <button onClick={fetchVM}
              className="flex items-center gap-2 bg-navy-500 hover:bg-navy-400 border border-navy-300 text-slate-300 px-3 py-2 rounded-md text-sm">
              <RefreshCw size={14} />
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5">
          {[
            { label: 'Memory',   value: `${vm.memory_mb} MB` },
            { label: 'vCPUs',    value: vm.vcpus },
            { label: 'OS Type',  value: vm.os_type || 'N/A' },
          ].map(item => (
            <div key={item.label} className="bg-navy-800 rounded-lg px-4 py-3">
              <div className="text-slate-400 text-xs mb-1">{item.label}</div>
              <div className="text-slate-200 font-medium">{item.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Disks ──────────────────────────────────────────────────── */}
      <Section title="Disks" icon={HardDrive}>
        {diskOrder.length > 0 ? (
          <>
            <table className="w-full text-sm mb-2">
              <thead>
                <tr className="bg-navy-800 text-sky-400">
                  <th className="px-3 py-2 text-left w-10"></th>
                  <th className="px-3 py-2 text-left w-12">Boot</th>
                  <th className="px-3 py-2 text-left">Target</th>
                  <th className="px-3 py-2 text-left">File</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Device</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {diskOrder.map((d, i) => (
                  <tr
                    key={d.target}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={e => handleDragOver(e, i)}
                    onDrop={handleDrop}
                    className="border-b border-navy-500 hover:bg-navy-600 cursor-grab active:cursor-grabbing"
                  >
                    <td className="px-3 py-2 text-slate-500">
                      <GripVertical size={14} />
                    </td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${
                        i === 0 ? 'bg-sky-500 text-white' :
                        i === 1 ? 'bg-sky-800 text-sky-200' :
                        'bg-navy-600 text-slate-500'
                      }`}>
                        {i + 1}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-slate-300">{d.target}</td>
                    <td className="px-3 py-2 text-slate-400 text-xs truncate max-w-xs" title={d.file}>{d.file}</td>
                    <td className="px-3 py-2 text-slate-400">{d.type}</td>
                    <td className="px-3 py-2 text-slate-400">{d.device}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        onClick={() => act(`disk-${d.target}`, () => api.delete(`/vms/${uuid}/disks`, { data: { target_dev: d.target } }))}
                        disabled={saving[`disk-${d.target}`]}
                        className="p-1.5 rounded bg-red-900/60 hover:bg-red-800 text-red-400 disabled:opacity-50">
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-slate-500 text-xs">Drag rows to reorder boot priority · top = boot 1</span>
              {bootSaving && <span className="text-sky-400 text-xs">Saving…</span>}
            </div>
          </>
        ) : (
          <p className="text-slate-400 text-sm mb-4">No disks attached.</p>
        )}

        {/* Tab toggle */}
        <div className="flex gap-1 mb-3">
          {[['attach', 'Attach Existing'], ['create', 'Create & Attach New'], ['cloud', 'Cloud Image']].map(([key, label]) => (
            <button key={key} onClick={() => setDiskTab(key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${diskTab === key ? 'bg-sky-600 text-white' : 'bg-navy-800 text-slate-400 hover:text-slate-200'}`}>
              {label}
            </button>
          ))}
        </div>

        {diskTab === 'attach' && (
          <div className="flex gap-2">
            <DiskPathInput value={diskPath} onChange={setDiskPath} images={images} />
            <button
              onClick={() => { if (!diskPath) return; act('add-disk', () => api.post(`/vms/${uuid}/disks`, { file_path: diskPath })); setDiskPath('') }}
              disabled={saving['add-disk'] || !diskPath}
              className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white px-3 py-2 rounded-md text-sm disabled:opacity-50">
              <PlusCircle size={14} /> Attach
            </button>
          </div>
        )}

        {diskTab === 'create' && (
          <div className="bg-navy-800 border border-navy-500 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-slate-400 mb-1">Disk name</label>
                <input value={newDisk.name} onChange={e => setNewDisk(p => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. myvm-data" className={inputCls('w-full')} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Size (GB)</label>
                <input type="number" min="1" value={newDisk.size}
                  onChange={e => setNewDisk(p => ({ ...p, size: e.target.value }))}
                  placeholder="20" className={inputCls('w-full')} />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">Format</label>
                <select value={newDisk.format} onChange={e => setNewDisk(p => ({ ...p, format: e.target.value }))}
                  className={inputCls('w-full')}>
                  <option value="qcow2">qcow2 (recommended)</option>
                  <option value="raw">raw</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => { if (!newDisk.name || !newDisk.size) return; act('create-disk', () => api.post(`/vms/${uuid}/disks/create`, newDisk)); setNewDisk({ name: '', size: '', format: 'qcow2' }); setDiskTab('attach') }}
                disabled={saving['create-disk'] || !newDisk.name || !newDisk.size}
                className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white px-4 py-2 rounded-md text-sm disabled:opacity-50">
                <HardDrive size={14} /> {saving['create-disk'] ? 'Creating…' : 'Create & Attach'}
              </button>
              <button onClick={() => setDiskTab('attach')}
                className="flex items-center gap-1.5 bg-navy-600 hover:bg-navy-500 border border-navy-400 text-slate-300 px-3 py-2 rounded-md text-sm">
                <X size={14} /> Cancel
              </button>
            </div>
          </div>
        )}

        {diskTab === 'cloud' && (
          <div className="bg-navy-800 border border-navy-500 rounded-lg p-4 space-y-3">
            <p className="text-slate-400 text-sm">
              Creates a qcow2 overlay backed by the selected cloud image and attaches it.
              Prepare the image with virt-customize first to bake in credentials.
            </p>
            {cloudImages.length === 0 ? (
              <p className="text-yellow-400 text-sm">No images found in <code className="bg-navy-700 px-1 rounded">/var/lib/libvirt/images/cloud-images/</code>. Place cloud images there first.</p>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <select
                    value={cloudImage}
                    onChange={e => setCloudImage(e.target.value)}
                    className={inputCls('flex-1')}>
                    <option value="">Select a cloud image…</option>
                    {cloudImages.map(f => (
                      <option key={f.path} value={f.path}>{f.name} — {f.size}</option>
                    ))}
                  </select>
                </div>
                <div className="flex gap-2 items-end">
                  <div>
                    <label className="block text-xs text-slate-400 mb-1">Boot disk size (GB)</label>
                    <input
                      type="number"
                      min="5"
                      max="2000"
                      value={cloudDiskSize}
                      onChange={e => setCloudDiskSize(e.target.value)}
                      className={inputCls('w-28')}
                    />
                  </div>
                  <button
                    onClick={() => {
                      if (!cloudImage) return
                      act('cloud-image', () => api.post(`/vms/${uuid}/cloud-image`, {
                        base_image: cloudImage,
                        disk_size_gb: parseInt(cloudDiskSize) || 20,
                      }))
                      setCloudImage('')
                      setCloudDiskSize('20')
                      setDiskTab('attach')
                    }}
                    disabled={saving['cloud-image'] || !cloudImage}
                    className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white px-3 py-2 rounded-md text-sm disabled:opacity-50 whitespace-nowrap">
                    <HardDrive size={14} /> {saving['cloud-image'] ? 'Setting up…' : 'Attach & Configure'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* ── Network Interfaces ─────────────────────────────────────── */}
      <Section title="Network Interfaces" icon={Network}>
        {vm.interfaces?.length > 0 ? (
          <table className="w-full text-sm mb-4">
            <thead>
              <tr className="bg-navy-800 text-sky-400">
                <th className="px-3 py-2 text-left">MAC</th>
                <th className="px-3 py-2 text-left">Model</th>
                <th className="px-3 py-2 text-left">Network / Bridge</th>
                <th className="px-3 py-2 text-left">IPs</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {vm.interfaces.map(iface => (
                <tr key={iface.mac} className="border-b border-navy-500 hover:bg-navy-600">
                  <td className="px-3 py-2 font-mono text-slate-300 text-xs">{iface.mac}</td>
                  <td className="px-3 py-2 text-slate-400">{iface.model}</td>
                  <td className="px-3 py-2 text-slate-400">{iface.network}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{iface.ips?.join(', ') || '—'}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => act(`iface-${iface.mac}`, () => api.delete(`/vms/${uuid}/interfaces`, { data: { mac: iface.mac } }))}
                      disabled={saving[`iface-${iface.mac}`]}
                      className="p-1.5 rounded bg-red-900/60 hover:bg-red-800 text-red-400 disabled:opacity-50">
                      <Trash2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-slate-400 text-sm mb-4">No network interfaces.</p>
        )}

        <div className="flex gap-2 flex-wrap items-end">
          {/* Mode selector */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Type</label>
            <select
              value={newIface.mode}
              onChange={e => {
                const mode = e.target.value
                const defaultSrc = mode === 'bridge'
                  ? (bridges[0] || '')
                  : (networks[0]?.name || 'default')
                setNewIface({ mode, source: defaultSrc })
                setCustomSource('')
              }}
              className={inputCls()}>
              <option value="nat">NAT / Virtual Network</option>
              <option value="bridge">Bridge</option>
            </select>
          </div>

          {/* Source dropdown */}
          <div className="flex-1 min-w-36">
            <label className="block text-xs text-slate-400 mb-1">
              {newIface.mode === 'bridge' ? 'Bridge interface' : 'Network'}
            </label>
            <NetworkSourceSelect
              mode={newIface.mode}
              value={newIface.source}
              onChange={v => { setNewIface(p => ({ ...p, source: v })); setCustomSource('') }}
              networks={networks}
              bridges={bridges}
            />
          </div>

          {/* Custom input if "Custom…" chosen */}
          {newIface.source === '__custom__' && (
            <div className="flex-1 min-w-36">
              <label className="block text-xs text-slate-400 mb-1">Custom name</label>
              <input
                value={customSource}
                onChange={e => setCustomSource(e.target.value)}
                placeholder={newIface.mode === 'bridge' ? 'br0' : 'mynet'}
                className={inputCls('w-full')}
              />
            </div>
          )}

          <button
            onClick={() => act('add-iface', () => api.post(`/vms/${uuid}/interfaces`, {
              mode: newIface.mode,
              source: resolvedSource,
            }))}
            disabled={saving['add-iface'] || !resolvedSource}
            className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white px-3 py-2 rounded-md text-sm disabled:opacity-50 self-end">
            <PlusCircle size={14} /> Add
          </button>
        </div>
      </Section>

      {/* ── PCI Passthrough ────────────────────────────────────────── */}
      <Section title="PCI Passthrough Devices" icon={Cpu}>
        {vm.host_devices?.length > 0 ? (
          <div className="space-y-2 mb-4">
            {vm.host_devices.map(dev => (
              <div key={dev.pci_id} className="flex items-center justify-between bg-navy-800 rounded-lg px-4 py-2.5">
                <div>
                  <div className="text-slate-200 text-sm">{dev.name}</div>
                  <div className="text-slate-500 text-xs font-mono">{dev.pci_id}</div>
                </div>
                <button
                  onClick={() => act(`dev-${dev.pci_id}`, () => api.delete(`/vms/${uuid}/devices`, { data: { pci_id: dev.pci_id } }))}
                  disabled={saving[`dev-${dev.pci_id}`]}
                  className="p-1.5 rounded bg-red-900/60 hover:bg-red-800 text-red-400 disabled:opacity-50">
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-400 text-sm mb-4">No PCI devices attached.</p>
        )}
        {vm.available_devices?.length > 0 && (
          <div className="flex gap-2">
            <select
              value={newPci}
              onChange={e => setNewPci(e.target.value)}
              className={inputCls('flex-1')}>
              <option value="">Select device to attach…</option>
              {vm.available_devices.map(d => (
                <option key={d.pci_id} value={d.pci_id}>
                  {d.name} ({d.pci_id}){d.iommu_group ? ` · IOMMU ${d.iommu_group}` : ''}
                </option>
              ))}
            </select>
            <button
              onClick={() => { if (!newPci) return; act('add-dev', () => api.post(`/vms/${uuid}/devices`, { pci_id: newPci })); setNewPci('') }}
              disabled={saving['add-dev'] || !newPci}
              className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white px-3 py-2 rounded-md text-sm disabled:opacity-50">
              <PlusCircle size={14} /> Attach
            </button>
          </div>
        )}
      </Section>

      {/* ── Snapshots ──────────────────────────────────────────────── */}
      <Section title="Snapshots" icon={Camera}>
        {vm.snapshots?.length > 0 ? (
          <div className="space-y-2 mb-4">
            {vm.snapshots.map(snap => (
              <div key={snap.name} className="flex items-center justify-between bg-navy-800 rounded-lg px-4 py-2.5">
                <span className="text-slate-200 text-sm font-medium">{snap.name}</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => act(`revert-${snap.name}`, () => api.post(`/vms/${uuid}/snapshots/${snap.name}/revert`))}
                    disabled={saving[`revert-${snap.name}`]}
                    className="flex items-center gap-1 bg-navy-500 hover:bg-navy-400 border border-navy-300 text-slate-300 px-2.5 py-1.5 rounded text-xs disabled:opacity-50">
                    Revert
                  </button>
                  <button
                    onClick={() => act(`del-snap-${snap.name}`, () => api.delete(`/vms/${uuid}/snapshots/${snap.name}`))}
                    disabled={saving[`del-snap-${snap.name}`]}
                    className="p-1.5 rounded bg-red-900/60 hover:bg-red-800 text-red-400 disabled:opacity-50">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-slate-400 text-sm mb-4">No snapshots.</p>
        )}
        <div className="flex gap-2">
          <input
            value={newSnap}
            onChange={e => setNewSnap(e.target.value)}
            placeholder="Snapshot name"
            className={inputCls('flex-1')}
          />
          <button
            onClick={() => { if (!newSnap) return; act('add-snap', () => api.post(`/vms/${uuid}/snapshots`, { snapshot_name: newSnap })); setNewSnap('') }}
            disabled={saving['add-snap']}
            className="flex items-center gap-1.5 bg-sky-500 hover:bg-sky-400 text-white px-3 py-2 rounded-md text-sm disabled:opacity-50">
            <Camera size={14} /> Create
          </button>
        </div>
      </Section>
    </div>
  )
}
