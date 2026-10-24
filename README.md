# VPS Dashboard

Login-protected dashboard for managing a VPS fleet. Standalone app on
**http://127.0.0.1:8081** (loopback only — separate from Hermes Command Center
on 8080).

## Stack

- Backend: FastAPI + SQLite (WAL), PBKDF2 password hashing, HS256 JWT sessions (24 h)
- Frontend: React 19 + Vite + TypeScript, hand-rolled dark UI (no CSS framework)
- Service: systemd unit `vps-dashboard.service`

## Layout

```
backend/
  app/main.py    API + static SPA host (catch-all -> frontend/dist)
  app/auth.py    hashing + JWT
  app/db.py      sqlite layer (users, servers)
  app/crypto.py  Fernet encryption for stored SSH passwords (.ssh_enc_key)
  app/ssh_client.py  paramiko collection (TOFU host keys)
  app/collector.py   async loop: SSH probe every 15s, in-memory history
  .venv/         python 3.12 venv
  data.db        created on first start
  .secret        JWT signing key (generated on first start, chmod 600)
  .ssh_enc_key   Fernet key for SSH passwords (generated, chmod 600)
frontend/
  src/           React app (components/Login.tsx, components/Dashboard.tsx,
                 components/ServerDetail.tsx, components/Chart.tsx)
  dist/          production build served by the backend
```

## API

- `GET  /api/health` — liveness
- `GET  /api/auth/status` — `{initialized}` (false = first-run setup screen)
- `POST /api/auth/setup` — create the first admin (403 once one exists)
- `POST /api/auth/login` — `{username, password}` → `{token, user}`
- `GET  /api/auth/me`
- `GET|POST /api/servers`, `PUT|DELETE /api/servers/{id}`
  - `ssh_password` is write-only: set on create/update, never returned
    (responses carry `has_credentials` instead)
- `POST /api/servers/check-all` — parallel TCP probes, updates status/latency
- `POST /api/servers/{id}/check` — single TCP probe
- `POST /api/servers/{id}/test` — SSH connect + collect now
- `POST /api/servers/{id}/collect` — collect metrics now, returns updated row
- `GET  /api/servers/{id}/metrics` — `{interval, history}` (in-memory, ~1 h)
- `POST /api/servers/{id}/reset-host-key` — clear pinned SSH host key (TOFU)

All routes except `/api/health` and `/api/auth/*` require `Authorization: Bearer <token>`.

## SSH metrics

Servers with a stored SSH password are probed every 15 s over SSH (paramiko,
password auth): CPU % (1 s /proc/stat delta), RAM used/total, disk `/` usage,
uptime and last reboot. History (240 samples ≈ 1 h) is kept in memory and lost
on restart; the latest snapshot is persisted in the `servers` table.

Security: passwords are Fernet-encrypted at rest (key `backend/.ssh_enc_key`,
chmod 600) and never logged or returned by the API. Host keys are pinned on
first connect (TOFU, SHA256 fingerprint in `servers.host_key_fp`); a changed
key refuses collection until an admin clicks "Reset host key".

## Operations

```bash
systemctl status vps-dashboard
journalctl -u vps-dashboard -n 50

# rebuild frontend after changes
cd frontend && npm run build && systemctl restart vps-dashboard

# reset admin (back to first-run setup screen)
systemctl stop vps-dashboard
rm backend/data.db backend/data.db-wal backend/data.db-shm backend/.secret
systemctl start vps-dashboard
```

Status checks are plain TCP connects (host:port) — they verify reachability,
not SSH auth. To expose beyond loopback, change `--host` in the systemd unit
(e.g. to the Tailscale IP 100.95.222.8).
