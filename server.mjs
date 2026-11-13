import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import { authenticate, authConfig, createSession, deleteSession, getUserFromRequest, getUserProfile, sessionCookie, updateUserProfile } from './authStore.mjs'

const PORT = Number(process.env.STICKER_SERVER_PORT || 8787)
const MAX_BODY = 32 * 1024 * 1024
// Provider generation requests are intentionally not capped by a fixed
// timeout. Image/GIF models can legitimately take longer than three minutes;
// set STICKER_PROVIDER_TIMEOUT_MS explicitly when a deployment needs a limit.
const PROVIDER_TIMEOUT_MS = Number(process.env.STICKER_PROVIDER_TIMEOUT_MS || 0)
const usageEvents = []
const loginAttempts = new Map()
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_ATTEMPTS = 10

function requestAddress(req) {
  return String(req.socket?.remoteAddress || 'unknown')
}

function canAttemptLogin(req) {
  const now = Date.now()
  const key = requestAddress(req)
  const current = loginAttempts.get(key)
  if (!current || current.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS })
    return true
  }
  return current.count < LOGIN_MAX_ATTEMPTS
}

function recordLoginFailure(req) {
  const key = requestAddress(req)
  const current = loginAttempts.get(key) || { count: 0, resetAt: Date.now() + LOGIN_WINDOW_MS }
  current.count += 1
  loginAttempts.set(key, current)
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload)
  const allowedOrigin = process.env.STICKER_WEB_ORIGIN || 'http://localhost:5173'
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    ...extraHeaders,
  })
  res.end(body)
}

async function readJson(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY) throw new Error('请求体过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  return text ? JSON.parse(text) : {}
}

function normalizeBaseUrl(value) {
  const url = new URL(String(value || ''))
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Base URL 只支持 HTTP 或 HTTPS')
  return url.toString().replace(/\/$/, '')
}

function recordUsage(event) {
  usageEvents.unshift({ id: crypto.randomUUID(), createdAt: new Date().toISOString(), ...event })
  usageEvents.splice(300)
}

async function requestProvider({ baseUrl, apiKey, pathName, body, form, method = 'POST' }) {
  const endpoint = `${normalizeBaseUrl(baseUrl)}${pathName}`
  const headers = { Authorization: `Bearer ${apiKey}` }
  const requestBody = form ?? (method === 'GET' ? undefined : JSON.stringify(body))
  if (!form && method !== 'GET') headers['Content-Type'] = 'application/json'
  const started = Date.now()
  let response
  let raw
  try {
    const requestOptions = {
      method,
      headers,
      body: requestBody,
    }
    if (PROVIDER_TIMEOUT_MS > 0) requestOptions.signal = AbortSignal.timeout(PROVIDER_TIMEOUT_MS)
    response = await fetch(endpoint, requestOptions)
    raw = await response.text()
  } catch (cause) {
    const message = String(cause?.message || cause || '')
    if (PROVIDER_TIMEOUT_MS > 0 && (cause?.name === 'TimeoutError' || /aborted due to timeout|timeout/i.test(message))) {
      const error = new Error(`模型渠道请求超时（${Math.round(PROVIDER_TIMEOUT_MS / 1000)} 秒）`)
      error.status = 504
      error.code = 'PROVIDER_TIMEOUT'
      error.timedOut = true
      error.endpoint = endpoint
      error.durationMs = Date.now() - started
      throw error
    }
    cause.endpoint = endpoint
    cause.durationMs = Date.now() - started
    throw cause
  }
  let parsed
  try { parsed = raw ? JSON.parse(raw) : {} } catch { parsed = { raw } }
  if (!response.ok) {
    const error = new Error(`模型渠道返回 ${response.status}`)
    error.status = response.status
    error.body = parsed
    error.endpoint = endpoint
    error.durationMs = Date.now() - started
    throw error
  }
  return parsed
}

function inferMotionProtocol(modelId) {
  const id = String(modelId || '').toLowerCase()
  // GPT-Image-2.6 Sunburst/Flare and compatible chatgpt-image aliases return
  // animated GIFs through the Image API, not the Videos API.
  if (/gpt[-_]?image|chatgpt[-_]?image|image[-_]?2(?:\.\d+)?/.test(id)) return 'images-gif'
  return 'videos'
}

function dataUrlToBlob(value) {
  const match = String(value || '').match(/^data:([^;,]+)?(?:;base64)?,(.*)$/s)
  if (!match) return null
  const mimeType = match[1] || 'image/png'
  const encoded = match[2] || ''
  const bytes = /;base64/i.test(String(value).slice(0, String(value).indexOf(',')))
    ? Buffer.from(encoded, 'base64')
    : Buffer.from(decodeURIComponent(encoded), 'utf8')
  return new Blob([bytes], { type: mimeType })
}

async function imageInputToBlob(value) {
  const local = dataUrlToBlob(value)
  if (local) return local
  const response = await fetch(String(value), { signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`无法读取参考图（${response.status}）`)
  const bytes = await response.arrayBuffer()
  return new Blob([bytes], { type: response.headers.get('content-type') || 'image/png' })
}

async function buildImageEditForm(body) {
  const form = new FormData()
  form.append('model', String(body.model || ''))
  form.append('prompt', String(body.prompt || ''))
  form.append('size', String(body.size || 'auto'))
  form.append('n', String(body.n || 1))
  form.append('output_format', String(body.output_format || 'gif'))
  form.append('frame_count', String(body.frame_count || 6))
  form.append('frame_duration_ms', String(body.frame_duration_ms || 170))
  const image = await imageInputToBlob(body.input_image)
  form.append('image[]', image, 'reference.png')
  return form
}

function isEditEndpointUnsupported(error) {
  if (![400, 404, 405, 415].includes(error?.status)) return false
  const body = JSON.stringify(error?.body || '').toLowerCase()
  return /not found|unsupported|unknown endpoint|invalid endpoint|method|multipart|image.?edit/.test(body)
}

function runLocalizer(frames) {
  return new Promise((resolve, reject) => {
    const child = spawn('python', ['locate.py'], { windowsHide: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString() })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(stderr.slice(-1200) || `定位器退出 ${code}`))
      try { resolve(JSON.parse(stdout)) } catch { reject(new Error('定位器返回了无效 JSON')) }
    })
    child.stdin.end(JSON.stringify({ frames }))
  })
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, {})
  try {
    const url = new URL(req.url, `http://${req.headers.host}`)
    if (req.method === 'GET' && url.pathname === '/api/auth/session') {
      const user = getUserFromRequest(req)
      if (!user) return sendJson(res, 401, { error: '未登录' })
      return sendJson(res, 200, { authenticated: true, user })
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/login') {
      if (!canAttemptLogin(req)) return sendJson(res, 429, { error: '登录尝试过多，请 15 分钟后再试' })
      const body = await readJson(req)
      const user = authenticate(body.email, body.password)
      if (!user) {
        recordLoginFailure(req)
        return sendJson(res, 401, { error: '邮箱或密码错误' })
      }
      loginAttempts.delete(requestAddress(req))
      const session = createSession(user.id)
      return sendJson(res, 200, { authenticated: true, user }, { 'Set-Cookie': sessionCookie(session.token, session.maxAge) })
    }
    if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
      deleteSession(req)
      return sendJson(res, 200, { authenticated: false }, { 'Set-Cookie': sessionCookie('', 0) })
    }
    if (url.pathname === '/api/auth/profile') {
      const user = getUserFromRequest(req)
      if (!user) return sendJson(res, 401, { error: '未登录' })
      if (req.method === 'GET') {
        const profile = getUserProfile(user.id)
        return profile ? sendJson(res, 200, { profile }) : sendJson(res, 404, { error: '管理员账号不存在' })
      }
      if (req.method === 'POST') {
        const body = await readJson(req)
        const result = updateUserProfile(user.id, body)
        const headers = {}
        if (result.passwordChanged) {
          const session = createSession(user.id)
          headers['Set-Cookie'] = sessionCookie(session.token, session.maxAge)
        }
        return sendJson(res, 200, { profile: result.user, passwordChanged: result.passwordChanged }, headers)
      }
      return sendJson(res, 405, { error: 'Method Not Allowed' })
    }
    if (req.method === 'GET' && url.pathname === '/api/health') return sendJson(res, 200, { ok: true, locator: true, usageEvents: usageEvents.length, auth: authConfig() })
    if (url.pathname.startsWith('/api/') && !getUserFromRequest(req)) return sendJson(res, 401, { error: '请先登录' })
    if (req.method === 'GET' && url.pathname === '/api/usage') return sendJson(res, 200, { data: usageEvents })
    if (req.method !== 'POST') return sendJson(res, 404, { error: 'Not Found' })
    const body = await readJson(req)

    if (url.pathname === '/api/ai/test') {
      const started = Date.now()
      const data = await requestProvider({ baseUrl: body.baseUrl, apiKey: body.apiKey, pathName: '/models', method: 'GET' })
      recordUsage({ role: 'connection', model: '', channel: body.channelName || '', status: 'success', durationMs: Date.now() - started })
      return sendJson(res, 200, { data, durationMs: Date.now() - started })
    }
    if (url.pathname === '/api/ai/analysis') {
      const started = Date.now()
      const data = await requestProvider({ baseUrl: body.baseUrl, apiKey: body.apiKey, pathName: '/chat/completions', body: { model: body.model, messages: body.messages, temperature: body.temperature ?? 0.2, response_format: body.responseFormat ? { type: body.responseFormat } : undefined } })
      recordUsage({ role: 'analysis', model: body.model, channel: body.channelName || '', status: 'success', durationMs: Date.now() - started })
      return sendJson(res, 200, data)
    }
    if (url.pathname === '/api/ai/image') {
      const started = Date.now()
      const data = await requestProvider({ baseUrl: body.baseUrl, apiKey: body.apiKey, pathName: '/images/generations', body: { model: body.model, prompt: body.prompt, size: body.size || '1024x1024', n: body.n || 1, quality: body.quality, background: body.background } })
      recordUsage({ role: 'static', model: body.model, channel: body.channelName || '', status: 'success', durationMs: Date.now() - started })
      return sendJson(res, 200, data)
    }
    if (url.pathname === '/api/ai/motion') {
      const started = Date.now()
      const protocol = body.protocol || inferMotionProtocol(body.model)
      const frameCount = Math.min(16, Math.max(2, Number(body.frameCount) || 6))
      const frameDurationMs = Math.min(2000, Math.max(20, Math.round((Number(body.frameDurationMs) || 170) / 10) * 10))
      let data
      if (protocol === 'images-gif') {
        const imageBody = {
          model: body.model,
          prompt: body.prompt,
          size: body.size || '240x240',
          n: 1,
          output_format: 'gif',
          frame_count: frameCount,
          frame_duration_ms: frameDurationMs,
          input_image: body.inputImage,
        }
        if (body.inputImage) {
          try {
            data = await requestProvider({ baseUrl: body.baseUrl, apiKey: body.apiKey, pathName: '/images/edits', form: await buildImageEditForm(imageBody) })
          } catch (error) {
            if (!isEditEndpointUnsupported(error)) throw error
            data = await requestProvider({ baseUrl: body.baseUrl, apiKey: body.apiKey, pathName: '/images/generations', body: imageBody })
          }
        } else {
          data = await requestProvider({ baseUrl: body.baseUrl, apiKey: body.apiKey, pathName: '/images/generations', body: imageBody })
        }
      } else {
        data = await requestProvider({ baseUrl: body.baseUrl, apiKey: body.apiKey, pathName: '/videos', body: { model: body.model, prompt: body.prompt, input_image: body.inputImage, duration: body.duration || 1, size: body.size || '240x240', output_format: body.outputFormat || 'gif' } })
      }
      recordUsage({ role: 'motion', model: body.model, channel: body.channelName || '', protocol, status: 'success', durationMs: Date.now() - started })
      return sendJson(res, 200, data)
    }
    if (url.pathname === '/api/media/locate') {
      const result = await runLocalizer(body.frames || [])
      return sendJson(res, 200, result)
    }
    if (url.pathname === '/api/usage') {
      recordUsage(body)
      return sendJson(res, 201, { ok: true })
    }
    return sendJson(res, 404, { error: 'Not Found' })
  } catch (error) {
    const status = error.status || 400
    return sendJson(res, status, {
      error: error.message,
      status,
      code: error.code,
      timedOut: Boolean(error.timedOut),
      endpoint: error.endpoint,
      durationMs: error.durationMs,
      provider: error.body,
    })
  }
}

const server = createServer((req, res) => { handle(req, res) })
// Node's default request timeout can terminate a long-running provider call
// even when fetch itself has no timeout. Disable those server-side limits for
// the proxy; the provider remains responsible for its own generation policy.
server.requestTimeout = 0
server.timeout = 0
server.listen(PORT, 'localhost', () => {
  console.log(`Sticker local server listening on http://localhost:${PORT}`)
})
