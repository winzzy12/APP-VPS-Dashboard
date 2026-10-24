import { useState, type FormEvent } from 'react'
import { api } from '../api'
import type { AuthResponse, User } from '../types'
import { Settings as GearIcon, X } from './Icons'

type Props = {
  user: User
  onClose: () => void
  onUserUpdated: (user: User, token: string) => void
}

export default function Settings({ user, onClose, onUserUpdated }: Props) {
  const [newName, setNewName] = useState(user.username)
  const [namePw, setNamePw] = useState('')
  const [nameErr, setNameErr] = useState<string | null>(null)
  const [nameOk, setNameOk] = useState<string | null>(null)
  const [nameBusy, setNameBusy] = useState(false)

  const [curPw, setCurPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [pwErr, setPwErr] = useState<string | null>(null)
  const [pwOk, setPwOk] = useState<string | null>(null)
  const [pwBusy, setPwBusy] = useState(false)

  const submitName = async (e: FormEvent) => {
    e.preventDefault()
    setNameErr(null)
    setNameOk(null)
    if (newName.trim() === user.username) {
      setNameErr('Username is unchanged')
      return
    }
    setNameBusy(true)
    try {
      const res = await api<AuthResponse>('/auth/username', {
        method: 'PUT',
        body: { username: newName.trim(), current_password: namePw },
      })
      onUserUpdated(res.user, res.token)
      setNamePw('')
      setNameOk('Username updated.')
    } catch (err) {
      setNameErr(err instanceof Error ? err.message : 'Failed to change username')
    } finally {
      setNameBusy(false)
    }
  }

  const submitPw = async (e: FormEvent) => {
    e.preventDefault()
    setPwErr(null)
    setPwOk(null)
    if (newPw.length < 8) {
      setPwErr('New password must be at least 8 characters')
      return
    }
    if (newPw !== confirmPw) {
      setPwErr('New passwords do not match')
      return
    }
    setPwBusy(true)
    try {
      await api<{ ok: boolean }>('/auth/password', {
        method: 'PUT',
        body: { current_password: curPw, new_password: newPw },
      })
      setCurPw('')
      setNewPw('')
      setConfirmPw('')
      setPwOk('Password updated.')
    } catch (err) {
      setPwErr(err instanceof Error ? err.message : 'Failed to change password')
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="modal">
        <header className="modal-head">
          <h3 className="modal-title">
            <GearIcon size={16} /> Settings
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="modal-body settings-body">
          <section>
            <h4>Username</h4>
            <form className="settings-form" onSubmit={submitName} autoComplete="off">
              <label className="field">
                <span>New username</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  minLength={3}
                  maxLength={32}
                  required
                />
              </label>
              <label className="field">
                <span>Current password</span>
                <input
                  type="password"
                  value={namePw}
                  onChange={(e) => setNamePw(e.target.value)}
                  required
                />
              </label>
              {nameErr && <p className="settings-msg err">{nameErr}</p>}
              {nameOk && <p className="settings-msg ok">{nameOk}</p>}
              <button className="btn btn-primary" disabled={nameBusy}>
                {nameBusy ? 'Saving…' : 'Save username'}
              </button>
            </form>
          </section>

          <section>
            <h4>Password</h4>
            <form className="settings-form" onSubmit={submitPw} autoComplete="off">
              <label className="field">
                <span>Current password</span>
                <input
                  type="password"
                  value={curPw}
                  onChange={(e) => setCurPw(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>New password (min. 8 characters)</span>
                <input
                  type="password"
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
              <label className="field">
                <span>Confirm new password</span>
                <input
                  type="password"
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  minLength={8}
                  maxLength={128}
                  required
                />
              </label>
              {pwErr && <p className="settings-msg err">{pwErr}</p>}
              {pwOk && <p className="settings-msg ok">{pwOk}</p>}
              <button className="btn btn-primary" disabled={pwBusy}>
                {pwBusy ? 'Saving…' : 'Change password'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  )
}
