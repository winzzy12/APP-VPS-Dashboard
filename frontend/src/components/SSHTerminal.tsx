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

    let ready = false
    let closed = false
    const ws = new WebSocket(
      `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/servers/${server.id}/terminal`,
    )
    let resizeTimer: number | undefined

    const sendResize = () => {
      if (ws.readyState === WebSocket.OPEN && ready) {
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
      }
    }

    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'auth', token: getToken() }))
    }

    ws.onmessage = (ev: MessageEvent) => {
      if (!ready) {
        try {
          const obj = JSON.parse(ev.data)
          if (obj.type === 'ready') {
            ready = true
            sendResize()
            term.focus()
            return
          }
          if (obj.type === 'error') {
            term.write(`\r\n\x1b[31m${obj.message ?? 'SSH error'}\x1b[0m\r\n`)
            return
          }
        } catch {
          /* not JSON before ready — treat as raw output */
        }
      }
      term.write(ev.data)
    }

    ws.onclose = () => {
      if (!closed) {
        term.write('\r\n\x1b[90m— session closed —\x1b[0m\r\n')
      }
    }

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN && ready) {
        ws.send(JSON.stringify({ type: 'input', data }))
      }
    })

    term.onResize(() => sendResize())

    const ro = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        try {
          fit.fit()
        } catch {
          /* noop */
        }
      }, 50)
    })
    ro.observe(container)

    // On phones the keyboard shrinks only the VISUAL viewport (layout stays put),
    // so a plain ResizeObserver never fires and the bottom of the terminal hides
    // behind the keyboard. Resize the modal to the visual viewport instead.
    const modal = modalRef.current
    const vv = window.visualViewport
    const onVV = () => {
      if (!modal) return
      const h = vv
        ? Math.max(240, Math.min(window.innerHeight * 0.86, vv.height - 24))
        : Math.min(window.innerHeight * 0.86, window.innerHeight - 40)
      modal.style.height = `${h}px`
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
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
      closed = true
      ro.disconnect()
      if (vv) {
        vv.removeEventListener('resize', onVV)
        vv.removeEventListener('scroll', onVV)
      }
      window.clearTimeout(resizeTimer)
      try {
        ws.close()
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
