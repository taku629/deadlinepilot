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
  run: (source_ids?: string[]) =>
    req('/runs', { method: 'POST', body: JSON.stringify({ source_ids: source_ids || [] }) }),
  runs: () => req('/runs'),
  runDetail: (id: string) => req(`/runs/${id}`),
  deadlines: () => req('/deadlines'),
  deleteDeadline: (id: string) => req(`/deadlines/${id}`, { method: 'DELETE' }),
  proposals: () => req('/proposals'),
  approve: (id: string) => req(`/proposals/${id}/approve`, { method: 'POST' }),
  reject: (id: string) => req(`/proposals/${id}/reject`, { method: 'POST' }),
  stats: () => req('/stats'),
}
