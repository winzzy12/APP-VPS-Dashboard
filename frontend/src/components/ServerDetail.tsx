import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { MetricsPoint, MetricsResponse, Server } from '../types'
import { AreaChart } from './Chart'
import {
  Activity,
  AlertTriangle,
  Power,
  Terminal as TerminalIcon,
  X,
} from './Icons'

function fmtPct(v: number | null | undefined): string {
  return v == null ? '—' : `${Math.round(v * 10) / 10}%`
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

function fmtMB(mb: number | null): string {
  if (mb == null) return '—'
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`
}

export default function ServerDetail({
  server,
  onClose,
  onUpdated,
  onOpenTerminal,
  onRebootRequest,
  toast,
}: {
  server: Server
  onClose: () => void
  onUpdated: (server: Server) => void
  onOpenTerminal: () => void
  onRebootRequest: () => void
  toast: (kind: 'success' | 'error', message: string) => void
}) {
  const [history, setHistory] = useState<MetricsPoint[]>([])
  const [intervalSec, setIntervalSec] = useState(15)
  const [busy, setBusy] = useState<'test' | 'reset' | 'collect' | null>(null)

  const refresh = useCallback(async () => {
    try {
      const res = await api<MetricsResponse>(`/servers/${server.id}/metrics`)
      setHistory(res.history)
      setIntervalSec(res.interval)
    } catch {
      /* transient — next poll retries */
    }
  }, [server.id])

  useEffect(() => {
    void refresh()
    const iv = setInterval(() => void refresh(), 5000)
    return () => clearInterval(iv)
  }, [refresh])

  const collect = useCallback(async () => {
    setBusy('collect')
    try {
      const updated = await api<Server>(`/servers/${server.id}/collect`, {
        method: 'POST',
      })
      onUpdated(updated)
      await refresh()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Collect failed')
    } finally {
      setBusy(null)
    }
  }, [server.id, onUpdated, refresh, toast])

  const test = useCallback(async () => {
    setBusy('test')
    try {
      const res = await api<{ ok: boolean; error: string | null }>(
        `/servers/${server.id}/test`,
        { method: 'POST' },
      )
      toast(
        res.ok ? 'success' : 'error',
        res.ok ? 'SSH connection OK' : (res.error ?? 'SSH test failed'),
      )
      await refresh()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'SSH test failed')
    } finally {
      setBusy(null)
    }
  }, [server.id, refresh, toast])

  const resetKey = useCallback(async () => {
    setBusy('reset')
    try {
      await api(`/servers/${server.id}/reset-host-key`, { method: 'POST' })
      toast('success', 'Stored host key cleared — reconnecting')
      const res = await api<{ ok: boolean; error: string | null }>(
        `/servers/${server.id}/test`,
        { method: 'POST' },
      )
      toast(
        res.ok ? 'success' : 'error',
        res.ok ? 'SSH connection OK' : (res.error ?? 'SSH test failed'),
      )
      await refresh()
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setBusy(null)
    }
  }, [server.id, refresh, toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const cpuData = history.map((h) => h.cpu_percent)
  const memData = history.map((h) => h.mem_percent)
  const latest = history.length ? history[history.length - 1] : null
  const sshError = server.ssh_status === 'error'

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal modal-lg detail">
        <header className="modal-head">
          <div className="detail-title">
            <h3>{server.name}</h3>
            <span className="detail-host">
              {server.host}:{server.port} · {server.ssh_user}
            </span>
          </div>
          <div className="detail-head-actions">
            <button
              className="icon-btn"
              title="SSH terminal"
              onClick={() => {
                onClose()
                onOpenTerminal()
              }}
            >
              <TerminalIcon size={16} />
            </button>
            <button
              className="icon-btn danger"
              title="Reboot server"
              onClick={() => {
                onClose()
                onRebootRequest()
              }}
            >
              <Power size={16} />
            </button>
            <button
              className="icon-btn"
              title="Collect now"
              onClick={() => void collect()}
              disabled={busy !== null}
            >
              <Activity size={16} className={busy === 'collect' ? 'spin' : undefined} />
            </button>
            <button className="icon-btn" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </header>
        <div className="modal-body">
          {sshError && (
            <div className="ssh-error">
              <AlertTriangle size={16} />
              <span>{server.last_error ?? 'SSH error'}</span>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => void test()}
                disabled={busy !== null}
              >
                Test again
              </button>
              <button
                className="btn btn-ghost btn-xs"
                onClick={() => void resetKey()}
                disabled={busy !== null}
              >
                Reset host key
              </button>
            </div>
          )}
          {server.ssh_status === 'none' && (
            <div className="ssh-hint">
              No SSH password stored — edit this server and add one to enable
              metrics.
            </div>
          )}
          {server.ssh_status === 'unknown' && (
            <div className="ssh-hint">
              Credentials stored — waiting for the first metrics sample…
            </div>
          )}

          <div className="info-grid">
            <div className="info-box">
              <span>CPU</span>
              <strong>{fmtPct(server.cpu_percent)}</strong>
            </div>
            <div className="info-box">
              <span>RAM</span>
              <strong>{fmtPct(server.mem_percent)}</strong>
              <em>
                {fmtMB(server.mem_used_mb)} / {fmtMB(server.mem_total_mb)}
              </em>
            </div>
            <div className="info-box">
              <span>Disk (/)</span>
              <strong>{fmtPct(server.disk_percent)}</strong>
              <em>
                {server.disk_used_gb ?? '—'} / {server.disk_total_gb ?? '—'} GB
              </em>
              {server.disk_percent != null && (
                <span className="disk-bar">
                  <i style={{ width: `${Math.min(100, server.disk_percent)}%` }} />
                </span>
              )}
            </div>
            <div className="info-box">
              <span>Uptime</span>
              <strong>{fmtUptime(server.uptime_seconds)}</strong>
              <em>
                {server.last_reboot ? `since ${server.last_reboot}` : 'last reboot unknown'}
              </em>
            </div>
          </div>

          <div className="charts">
            <div className="chart-card">
              <header>
                CPU
                <strong>{fmtPct(latest?.cpu_percent ?? server.cpu_percent)}</strong>
              </header>
              <AreaChart data={cpuData} color="#22d3ee" gradientId="grad-cpu" />
            </div>
            <div className="chart-card">
              <header>
                RAM
                <strong>{fmtPct(latest?.mem_percent ?? server.mem_percent)}</strong>
              </header>
              <AreaChart data={memData} color="#a78bfa" gradientId="grad-mem" />
            </div>
          </div>

          <p className="detail-foot">
            {server.ssh_status === 'ok'
              ? `Sampled every ${intervalSec}s over SSH · in-memory history (last hour)`
              : 'Charts appear once metrics collection succeeds.'}
          </p>
        </div>
      </div>
    </div>
  )
}
