import { useState } from 'react'
import { api } from '../api'

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [u, setU] = useState('')
  const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await api.login(u, p)
      localStorage.setItem('dp_token', r.token)
      onLogin()
    } catch (ex: any) {
      setErr(ex.message === 'unauthorized' ? 'IDまたはパスワードが違います' : ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="loginwrap">
      <div className="loginbox card">
        <h1>Deadline<span>Pilot</span></h1>
        <p className="dim">コンペ・ハッカソン締切管理エージェント</p>
        <form onSubmit={submit}>
          <div style={{ marginBottom: 12 }}>
            <input placeholder="ユーザーID" value={u} autoFocus
              onChange={e => setU(e.target.value)} />
          </div>
          <div style={{ marginBottom: 16 }}>
            <input placeholder="パスワード" type="password" value={p}
              onChange={e => setP(e.target.value)} />
          </div>
          {err && <div className="alert bad small">{err}</div>}
          <button disabled={busy || !u || !p} style={{ width: '100%' }}>
            {busy ? 'ログイン中…' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}
