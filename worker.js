/**
 * C3 安全员刷题 · Cloudflare Worker
 *
 * 运行时:Cloudflare Workers (nodejs_compat)
 * 存储:  Workers KV (绑定名 C3_KV)
 * 静态:  env.ASSETS 绑定(public/ 目录,含题库 + 前端)
 *
 * 部署:
 *   npx wrangler deploy
 */
import crypto from 'node:crypto';

// ── 存储(KV) ──
const KV_KEY = {
  users: 'users',
  sessions: 'sessions',
};

async function kvGet(env, key) {
  const kv = env.C3_KV;
  if (!kv) throw new Error('缺少 KV 绑定 C3_KV');
  const raw = await kv.get(key, 'json');
  return raw === null || raw === undefined ? null : raw;
}

async function kvSet(env, key, value) {
  const kv = env.C3_KV;
  if (!kv) throw new Error('缺少 KV 绑定 C3_KV');
  await kv.put(key, JSON.stringify(value));
}

async function kvDel(env, key) {
  const kv = env.C3_KV;
  if (!kv) throw new Error('缺少 KV 绑定 C3_KV');
  await kv.delete(key);
}

async function kvList(env, prefix) {
  const kv = env.C3_KV;
  const out = [];
  let cursor;
  do {
    const res = await kv.list({ prefix: prefix || '', cursor });
    for (const k of res.keys) out.push(k.name);
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);
  return out;
}

// ── 密码(scrypt, nodejs_compat 提供 crypto) ──
const SCRYPT_N = 16384;
const SESSION_TTL = 30 * 24 * 3600 * 1000;

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

const newToken = () => crypto.randomBytes(32).toString('hex');
const hashToken = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');

// ── 用户 ──
async function getUsers(env) {
  return (await kvGet(env, KV_KEY.users)) || {};
}
async function saveUsers(env, u) {
  await kvSet(env, KV_KEY.users, u);
}
async function getSessions(env) {
  return (await kvGet(env, KV_KEY.sessions)) || {};
}
async function saveSessions(env, s) {
  await kvSet(env, KV_KEY.sessions, s);
}

function publicUser(rec) {
  if (!rec) return null;
  return {
    username: rec.u,
    name: rec.name || rec.u,
    role: rec.role || 'user',
    active: !!rec.active,
    created: rec.created || 0,
    lastLogin: rec.lastLogin || 0,
  };
}

async function ensureAdmin(env) {
  const users = await getUsers(env);
  const adminUser = env.ADMIN_USER || 'admin';
  if (!users[adminUser]) {
    const { hash, salt } = hashPassword(env.ADMIN_PASS || 'C3@Quiz2026');
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
    await saveUsers(env, users);
    console.log(`[auth] created admin "${adminUser}"`);
  }
  return users;
}

async function register(env, username, password, displayName) {
  const u = String(username || '').trim();
  const p = String(password || '');
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(u)) return { error: '用户名需 3-32 位,只能是字母数字 _ . -' };
  if (p.length < 6) return { error: '密码至少 6 位' };
  if (p.length > 128) return { error: '密码太长' };

  const users = await getUsers(env);
  if (users[u]) return { error: '用户名已存在' };

  const { hash, salt } = hashPassword(p);
  users[u] = {
    u, p: hash, salt,
    role: 'user',
    name: String(displayName || u).slice(0, 32),
    created: Date.now(),
    lastLogin: 0,
    active: 1,
  };
  await saveUsers(env, users);
  return { ok: true, user: publicUser(users[u]) };
}

async function login(env, username, password) {
  const u = String(username || '').trim();
  const users = await getUsers(env);
  const rec = users[u];
  if (!rec) return { error: '用户名或密码错误' };
  if (!rec.active) return { error: '账号已被禁用,请联系管理员' };
  if (!verifyPassword(password, rec.salt, rec.p)) return { error: '用户名或密码错误' };

  const token = newToken();
  const sessions = await getSessions(env);
  sessions[hashToken(token)] = { u: rec.u, created: Date.now(), expires: Date.now() + SESSION_TTL };
  await saveSessions(env, sessions);

  rec.lastLogin = Date.now();
  await saveUsers(env, users);
  return { ok: true, token, user: publicUser(rec) };
}

async function logout(env, token) {
  if (!token) return { ok: true };
  const sessions = await getSessions(env);
  delete sessions[hashToken(token)];
  await saveSessions(env, sessions);
  return { ok: true };
}

async function userFromToken(env, token) {
  if (!token) return null;
  const sessions = await getSessions(env);
  const s = sessions[hashToken(token)];
  if (!s) return null;
  if (s.expires && s.expires < Date.now()) {
    delete sessions[hashToken(token)];
    await saveSessions(env, sessions);
    return null;
  }
  const users = await getUsers(env);
  const rec = users[s.u];
  if (!rec || !rec.active) return null;
  return publicUser(rec);
}

// ── 进度 ──
const progressKey = (uid) => `progress:${uid}`;

async function loadProgress(env, uid) {
  return await kvGet(env, progressKey(uid));
}
async function saveProgress(env, uid, body) {
  const cur = (await loadProgress(env, uid)) || {};
  const payload = {
    uid,
    wrong: body.wrong || cur.wrong || {},
    fav: body.fav || cur.fav || {},
    stats: body.stats || cur.stats || {},
    settings: body.settings || cur.settings || {},
    updatedAt: Date.now(),
  };
  await kvSet(env, progressKey(uid), payload);
  return payload;
}

// ── HTTP 工具 ──
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Token',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS, ...extra },
  });
}

function getToken(req, url) {
  const auth = req.headers.get('authorization');
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7).trim();
  return url.searchParams.get('token') || req.headers.get('x-token') || '';
}

async function readBody(req) {
  try {
    const t = await req.text();
    return t ? JSON.parse(t) : {};
  } catch (e) {
    return {};
  }
}

// ── 题库缓存 ──
const bankCache = new Map();
const qCache = new Map();

async function loadBanks(env) {
  if (bankCache.has('banks')) return bankCache.get('banks');
  const r = await env.ASSETS.fetch(new Request('https://x.local/sets_c3_2025.json'));
  const j = await r.json();
  bankCache.set('banks', j);
  // name → file 映射(文件路径来自 sets,避免自己拼大小写)
  const map = new Map();
  for (const b of j) map.set(b.name, b.file);
  bankCache.set('fileMap', map);
  return j;
}

async function loadQuestions(env, bank) {
  const key = `q:${bank}`;
  if (qCache.has(key)) return qCache.get(key);
  try {
    const banks = await loadBanks(env);
    const fileMap = bankCache.get('fileMap');
    const file = fileMap.get(bank) || `data/questions_${bank}.json`;
    const r = await env.ASSETS.fetch(new Request(`https://x.local/${file}`));
    if (!r.ok) {
      console.error('asset not found', file, r.status);
      return null;
    }
    const j = await r.json();
    const arr = Array.isArray(j) ? j : (j.questions || []);
    qCache.set(key, arr);
    return arr;
  } catch (e) {
    console.error('loadQuestions error', e);
    return null;
  }
}

function slimQuestion(q) {
  return {
    q: q.question,
    o: q.options,
    a: q.answer,
    c: q.category || '',
    av: q.analysis_v2 ? {
      p: q.analysis_v2.core_point || '',
      d: q.analysis_v2.detailed_explanation || q.analysis_v2.core_point || '',
    } : (q.analysis ? { p: q.analysis, d: q.analysis } : null),
  };
}

// ── 路由 ──
async function handle(req, env, url) {
  const p = url.pathname;

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  // --- 健康检查 ---
  if (p === '/api/health') {
    return json({ ok: true, ts: Date.now(), platform: 'workers', banks: 18 });
  }

  // --- 题库索引 ---
  if (p === '/api/sets') {
    const banks = await loadBanks(env);
    // 与 Node 版保持一致的结构:{ sets:[{n,l,c,d,a}], total }
    const sets = banks.map((b) => ({
      n: b.name,
      l: b.label,
      c: b.count,
      d: b.desc,
      a: b.has_analysis ? 1 : 0,
    }));
    const total = banks.reduce((sum, b) => sum + (b.count || 0), 0);
    return json({ sets, total });
  }

  // --- 取题(必须登录) ---
  if (p.startsWith('/api/questions/')) {
    // 未登录不给题目 —— 保证每个刷题记录都能归属到具体用户
    const authUser = await userFromToken(env, getToken(req, url));
    if (!authUser) return json({ error: '请先登录' }, 401);

    const rest = p.slice('/api/questions/'.length);
    const bank = rest.split('/')[0];
    const isRandom = rest.endsWith('/random');

    const arr = await loadQuestions(env, bank);
    if (!arr) return json({ error: '题库不存在' }, 404);

    if (isRandom) {
      const count = Math.min(parseInt(url.searchParams.get('count') || '20', 10), 100);
      const shuffled = [...arr].sort(() => Math.random() - 0.5);
      return json({
        bank, total: arr.length, count,
        items: shuffled.slice(0, count).map(slimQuestion),
      });
    }

    const page = parseInt(url.searchParams.get('page') || '1', 10);
    const size = Math.min(parseInt(url.searchParams.get('size') || '20', 10), 200);
    const slice = arr.slice((page - 1) * size, page * size);
    return json({
      bank, page, size, total: arr.length,
      items: slice.map(slimQuestion),
    });
  }

  // --- Auth ---
  if (p === '/api/auth/register' && req.method === 'POST') {
    const body = await readBody(req);
    const r = await register(env, body.username, body.password, body.name);
    if (r.error) return json(r, 400);
    return json(r, 200);
  }

  if (p === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const r = await login(env, body.username, body.password);
    if (r.error) return json(r, 401);
    return json(r, 200);
  }

  if (p === '/api/auth/logout' && req.method === 'POST') {
    return json(await logout(env, getToken(req, url)), 200);
  }

  if (p === '/api/auth/me' && req.method === 'GET') {
    const user = await userFromToken(env, getToken(req, url));
    if (!user) return json({ error: '未登录' }, 401);
    return json({ user }, 200);
  }

  // --- Progress ---
  if (p === '/api/progress') {
    const user = await userFromToken(env, getToken(req, url));
    const uid = user ? user.username : url.searchParams.get('uid');
    if (!uid) return json({ error: 'uid required' }, 400);

    if (req.method === 'GET') {
      const data = await loadProgress(env, uid);
      return json(data || { uid, wrong: {}, fav: {}, stats: {}, settings: {} }, 200);
    }
    if (req.method === 'POST') {
      const body = await readBody(req);
      // 登录用户强制用自己的用户名,忽略 body.uid(防伪造)
      const u = user ? user.username : (body.uid || uid);
      const saved = await saveProgress(env, u, body);
      return json({ ok: true, updatedAt: saved.updatedAt }, 200);
    }
    if (req.method === 'DELETE') {
      await kvDel(env, progressKey(uid));
      return json({ ok: true }, 200);
    }
  }

  // --- Admin ---
  if (p.startsWith('/api/admin/')) {
    const user = await userFromToken(env, getToken(req, url));
    if (!user) return json({ error: '未登录' }, 401);
    if (user.role !== 'admin') return json({ error: '需要管理员权限' }, 403);

    const sub = p.slice('/api/admin/'.length);

    if (sub === 'stats' && req.method === 'GET') {
      const users = await getUsers(env);
      const rows = [];
      let totalAnswered = 0, totalCorrect = 0, totalWrong = 0;

      for (const rec of Object.values(users)) {
        const prog = await loadProgress(env, rec.u);
        const st = (prog && prog.stats) || {};
        const answered = st.answered || 0;
        const correct = st.correct || 0;
        const accuracy = answered ? Math.round((correct || 0) / answered * 100) : 0;
        const wrongCount = prog ? Object.keys(prog.wrong || {}).length : 0;

        rows.push({
          username: rec.u,
          name: rec.name || rec.u,
          role: rec.role || 'user',
          active: !!rec.active,
          created: rec.created || 0,
          lastLogin: rec.lastLogin || 0,
          answered,
          correct,
          accuracy,
          sessions: st.sessions || 0,
          wrongCount,
          favCount: prog ? Object.keys(prog.fav || {}).length : 0,
        });
        totalAnswered += answered;
        totalCorrect += correct;
        totalWrong += wrongCount;
      }

      rows.sort((a, b) => b.answered - a.answered);
      const activeUsers = rows.filter((r) => r.active).length;
      return json({
        summary: {
          users: rows.length,
          activeUsers,
          totalAnswered,
          totalCorrect,
          accuracy: totalAnswered ? Math.round((totalCorrect / totalAnswered) * 100) : 0,
          totalWrong,
        },
        rows,
      }, 200);
    }

    if (sub === 'users' && req.method === 'GET') {
      const users = await getUsers(env);
      return json({
        users: Object.values(users).map(publicUser),
      }, 200);
    }

    if (sub.startsWith('user/') && req.method === 'POST') {
      const body = await readBody(req);
      const target = body.username;
      if (!target) return json({ error: 'username required' }, 400);
      const users = await getUsers(env);
      const rec = users[target];
      if (!rec) return json({ error: '用户不存在' }, 404);

      if (sub === 'user/active') {
        if (target === user.username) return json({ error: '不能操作自己' }, 400);
        rec.active = body.active ? 1 : 0;
        if (!rec.active) {
          const sessions = await getSessions(env);
          for (const h of Object.keys(sessions)) {
            if (sessions[h].u === target) delete sessions[h];
          }
          await saveSessions(env, sessions);
        }
        await saveUsers(env, users);
        return json({ ok: true, user: publicUser(rec) }, 200);
      }

      if (sub === 'user/role') {
        if (target === user.username) return json({ error: '不能操作自己' }, 400);
        rec.role = body.role === 'admin' ? 'admin' : 'user';
        await saveUsers(env, users);
        return json({ ok: true, user: publicUser(rec) }, 200);
      }

      if (sub === 'user/reset-password') {
        // 兼容两种字段名:newPassword(前端) / password
        const newPass = String(body.password || body.newPassword || '');
        if (newPass.length < 6) return json({ error: '密码至少 6 位' }, 400);
        const { hash, salt } = hashPassword(newPass);
        rec.p = hash;
        rec.salt = salt;
        await saveUsers(env, users);
        const sessions = await getSessions(env);
        for (const h of Object.keys(sessions)) {
          if (sessions[h].u === target) delete sessions[h];
        }
        await saveSessions(env, sessions);
        return json({ ok: true }, 200);
      }

      if (sub === 'user/reset-progress') {
        await kvDel(env, progressKey(target));
        return json({ ok: true }, 200);
      }

      if (sub === 'user/delete') {
        if (target === user.username) return json({ error: '不能删除自己' }, 400);
        delete users[target];
        await saveUsers(env, users);
        const sessions = await getSessions(env);
        for (const h of Object.keys(sessions)) {
          if (sessions[h].u === target) delete sessions[h];
        }
        await saveSessions(env, sessions);
        await kvDel(env, progressKey(target));
        return json({ ok: true }, 200);
      }
    }

    // 用户详情(含错题)
    // 兼容两种调用:
    //   GET /api/admin/user/progress?username=xxx   (旧版 Node 路径)
    //   GET /api/admin/user/xxx                     (新路径)
    if (sub.startsWith('user/') && req.method === 'GET') {
      let target = sub.slice('user/'.length);
      if (target === 'progress') {
        target = url.searchParams.get('username') || '';
      }
      if (!target) return json({ error: 'username required' }, 400);

      const users = await getUsers(env);
      const rec = users[target];
      if (!rec) return json({ error: '用户不存在' }, 404);
      const prog = await loadProgress(env, target);
      const st = (prog && prog.stats) || {};

      // 扁平结构(Node 版兼容)
      const flat = {
        username: target,
        name: rec.name || target,
        role: rec.role || 'user',
        active: !!rec.active,
        lastLogin: rec.lastLogin || 0,
        created: rec.created || 0,
        answered: st.answered || 0,
        correct: st.correct || 0,
        accuracy: st.answered ? Math.round((st.correct || 0) / st.answered * 100) : 0,
        sessions: st.sessions || 0,
        bySet: st.bySet || {},
        progressUpdated: prog ? prog.updatedAt : 0,
      };

      // 新结构(带错题明细)
      return json({
        ...flat,
        user: publicUser(rec),
        stats: {
          answered: flat.answered,
          correct: flat.correct,
          accuracy: flat.accuracy,
          sessions: flat.sessions,
          bySet: flat.bySet,
        },
        wrong: prog ? (prog.wrong || {}) : {},
        fav: prog ? (prog.fav || {}) : {},
        progress: prog || null,
      }, 200);
    }

    return json({ error: 'unknown admin endpoint' }, 404);
  }

  // --- 静态资源 ---
  // Cloudflare assets 的 html_handling 默认 "auto":
  //   /admin.html → 307 → /admin(浏览器自动跟随,无碍)
  //   /          → 200 index.html
  if (env.ASSETS) return env.ASSETS.fetch(req);

  return json({ error: 'not found' }, 404);
}

// admin 初始化标记(模块级,Workers 里 env 只读)
let adminReady = false;

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    try {
      // 首次调用时确保 admin 存在
      if (!adminReady) {
        adminReady = true;
        try {
          await ensureAdmin(env);
        } catch (e) {
          console.error('ensureAdmin failed', e.message);
        }
      }
      return await handle(req, env, url);
    } catch (e) {
      console.error('worker error', e);
      return json({ error: e.message }, 500);
    }
  },
};
