import { useEffect, useState } from 'react'
import { api } from '../api'
import { clean } from '../steps'

const KIND: Record<string, string> = {
  ics_event: '📅 カレンダー登録 (ICS)',
  reminder: '⏰ リマインド',
  review_flag: '🔍 要確認フラグ',
}
const ST: Record<string, [string, string]> = {
  pending: ['承認待ち', 'warn'], approved: ['承認済み', 'ok'],
  rejected: ['却下', 'dim'],
}

export default function Approvals({ onChange }: { onChange?: (n: number) => void }) {
  const [rows, setRows] = useState<any[]>([])
  const load = () => api.proposals().then(ps => {
    setRows(ps)
    onChange?.(ps.filter((p: any) => p.status === 'pending').length)
  })
  useEffect(() => { load() }, [])

  const act = async (id: string, action: 'approve' | 'reject') => {
    await api[action](id); load()
  }

  const pend = rows.filter(r => r.status === 'pending')
  const done = rows.filter(r => r.status !== 'pending')

  const Card = ({ p }: { p: any }) => {
    const st = ST[p.status] || [p.status, 'dim']
    return (
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700 }}>{KIND[p.kind] || p.kind}</div>
            <div style={{ margin: '6px 0 2px', fontSize: 17 }}>{clean(p.title)}</div>
            <div className="small dim">{clean(p.detail)}</div>
            <div className="small dim">
              提案日時: {new Date(p.created_at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}
            </div>
          </div>
          <div className="row">
            <span className={`pill ${st[1]}`}>{st[0]}</span>
            {p.status === 'pending' && (
              <>
                <button onClick={() => act(p.id, 'approve')}>承認</button>
                <button className="danger" onClick={() => act(p.id, 'reject')}>却下</button>
              </>
            )}
            {p.status === 'approved' && p.kind === 'ics_event' && (
              <button className="ghost" onClick={() => api.downloadIcs(p.id).catch(e => alert(`ICS生成に失敗: ${e.message}`))}>
                📅 ICSをダウンロード
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2>承認待ち</h2>
      <p className="dim">
        エージェントは外部への書き込みを行いません。すべて「提案」として
        ここに並び、承認されたものだけが実行（ICS生成等）されます。
      </p>
      {pend.length === 0 && <div className="card dim">承認待ちはありません。</div>}
      {pend.map(p => <Card key={p.id} p={p} />)}
      {done.length > 0 && <h3 className="dim">処理済み</h3>}
      {done.map(p => <Card key={p.id} p={p} />)}
    </div>
  )
}
