export type ServerStatus = 'online' | 'offline' | 'unknown'

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
  created_at: string
}

export interface AuthResponse {
  token: string
  user: User
}
