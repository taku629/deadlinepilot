import { useEffect, useState } from 'react'
import { api } from '../api'

export default function Stats() {
  const [s, setS] = useState<any>(null)
  useEffect(() => { api.stats().then(setS).catch(() => {}) }, [])
  if (!s) return <div className="dim">読み込み中…</div>
  return (
    <div>
      <h2>統計・ガバナンス</h2>
      <div className="grid cols4">
        <div className="card"><div className="dim small">エージェント実行</div>
          <div className="statnum">{s.runs_total}</div>
          <div className="small dim">成功 {s.runs_success} / 失敗 {s.runs_error}</div></div>
        <div className="card"><div className="dim small">ツール呼出合計</div>
          <div className="statnum">{s.tool_calls}</div></div>
        <div className="card"><div className="dim small">トークン in/out</div>
          <div className="statnum" style={{ fontSize: 20 }}>
            {s.tokens_in.toLocaleString()} / {s.tokens_out.toLocaleString()}</div>
          <div className="small dim">推定 ${s.est_cost_usd.toFixed(4)}</div></div>
        <div className="card"><div className="dim small">注入検知 / 隔離</div>
          <div className="statnum" style={{ color: 'var(--bad)' }}>
            {s.injection_detections} / {s.sources_quarantined}</div></div>
        <div className="card"><div className="dim small">承認 / 却下 / 保留</div>
          <div className="statnum" style={{ fontSize: 20 }}>
            {s.proposals_approved} / {s.proposals_rejected} / {s.proposals_pending}</div></div>
        <div className="card"><div className="dim small">締切（要確認）</div>
          <div className="statnum">{s.deadlines_total}
            <span className="small" style={{ color: 'var(--warn)' }}>
              {' '}({s.deadlines_needs_review})</span></div></div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>ガバナンス設定</h3>
        <table>
          <tbody>
            <tr><td className="dim">ツール呼出上限 / 実行</td>
              <td className="mono">{s.limits.max_tool_calls}</td></tr>
            <tr><td className="dim">トークン上限 / 実行</td>
              <td className="mono">{s.limits.max_total_tokens.toLocaleString()}</td></tr>
            <tr><td className="dim">タイムアウト</td>
              <td className="mono">{s.limits.run_timeout_s}s</td></tr>
            <tr><td className="dim">fetch_page 許可ドメイン</td>
              <td className="mono small">{s.allowed_domains.join(', ')}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
