import { useEffect, useRef, useState } from 'react'
import { api } from './api'

// Human-readable labels for every trace step. Raw model I/O ("io") is kept
// for auditing but collapsed behind a toggle.
const TOOL_LABEL: Record<string, [string, string]> = {
  fetch_page: ['🌐', '公式ページを取得'],
  parse_email: ['✉️', 'メールを読み込み・検査'],
  extract_deadlines: ['🔎', '締切を抽出（Gemini 構造化出力）'],
  normalize_timezone: ['🕒', 'タイムゾーンを正規化（zoneinfo・決定的計算）'],
  upsert_deadline: ['💾', '締切を保存・既存と照合'],
  detect_conflicts: ['⚖️', '矛盾・時間衝突を検査'],
  propose_action: ['📝', '人間への提案を作成（承認待ちへ）'],
}
const OTHER_LABEL: Record<string, [string, string]> = {
  planner_start: ['🚀', 'プランナー起動'],
  判断: ['🧠', 'エージェントの判断'],
  思考: ['🧠', 'エージェントの思考'],
  injection_detected: ['🛡️', 'プロンプトインジェクションを検知 → 隔離'],
  watch_start: ['👀', '変更監視を開始'],
  unchanged: ['✅', '変更なし'],
  change_detected: ['🔔', 'ページの変更を検知'],
  wake_agent: ['⚡', 'エージェントを起動'],
  sleep: ['💤', 'LLMを呼ばずに終了'],
  watch_error: ['⚠️', '取得失敗'],
  watch_skip: ['⛔', '許可リスト外'],
  timeout: ['⛔', 'タイムアウトで強制終了'],
  run_failed: ['⛔', '実行失敗'],
}

export const ID_RE = /(ソース|締切|source)?\s*ID[:：]?\s*[0-9a-f]{12,}|\(?\b[0-9a-f]{16}\b\)?/gi
export const clean = (s: string) => (s || '').replace(ID_RE, '').replace(/\s{2,}/g, ' ').trim()

type Step = { seq: number; kind: string; name: string; summary: string; latency_ms?: number; ts: string }

function label(s: Step): [string, string] {
  if (s.kind === 'tool_call' || s.kind === 'tool_result') {
    return TOOL_LABEL[s.name] || ['🔧', s.name]
  }
  return OTHER_LABEL[s.name] || ['•', s.name]
}

export function StepList({ steps, live }: { steps: Step[]; live?: boolean }) {
  const [raw, setRaw] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (live) end.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [steps.length, live])

  // Merge each tool_call with its tool_result into one row.
  const rows: { s: Step; result?: Step }[] = []
  for (const s of steps) {
    if (s.kind === 'io' && !raw) continue
    if (s.kind === 'tool_result') {
      const open = [...rows].reverse().find(r => r.s.kind === 'tool_call' && r.s.name === s.name && !r.result)
      if (open) { open.result = s; continue }
    }
    rows.push({ s })
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'flex-end', marginBottom: 6 }}>
        <label className="small dim" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={raw} onChange={e => setRaw(e.target.checked)}
            style={{ width: 'auto', marginRight: 6 }} />
          生のモデル入出力も表示
        </label>
      </div>
      <div className="tl">
        {rows.map(({ s, result }) => {
          const [icon, text] = label(s)
          const cls = s.kind === 'security' ? 'sec' : s.kind === 'model' ? 'model'
            : s.kind === 'error' ? 'err' : s.kind === 'watch' ? 'watch' : s.kind === 'io' ? 'io' : ''
          const pending = s.kind === 'tool_call' && !result && live
          return (
            <div key={s.seq} className={`ev ${cls} ${pending ? 'pending' : ''}`}>
              <div className="evhead">
                <span className="evicon">{icon}</span>
                <b>{s.kind === 'io' ? s.name : text}</b>
                <span className="small dim" style={{ marginLeft: 'auto' }}>
                  {new Date(s.ts).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })}
                  {result?.latency_ms ? ` · ${(result.latency_ms / 1000).toFixed(1)}秒` : ''}
                </span>
              </div>
              {s.kind === 'model'
                ? <div className="thought">{s.summary}</div>
                : <div className="small dim">{s.summary}</div>}
              {result && <div className="small result">→ {result.summary}</div>}
              {pending && <div className="small dim">実行中…</div>}
            </div>
          )
        })}
        {live && <div className="ev pending"><div className="small dim">エージェントが次の行動を判断中…</div></div>}
        <div ref={end} />
      </div>
    </div>
  )
}

// Follows a run while the POST that started it is still in flight.
export function useLiveRun() {
  const [runId, setRunId] = useState('')
  const [run, setRun] = useState<any>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<any>(null)

  const start = async (kick: (id: string) => Promise<any>) => {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map(b => b.toString(16).padStart(2, '0')).join('')
    setRunId(id); setRun(null); setBusy(true)
    timer.current = setInterval(() => {
      api.runDetail(id).then(setRun).catch(() => {})
    }, 1000)
    try {
      const final = await kick(id)
      setRun(final)
      return final
    } finally {
      clearInterval(timer.current)
      setBusy(false)
    }
  }
  useEffect(() => () => clearInterval(timer.current), [])
  return { runId, run, busy, start }
}

export function LivePanel({ run, busy }: { run: any; busy: boolean }) {
  if (!run && !busy) return null
  const steps = run?.steps || []
  return (
    <div className="card live">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0 }}>
          {busy ? <><span className="dot" /> エージェント実行中（ライブ）</> : '実行結果'}
        </h3>
        {run && (
          <div className="row small dim">
            <span>ツール {run.tool_calls || 0}回</span>
            <span>トークン {(run.tokens_in || 0) + (run.tokens_out || 0)}</span>
            <span>推定 ${(run.est_cost_usd || 0).toFixed(4)}</span>
            {run.injection_detections > 0 && <span className="pill bad">注入検知 {run.injection_detections}</span>}
            {run.id && !busy && <a href={`/runs/${run.id}`}>トレース詳細 →</a>}
          </div>
        )}
      </div>
      {!busy && run?.summary && <div className="summary">{run.summary}</div>}
      <StepList steps={steps} live={busy} />
    </div>
  )
}
