import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { api } from '../api'

function fmtJst(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo', hour12: false, month: 'numeric', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit',
  })
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
  conflict: ['矛盾あり', 'bad'], changed: ['変更あり', 'purp'],
  passed: ['経過済み', 'dim'],
}

const TZ_LABEL: Record<string, string> = {
  'Etc/GMT+12': 'AoE', 'Asia/Tokyo': 'JST', 'America/Los_Angeles': 'PT',
  'America/New_York': 'ET', 'Europe/Berlin': 'CET',
}

export default function Dashboard() {
  const [rows, setRows] = useState<any[]>([])
  const [pending, setPending] = useState(0)
  const [err, setErr] = useState('')
  const load = () => {
    api.deadlines().then(setRows).catch(e => setErr(e.message))
    api.proposals().then(ps => setPending(ps.filter((p: any) => p.status === 'pending').length)).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const upcoming = rows.filter(r => r.status !== 'passed' && (r.hours_left ?? -1) > 0)
  const top = upcoming.slice(0, 3)
  const week = upcoming.filter(r => r.hours_left < 168).length
  const review = rows.filter(r => r.status === 'needs_review' || r.status === 'conflict')
  const changed = rows.filter(r => r.status === 'changed')

  return (
    <div>
      <h2>締切一覧 <span className="dim small">すべて JST で表示</span></h2>

      <div className="grid cols4" style={{ marginBottom: 14 }}>
        <div className="card kpi"><div className="dim small">7日以内の締切</div><div className="statnum u-soon">{week}</div></div>
        <div className="card kpi"><div className="dim small">要確認・矛盾</div><div className="statnum" style={{ color: review.length ? 'var(--warn)' : 'var(--ok)' }}>{review.length}</div></div>
        <div className="card kpi"><div className="dim small">変更を検知</div><div className="statnum" style={{ color: changed.length ? 'var(--purp)' : 'var(--dim)' }}>{changed.length}</div></div>
        <NavLink to="/approvals" className="card kpi link"><div className="dim small">承認待ちの提案</div><div className="statnum" style={{ color: pending ? 'var(--acc)' : 'var(--dim)' }}>{pending} <span className="small">→</span></div></NavLink>
      </div>

      {changed.map(d => {
        const prev = (d.history || [])[d.history.length - 1]
        return (
          <div key={d.id} className="alert purp">
            🔔 <b>{d.title}</b> の締切が主催者ページで変更されました：
            {prev && <> <s className="dim">{fmtJst(prev.deadline_utc)}</s> → </>}
            <b>{fmtJst(d.deadline_jst)}</b>
            {' '}<NavLink to="/approvals">提案を確認 →</NavLink>
          </div>
        )
      })}
      {review.length > 0 && (
        <div className="alert">
          ⚠ {review.length} 件は人間の確認が必要です（情報源の矛盾・抽出の確信度が低い）。
        </div>
      )}
      {err && <div className="alert bad">{err}</div>}

      {top.length > 0 && <>
        <h3 className="section">今やるべきこと</h3>
        <div className="grid tops">
          {top.map((d, i) => {
            const l = left(d.hours_left)
            return (
              <div key={d.id} className={`card top top-${l.cls}`}>
                <div className="small dim">#{i + 1} ・ {fmtJst(d.deadline_jst)}</div>
                <div className={`bigcount ${l.cls}`}>{l.txt}</div>
                <div className="toptitle">{d.title}</div>
                <div className="small">👉 {d.action_required || '—'}</div>
                <div className="row" style={{ marginTop: 10 }}>
                  {d.url && <a href={d.url} target="_blank"><button className="ghost">公式ページ ↗</button></a>}
                  {STATUS[d.status] && d.status !== 'active' &&
                    <span className={`pill ${STATUS[d.status][1]}`}>{STATUS[d.status][0]}</span>}
                </div>
              </div>
            )
          })}
        </div>
      </>}

      <h3 className="section">すべての締切</h3>
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>締切 (JST)</th><th>残り</th><th>タイトル</th>
              <th>必要アクション</th><th>確信度</th><th>状態</th><th>出典</th><th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(d => {
              const l = left(d.hours_left)
              const st = STATUS[d.status] || [d.status, 'dim']
              const prev = (d.history || [])[d.history?.length - 1]
              return (
                <tr key={d.id} className={d.status === 'passed' ? 'passed' : ''}>
                  <td className="mono">{fmtJst(d.deadline_jst)}</td>
                  <td className={`countdown ${l.cls}`}>{l.txt}</td>
                  <td>
                    <div>{d.title}</div>
                    <div className="small dim">
                      原文: {d.deadline_local} [{TZ_LABEL[d.source_tz] || d.source_tz}]
                    </div>
                    {prev && d.status === 'conflict' && (
                      <div className="small" style={{ color: 'var(--bad)' }}>
                        別ソースでは {fmtJst(prev.deadline_utc)}
                      </div>
                    )}
                    {prev && d.status === 'changed' && (
                      <div className="small" style={{ color: 'var(--purp)' }}>
                        変更前 {fmtJst(prev.deadline_utc)}
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
                  <td className="nowrap">{d.url ? <a href={d.url} target="_blank">公式ページ ↗</a> : <span className="dim">メール</span>}</td>
                  <td><button className="ghost" onClick={async () => {
                    await api.deleteDeadline(d.id); load()
                  }}>削除</button></td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={8} className="dim">
                締切がありません。「ソース登録」から URL やメールを登録してエージェントを実行してください。
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
