import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { getToken } from '../api'
import type { Server } from '../types'
import { Terminal as TerminalIcon, Minus, X } from './Icons'

export default function SSHTerminal({
  server,
  onClose,
  onMinimize,
}: {
  server: Server
  onClose: () => void
  onMinimize: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily:
        "ui-monospace, 'SF Mono', 'Cascadia Code', Menlo, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      scrollback: 5000,
      theme: {
        background: '#0b1120',
        foreground: '#e8ecf4',
        cursor: '#22d3ee',
        cursorAccent: '#0b1120',
        selectionBackground: 'rgba(99, 102, 241, 0.4)',
        black: '#0b1120',
        red: '#f87171',
        green: '#34d399',
        yellow: '#fbbf24',
        blue: '#60a5fa',
        magenta: '#c084fc',
        cyan: '#22d3ee',
        white: '#e8ecf4',
      },
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(container)
    try {
      fit.fit()
    } catch {
      /* container not laid out yet */
    }

    // The WebSocket can die from outside our control (phone screen lock /
    // tab freeze, Wi-Fi or VPN switch, dashboard restarts). Auto-reconnect
    // instead of showing a dead terminal; only an explicit close ends it.
    let disposed = false // component unmounted (user closed the terminal)
    let ws: WebSocket | null = null
    let ready = false
    let attempts = 0
    let reconnectTimer: number | undefined
    let pingTimer: number | undefined
    let pongTimer: number | undefined
    let roTimer: number | undefined

    const clearTimers = () => {
      window.clearInterval(pingTimer)
      window.clearTimeout(pongTimer)
      window.clearTimeout(reconnectTimer)
    }

    const sendResize = () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }

    const startHeartbeat = () => {
      window.clearInterval(pingTimer)
      window.clearTimeout(pongTimer)
      pingTimer = window.setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }))
          // No pong = half-open TCP (sleep, network switch) — force close so
          // the reconnect path kicks in instead of a silently dead terminal.
          window.clearTimeout(pongTimer)
          pongTimer = window.setTimeout(() => {
            if (ws && ws.readyState === WebSocket.OPEN) ws.close()
          }, 10000)
        }
      }, 25000)
    }

    const connect = () => {
      if (disposed) return
      let alive = false // ready handshake completed on this socket
      let fatal = false // SSH-level refusal (bad token/credentials) — no retry
      const sock = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/servers/${server.id}/terminal`,
      )
      ws = sock

      sock.onopen = () => {
        sock.send(JSON.stringify({ type: 'auth', token: getToken() }))
      }

      sock.onmessage = (ev: MessageEvent) => {
        let parsed: { type?: string; message?: string } | null = null
        try {
          parsed = JSON.parse(ev.data)
        } catch {
          /* raw PTY output */
        }
        if (parsed?.type === 'pong') {
          window.clearTimeout(pongTimer)
          return
        }
        if (!alive) {
          if (parsed?.type === 'ready') {
            alive = true
            ready = true
            attempts = 0
            sendResize()
            term.focus()
            startHeartbeat()
            return
          }
          if (parsed?.type === 'error') {
            fatal = true
            term.write(`\r\n\x1b[31m${parsed.message ?? 'SSH error'}\x1b[0m\r\n`)
            return
          }
        }
        term.write(ev.data)
      }

      sock.onclose = () => {
        if (ws === sock) {
          ws = null
          ready = false
        }
        window.clearInterval(pingTimer)
        window.clearTimeout(pongTimer)
        if (disposed || fatal) return
        attempts += 1
        const delay = Math.min(1000 * 2 ** (attempts - 1), 10000)
        if (alive) {
          term.write(
            `\r\n\x1b[90m— connection lost — reconnecting in ${Math.round(delay / 1000)}s —\x1b[0m\r\n`,
          )
        }
        reconnectTimer = window.setTimeout(connect, delay)
      }
    }

    connect()

    term.onData((data) => {
      if (ws && ws.readyState === WebSocket.OPEN && ready) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    term.onResize(() => sendResize())

    const ro = new ResizeObserver(() => {
      window.clearTimeout(roTimer)
      roTimer = window.setTimeout(() => {
        try {
          fit.fit()
        } catch {
          /* noop */
        }
      }, 50)
    })
    ro.observe(container)

    // On phones the keyboard shrinks only the VISUAL viewport (layout stays
    // put), so a plain ResizeObserver never fires and the bottom of the
    // terminal hides behind the keyboard. Resize the modal to the visual
    // viewport instead.
    const modal = modalRef.current
    const vv = window.visualViewport
    const onVV = () => {
      if (!modal) return
      const h = vv
        ? Math.max(240, Math.min(window.innerHeight * 0.86, vv.height - 24))
        : Math.min(window.innerHeight * 0.86, window.innerHeight - 40)
      modal.style.height = `${h}px`
      window.clearTimeout(roTimer)
      roTimer = window.setTimeout(() => {
        try {
          fit.fit()
        } catch {
          /* noop */
        }
      }, 50)
    }
    if (vv) {
      vv.addEventListener('resize', onVV)
      vv.addEventListener('scroll', onVV)
    }
    onVV()

    return () => {
      disposed = true
      clearTimers()
      ro.disconnect()
      if (vv) {
        vv.removeEventListener('resize', onVV)
        vv.removeEventListener('scroll', onVV)
      }
      window.clearTimeout(roTimer)
      try {
        ws?.close()
      } catch {
        /* noop */
      }
      term.dispose()
    }
  }, [server.id])

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onMinimize()}
    >
      <div className="modal modal-xl term-modal" ref={modalRef}>
        <header className="modal-head term-head">
          <div className="detail-title">
            <h3>
              <TerminalIcon size={16} /> {server.name}
            </h3>
            <span className="detail-host">
              {server.ssh_user}@{server.host}:{server.port}
            </span>
          </div>
          <button
            className="icon-btn"
            onClick={onMinimize}
            aria-label="Minimize"
            title="Minimize — session stays alive"
          >
            <Minus size={18} />
          </button>
          <button className="icon-btn" onClick={onClose} aria-label="Close" title="End session">
            <X size={18} />
          </button>
        </header>
        <div className="term-container" ref={containerRef} />
      </div>
    </div>
  )
}
