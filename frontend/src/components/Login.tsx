import { useState, type FormEvent } from 'react'
import { api } from '../api'
import type { AuthResponse, User } from '../types'
import { Eye, EyeOff, Logo } from './Icons'

type Props = {
  mode: 'login' | 'setup'
  onAuthed: (user: User, token: string) => void
}

export default function Login({ mode, onAuthed }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const setup = mode === 'setup'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (setup && password !== confirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      const res = await api<AuthResponse>(setup ? '/auth/setup' : '/auth/login', {
        method: 'POST',
        body: { username: username.trim(), password },
      })
      onAuthed(res.user, res.token)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <div className="auth-blob blob-a" />
      <div className="auth-blob blob-b" />
      <div className="auth-dots" />
      <form className="auth-card" onSubmit={submit} autoComplete={setup ? 'off' : 'on'}>
        <div className="auth-brand">
          <Logo size={44} />
          <h1>{setup ? 'Create admin account' : 'Welcome back'}</h1>
          <p>
            {setup
              ? 'First run — set up the administrator account for this dashboard.'
              : 'Sign in to manage your VPS fleet.'}
          </p>
        </div>

        <label className="field">
          <span>Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="admin"
            autoFocus
            autoCapitalize="none"
            autoComplete="username"
            required
          />
        </label>

        <label className="field">
          <span>Password</span>
          <div className="pw-wrap">
            <input
              type={showPw ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={setup ? 'Minimum 8 characters' : 'Your password'}
              required
              minLength={setup ? 8 : 1}
              autoComplete={setup ? 'new-password' : 'current-password'}
            />
            <button
              type="button"
              className="pw-toggle"
              onClick={() => setShowPw((s) => !s)}
              aria-label="Toggle password visibility"
            >
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>

        {setup && (
          <label className="field">
            <span>Confirm password</span>
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Repeat password"
              required
              autoComplete="new-password"
            />
          </label>
        )}

        {error && <div className="form-error">{error}</div>}

        <button className="btn btn-primary btn-block" disabled={busy || !username || !password}>
          {busy ? (
            <span className="spinner spinner-sm light" />
          ) : setup ? (
            'Create account'
          ) : (
            'Sign in'
          )}
        </button>

        <p className="auth-foot">VPS Dashboard</p>
      </form>
    </div>
  )
}
