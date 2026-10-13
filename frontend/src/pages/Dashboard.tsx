import { useEffect, useState } from 'react'
import { api } from '../api'

function fmtJst(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })
}

function left(hours: number | null | undefined) {
  if (hours === null || hours === undefined) return { txt: '—', cls: 'dim' }
  if (hours < 0) return { txt: '期限切れ', cls: 'dim' }
  if (hours < 48) return { txt: `残り ${Math.floor(hours / 24)}日${Math.floor(hours % 24)}時間`, cls: 'u-urgent' }
  if (hours < 168) return { txt: `残り ${Math.floor(hours / 24)}日`, cls: 'u-soon' }
  return { txt: `残り ${Math.floor(hours / 24)}日`, cls: 'u-ok' }
}

const STATUS: Record<string, [string, string]> = {
  active: ['有効', 'ok'], needs_review: ['要確認', 'warn'],
  conflict: ['矛盾あり', 'bad'], passed: ['経過済み', 'dim'],
}

export default function Dashboard() {
  const [rows, setRows] = useState<any[]>([])
  const [err, setErr] = useState('')
  const load = () => api.deadlines().then(setRows).catch(e => setErr(e.message))
  useEffect(() => { load() }, [])

  const review = rows.filter(r => r.status === 'needs_review' || r.status === 'conflict')

  return (
    <div>
      <h2>締切一覧 <span className="dim small">JST 表示</span></h2>
      {review.length > 0 && (
        <div className="alert">
          ⚠ {review.length} 件に確認が必要です（confidence 低下・情報源の矛盾）。
          「要確認」「矛盾あり」バッジの行を確認してください。
        </div>
      )}
      {err && <div className="alert bad">{err}</div>}
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>締切 (JST)</th><th>残り</th><th>タイトル</th>
              <th>必要アクション</th><th>confidence</th><th>状態</th><th>出典</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(d => {
              const l = left(d.hours_left)
              const st = STATUS[d.status] || [d.status, 'dim']
              return (
                <tr key={d.id}>
                  <td className="mono">{fmtJst(d.deadline_jst)}</td>
                  <td className={`countdown ${l.cls}`}>{l.txt}</td>
                  <td>
                    <div>{d.title}</div>
                    <div className="small dim">
                      原文: {d.deadline_local} [{d.source_tz}]
                    </div>
                    {d.status === 'conflict' && (d.history || []).length > 0 && (
                      <div className="small" style={{ color: 'var(--bad)' }}>
                        別ソースでは {fmtJst(d.history[d.history.length - 1].deadline_utc)}
                      </div>
                    )}
                  </td>
                  <td className="small">{d.action_required}</td>
                  <td>
                    <span className={`pill ${d.confidence >= 0.8 ? 'ok' : d.confidence >= 0.6 ? 'warn' : 'bad'}`}>
                      {Math.round(d.confidence * 100)}%
                    </span>
                  </td>
                  <td><span className={`pill ${st[1]}`}>{st[0]}</span></td>
                  <td>{d.url ? <a href={d.url} target="_blank">link</a> : <span className="dim">mail</span>}</td>
                  <td><button className="ghost" onClick={async () => {
                    await api.deleteDeadline(d.id); load()
                  }}>削除</button></td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="dim">
                締切がありません。「ソース登録」から URL/メールを登録してエージェントを実行してください。
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
