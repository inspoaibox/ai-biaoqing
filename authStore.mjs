import { mkdirSync } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const databasePath = path.resolve(process.env.STICKER_DB_PATH || './data/sticker.sqlite')
mkdirSync(path.dirname(databasePath), { recursive: true })

const database = new DatabaseSync(databasePath)
database.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);
`)

// Keep the auth schema compatible with databases created before profile
// editing was added. SQLite does not support IF NOT EXISTS for ADD COLUMN,
// so inspect the table first and apply the migration exactly once.
const userColumns = new Set(database.prepare('PRAGMA table_info(users)').all().map((column) => String(column.name)))
if (!userColumns.has('display_name')) {
  database.exec("ALTER TABLE users ADD COLUMN display_name TEXT NOT NULL DEFAULT '管理员'")
}

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000
const adminEmail = String(process.env.STICKER_ADMIN_EMAIL || 'admin@localhost').trim().toLowerCase()
const configuredPassword = String(process.env.STICKER_ADMIN_PASSWORD || '')

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const digest = crypto.scryptSync(password, salt, 64).toString('hex')
  return { salt, digest }
}

function createDevelopmentPassword() {
  return `dev-${crypto.randomBytes(12).toString('base64url')}`
}

function ensureAdminUser() {
  // A changed STICKER_ADMIN_EMAIL must not create a second administrator
  // after the administrator edits their email from the UI.
  const existing = database.prepare("SELECT id, email, role, display_name FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").get()
  if (existing) return existing
  if (!configuredPassword && process.env.NODE_ENV === 'production') {
    throw new Error('生产环境必须设置 STICKER_ADMIN_PASSWORD')
  }
  const password = configuredPassword || createDevelopmentPassword()
  const passwordData = hashPassword(password)
  const id = `user-${crypto.randomUUID()}`
  const now = Date.now()
  database.prepare('INSERT INTO users (id, email, password_hash, password_salt, role, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, adminEmail, passwordData.digest, passwordData.salt, 'admin', '管理员', now, now)
  if (!configuredPassword) {
    console.warn(`[auth] 开发管理员账号：${adminEmail}`)
    console.warn(`[auth] 开发管理员密码（仅首次生成）：${password}`)
  }
  return { id, email: adminEmail, role: 'admin', display_name: '管理员' }
}

const adminUser = ensureAdminUser()

function publicUser(user) {
  return { id: String(user.id), email: String(user.email), displayName: String(user.display_name || user.displayName || '管理员'), role: String(user.role || 'admin') }
}

function profileUser(user) {
  return {
    ...publicUser(user),
    createdAt: Number(user.created_at || 0),
    updatedAt: Number(user.updated_at || 0),
  }
}

function validationError(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function verifyPassword(password, user) {
  const candidate = hashPassword(String(password || ''), user.password_salt).digest
  const candidateBuffer = Buffer.from(candidate, 'hex')
  const storedBuffer = Buffer.from(String(user.password_hash), 'hex')
  return candidateBuffer.length === storedBuffer.length && crypto.timingSafeEqual(candidateBuffer, storedBuffer)
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const index = part.indexOf('=')
    if (index < 0) return cookies
    const key = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (key) cookies[key] = decodeURIComponent(value)
    return cookies
  }, {})
}

export function getSessionCookie(req) {
  return parseCookies(req.headers.cookie).sticker_session || ''
}

export function getUserFromRequest(req) {
  const token = getSessionCookie(req)
  if (!token) return null
  const now = Date.now()
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
  const session = database.prepare('SELECT users.id, users.email, users.role, users.display_name FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').get(tokenHash(token), now)
  return session ? publicUser(session) : null
}

export function authenticate(email, password) {
  const normalizedEmail = String(email || '').trim().toLowerCase()
  const user = database.prepare('SELECT id, email, password_hash, password_salt, role, display_name FROM users WHERE email = ?').get(normalizedEmail)
  if (!user) return null
  return verifyPassword(password, user) ? publicUser(user) : null
}

export function getUserProfile(userId) {
  const user = database.prepare('SELECT id, email, role, display_name, created_at, updated_at FROM users WHERE id = ?').get(String(userId))
  return user ? profileUser(user) : null
}

export function updateUserProfile(userId, input = {}) {
  const user = database.prepare('SELECT id, email, role, display_name, password_hash, password_salt, created_at, updated_at FROM users WHERE id = ?').get(String(userId))
  if (!user) throw validationError('管理员账号不存在')

  const email = String(input.email ?? user.email).trim().toLowerCase()
  const displayName = String(input.displayName ?? user.display_name ?? '管理员').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw validationError('请输入有效的登录邮箱')
  if (!displayName) throw validationError('显示名称不能为空')
  if (displayName.length > 80) throw validationError('显示名称不能超过 80 个字符')

  const newPassword = String(input.newPassword || '')
  const wantsPasswordChange = newPassword.length > 0
  if (wantsPasswordChange) {
    if (newPassword.length < 12) throw validationError('新密码至少需要 12 个字符')
    if (!verifyPassword(input.currentPassword, user)) throw validationError('当前密码错误，无法修改密码')
  }
  if (email !== String(user.email).toLowerCase()) {
    const duplicate = database.prepare('SELECT id FROM users WHERE email = ? AND id <> ?').get(email, String(userId))
    if (duplicate) throw validationError('该邮箱已被其他账号使用')
  }

  const now = Date.now()
  if (wantsPasswordChange) {
    const passwordData = hashPassword(newPassword)
    database.prepare('UPDATE users SET email = ?, display_name = ?, password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?').run(email, displayName, passwordData.digest, passwordData.salt, now, String(userId))
    // A password change revokes every old browser/device session. The caller
    // will immediately issue one fresh session for the current browser.
    database.prepare('DELETE FROM sessions WHERE user_id = ?').run(String(userId))
  } else {
    database.prepare('UPDATE users SET email = ?, display_name = ?, updated_at = ? WHERE id = ?').run(email, displayName, now, String(userId))
  }
  return { user: getUserProfile(userId), passwordChanged: wantsPasswordChange }
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url')
  const now = Date.now()
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now)
  database.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(tokenHash(token), userId, now + SESSION_TTL_MS, now)
  return { token, maxAge: Math.floor(SESSION_TTL_MS / 1000) }
}

export function deleteSession(req) {
  const token = getSessionCookie(req)
  if (token) database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token))
}

export function sessionCookie(token, maxAge = Math.floor(SESSION_TTL_MS / 1000)) {
  const values = [`sticker_session=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`]
  if (process.env.STICKER_SECURE_COOKIE === '1' || process.env.NODE_ENV === 'production') values.push('Secure')
  return values.join('; ')
}

export function authConfig() {
  const current = database.prepare("SELECT email FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").get()
  return { configured: Boolean(configuredPassword || process.env.NODE_ENV !== 'production'), email: current?.email || adminUser.email }
}
