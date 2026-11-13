export type LocalImageResult = {
  created?: number
  data?: Array<{ url?: string; b64_json?: string }>
}

export type LocalMotionResult = {
  id?: string
  status?: string
  output?: string
  url?: string
  data?: Array<{ url?: string; b64_json?: string }>
  frames?: string[]
  dataUrl?: string
}

export type AuthUser = {
  id: string
  email: string
  displayName: string
  role: string
}

export type AuthProfile = AuthUser & {
  createdAt: number
  updatedAt: number
}

export type LocalApiErrorDetails = {
  status?: number
  endpoint?: string
  provider?: unknown
  timedOut?: boolean
  code?: string
  durationMs?: number
}

export class LocalApiError extends Error {
  status?: number
  endpoint?: string
  provider?: unknown
  timedOut?: boolean
  code?: string
  durationMs?: number

  constructor(message: string, details: LocalApiErrorDetails = {}) {
    super(message)
    this.name = 'LocalApiError'
    Object.assign(this, details)
  }
}

async function request<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    method: payload === undefined ? 'GET' : 'POST',
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
    credentials: 'include',
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new LocalApiError(data.error || `本地服务请求失败（${response.status}）`, {
      status: data.status || response.status,
      endpoint: data.endpoint || path,
      provider: data.provider,
      timedOut: Boolean(data.timedOut),
      code: data.code,
      durationMs: data.durationMs,
    })
  }
  return data as T
}

export const localApi = {
  authSession: () => request<{ authenticated: boolean; user: AuthUser }>('/api/auth/session'),
  login: (payload: { email: string; password: string }) => request<{ authenticated: boolean; user: AuthUser }>('/api/auth/login', payload),
  logout: () => request<{ authenticated: false }>('/api/auth/logout', {}),
  authProfile: () => request<{ profile: AuthProfile }>('/api/auth/profile'),
  updateAuthProfile: (payload: { email: string; displayName: string; currentPassword?: string; newPassword?: string }) => request<{ profile: AuthProfile; passwordChanged: boolean }>('/api/auth/profile', payload),
  health: () => request<{ ok: boolean; locator: boolean }>('/api/health'),
  testChannel: (payload: { baseUrl: string; apiKey: string; channelName?: string }) => request<{ data: { data?: Array<{ id: string }> }; durationMs: number }>('/api/ai/test', payload),
  analyze: (payload: Record<string, unknown>, signal?: AbortSignal) => request<Record<string, unknown>>('/api/ai/analysis', payload, signal),
  generateImage: (payload: Record<string, unknown>, signal?: AbortSignal) => request<LocalImageResult>('/api/ai/image', payload, signal),
  generateMotion: (payload: Record<string, unknown>, signal?: AbortSignal) => request<LocalMotionResult>('/api/ai/motion', payload, signal),
  locate: (payload: { frames: string[] }, signal?: AbortSignal) => request<{ frames: Array<Record<string, unknown>>; summary: Record<string, unknown> }>('/api/media/locate', payload, signal),
  usage: () => request<{ data: Array<Record<string, unknown>> }>('/api/usage'),
}

export function imageResultToUrl(result: LocalImageResult) {
  const item = result.data?.[0]
  if (!item) return undefined
  if (item.url) return item.url
  if (item.b64_json) return `data:image/png;base64,${item.b64_json}`
  return undefined
}

export function motionResultToUrl(result: LocalMotionResult) {
  if (result.dataUrl) return result.dataUrl
  if (result.output) return result.output
  if (result.url) return result.url
  const item = result.data?.[0]
  if (!item) return undefined
  if (item.url) return item.url
  if (!item.b64_json) return undefined
  const mimeType = item.b64_json.startsWith('R0lGOD') ? 'image/gif' : item.b64_json.startsWith('iVBORw0KGgo') ? 'image/png' : 'application/octet-stream'
  return `data:${mimeType};base64,${item.b64_json}`
}
