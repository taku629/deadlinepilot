const BASE = '/api'

export function token(): string | null {
  return localStorage.getItem('dp_token')
}

async function req(path: string, opts: RequestInit = {}) {
  const t = token()
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(opts.headers || {}),
    },
  })
  if (res.status === 401) {
    localStorage.removeItem('dp_token')
    if (!location.pathname.startsWith('/login')) location.href = '/login'
    throw new Error('unauthorized')
  }
  if (!res.ok) {
    const j = await res.json().catch(() => ({}))
    throw new Error(j.detail || `${res.status}`)
  }
  return res.json()
}

export const api = {
  login: (username: string, password: string) =>
    req('/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => req('/me'),
  sources: () => req('/sources'),
  addSource: (type: string, url?: string, raw_text?: string) =>
    req('/sources', { method: 'POST', body: JSON.stringify({ type, url, raw_text }) }),
  run: (source_ids?: string[], run_id?: string) =>
    req('/runs', { method: 'POST', body: JSON.stringify({ source_ids: source_ids || [], run_id }) }),
  watch: (run_id?: string) =>
    req('/watch', { method: 'POST', body: JSON.stringify({ run_id }) }),
  watchStatus: () => req('/watch/status'),
  demoNotice: (version: number) =>
    req('/demo/notice', { method: 'POST', body: JSON.stringify({ version }) }),
  runs: () => req('/runs'),
  runDetail: (id: string) => req(`/runs/${id}`),
  deadlines: () => req('/deadlines'),
  deleteDeadline: (id: string) => req(`/deadlines/${id}`, { method: 'DELETE' }),
  proposals: () => req('/proposals'),
  approve: (id: string) => req(`/proposals/${id}/approve`, { method: 'POST' }),
  reject: (id: string) => req(`/proposals/${id}/reject`, { method: 'POST' }),
  stats: () => req('/stats'),
  downloadIcs: async (id: string) => {
    const res = await fetch(`${BASE}/proposals/${id}/ics`, {
      headers: { Authorization: `Bearer ${token()}` },
    })
    if (!res.ok) throw new Error(`${res.status}`)
    const url = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = url; a.download = `deadline_${id}.ics`; a.click()
    URL.revokeObjectURL(url)
  },
}
