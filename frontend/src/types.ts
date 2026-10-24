export type ServerStatus = 'online' | 'offline' | 'unknown'
export type SSHStatus = 'ok' | 'error' | 'unknown' | 'none'

export interface User {
  id: number
  username: string
}

export interface Server {
  id: number
  name: string
  host: string
  port: number
  ssh_user: string
  os: string
  notes: string
  status: ServerStatus
  latency_ms: number | null
  last_checked: string | null
  ssh_status: SSHStatus
  has_credentials: boolean
  last_error: string | null
  cpu_percent: number | null
  mem_percent: number | null
  mem_used_mb: number | null
  mem_total_mb: number | null
  disk_percent: number | null
  disk_used_gb: number | null
  disk_total_gb: number | null
  uptime_seconds: number | null
  last_reboot: string | null
  last_metrics_at: string | null
  created_at: string
}

export interface AuthResponse {
  token: string
  user: User
}

export interface MetricsPoint {
  ts: number
  cpu_percent: number
  mem_percent: number
  mem_used_mb: number
  mem_total_mb: number
  disk_percent: number
  disk_used_gb: number
  disk_total_gb: number
  uptime_seconds: number
  last_reboot: string | null
}

export interface MetricsResponse {
  interval: number
  history: MetricsPoint[]
}
