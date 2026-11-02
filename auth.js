/**
 * C3 Quiz - Auth & Admin module
 * 用户表 + 会话 + 密码哈希 + 管理员 API
 *
 * 存储:
 *   data/_db/users.json     { username: { u, p, salt, role, created, lastLogin, active } }
 *   data/_db/sessions.json  { tokenHash: { u, created, expires } }
 *
 * 密码: scrypt(N=16384) + 32B 随机 salt,时序安全比较
 * token: 32B 随机 hex, 只存 sha256(token), 明文仅在登录响应给一次
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'data', '_db');
const USERS_FILE = path.join(DB_DIR, 'users.json');
const SESSIONS_FILE = path.join(DB_DIR, 'sessions.json');

const SESSION_TTL = 30 * 24 * 3600 * 1000; // 30 天
const SCRYPT_N = 16384;

// ---------- 文件读写(原子) ----------
function ensureDB() {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, '{}', 'utf-8');
  if (!fs.existsSync(SESSIONS_FILE)) fs.writeFileSync(SESSIONS_FILE, '{}', 'utf-8');
}

function readJSON(file, fallback = {}) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error('[db] read failed', file, e.message);
  }
  return fallback;
}

function writeJSON(file, obj) {
  ensureDB();
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

// ---------- 密码 ----------
function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(String(password), s, 32, { N: SCRYPT_N, r: 8, p: 1 }).toString('hex');
  return { hash: h, salt: s };
}

function verifyPassword(password, salt, expectedHash) {
  try {
    const { hash } = hashPassword(password, salt);
    const a = Buffer.from(hash, 'hex');
    const b = Buffer.from(expectedHash, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

// ---------- Token ----------
function newToken() {
  return crypto.randomBytes(32).toString('hex');
}
function hashToken(t) {
  return crypto.createHash('sha256').update(String(t)).digest('hex');
}

// ---------- 用户 ----------
function getUsers() { return readJSON(USERS_FILE, {}); }
function saveUsers(u) { writeJSON(USERS_FILE, u); }
function getSessions() { return readJSON(SESSIONS_FILE, {}); }
function saveSessions(s) { writeJSON(SESSIONS_FILE, s); }

// 首次启动创建管理员
function ensureAdmin() {
  ensureDB();
  const users = getUsers();
  const adminUser = process.env.ADMIN_USER || 'admin';
  if (!users[adminUser]) {
    const { hash, salt } = hashPassword(process.env.ADMIN_PASS || 'admin123');
    users[adminUser] = {
      u: adminUser,
      p: hash,
      salt,
      role: 'admin',
      name: '管理员',
      created: Date.now(),
      lastLogin: 0,
      active: 1,
    };
    saveUsers(users);
    console.log(`[auth] created admin user "${adminUser}" (change password via ADMIN_PASS env)`);
  }
  return users;
}

// 注册
function register(username, password, displayName, role = 'user') {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(u)) {
    return { error: '用户名需 3-32 位,只能是字母数字 _ . -' };
  }
  if (p.length < 6) return { error: '密码至少 6 位' };
  if (p.length > 128) return { error: '密码太长' };

  const users = getUsers();
  if (users[u]) return { error: '用户名已存在' };

  const { hash, salt } = hashPassword(p);
  users[u] = {
    u,
    p: hash,
    salt,
    role: role === 'admin' ? 'admin' : 'user',
    name: String(displayName || u).slice(0, 32),
    created: Date.now(),
    lastLogin: 0,
    active: 1,
  };
  saveUsers(users);
  console.log(`[auth] registered user "${u}"`);
  return { ok: true, user: publicUser(users[u]) };
}

// 登录
function login(username, password) {
  const u = String(username || '').trim();
  const users = getUsers();
  const rec = users[u];
  if (!rec) return { error: '用户名或密码错误' };
  if (!rec.active) return { error: '账号已被禁用,请联系管理员' };
  if (!verifyPassword(password, rec.salt, rec.p)) return { error: '用户名或密码错误' };

  const token = newToken();
  const sessions = getSessions();
  sessions[hashToken(token)] = { u: rec.u, created: Date.now(), expires: Date.now() + SESSION_TTL };
  saveSessions(sessions);

  rec.lastLogin = Date.now();
  saveUsers(users);

  return { ok: true, token, user: publicUser(rec) };
}

// 登出
function logout(token) {
  if (!token) return { ok: true };
  const sessions = getSessions();
  delete sessions[hashToken(token)];
  saveSessions(sessions);
  return { ok: true };
}

// 校验 token → 用户
function userFromToken(token) {
  if (!token) return null;
  const sessions = getSessions();
  const h = hashToken(token);
  const s = sessions[h];
  if (!s) return null;
  if (Date.now() > s.expires) {
    delete sessions[h];
    saveSessions(sessions);
    return null;
  }
  const users = getUsers();
  const rec = users[s.u];
  if (!rec || !rec.active) return null;
  return rec;
}

function publicUser(rec) {
  return {
    username: rec.u,
    name: rec.name || rec.u,
    role: rec.role || 'user',
    active: !!rec.active,
    created: rec.created,
    lastLogin: rec.lastLogin || 0,
  };
}

// ---------- 管理员操作 ----------
function listUsers() {
  const users = getUsers();
  const sessions = getSessions();
  // 每个用户的活跃 session 数
  const activeSessions = {};
  const now = Date.now();
  for (const s of Object.values(sessions)) {
    if (s.expires > now) activeSessions[s.u] = (activeSessions[s.u] || 0) + 1;
  }
  return Object.values(users).map(rec => ({
    ...publicUser(rec),
    sessions: activeSessions[rec.u] || 0,
  })).sort((a, b) => (b.lastLogin || 0) - (a.lastLogin || 0));
}

function setUserActive(username, active) {
  const users = getUsers();
  if (!users[username]) return { error: '用户不存在' };
  users[username].active = active ? 1 : 0;
  saveUsers(users);
  if (!active) {
    // 禁用后踢掉所有会话
    const sessions = getSessions();
    let changed = false;
    for (const [h, s] of Object.entries(sessions)) {
      if (s.u === username) { delete sessions[h]; changed = true; }
    }
    if (changed) saveSessions(sessions);
  }
  return { ok: true };
}

function setUserRole(username, role) {
  const users = getUsers();
  if (!users[username]) return { error: '用户不存在' };
  if (!['user', 'admin'].includes(role)) return { error: '角色无效' };
  users[username].role = role;
  saveUsers(users);
  return { ok: true };
}

function resetPassword(username, newPass) {
  const users = getUsers();
  if (!users[username]) return { error: '用户不存在' };
  if (String(newPass || '').length < 6) return { error: '密码至少 6 位' };
  const { hash, salt } = hashPassword(newPass);
  users[username].p = hash;
  users[username].salt = salt;
  saveUsers(users);
  // 强制重登
  const sessions = getSessions();
  let changed = false;
  for (const [h, s] of Object.entries(sessions)) {
    if (s.u === username) { delete sessions[h]; changed = true; }
  }
  if (changed) saveSessions(sessions);
  return { ok: true };
}

function deleteUser(username) {
  const users = getUsers();
  if (!users[username]) return { error: '用户不存在' };
  delete users[username];
  saveUsers(users);
  const sessions = getSessions();
  let changed = false;
  for (const [h, s] of Object.entries(sessions)) {
    if (s.u === username) { delete sessions[h]; changed = true; }
  }
  if (changed) saveSessions(sessions);
  return { ok: true };
}

function changePassword(username, oldPass, newPass) {
  const users = getUsers();
  const rec = users[username];
  if (!rec) return { error: '用户不存在' };
  if (!verifyPassword(oldPass, rec.salt, rec.p)) return { error: '原密码错误' };
  if (String(newPass || '').length < 6) return { error: '新密码至少 6 位' };
  const { hash, salt } = hashPassword(newPass);
  rec.p = hash; rec.salt = salt;
  saveUsers(users);
  return { ok: true };
}

// 清理过期会话
function cleanupSessions() {
  const sessions = getSessions();
  const now = Date.now();
  let changed = false;
  for (const [h, s] of Object.entries(sessions)) {
    if (s.expires < now) { delete sessions[h]; changed = true; }
  }
  if (changed) { saveSessions(sessions); console.log('[auth] cleaned expired sessions'); }
}

module.exports = {
  ensureAdmin, ensureDB,
  register, login, logout, userFromToken,
  listUsers, setUserActive, setUserRole, resetPassword, deleteUser, changePassword,
  publicUser, cleanupSessions,
  getUsers,
};
