/**
 * C3 Quiz - Backend API
 * Zero dependencies. Node.js >= 16.
 *
 * Endpoints:
 *   GET  /api/sets                 -> 题库索引 (小,手机首屏用)
 *   GET  /api/sets/:name           -> 单个题库元信息
 *   GET  /api/questions/:name?page=1&size=50&shuffle=1
 *                                -> 分页取题 (手机端省流量)
 *   GET  /api/questions/:name/random?count=30
 *                                -> 随机抽题组卷
 *   POST /api/progress             -> 保存进度 {uid, wrong, fav, stats}
 *   GET  /api/progress?uid=xxx     -> 读取进度
 *   DELETE /api/progress?uid=xxx   -> 清空进度
 *   GET  /api/health               -> 健康检查
 *
 * Progress storage: JSON file on disk (data/progress/<uid>.json)
 * For production you may swap the store for Redis/Postgres - see STORAGE notes.
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const auth = require('./auth');

const PORT = process.env.PORT || 8787;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const PROGRESS_DIR = path.join(ROOT, 'data', '_progress');
const WEB_DIR = path.join(ROOT, 'web');

// ---------- 索引缓存 ----------
let SETS_CACHE = null;
let SETS_CACHE_TIME = 0;
const CACHE_TTL = 60 * 1000; // 60s

function loadSets() {
  const now = Date.now();
  if (SETS_CACHE && now - SETS_CACHE_TIME < CACHE_TTL) return SETS_CACHE;
  try {
    const raw = fs.readFileSync(path.join(ROOT, 'sets_c3_2025.json'), 'utf-8');
    SETS_CACHE = JSON.parse(raw);
    SETS_CACHE_TIME = now;
    console.log(`[sets] loaded ${SETS_CACHE.length} banks`);
  } catch (e) {
    console.error('[sets] load failed:', e.message);
    SETS_CACHE = SETS_CACHE || [];
  }
  return SETS_CACHE;
}

// 题库题目缓存(懒加载,LRU 太重就简单 Map)
const QS_CACHE = new Map();

function loadQuestions(file) {
  if (QS_CACHE.has(file)) return QS_CACHE.get(file);
  const p = path.join(DATA_DIR, path.basename(file));
  try {
    const raw = fs.readFileSync(p, 'utf-8');
    const arr = JSON.parse(raw);
    // 精简:去掉前端不用的字段,减小体积
    const slim = arr.map(q => ({
      id: q.id,
      t: q.type,
      q: q.question,
      o: q.options,
      a: q.answer,
      c: q.category || '',
      // 只保留有内容的解析(体积大,仅在请求解析时给)
      av: q.analysis_v2 ? {
        p: q.analysis_v2.core_point || '',
        r: q.analysis_v2.answer_reason || '',
        o: (q.analysis_v2.option_analysis || []).map(x => ({
          o: x.option, t: x.text || '', c: !!x.correct, r: x.reason || ''
        })),
        l: (q.analysis_v2.highlights && q.analysis_v2.highlights.laws) || []
      } : null,
      a1: q.analysis || ''
    }));
    QS_CACHE.set(file, slim);
    console.log(`[qs] loaded ${file} -> ${slim.length} questions`);
    return slim;
  } catch (e) {
    console.error(`[qs] load failed ${file}:`, e.message);
    return [];
  }
}

// ---------- 进度存储 ----------
function ensureProgressDir() {
  if (!fs.existsSync(PROGRESS_DIR)) {
    fs.mkdirSync(PROGRESS_DIR, { recursive: true });
  }
}

function progressPath(uid) {
  // 防目录穿越
  const safe = String(uid).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return path.join(PROGRESS_DIR, safe + '.json');
}

function saveProgress(uid, data) {
  ensureProgressDir();
  const p = progressPath(uid);
  const payload = {
    uid,
    updatedAt: Date.now(),
    wrong: data.wrong || {},
    fav: data.fav || {},
    stats: data.stats || {},
    settings: data.settings || {},
  };
  // 原子写
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(payload), 'utf-8');
  fs.renameSync(tmp, p);
  return payload;
}

function loadProgress(uid) {
  const p = progressPath(uid);
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8'));
    }
  } catch (e) {
    console.error('[progress] read failed:', e.message);
  }
  return null;
}

// ---------- Token 提取 ----------
function getToken(req, query) {
  // 优先级: Authorization: Bearer > X-Token > query.token
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7).trim();
  }
  const xToken = req.headers['x-token'];
  if (xToken) return String(xToken).trim();
  if (query && query.get) return query.get('token');
  return null;
}

// ---------- HTTP helpers ----------
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function sendFile(res, filePath, mime, req) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      return json(res, 404, { error: 'not found' });
    }
    const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304);
      return res.end();
    }
    const type = mime || {
      '.html': 'text/html; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.webmanifest': 'application/manifest+json',
    }[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

    const isHtml = type.startsWith('text/html');
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'ETag': etag,
      'Cache-Control': isHtml ? 'no-cache' : 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath).pipe(res);
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > 5 * 1024 * 1024) { // 5MB 上限
        req.destroy();
        return reject(new Error('payload too large'));
      }
      data += c;
    });
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(parsed.pathname);
  const query = parsed.searchParams;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  try {
    // ---- API ----
    if (pathname === '/api/health') {
      return json(res, 200, { ok: true, ts: Date.now(), banks: loadSets().length });
    }

    if (pathname === '/api/sets') {
      const sets = loadSets();
      // 手机端要精简
      const slim = sets.map(s => ({
        n: s.name,
        l: s.label,
        c: s.count,
        d: s.desc,
        a: s.has_analysis ? 1 : 0,
      }));
      return json(res, 200, { sets: slim, total: sets.reduce((a, s) => a + s.count, 0) });
    }

    if (pathname.startsWith('/api/questions/')) {
      // 未登录不给题目 —— 保证每个刷题记录都能归属到具体用户
      const authUser = auth.userFromToken(getToken(req, query));
      if (!authUser) return json(res, 401, { error: '请先登录' });

      const rest = pathname.slice('/api/questions/'.length);
      const [name, sub] = rest.split('/');
      const sets = loadSets();
      const set = sets.find(s => s.name === name);
      if (!set) return json(res, 404, { error: 'bank not found' });

      let qs = loadQuestions(set.file);
      if (!qs.length) return json(res, 404, { error: 'bank empty' });

      // 随机抽题组卷
      if (sub === 'random') {
        const count = Math.min(parseInt(query.get('count')) || 30, 200);
        const pool = qs.slice();
        // Fisher-Yates 部分洗牌
        for (let i = 0; i < count && i < pool.length; i++) {
          const j = i + Math.floor(Math.random() * (pool.length - i));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        const picked = pool.slice(0, count);
        // 去掉解析(省流量),可另请求
        const light = picked.map(q => ({ ...q, av: undefined, a1: undefined }));
        return json(res, 200, { bank: name, total: qs.length, count: light.length, questions: light });
      }

      // 分页
      let page = parseInt(query.get('page')) || 1;
      let size = Math.min(parseInt(query.get('size')) || 50, 200);
      if (query.get('shuffle') === '1') {
        const pool = qs.slice();
        for (let i = 0; i < pool.length; i++) {
          const j = i + Math.floor(Math.random() * (pool.length - i));
          [pool[i], pool[j]] = [pool[j], pool[i]];
        }
        qs = pool;
      }
      const total = qs.length;
      const start = (page - 1) * size;
      const slice = qs.slice(start, start + size);
      const withAnalysis = query.get('analysis') !== '0';
      const out = slice.map(q => ({
        ...q,
        av: withAnalysis ? q.av : undefined,
        a1: withAnalysis ? q.a1 : undefined,
      }));
      return json(res, 200, {
        bank: name, page, size, total,
        pages: Math.ceil(total / size),
        questions: out,
      });
    }

    // ---- Auth ----
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const body = await readBody(req);
      const r = auth.register(body.username, body.password, body.name, 'user');
      if (r.error) return json(res, 400, r);
      return json(res, 200, r);
    }

    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const body = await readBody(req);
      const r = auth.login(body.username, body.password);
      if (r.error) return json(res, 401, r);
      return json(res, 200, r);
    }

    if (pathname === '/api/auth/logout' && req.method === 'POST') {
      const token = getToken(req, query);
      auth.logout(token);
      return json(res, 200, { ok: true });
    }

    if (pathname === '/api/auth/me') {
      const token = getToken(req, query);
      const user = auth.userFromToken(token);
      if (!user) return json(res, 401, { error: '未登录或会话过期' });
      return json(res, 200, { user: auth.publicUser(user) });
    }

    if (pathname === '/api/auth/password' && req.method === 'POST') {
      const token = getToken(req, query);
      const user = auth.userFromToken(token);
      if (!user) return json(res, 401, { error: '未登录' });
      const body = await readBody(req);
      const r = auth.changePassword(user.u, body.oldPassword, body.newPassword);
      if (r.error) return json(res, 400, r);
      return json(res, 200, r);
    }

    // ---- Admin ----
    if (pathname.startsWith('/api/admin/')) {
      const token = getToken(req, query);
      const user = auth.userFromToken(token);
      if (!user) return json(res, 401, { error: '未登录' });
      if (user.role !== 'admin') return json(res, 403, { error: '需要管理员权限' });

      const sub = pathname.slice('/api/admin/'.length);

      if (sub === 'users' && req.method === 'GET') {
        return json(res, 200, { users: auth.listUsers() });
      }

      if (sub === 'stats' && req.method === 'GET') {
        // 全站统计:每个用户的进度摘要
        const users = auth.listUsers();
        const rows = [];
        for (const u of users) {
          const p = loadProgress(u.username);
          const st = (p && p.stats) || {};
          rows.push({
            username: u.username,
            name: u.name,
            role: u.role,
            active: u.active,
            lastLogin: u.lastLogin,
            created: u.created,
            answered: st.answered || 0,
            correct: st.correct || 0,
            accuracy: st.answered ? Math.round((st.correct || 0) / st.answered * 100) : 0,
            sessions: st.sessions || 0,
            wrongCount: p ? Object.keys(p.wrong || {}).length : 0,
            favCount: p ? Object.keys(p.fav || {}).length : 0,
            bySet: st.bySet || {},
            progressUpdated: p ? p.updatedAt : 0,
          });
        }
        const totalAnswered = rows.reduce((a, r) => a + r.answered, 0);
        const totalCorrect = rows.reduce((a, r) => a + r.correct, 0);
        return json(res, 200, {
          rows,
          summary: {
            users: rows.length,
            activeUsers: rows.filter(r => r.lastLogin > 0).length,
            totalAnswered,
            totalCorrect,
            accuracy: totalAnswered ? Math.round(totalCorrect / totalAnswered * 100) : 0,
            totalWrong: rows.reduce((a, r) => a + r.wrongCount, 0),
          },
        });
      }

      if (sub === 'user/progress' && req.method === 'GET') {
        const uname = query.get('username');
        if (!uname) return json(res, 400, { error: 'username required' });
        const p = loadProgress(uname);
        return json(res, 200, { username: uname, progress: p || null });
      }

      if (sub === 'user/active' && req.method === 'POST') {
        const body = await readBody(req);
        const r = auth.setUserActive(body.username, !!body.active);
        if (r.error) return json(res, 400, r);
        return json(res, 200, r);
      }

      if (sub === 'user/role' && req.method === 'POST') {
        const body = await readBody(req);
        const r = auth.setUserRole(body.username, body.role);
        if (r.error) return json(res, 400, r);
        return json(res, 200, r);
      }

      if (sub === 'user/reset-password' && req.method === 'POST') {
        const body = await readBody(req);
        const r = auth.resetPassword(body.username, body.newPassword);
        if (r.error) return json(res, 400, r);
        return json(res, 200, r);
      }

      if (sub === 'user/delete' && req.method === 'POST') {
        const body = await readBody(req);
        if (body.username === user.u) return json(res, 400, { error: '不能删除自己' });
        const r = auth.deleteUser(body.username);
        if (r.error) return json(res, 400, r);
        return json(res, 200, r);
      }

      if (sub === 'user/reset-progress' && req.method === 'POST') {
        const body = await readBody(req);
        const p = progressPath(body.username);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
        return json(res, 200, { ok: true });
      }

      return json(res, 404, { error: 'unknown admin endpoint' });
    }

    // ---- Progress (按登录用户隔离) ----
    if (pathname === '/api/progress') {
      const token = getToken(req, query);
      const user = auth.userFromToken(token);
      // 登录用户:uid 用用户名(保证后台能看到)
      // 未登录:用匿名 uid(保持旧的免登录可用性)
      const uid = user ? user.u : (query.get('uid') || (req.headers['x-uid']));
      if (!uid) return json(res, 400, { error: 'uid required' });

      if (req.method === 'GET') {
        const p = loadProgress(uid);
        return json(res, 200, p || { uid, wrong: {}, fav: {}, stats: {}, settings: {} });
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        // 登录用户不允许伪造 uid
        const u = user ? user.u : (body.uid || uid);
        if (!u) return json(res, 400, { error: 'uid required' });
        const saved = saveProgress(u, body);
        return json(res, 200, { ok: true, updatedAt: saved.updatedAt });
      }
      if (req.method === 'DELETE') {
        const p = progressPath(uid);
        try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch (e) {}
        return json(res, 200, { ok: true });
      }
    }

    // ---- 静态文件 ----
    if (pathname === '/') pathname = '/index.html';

    // 防目录穿越
    const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
    const filePath = path.join(WEB_DIR, safePath);
    if (!filePath.startsWith(WEB_DIR)) {
      return json(res, 403, { error: 'forbidden' });
    }
    return sendFile(res, filePath, null, req);

  } catch (e) {
    console.error('[error]', req.method, pathname, e.message);
    return json(res, 500, { error: 'internal error', msg: e.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`C3 Quiz backend listening on http://${HOST}:${PORT}`);
  console.log(`Web root: ${WEB_DIR}`);
  try {
    auth.ensureAdmin();
    auth.ensureDB();
    auth.cleanupSessions();
    console.log(`Admin panel: http://${HOST}:${PORT}/admin.html`);
  } catch (e) {
    console.error('[auth] init failed:', e.message);
  }
});

// 每小时清理过期会话
setInterval(() => {
  try { auth.cleanupSessions(); } catch (e) {}
}, 3600 * 1000).unref();

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
