import { useEffect, useState } from 'react'
import { api, getToken, setToken } from './api'
import type { User } from './types'
import Login from './components/Login'
import Dashboard from './components/Dashboard'

type Phase = 'loading' | 'setup' | 'login' | 'app'

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [user, setUser] = useState<User | null>(null)

  useEffect(() => {
    ;(async () => {
      if (getToken()) {
        try {
          setUser(await api<User>('/auth/me'))
          setPhase('app')
          return
        } catch {
          setToken(null)
        }
      }
      const status = await api<{ initialized: boolean }>('/auth/status')
      setPhase(status.initialized ? 'login' : 'setup')
    })().catch(() => setPhase('login'))
  }, [])

  if (phase === 'loading') {
    return (
      <div className="boot">
        <div className="spinner" />
      </div>
    )
  }

  if (phase === 'app' && user) {
    return (
      <Dashboard
        user={user}
        onLogout={() => {
          setToken(null)
          setUser(null)
          setPhase('login')
        }}
      />
    )
  }

  return (
    <Login
      mode={phase === 'setup' ? 'setup' : 'login'}
      onAuthed={(u, token) => {
        setToken(token)
        setUser(u)
        setPhase('app')
      }}
    />
  )
}
