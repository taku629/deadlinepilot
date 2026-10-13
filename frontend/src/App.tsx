import { useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api, token } from './api'
import Dashboard from './pages/Dashboard'
import Sources from './pages/Sources'
import Approvals from './pages/Approvals'
import Runs from './pages/Runs'
import Stats from './pages/Stats'
import Login from './pages/Login'

export default function App() {
  const [authed, setAuthed] = useState(!!token())
  const [pending, setPending] = useState(0)
  const nav = useNavigate()

  useEffect(() => {
    if (!authed) return
    api.proposals().then(ps =>
      setPending(ps.filter((p: any) => p.status === 'pending').length)
    ).catch(() => {})
  }, [authed])

  if (!authed) {
    return <Routes>
      <Route path="*" element={<Login onLogin={() => setAuthed(true)} />} />
    </Routes>
  }

  return (
    <div className="layout">
      <div className="sidebar">
        <h1>Deadline<span>Pilot</span></h1>
        <div className="nav">
          <NavLink to="/" end>締切一覧</NavLink>
          <NavLink to="/sources">ソース登録</NavLink>
          <NavLink to="/approvals">
            承認待ち{pending > 0 && <span className="badge">{pending}</span>}
          </NavLink>
          <NavLink to="/runs">実行トレース</NavLink>
          <NavLink to="/stats">統計</NavLink>
        </div>
        <div style={{ position: 'absolute', bottom: 20, padding: '0 10px' }}>
          <button className="ghost" onClick={() => {
            localStorage.removeItem('dp_token'); setAuthed(false); nav('/login')
          }}>ログアウト</button>
        </div>
      </div>
      <div className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/sources" element={<Sources />} />
          <Route path="/approvals" element={<Approvals onChange={setPending} />} />
          <Route path="/runs/*" element={<Runs />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
    </div>
  )
}
