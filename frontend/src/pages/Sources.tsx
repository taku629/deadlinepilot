import { useEffect, useState } from 'react'
import { api } from '../api'

const SRC_STATUS: Record<string, [string, string]> = {
  pending: ['未処理', 'info'], scanned: ['検査済', 'info'],
  processed: ['処理済', 'ok'], quarantined: ['隔離（注入検知）', 'bad'],
  error: ['エラー', 'bad'],
}

export default function Sources() {
  const [rows, setRows] = useState<any[]>([])
  const [url, setUrl] = useState('')
  const [mail, setMail] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [runId, setRunId] = useState('')

  const load = () => api.sources().then(setRows).catch(() => {})
  useEffect(() => { load() }, [])

  const addUrl = async () => {
    await api.addSource('url', url); setUrl(''); load()
  }
  const addMail = async () => {
    await api.addSource('email', undefined, mail); setMail(''); load()
  }
  const runAll = async () => {
    setBusy(true); setMsg('エージェント実行中…（数十秒かかります）')
    try {
      const r = await api.run([])
      setRunId(r.id)
      setMsg(`実行完了: ${r.status} — ツール${r.tool_calls}回, ` +
        `注入検知${r.injection_detections}件, 推定$${r.est_cost_usd}`)
      load()
    } catch (e: any) {
      setMsg(`実行失敗: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  const pending = rows.filter(r => r.status === 'pending').length

  return (
    <div>
      <h2>ソース登録</h2>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <h3 style={{ marginTop: 0 }}>URL を登録</h3>
          <p className="small dim">許可ドメインのみ取得できます（allowlist）。</p>
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

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>登録済みソース ({rows.length})</h3>
          <button onClick={runAll} disabled={busy || pending === 0}>
            {busy ? '実行中…' : `未処理 ${pending} 件をエージェント実行`}
          </button>
        </div>
        {msg && <p className="small" style={{ color: 'var(--acc)' }}>{msg}
          {runId && <> — <a href={`/runs/${runId}`}>トレースを見る</a></>}</p>}
        <table>
          <thead>
            <tr><th>種別</th><th>内容</th><th>状態</th><th>登録日時</th></tr>
          </thead>
          <tbody>
            {rows.map(s => {
              const st = SRC_STATUS[s.status] || [s.status, 'dim']
              const body = s.type === 'url' ? s.url : (s.raw_text || '').slice(0, 90)
              return (
                <tr key={s.id}>
                  <td><span className="pill info">{s.type}</span></td>
                  <td className="small">
                    {body}…
                    {s.status === 'quarantined' && (
                      <div style={{ color: 'var(--bad)' }} className="small">
                        🚫 {s.injection_flag}
                      </div>
                    )}
                  </td>
                  <td><span className={`pill ${st[1]}`}>{st[0]}</span></td>
                  <td className="small dim">{new Date(s.created_at).toLocaleString('ja-JP')}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
