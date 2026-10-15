import { useEffect, useState } from 'react'
import { NavLink, Route, Routes, useParams } from 'react-router-dom'
import { api } from '../api'
import { StepList } from '../steps'

const TRIGGER: Record<string, [string, string]> = {
  manual: ['手動', 'info'], watch: ['手動巡回', 'purp'], schedule: ['自動巡回', 'purp'],
}

function RunList() {
  const [rows, setRows] = useState<any[]>([])
  useEffect(() => { api.runs().then(setRows).catch(() => {}) }, [])
  return (
    <div>
      <h2>実行トレース</h2>
      <div className="card">
        <table>
          <thead>
            <tr><th>実行ID</th><th>開始</th><th>起動</th><th>状態</th><th>ツール</th>
              <th>トークン(in/out)</th><th>推定費用</th><th>注入検知</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td><NavLink to={`/runs/${r.id}`} className="mono">
                  {r.id.slice(0, 8)}</NavLink></td>
                <td className="small">{new Date(r.started_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}</td>
                <td>{(() => { const t = TRIGGER[r.trigger || 'manual'] || [r.trigger, 'dim']; return <span className={`pill ${t[1]}`}>{t[0]}</span> })()}</td>
                <td><span className={`pill ${r.status === 'success' ? 'ok' : r.status === 'error' ? 'bad' : 'info'}`}>
                  {r.status}</span>{r.error && <div className="small dim">{r.error}</div>}</td>
                <td>{r.tool_calls}</td>
                <td className="mono small">{r.tokens_in}/{r.tokens_out}</td>
                <td className="mono">${(r.est_cost_usd || 0).toFixed(5)}</td>
                <td>{r.injection_detections > 0
                  ? <span className="pill bad">{r.injection_detections}</span>
                  : <span className="dim">0</span>}</td>
              </tr>
            ))}
            {rows.length === 0 &&
              <tr><td colSpan={8} className="dim">まだ実行がありません。</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}


function RunDetail() {
  const { id } = useParams()
  const [run, setRun] = useState<any>(null)
  useEffect(() => {
    if (!id) return
    api.runDetail(id).then(setRun).catch(() => {})
    const t = setInterval(() => api.runDetail(id).then(setRun).catch(() => {}), 2000)
    return () => clearInterval(t)
  }, [id])

  if (!run) return <div className="dim">読み込み中…</div>
  return (
    <div>
      <h2>実行 {run.id.slice(0, 8)} <span className={`pill ${run.status === 'success' ? 'ok' : run.status === 'error' ? 'bad' : 'info'}`}>{run.status}</span></h2>
      <div className="grid cols4" style={{ marginBottom: 18 }}>
        <div className="card"><div className="dim small">ツール呼出</div>
          <div className="statnum">{run.tool_calls}</div></div>
        <div className="card"><div className="dim small">トークン in/out</div>
          <div className="statnum small" style={{ fontSize: 20 }}>
            {run.tokens_in} / {run.tokens_out}</div></div>
        <div className="card"><div className="dim small">推定費用</div>
          <div className="statnum" style={{ fontSize: 20 }}>${(run.est_cost_usd || 0).toFixed(5)}</div></div>
        <div className="card"><div className="dim small">注入検知</div>
          <div className="statnum" style={{ color: run.injection_detections ? 'var(--bad)' : 'var(--ok)' }}>
            {run.injection_detections}</div></div>
      </div>
      {run.summary && <div className="card summary">{run.summary}</div>}
      <div className="card">
        <h3 style={{ marginTop: 0 }}>ステップタイムライン</h3>
        <StepList steps={run.steps || []} live={run.status === 'running'} />
      </div>
    </div>
  )
}

export default function Runs() {
  return (
    <Routes>
      <Route index element={<RunList />} />
      <Route path=":id" element={<RunDetail />} />
    </Routes>
  )
}
