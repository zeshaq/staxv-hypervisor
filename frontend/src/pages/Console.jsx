import { useEffect, useRef, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import RFB from '@novnc/novnc/lib/rfb'
import {
  Maximize2, Minimize2, Clipboard, Power, RefreshCw,
  Monitor, ChevronLeft, Keyboard, Eye, EyeOff,
} from 'lucide-react'

const RECONNECT_DELAY = 5   // seconds before auto-reconnect attempt
const MAX_RECONNECTS  = 20  // after this many attempts show manual button only

export default function Console() {
  const { uuid } = useParams()
  const screenRef   = useRef(null)
  const rfbRef      = useRef(null)
  const retryTimer  = useRef(null)
  const retryCount  = useRef(0)

  const [status,      setStatus]    = useState('connecting')   // connecting|connected|disconnected|error
  const [vmName,      setVmName]    = useState(uuid?.slice(0, 8))
  const [fullscreen,  setFullscreen]= useState(false)
  const [clipText,    setClipText]  = useState('')
  const [showClip,    setShowClip]  = useState(false)
  const [viewOnly,    setViewOnly]  = useState(false)
  const [countdown,   setCountdown] = useState(0)  // seconds until next reconnect
  const [autoRecon,   setAutoRecon] = useState(true)

  // Fetch VM name
  useEffect(() => {
    fetch(`/api/vms/${uuid}`)
      .then(r => r.json())
      .then(d => { if (d.name) setVmName(d.name) })
      .catch(() => {})
  }, [uuid])

  // ── Connect ────────────────────────────────────────────────────────────────
  const connect = useCallback(() => {
    if (!screenRef.current) return
    // Tear down any existing connection
    if (rfbRef.current) {
      try { rfbRef.current.disconnect() } catch (_) {}
      rfbRef.current = null
    }

    setStatus('connecting')

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const wsUrl = `${proto}://${window.location.host}/ws/vnc/${uuid}`

    let rfb
    try {
      rfb = new RFB(screenRef.current, wsUrl, {
        wsProtocols: ['binary'],
        credentials:  {},
      })
    } catch (e) {
      setStatus('error')
      return
    }

    rfb.scaleViewport  = true
    rfb.resizeSession  = false
    rfb.viewOnly       = viewOnly

    rfb.addEventListener('connect', () => {
      retryCount.current = 0
      setStatus('connected')
      setCountdown(0)
    })

    rfb.addEventListener('disconnect', e => {
      const clean = e.detail?.clean
      setStatus(clean ? 'disconnected' : 'error')
      scheduleReconnect()
    })

    rfb.addEventListener('credentialsrequired', () => {
      rfb.sendCredentials({ password: '' })
    })

    rfb.addEventListener('desktopname', e => {
      if (e.detail?.name) setVmName(e.detail.name)
    })

    rfbRef.current = rfb
  }, [uuid, viewOnly])  // eslint-disable-line

  // ── Auto reconnect ─────────────────────────────────────────────────────────
  const scheduleReconnect = useCallback(() => {
    if (!autoRecon) return
    retryCount.current += 1
    if (retryCount.current > MAX_RECONNECTS) return

    let secs = RECONNECT_DELAY
    setCountdown(secs)

    const tick = () => {
      secs -= 1
      setCountdown(secs)
      if (secs <= 0) {
        connect()
      } else {
        retryTimer.current = setTimeout(tick, 1000)
      }
    }
    retryTimer.current = setTimeout(tick, 1000)
  }, [autoRecon, connect])

  // Initial connect
  useEffect(() => {
    connect()
    return () => {
      clearTimeout(retryTimer.current)
      if (rfbRef.current) {
        try { rfbRef.current.disconnect() } catch (_) {}
      }
    }
  }, [uuid])  // only re-run when uuid changes

  // Sync viewOnly
  useEffect(() => {
    if (rfbRef.current) rfbRef.current.viewOnly = viewOnly
  }, [viewOnly])

  // Fullscreen listener
  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {})
      setFullscreen(true)
    } else {
      document.exitFullscreen()
      setFullscreen(false)
    }
  }

  const pasteToVm = () => {
    if (rfbRef.current && clipText) {
      rfbRef.current.clipboardPasteFrom(clipText)
    }
    setShowClip(false)
  }

  const sendCAD = () => rfbRef.current?.sendCtrlAltDel()

  const manualReconnect = () => {
    clearTimeout(retryTimer.current)
    retryCount.current = 0
    setCountdown(0)
    connect()
  }

  const STATUS_DOT = {
    connecting:   { color: 'text-sky-400',     dot: 'bg-sky-400',     label: 'Connecting…' },
    connected:    { color: 'text-emerald-400',  dot: 'bg-emerald-400', label: 'Connected' },
    disconnected: { color: 'text-slate-400',    dot: 'bg-slate-500',   label: 'Disconnected' },
    error:        { color: 'text-red-400',      dot: 'bg-red-400',     label: 'Connection failed' },
  }
  const s = STATUS_DOT[status] || STATUS_DOT.error

  const isOff = status === 'disconnected' || status === 'error'
  const tooManyRetries = retryCount.current > MAX_RECONNECTS

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white select-none overflow-hidden">

      {/* ── Top bar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-3 py-2 bg-[#0f1117] border-b border-[#1e2433] flex-shrink-0 z-10">
        <button
          onClick={() => window.close()}
          className="p-1.5 rounded text-slate-500 hover:text-slate-200 hover:bg-[#1e2433] transition-colors"
          title="Close tab"
        >
          <ChevronLeft size={16}/>
        </button>

        <Monitor size={14} className="text-sky-400 flex-shrink-0"/>
        <span className="text-slate-200 font-medium text-sm flex-1 truncate">{vmName}</span>

        {/* Status pill */}
        <div className={`flex items-center gap-1.5 text-xs font-medium ${s.color} flex-shrink-0`}>
          <span className={`w-1.5 h-1.5 rounded-full ${s.dot} ${status === 'connecting' ? 'animate-pulse' : ''}`}/>
          {s.label}
          {isOff && countdown > 0 && (
            <span className="text-slate-500 ml-1">· reconnecting in {countdown}s</span>
          )}
        </div>

        <div className="flex items-center gap-0.5 ml-1 flex-shrink-0">

          {/* Ctrl+Alt+Del */}
          <button
            onClick={sendCAD}
            disabled={status !== 'connected'}
            className="px-2 py-1 text-xs rounded text-slate-400 hover:text-slate-200 hover:bg-[#1e2433] disabled:opacity-30 transition-colors font-mono"
            title="Send Ctrl+Alt+Del"
          >
            C+A+D
          </button>

          {/* Keyboard shortcut helper */}
          <button
            onClick={() => setViewOnly(v => !v)}
            className={`p-1.5 rounded transition-colors ${
              viewOnly
                ? 'bg-amber-500/20 text-amber-400'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#1e2433]'
            }`}
            title={viewOnly ? 'View only — click to enable input' : 'Input enabled'}
          >
            {viewOnly ? <Eye size={14}/> : <EyeOff size={14}/>}
          </button>

          {/* Clipboard */}
          <div className="relative">
            <button
              onClick={() => setShowClip(s => !s)}
              disabled={status !== 'connected'}
              className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-[#1e2433] disabled:opacity-30 transition-colors"
              title="Paste text to VM"
            >
              <Clipboard size={14}/>
            </button>
            {showClip && (
              <div className="absolute right-0 top-9 w-72 bg-[#1a1f2e] border border-[#2a3348] rounded-xl shadow-2xl p-3 z-50">
                <p className="text-xs text-slate-400 mb-2">Text to paste into VM</p>
                <textarea
                  className="w-full h-24 bg-[#0f1117] border border-[#2a3348] rounded-lg px-2.5 py-2 text-sm text-slate-100 resize-none focus:outline-none focus:border-sky-500"
                  value={clipText}
                  onChange={e => setClipText(e.target.value)}
                  placeholder="Type or paste here…"
                  autoFocus
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={pasteToVm}
                    className="flex-1 py-1.5 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium transition-colors"
                  >
                    Send to VM
                  </button>
                  <button
                    onClick={() => setShowClip(false)}
                    className="px-3 py-1.5 text-slate-400 hover:text-slate-200 rounded-lg hover:bg-[#1e2433] transition-colors text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Auto-reconnect toggle */}
          <button
            onClick={() => setAutoRecon(v => !v)}
            className={`p-1.5 rounded text-xs transition-colors ${
              autoRecon
                ? 'text-sky-400 hover:bg-[#1e2433]'
                : 'text-slate-600 hover:text-slate-400 hover:bg-[#1e2433]'
            }`}
            title={autoRecon ? 'Auto-reconnect ON' : 'Auto-reconnect OFF'}
          >
            <RefreshCw size={13} className={status === 'connecting' ? 'animate-spin' : ''}/>
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded text-slate-400 hover:text-slate-200 hover:bg-[#1e2433] transition-colors"
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}
          </button>
        </div>
      </div>

      {/* ── VNC canvas ───────────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden bg-black">
        {/* Connecting overlay */}
        {status === 'connecting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 pointer-events-none">
            <div className="w-8 h-8 border-2 border-sky-500/30 border-t-sky-400 rounded-full animate-spin"/>
            <p className="text-slate-400 text-sm">Connecting to <span className="text-slate-200">{vmName}</span>…</p>
            {retryCount.current > 0 && (
              <p className="text-slate-600 text-xs">Attempt {retryCount.current}</p>
            )}
          </div>
        )}

        {/* Disconnected/error overlay */}
        {isOff && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 z-10 bg-black/70 backdrop-blur-sm">
            <Power size={32} className={status === 'error' ? 'text-red-500/70' : 'text-slate-600'}/>
            <p className="text-slate-200 font-semibold text-base">
              {status === 'error' ? 'Connection failed' : 'Disconnected'}
            </p>
            <p className="text-slate-500 text-sm text-center max-w-xs">
              {status === 'error'
                ? 'The VM may be stopped or VNC is not available.'
                : 'The VM disconnected — it may be rebooting or shutting down.'}
            </p>

            {countdown > 0 && !tooManyRetries && (
              <div className="flex items-center gap-2 mt-1">
                <div className="w-3 h-3 border border-sky-500/40 border-t-sky-400 rounded-full animate-spin text-xs"/>
                <span className="text-sky-400 text-sm">Reconnecting in {countdown}s…</span>
                <button
                  onClick={() => { clearTimeout(retryTimer.current); setCountdown(0) }}
                  className="text-xs text-slate-600 hover:text-slate-400 underline ml-1"
                >
                  cancel
                </button>
              </div>
            )}

            <button
              onClick={manualReconnect}
              className="mt-2 flex items-center gap-2 px-5 py-2.5 bg-sky-600 hover:bg-sky-500 rounded-lg text-sm font-medium transition-colors"
            >
              <RefreshCw size={14}/> Reconnect now
            </button>
          </div>
        )}

        {/* noVNC mounts here */}
        <div
          ref={screenRef}
          className="w-full h-full"
          style={{ cursor: status === 'connected' ? 'none' : 'default' }}
        />
      </div>
    </div>
  )
}
