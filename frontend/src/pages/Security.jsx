import { useState, useEffect, useCallback } from 'react'
import {
  Shield, ShieldAlert, ShieldCheck, ShieldOff,
  Lock, Unlock, UserX, AlertTriangle, CheckCircle, XCircle,
  RefreshCw, Loader2, Terminal, Package, Users, Wifi,
  Eye, EyeOff
} from 'lucide-react'
import api from '../api'

function ScoreRing({ score }) {
  const color = score >= 80 ? '#4ade80' : score >= 50 ? '#facc15' : '#f87171'
  const r = 40
  const circ = 2 * Math.PI * r
  const offset = circ - (score / 100) * circ
  return (
    <div className="relative flex items-center justify-center w-28 h-28">
      <svg width="112" height="112" className="-rotate-90">
        <circle cx="56" cy="56" r={r} fill="none" stroke="#1e293b" strokeWidth="10" />
        <circle cx="56" cy="56" r={r} fill="none" stroke={color} strokeWidth="10"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.8s ease' }} />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-3xl font-bold" style={{ color }}>{score}</span>
        <span className="text-slate-400 text-xs">/100</span>
      </div>
    </div>
  )
}

function Check({ label, ok, warn, detail }) {
  const Icon  = ok ? CheckCircle : warn ? AlertTriangle : XCircle
  const color = ok ? 'text-green-400' : warn ? 'text-yellow-400' : 'text-red-400'
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-navy-700/50 last:border-0">
      <Icon size={16} className={`mt-0.5 flex-shrink-0 ${color}`} />
      <div className="flex-1 min-w-0">
        <span className="text-slate-200 text-sm">{label}</span>
        {detail && <p className="text-slate-500 text-xs mt-0.5">{detail}</p>}
      </div>
    </div>
  )
}

function Section({ icon: Icon, title, children, className = '' }) {
  return (
    <div className={`bg-navy-800 border border-navy-600 rounded-xl overflow-hidden ${className}`}>
      <div className="px-5 py-4 border-b border-navy-600 flex items-center gap-2">
        <Icon size={15} className="text-sky-400" />
        <span className="text-slate-200 text-sm font-semibold">{title}</span>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

function computeScore(d) {
  if (!d) return 0
  let score = 100
  if (!d.ufw_enabled)                                        score -= 15
  if (!d.fail2ban)                                           score -= 10
  if (d.ssh?.permit_root_login === 'yes')                    score -= 15
  if (d.ssh?.permit_empty_pw === 'yes')                      score -= 15
  if (d.ssh?.password_auth === 'yes')                        score -= 5
  if (d.failed_logins > 100)                                 score -= 10
  else if (d.failed_logins > 20)                             score -= 5
  if (d.updates?.security > 0)                               score -= Math.min(d.updates.security * 2, 15)
  if (d.sudo_nopasswd?.length > 2)                           score -= 5
  return Math.max(0, score)
}

export default function Security() {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [showPorts, setShowPorts] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await api.get('/system/security')
      setData(r.data)
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load security data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex items-center justify-center gap-2 py-20 text-slate-400">
      <Loader2 size={20} className="animate-spin" /> Running security checks…
    </div>
  )

  if (error) return (
    <div className="bg-red-900/30 border border-red-700 text-red-300 rounded-xl px-5 py-4 text-sm">{error}</div>
  )

  const score = computeScore(data)
  const scoreLabel = score >= 80 ? 'Good' : score >= 50 ? 'Fair' : 'At Risk'
  const scoreColor = score >= 80 ? 'text-green-400' : score >= 50 ? 'text-yellow-400' : 'text-red-400'

  const ssh = data.ssh || {}
  const rootLoginYes   = ssh.permit_root_login === 'yes'
  const emptyPwYes     = ssh.permit_empty_pw === 'yes'
  const passwdAuthYes  = ssh.password_auth === 'yes'
  const pubkeyYes      = ssh.pubkey_auth !== 'no'

  const updTotal  = data.updates?.total    ?? '?'
  const updSec    = data.updates?.security ?? 0

  return (
    <div className="space-y-5">
      {/* Score + quick stats */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Score */}
        <div className="bg-navy-800 border border-navy-600 rounded-xl p-6 flex items-center gap-5 lg:col-span-1">
          <ScoreRing score={score} />
          <div>
            <div className={`text-2xl font-bold ${scoreColor}`}>{scoreLabel}</div>
            <div className="text-slate-400 text-xs mt-1">Security Score</div>
            <button onClick={load} className="mt-3 flex items-center gap-1 text-xs text-sky-400 hover:text-sky-300">
              <RefreshCw size={11} /> Re-scan
            </button>
          </div>
        </div>

        {/* Quick stats */}
        {[
          {
            label: 'Firewall',
            val: data.ufw_enabled ? 'Active' : 'Inactive',
            ok: data.ufw_enabled,
            icon: data.ufw_enabled ? Shield : ShieldOff,
            color: data.ufw_enabled ? 'green' : 'red',
          },
          {
            label: 'Failed Logins',
            val: data.failed_logins ?? '—',
            ok: (data.failed_logins ?? 0) < 20,
            icon: UserX,
            color: (data.failed_logins ?? 0) > 100 ? 'red' : (data.failed_logins ?? 0) > 20 ? 'yellow' : 'green',
          },
          {
            label: 'Security Updates',
            val: `${updSec} pending`,
            ok: updSec === 0,
            icon: Package,
            color: updSec > 0 ? 'red' : 'green',
          },
        ].map(s => {
          const Icon = s.icon
          const colorMap = { green: { text: 'text-green-400', bg: 'bg-green-400/10' }, red: { text: 'text-red-400', bg: 'bg-red-400/10' }, yellow: { text: 'text-yellow-400', bg: 'bg-yellow-400/10' } }
          const c = colorMap[s.color]
          return (
            <div key={s.label} className="bg-navy-800 border border-navy-600 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-slate-400 text-xs font-medium">{s.label}</span>
                <div className={`p-2 rounded-lg ${c.bg}`}><Icon size={14} className={c.text} /></div>
              </div>
              <div className={`text-2xl font-bold ${c.text}`}>{s.val}</div>
            </div>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* SSH Security */}
        <Section icon={Lock} title="SSH Configuration">
          {ssh.error
            ? <p className="text-slate-500 text-sm">{ssh.error}</p>
            : <>
              <Check
                label="Root login disabled"
                ok={!rootLoginYes} warn={false}
                detail={rootLoginYes ? 'PermitRootLogin yes — set to no or prohibit-password' : `PermitRootLogin: ${ssh.permit_root_login}`}
              />
              <Check
                label="Empty passwords rejected"
                ok={!emptyPwYes} warn={false}
                detail={emptyPwYes ? 'PermitEmptyPasswords yes — should be no' : `PermitEmptyPasswords: ${ssh.permit_empty_pw}`}
              />
              <Check
                label="Public key authentication enabled"
                ok={pubkeyYes} warn={false}
                detail={`PubkeyAuthentication: ${ssh.pubkey_auth}`}
              />
              <Check
                label="Password authentication"
                ok={!passwdAuthYes}
                warn={passwdAuthYes}
                detail={passwdAuthYes ? 'Consider disabling password auth and using keys only' : `PasswordAuthentication: ${ssh.password_auth}`}
              />
              <Check
                label="Non-standard SSH port"
                ok={ssh.port !== '22'}
                warn={ssh.port === '22'}
                detail={`Port: ${ssh.port} — changing from 22 reduces scan noise`}
              />
            </>
          }
        </Section>

        {/* Services */}
        <Section icon={ShieldCheck} title="Security Services">
          <Check label="UFW Firewall active"       ok={data.ufw_enabled}  warn={false} detail={data.ufw_enabled ? 'Firewall is running' : 'Run: sudo ufw enable'} />
          <Check label="Fail2ban running"          ok={data.fail2ban}     warn={false} detail={data.fail2ban ? 'Intrusion prevention active' : 'Install: sudo apt install fail2ban'} />
          <Check label="ClamAV antivirus running"  ok={data.clamav}       warn={true}  detail={data.clamav ? 'ClamAV daemon active' : 'Optional: sudo apt install clamav-daemon'} />
          <Check label="AppArmor running"          ok={data.apparmor}     warn={true}  detail={data.apparmor ? 'Mandatory access control active' : 'Consider enabling AppArmor'} />
          {data.selinux && (
            <Check label="SELinux" ok={data.selinux === 'Enforcing'} warn={data.selinux === 'Permissive'}
              detail={`SELinux mode: ${data.selinux}`} />
          )}
        </Section>

        {/* Pending Updates */}
        <Section icon={Package} title="Pending Updates">
          {data.updates === null
            ? <p className="text-slate-500 text-sm">apt not available on this system.</p>
            : <>
              <div className="flex gap-4 mb-4">
                <div className="bg-navy-700/50 rounded-lg p-3 flex-1 text-center">
                  <div className="text-2xl font-bold text-slate-200">{updTotal}</div>
                  <div className="text-slate-400 text-xs mt-1">Total upgradable</div>
                </div>
                <div className={`rounded-lg p-3 flex-1 text-center ${updSec > 0 ? 'bg-red-900/20' : 'bg-navy-700/50'}`}>
                  <div className={`text-2xl font-bold ${updSec > 0 ? 'text-red-400' : 'text-green-400'}`}>{updSec}</div>
                  <div className="text-slate-400 text-xs mt-1">Security fixes</div>
                </div>
              </div>
              {data.updates.security_list?.length > 0 && (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {data.updates.security_list.map((pkg, i) => (
                    <div key={i} className="text-xs font-mono text-red-300 bg-red-900/10 rounded px-2 py-1 truncate">{pkg}</div>
                  ))}
                </div>
              )}
              {updSec > 0 && (
                <p className="text-yellow-400 text-xs mt-3 flex items-center gap-1">
                  <AlertTriangle size={12} /> Run <code className="bg-navy-700 px-1 rounded">sudo apt upgrade</code> to apply security patches.
                </p>
              )}
            </>
          }
        </Section>

        {/* Logins */}
        <Section icon={Users} title="Recent Logins">
          {data.logged_in?.length > 0 && (
            <div className="mb-3 p-3 bg-navy-700/50 rounded-lg">
              <div className="text-xs text-slate-400 mb-1 font-medium">Currently logged in</div>
              {data.logged_in.map((u, i) => (
                <div key={i} className="text-xs font-mono text-green-300">{u}</div>
              ))}
            </div>
          )}
          <div className="text-xs text-slate-400 mb-2 font-medium">Last logins</div>
          <div className="space-y-1 max-h-52 overflow-y-auto">
            {(data.recent_logins || []).map((l, i) => (
              <div key={i} className="text-xs font-mono text-slate-300 bg-navy-700/30 rounded px-2 py-1">{l}</div>
            ))}
            {(data.recent_logins || []).length === 0 && (
              <p className="text-slate-500 text-sm">No login history available.</p>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <div className={`text-sm font-bold ${(data.failed_logins ?? 0) > 100 ? 'text-red-400' : (data.failed_logins ?? 0) > 20 ? 'text-yellow-400' : 'text-green-400'}`}>
              {data.failed_logins ?? '—'}
            </div>
            <span className="text-slate-400 text-xs">failed SSH login attempts in auth.log</span>
          </div>
        </Section>

        {/* Open Ports */}
        <Section icon={Wifi} title={`Open Listening Ports (${data.open_ports?.length ?? 0})`} className="lg:col-span-2">
          <button
            onClick={() => setShowPorts(v => !v)}
            className="flex items-center gap-2 text-xs text-sky-400 hover:text-sky-300 mb-3"
          >
            {showPorts ? <EyeOff size={13} /> : <Eye size={13} />}
            {showPorts ? 'Hide' : 'Show'} ports
          </button>
          {showPorts && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-navy-700 text-slate-400">
                    <th className="text-left py-2 pr-4 font-medium">Local address</th>
                    <th className="text-left py-2 font-medium">Process</th>
                  </tr>
                </thead>
                <tbody>
                  {(data.open_ports || []).map((p, i) => (
                    <tr key={i} className="border-b border-navy-700/40 hover:bg-navy-700/20">
                      <td className="py-2 pr-4 font-mono text-slate-200">{p.local}</td>
                      <td className="py-2 text-slate-400 font-mono">{p.process || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        {/* Sudo NOPASSWD */}
        {(data.sudo_nopasswd?.length ?? 0) > 0 && (
          <Section icon={ShieldAlert} title="Sudo NOPASSWD Entries" className="lg:col-span-2">
            <div className="flex items-start gap-2 mb-3">
              <AlertTriangle size={15} className="text-yellow-400 mt-0.5 flex-shrink-0" />
              <p className="text-slate-300 text-sm">
                These entries allow passwordless sudo. Review carefully — any entry with <code className="bg-navy-700 px-1 rounded">ALL</code> is a significant privilege escalation risk.
              </p>
            </div>
            <div className="space-y-1">
              {data.sudo_nopasswd.map((entry, i) => (
                <div key={i} className="text-xs font-mono text-yellow-300 bg-yellow-900/10 border border-yellow-900/30 rounded px-3 py-1.5">{entry}</div>
              ))}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
