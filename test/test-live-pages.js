/**
 * 线上 Pages 版实测(用真实 API,jsdom 跑前端)
 * 验证:登录 → 加载题库 → 打开 SD_C 新题库 → 取题 → 作答
 */
const { JSDOM } = require('jsdom');
const path = require('path');
const { ProxyAgent, setGlobalDispatcher } = require('undici');

// Node fetch 不读 HTTP_PROXY 环境变量,得手动挂 ProxyAgent
const PROXY = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || 'http://127.0.0.1:7897';
try {
  setGlobalDispatcher(new ProxyAgent(PROXY));
} catch (e) {
  console.log('⚠️ 代理挂载失败(可能没装 undici):', e.message);
}

const BASE = process.env.BASE_URL || 'https://c3-quiz-ceq.pages.dev';
// 动态注册一个临时账号(每次跑都新建,避免依赖固定账号)
const USER = 'live_' + Date.now().toString(36);
const PASS = 'pass123456';

let passed = 0, failed = 0;
function ok(cond, label, extra) {
  if (cond) { passed++; console.log(`  ✅ ${label}`); }
  else { failed++; console.log(`  ❌ ${label}${extra ? '  ' + extra : ''}`); }
}

(async () => {
  console.log(`=== 线上实测 ${BASE} ===\n`);

  // 1. API 层
  console.log('[1] API 层');
  const health = await (await fetch(`${BASE}/api/health`)).json();
  ok(health.ok === true, 'health', JSON.stringify(health));

  const sets = await (await fetch(`${BASE}/api/sets`)).json();
  ok(sets.total === 7360, `总题数 7360 (实际 ${sets.total})`);
  const sd = sets.sets.find(s => (s.l || '').includes('山东'));
  ok(sd && sd.c === 2304, `山东C类 2304 题 (实际 ${sd && sd.c})`);

  const noAuth = await fetch(`${BASE}/api/questions/sd_c?page=1&size=2`);
  ok(noAuth.status === 401, `未登录取题 401 (实际 ${noAuth.status})`);

  // 注册临时账号
  const reg = await (await fetch(`${BASE}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS, name: '线上实测' }),
  })).json();
  ok(!!reg.ok, `注册临时账号 ${USER}`);

  const login = await (await fetch(`${BASE}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  })).json();
  ok(!!login.token, '登录成功');
  const tok = login.token;

  const qs = await (await fetch(`${BASE}/api/questions/sd_c?page=1&size=3`, {
    headers: { Authorization: `Bearer ${tok}` },
  })).json();
  ok(qs.total === 2304, `SD_C 取题 total=2304 (实际 ${qs.total})`);
  ok(Array.isArray(qs.items) && qs.items.length === 3, `返回 3 题 (实际 ${qs.items && qs.items.length})`);
  const q0 = qs.items[0];
  ok(q0 && q0.q && q0.q.length > 10, `题干非空: ${q0 && q0.q.slice(0, 40)}`);
  ok(q0 && Array.isArray(q0.o), `选项存在: ${q0 && JSON.stringify(q0.o).slice(0, 80)}`);
  ok(q0 && /^[A-E]+$/.test(q0.a), `答案格式正确: ${q0 && q0.a}`);

  // 2. 抽不同页抽查内容(2304 题 / size 20 = 116 页)
  console.log('\n[2] 抽查不同页');
  for (const page of [1, 30, 60, 90, 116]) {
    const r = await (await fetch(`${BASE}/api/questions/sd_c?page=${page}&size=5`, {
      headers: { Authorization: `Bearer ${tok}` },
    })).json();
    const items = r.items || [];
    const valid = items.length > 0 && items.every(it =>
      it.q && it.q.length > 5 && Array.isArray(it.o) &&
      it.o.length >= 2 && /^[A-E]+$/.test(it.a)
    );
    ok(valid, `第 ${page} 页 ${items.length} 题格式正确`);
    if (items[0]) {
      console.log(`      e.g. ${items[0].q.slice(0, 46)}`);
      console.log(`           选项${items[0].o.length}个 答案${items[0].a}`);
    }
  }
  // 超出范围的页应该返回空(不是报错)
  const beyond = await (await fetch(`${BASE}/api/questions/sd_c?page=999&size=5`, {
    headers: { Authorization: `Bearer ${tok}` },
  })).json();
  ok((beyond.items || []).length === 0 && beyond.total === 2304,
    `超出范围页返回空且 total 正确`);

  // 3. 随机组卷
  console.log('\n[3] 随机组卷');
  const rnd = await (await fetch(`${BASE}/api/questions/sd_c/random?count=10`, {
    headers: { Authorization: `Bearer ${tok}` },
  })).json();
  ok(rnd.items && rnd.items.length === 10, `随机 10 题 (实际 ${rnd.items && rnd.items.length})`);

  // 4. 前端 jsdom 加载
  console.log('\n[4] 前端页面');
  const html = await (await fetch(BASE)).text();
  ok(html.includes('C3'), '首页 HTML 正常');

  const dom = new JSDOM(html, {
    url: BASE + '/',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    beforeParse(win) {
      win.fetch = (u, o) => fetch(u.startsWith('http') ? u : BASE + u, o);
      win.localStorage.setItem('c3m-token', tok);
      win.localStorage.setItem('c3m-user', JSON.stringify(login.user));
      win.localStorage.setItem('c3m-uid', USER);
    },
  });
  await new Promise(r => setTimeout(r, 6000));
  const doc = dom.window.document;
  const S = dom.window.S;
  const banks = doc.querySelectorAll('.bank');
  ok(banks.length === 18, `题库卡片 18 个 (实际 ${banks.length})`);
  if (S && S.sets) {
    const sdSet = S.sets.find(s => (s.l || '').includes('山东'));
    ok(sdSet && sdSet.c === 2304, `前端 SD_C count=2304 (实际 ${sdSet && sdSet.c})`);
  }
  ok(doc.body.textContent.includes('登录'), '页面有登录/用户信息');

  console.log(`\n===> 通过 ${passed} 项, 失败 ${failed} 项`);

  // 清理:删掉临时账号(需要管理员权限,失败无所谓)
  try {
    const al = await (await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: process.env.ADMIN_PASS || 'C3@Quiz2026' }),
    })).json();
    if (al.token) {
      await fetch(`${BASE}/api/admin/user/delete`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${al.token}` },
        body: JSON.stringify({ username: USER }),
      });
      console.log(`🧹 已清理临时账号 ${USER}`);
    }
  } catch (e) { /* 忽略 */ }

  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
