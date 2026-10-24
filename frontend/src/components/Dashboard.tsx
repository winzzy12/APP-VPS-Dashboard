import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react'
import { api } from '../api'
import type { Server, User } from '../types'
import ServerDetail from './ServerDetail'
import SSHTerminal from './SSHTerminal'
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Clock,
  Eye,
  EyeOff,
  Globe,
  Logo,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Server as ServerIcon,
  Terminal as TerminalIcon,
  Trash,
  X,
  Zap,
  Power,
} from './Icons'

type Toast = { id: number; kind: 'success' | 'error'; message: string }
type Editing = { mode: 'add' } | { mode: 'edit'; server: Server }

const EMPTY_FORM = {
  name: '',
  host: '',
  port: '22',
  ssh_user: 'root',
  ssh_password: '',
  os: '',
  notes: '',
}

function fmtUptime(seconds: number | null): string {
  if (seconds == null) return '—'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function relTime(iso: string | null): string {
  if (!iso) return 'never'
  const t = new Date(iso.replace(' ', 'T') + 'Z').getTime()
  if (Number.isNaN(t)) return '—'
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function StatusPill({ server }: { server: Server }) {
  if (server.status === 'online') {
    return (
      <span className="pill online">
        <span className="dot" />
        Online
        {server.latency_ms != null && <em>{server.latency_ms} ms</em>}
      </span>
    )
  }
  if (server.status === 'offline') {
    return (
      <span className="pill offline">
        <span className="dot" />
        Offline
      </span>
    )
  }
  return (
    <span className="pill unknown">
      <span className="dot" />
      Unknown
    </span>
  )
}

function MiniMetric({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>
  const level = value >= 90 ? 'crit' : value >= 70 ? 'warn' : 'ok'
  return (
    <div className="mini-metric">
      <span className="mini-bar">
        <i className={level} style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      <span className="mini-val">{Math.round(value * 10) / 10}%</span>
    </div>
  )
}

export default function Dashboard({
  user,
  onLogout,
}: {
  user: User
  onLogout: () => void
}) {
  const [servers, setServers] = useState<Server[]>([])
  const [loaded, setLoaded] = useState(false)
  const [checkingAll, setCheckingAll] = useState(false)
  const [checkingIds, setCheckingIds] = useState<ReadonlySet<number>>(new Set())
  const [editing, setEditing] = useState<Editing | null>(null)
  const [deleting, setDeleting] = useState<Server | null>(null)
  const [detailId, setDetailId] = useState<number | null>(null)
  const [termId, setTermId] = useState<number | null>(null)
  const [rebooting, setRebooting] = useState<Server | null>(null)
  const [rebootBusy, setRebootBusy] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextToastId = useRef(1)

  const toast = useCallback((kind: Toast['kind'], message: string) => {
    const id = nextToastId.current++
    setToasts((list) => [...list, { id, kind, message }])
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 4000)
  }, [])

  const load = useCallback(async () => {
    try {
      setServers(await api<Server[]>('/servers'))
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to load servers')
    } finally {
      setLoaded(true)
    }
  }, [toast])

  const checkAll = useCallback(async () => {
    setCheckingAll(true)
    try {
      setServers(await api<Server[]>('/servers/check-all', { method: 'POST' }))
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Status check failed')
    } finally {
      setCheckingAll(false)
    }
  }, [toast])

  const checkOne = useCallback(
    async (server: Server) => {
      setCheckingIds((ids) => new Set(ids).add(server.id))
      try {
        const updated = await api<Server>(`/servers/${server.id}/check`, {
          method: 'POST',
        })
        setServers((list) => list.map((s) => (s.id === updated.id ? updated : s)))
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Check failed')
      } finally {
        setCheckingIds((ids) => {
          const next = new Set(ids)
          next.delete(server.id)
          return next
        })
      }
    },
    [toast],
  )

  const remove = useCallback(
    async (server: Server) => {
      try {
        await api(`/servers/${server.id}`, { method: 'DELETE' })
        setServers((list) => list.filter((s) => s.id !== server.id))
        toast('success', `"${server.name}" deleted`)
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Delete failed')
      } finally {
        setDeleting(null)
      }
    },
    [toast],
  )

  const handleSaved = useCallback(
    async (message: string) => {
      setEditing(null)
      toast('success', message)
      await load()
      await checkAll()
    },
    [toast, load, checkAll],
  )

  const handleDetailUpdate = useCallback((updated: Server) => {
    setServers((list) => list.map((s) => (s.id === updated.id ? updated : s)))
  }, [])

  const closeTerm = useCallback(() => setTermId(null), [])

  const reboot = useCallback(
    async (server: Server) => {
      setRebootBusy(true)
      try {
        const res = await api<{ ok: boolean; message: string }>(
          `/servers/${server.id}/reboot`,
          { method: 'POST' },
        )
        toast('success', res.message || `Reboot command sent to "${server.name}"`)
        setServers((list) =>
          list.map((s) => (s.id === server.id ? { ...s, status: 'unknown' as const } : s)),
        )
        void checkAll()
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Reboot failed')
      } finally {
        setRebootBusy(false)
        setRebooting(null)
      }
    },
    [toast, checkAll],
  )

  useEffect(() => {
    void load().then(() => void checkAll())
    const iv = setInterval(() => {
      if (!document.hidden) void checkAll()
    }, 30_000)
    return () => clearInterval(iv)
  }, [load, checkAll])

  const stats = useMemo(() => {
    const online = servers.filter((s) => s.status === 'online')
    const latencies = online
      .map((s) => s.latency_ms)
      .filter((n): n is number => n != null)
    return {
      total: servers.length,
      online: online.length,
      offline: servers.filter((s) => s.status === 'offline').length,
      avgLatency: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null,
    }
  }, [servers])

  const detailServer =
    detailId != null ? (servers.find((s) => s.id === detailId) ?? null) : null
  const termServer =
    termId != null ? (servers.find((s) => s.id === termId) ?? null) : null

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Logo size={34} />
          <div>
            <strong>VPS Dashboard</strong>
            <span>Fleet manager</span>
          </div>
        </div>
        <nav className="nav">
          <button className="nav-item active">
            <ServerIcon size={18} />
            Servers
          </button>
        </nav>
        <div className="sidebar-foot">
          <div className="user-chip">
            <span className="avatar">{user.username.charAt(0)}</span>
            <div className="user-meta">
              <strong>{user.username}</strong>
              <span>Administrator</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onLogout} title="Sign out" aria-label="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>Servers</h1>
            <p className="subtitle">
              {stats.online} of {stats.total} online · auto-check every 30s
            </p>
          </div>
          <div className="topbar-actions">
            <button
              className="btn btn-ghost"
              onClick={() => void checkAll()}
              disabled={checkingAll}
            >
              <RefreshCw size={16} className={checkingAll ? 'spin' : undefined} />
              {checkingAll ? 'Checking…' : 'Refresh status'}
            </button>
            <button className="btn btn-primary" onClick={() => setEditing({ mode: 'add' })}>
              <Plus size={16} />
              Add server
            </button>
          </div>
        </header>

        <section className="stats">
          <div className="stat-card">
            <span className="stat-icon indigo">
              <ServerIcon size={18} />
            </span>
            <div>
              <strong>{stats.total}</strong>
              <span>Total servers</span>
            </div>
          </div>
          <div className="stat-card">
            <span className="stat-icon green">
              <CheckCircle size={18} />
            </span>
            <div>
              <strong>{stats.online}</strong>
              <span>Online</span>
            </div>
          </div>
          <div className="stat-card">
            <span className="stat-icon red">
              <AlertTriangle size={18} />
            </span>
            <div>
              <strong>{stats.offline}</strong>
              <span>Offline</span>
            </div>
          </div>
          <div className="stat-card">
            <span className="stat-icon cyan">
              <Zap size={18} />
            </span>
            <div>
              <strong>{stats.avgLatency != null ? `${stats.avgLatency} ms` : '—'}</strong>
              <span>Avg response</span>
            </div>
          </div>
        </section>

        <section className="panel">
          {!loaded ? (
            <div className="skeleton-rows">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton-row">
                  <span className="skeleton w-40" />
                  <span className="skeleton w-24" />
                  <span className="skeleton w-32" />
                </div>
              ))}
            </div>
          ) : servers.length === 0 ? (
            <div className="empty">
              <ServerIcon size={44} className="empty-icon" />
              <h3>No servers yet</h3>
              <p>
                Add your first VPS to monitor reachability and system metrics.
              </p>
              <button className="btn btn-primary" onClick={() => setEditing({ mode: 'add' })}>
                <Plus size={16} />
                Add server
              </button>
            </div>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>SSH user</th>
                  <th>CPU</th>
                  <th>RAM</th>
                  <th>Status</th>
                  <th>Uptime</th>
                  <th className="th-actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {servers.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="server-cell">
                        <button className="link-name" onClick={() => setDetailId(s.id)}>
                          {s.name}
                        </button>
                        <span>
                          <Globe size={13} /> {s.host}:{s.port}
                        </span>
                        {s.os && <em className="os-badge">{s.os}</em>}
                      </div>
                    </td>
                    <td className="muted">{s.ssh_user}</td>
                    <td>
                      <MiniMetric value={s.cpu_percent} />
                    </td>
                    <td>
                      <MiniMetric value={s.mem_percent} />
                    </td>
                    <td>
                      <StatusPill server={s} />
                    </td>
                    <td className="muted">
                      <span
                        title={
                          s.last_checked
                            ? `Last checked ${relTime(s.last_checked)}`
                            : 'Never checked'
                        }
                      >
                        <Clock size={13} className="inline-icon" /> {fmtUptime(s.uptime_seconds)}
                      </span>
                    </td>
                    <td>
                      <div className="row-actions">
                        {s.ssh_status === 'error' && (
                          <button
                            className="icon-btn danger"
                            title={s.last_error ?? 'SSH error'}
                            onClick={() => setDetailId(s.id)}
                          >
                            <AlertTriangle size={16} />
                          </button>
                        )}
                        <button
                          className="icon-btn"
                          title="Metrics & charts"
                          onClick={() => setDetailId(s.id)}
                        >
                          <Activity size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title="SSH terminal"
                          onClick={() => setTermId(s.id)}
                        >
                          <TerminalIcon size={16} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title="Reboot"
                          onClick={() => setRebooting(s)}
                        >
                          <Power size={16} />
                        </button>
                        <button
                          className="icon-btn"
                          title="Check now"
                          onClick={() => void checkOne(s)}
                          disabled={checkingIds.has(s.id)}
                        >
                          <RefreshCw
                            size={16}
                            className={checkingIds.has(s.id) ? 'spin' : undefined}
                          />
                        </button>
                        <button
                          className="icon-btn"
                          title="Edit"
                          onClick={() => setEditing({ mode: 'edit', server: s })}
                        >
                          <Pencil size={16} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title="Delete"
                          onClick={() => setDeleting(s)}
                        >
                          <Trash size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>

      {editing && (
        <ServerModal
          initial={editing.mode === 'edit' ? editing.server : null}
          onClose={() => setEditing(null)}
          onSaved={(m) => void handleSaved(m)}
        />
      )}

      {deleting && (
        <div
          className="overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setDeleting(null)}
        >
          <div className="modal modal-sm">
            <header className="modal-head">
              <h3>Delete server</h3>
              <button className="icon-btn" onClick={() => setDeleting(null)} aria-label="Close">
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <p className="confirm-text">
                Delete <strong>{deleting.name}</strong> ({deleting.host})? This cannot be
                undone.
              </p>
            </div>
            <footer className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setDeleting(null)}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void remove(deleting)}>
                Delete
              </button>
            </footer>
          </div>
        </div>
      )}

      {rebooting && (
        <div
          className="overlay"
          onMouseDown={(e) => e.target === e.currentTarget && setRebooting(null)}
        >
          <div className="modal modal-sm">
            <header className="modal-head">
              <h3>Reboot server</h3>
              <button className="icon-btn" onClick={() => setRebooting(null)} aria-label="Close">
                <X size={18} />
              </button>
            </header>
            <div className="modal-body">
              <p className="confirm-text">
                Reboot <strong>{rebooting.name}</strong> ({rebooting.host}) over SSH now? The
                server will be unreachable for a few minutes.
              </p>
            </div>
            <footer className="modal-foot">
              <button className="btn btn-ghost" onClick={() => setRebooting(null)}>
                Cancel
              </button>
              <button
                className="btn btn-danger"
                onClick={() => void reboot(rebooting)}
                disabled={rebootBusy}
              >
                {rebootBusy ? <span className="spinner spinner-sm light" /> : 'Reboot now'}
              </button>
            </footer>
          </div>
        </div>
      )}

      {detailServer && (
        <ServerDetail
          server={detailServer}
          onClose={() => setDetailId(null)}
          onUpdated={handleDetailUpdate}
          onOpenTerminal={() => setTermId(detailServer.id)}
          onRebootRequest={() => {
            setDetailId(null)
            setRebooting(detailServer)
          }}
          toast={toast}
        />
      )}

      {termServer && <SSHTerminal server={termServer} onClose={closeTerm} />}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.kind === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ServerModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: Server | null
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const [form, setForm] = useState(
    initial
      ? {
          name: initial.name,
          host: initial.host,
          port: String(initial.port),
          ssh_user: initial.ssh_user,
          ssh_password: '',
          os: initial.os,
          notes: initial.notes,
        }
      : EMPTY_FORM,
  )
  const [showPw, setShowPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set =
    (key: keyof typeof EMPTY_FORM) =>
    (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    const payload = {
      name: form.name.trim(),
      host: form.host.trim(),
      port: Number(form.port) || 22,
      ssh_user: form.ssh_user.trim() || 'root',
      ssh_password: form.ssh_password,
      os: form.os.trim(),
      notes: form.notes.trim(),
    }
    try {
      if (initial) await api(`/servers/${initial.id}`, { method: 'PUT', body: payload })
      else await api('/servers', { method: 'POST', body: payload })
      onSaved(initial ? `"${payload.name}" updated` : `"${payload.name}" added`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setSaving(false)
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <form className="modal" onSubmit={submit}>
        <header className="modal-head">
          <h3>{initial ? 'Edit server' : 'Add server'}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body">
          <div className="grid-2">
            <label className="field">
              <span>Name *</span>
              <input
                value={form.name}
                onChange={set('name')}
                placeholder="edge-01"
                required
                autoFocus
              />
            </label>
            <label className="field">
              <span>Host / IP *</span>
              <input value={form.host} onChange={set('host')} placeholder="203.0.113.10" required />
            </label>
            <label className="field">
              <span>SSH port</span>
              <input value={form.port} onChange={set('port')} inputMode="numeric" />
            </label>
            <label className="field">
              <span>SSH user</span>
              <input value={form.ssh_user} onChange={set('ssh_user')} placeholder="root" />
            </label>
            <label className="field field-wide">
              <span>
                SSH password{initial && initial.has_credentials ? ' — leave blank to keep' : ''}
              </span>
              <div className="pw-wrap">
                <input
                  type={showPw ? 'text' : 'password'}
                  value={form.ssh_password}
                  onChange={set('ssh_password')}
                  placeholder="Used to collect CPU / RAM / disk metrics"
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="pw-toggle"
                  onClick={() => setShowPw((v) => !v)}
                  aria-label="Toggle password visibility"
                >
                  {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </label>
            <label className="field field-wide">
              <span>OS</span>
              <input value={form.os} onChange={set('os')} placeholder="Ubuntu 24.04" />
            </label>
            <label className="field field-wide">
              <span>Notes</span>
              <textarea
                value={form.notes}
                onChange={set('notes')}
                rows={3}
                placeholder="Location, provider, purpose…"
              />
            </label>
          </div>
          <p className="form-note">
            The SSH password is stored encrypted and never displayed again. The host key is
            pinned on first connect (TOFU) — a changed key blocks collection until you reset
            it.
          </p>
          {error && <div className="form-error">{error}</div>}
        </div>
        <footer className="modal-foot">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={saving || !form.name.trim() || !form.host.trim()}
          >
            {saving ? (
              <span className="spinner spinner-sm light" />
            ) : initial ? (
              'Save changes'
            ) : (
              'Add server'
            )}
          </button>
        </footer>
      </form>
    </div>
  )
}
