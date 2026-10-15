import { useEffect, useState } from 'react'
import { api } from '../api'
import { LivePanel, useLiveRun } from '../steps'

const SRC_STATUS: Record<string, [string, string]> = {
  pending: ['未処理', 'info'], scanned: ['検査済', 'info'],
  processed: ['処理済', 'ok'], quarantined: ['隔離（注入検知）', 'bad'],
  error: ['エラー', 'bad'],
}

const fmt = (iso?: string) => iso
  ? new Date(iso).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', hour12: false })
  : '—'

export default function Sources() {
  const [rows, setRows] = useState<any[]>([])
  const [url, setUrl] = useState('')
  const [mail, setMail] = useState('')
  const [watch, setWatch] = useState<any>(null)
  const [err, setErr] = useState('')
  const live = useLiveRun()

  const load = () => {
    api.sources().then(setRows).catch(() => {})
    api.watchStatus().then(setWatch).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const addUrl = async () => {
    await api.addSource('url', url); setUrl(''); load()
  }
  const addMail = async () => {
    await api.addSource('email', undefined, mail); setMail(''); load()
  }
  const runAll = async () => {
    setErr('')
    try { await live.start(id => api.run([], id)) }
    catch (e: any) { setErr(`実行失敗: ${e.message}`) }
    load()
  }
  const watchNow = async () => {
    setErr('')
    try { await live.start(id => api.watch(id)) }
    catch (e: any) { setErr(`巡回失敗: ${e.message}`) }
    load()
  }
  const setDemo = async (v: number) => { await api.demoNotice(v); load() }

  const pending = rows.filter(r => r.status === 'pending').length

  return (
    <div>
      <h2>ソース登録</h2>
      <p className="dim" style={{ marginTop: -8 }}>
        告知メールや公式ページを登録すると、エージェントが締切を抽出・JST に正規化し、
        登録した URL はその後も自動で巡回して締切の変更を見張ります。
      </p>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>URL を登録</h3>
          <p className="small dim">許可ドメインのみ取得できます（allowlist）。登録後は自動巡回の対象になります。</p>
          <div className="row">
            <input placeholder="https://www.kaggle.com/competitions/..."
              value={url} onChange={e => setUrl(e.target.value)} />
            <button onClick={addUrl} disabled={!url}>追加</button>
          </div>
        </div>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>メール本文を貼り付け</h3>
          <textarea rows={3} placeholder="告知メール本文をそのまま貼り付け…"
            value={mail} onChange={e => setMail(e.target.value)} />
          <div style={{ marginTop: 8 }}>
            <button onClick={addMail} disabled={!mail.trim()}>追加</button>
          </div>
        </div>
      </div>

      <div className="card watchcard">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ marginTop: 0, marginBottom: 4 }}>👀 締切の変更監視</h3>
            <div className="small dim">
              Cloud Scheduler が{watch?.interval || '定期的に'}登録 URL を再取得し、内容が変わったページだけ
              エージェントを起動します（変化がなければ LLM を呼ばずトークン消費 0）。
            </div>
            <div className="small" style={{ marginTop: 6 }}>
              監視中 {watch?.monitored?.length ?? 0} 件 ・ 最終巡回 {fmt(watch?.last?.last_at)}
              {watch?.last?.trigger && <> （{watch.last.trigger === 'schedule' ? '自動' : '手動'}・変更 {watch.last.changed} 件）</>}
            </div>
          </div>
          <button onClick={watchNow} disabled={live.busy}>今すぐ巡回</button>
        </div>
        {watch?.demo_url && (
          <div className="demo">
            <div className="small">
              <b>デモ:</b> 架空の主催者ページ「Tokyo AgentOps Challenge 2026」
              （現在: {watch.demo_version ? <span className="pill purp">締切延長後</span> : <span className="pill dim">当初の締切</span>}）
              {' '}<a href={watch.demo_url} target="_blank">ページを開く ↗</a>
            </div>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="ghost" disabled={live.busy || watch.demo_version === 1}
                onClick={() => setDemo(1)}>主催者が締切を1週間延長する</button>
              <button className="ghost" disabled={live.busy || watch.demo_version === 0}
                onClick={() => setDemo(0)}>元に戻す</button>
              <span className="small dim">→ その後「今すぐ巡回」</span>
            </div>
          </div>
        )}
      </div>

      {err && <div className="alert bad">{err}</div>}
      <LivePanel run={live.run} busy={live.busy} />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>登録済みソース ({rows.length})</h3>
          <button onClick={runAll} disabled={live.busy || pending === 0}>
            {live.busy ? '実行中…' : `未処理 ${pending} 件をエージェント実行`}
          </button>
        </div>
        <table>
          <thead>
            <tr><th>種別</th><th>内容</th><th>状態</th><th>登録 / 最終巡回</th></tr>
          </thead>
          <tbody>
            {rows.map(s => {
              const st = SRC_STATUS[s.status] || [s.status, 'dim']
              const body = s.type === 'url' ? (s.label || s.url) : (s.raw_text || '').slice(0, 90) + '…'
              return (
                <tr key={s.id}>
                  <td><span className="pill info">{s.type === 'url' ? 'URL' : 'メール'}</span></td>
                  <td className="small">
                    {body}
                    {s.type === 'url' && s.label && <div className="dim small">{s.url}</div>}
                    {s.status === 'quarantined' && (
                      <div style={{ color: 'var(--bad)' }} className="small">
                        🚫 {s.injection_flag}
                      </div>
                    )}
                  </td>
                  <td><span className={`pill ${st[1]}`}>{st[0]}</span>
                    {s.last_changed_at && <div className="small" style={{ color: 'var(--purp)' }}>変更検知 {fmt(s.last_changed_at)}</div>}
                  </td>
                  <td className="small dim">{fmt(s.created_at)}
                    {s.type === 'url' && <div>巡回 {fmt(s.last_checked_at)}</div>}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
