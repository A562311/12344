// e2e for auth + admin (real backend, no mock)
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', 'server');
const WEB = path.join(ROOT, 'web');
const DATA = path.join(ROOT, 'data');
const PORT = 8899;

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => console.error('[jsdomErr]', e.message));

(async () => {
  // 用真实 server.js 起服务
  const { spawn } = require('child_process');
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  srv.stdout.on('data', d => { if (process.env.VERBOSE) process.stdout.write('[srv] ' + d); });
  srv.stderr.on('data', d => { if (process.env.VERBOSE) process.stderr.write('[srv!] ' + d); });
  await new Promise(r => setTimeout(r, 2500));

  const BASE = `http://127.0.0.1:${PORT}`;
  const ok = m => console.log('  ✅', m);
  const fail = m => { console.log('  ❌', m); process.exitCode = 1; };

  async function call(method, p, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch(BASE + p, {
      method, headers, body: body ? JSON.stringify(body) : undefined
    });
    let d = null;
    try { d = await res.json(); } catch (e) {}
    return { status: res.status, data: d };
  }

  // 随机后缀:避免上次运行的残留账号导致冲突
  const SFX = Math.random().toString(36).slice(2, 7);
  const UA = 'test_a_' + SFX;
  const UC = 'colleague_' + SFX;

  console.log('=== 1. 注册校验 ===');
  let r = await call('POST', '/api/auth/register', { username: UA, password: 'pass123456', name: '测试A' });
  if (r.status === 200) ok('注册成功'); else fail('注册失败 ' + JSON.stringify(r.data));
  r = await call('POST', '/api/auth/register', { username: UA, password: 'pass123456' });
  if (r.status === 400 && r.data.error.includes('已存在')) ok('重复用户名被拒'); else fail('重复未拒');
  r = await call('POST', '/api/auth/register', { username: 'ab', password: 'pass123456' });
  if (r.status === 400) ok('短用户名被拒'); else fail('短用户名未拒');
  r = await call('POST', '/api/auth/register', { username: 'ok_user', password: '123' });
  if (r.status === 400) ok('短密码被拒'); else fail('短密码未拒');
  r = await call('POST', '/api/auth/register', { username: 'bad user!', password: 'pass123456' });
  if (r.status === 400) ok('非法字符被拒'); else fail('非法字符未拒');

  console.log('\n=== 2. 登录 ===');
  r = await call('POST', '/api/auth/login', { username: UA, password: 'pass123456' });
  if (r.status === 200 && r.data.token) ok('登录成功,拿到 token'); else fail('登录失败');
  const tokenA = r.data.token;
  if (r.data.user.role === 'user') ok('角色=user'); else fail('角色错误');
  r = await call('POST', '/api/auth/login', { username: UA, password: 'wrongpass' });
  if (r.status === 401) ok('错误密码被拒'); else fail('错误密码未拒');
  r = await call('POST', '/api/auth/login', { username: 'nonexist', password: 'x' });
  if (r.status === 401) ok('不存在用户被拒'); else fail('不存在用户未拒');

  console.log('\n=== 3. token 校验 ===');
  r = await call('GET', '/api/auth/me', null, tokenA);
  if (r.status === 200 && r.data.user.username === UA) ok('me 返回正确用户'); else fail('me 错误');
  r = await call('GET', '/api/auth/me', null, 'garbage');
  if (r.status === 401) ok('无效 token 被拒'); else fail('无效 token 未拒');
  r = await call('GET', '/api/auth/me');
  if (r.status === 401) ok('无 token 被拒'); else fail('无 token 未拒');

  console.log('\n=== 4. 越权访问 ===');
  r = await call('GET', '/api/admin/stats', null, tokenA);
  if (r.status === 403) ok('普通用户访问 admin 被拒(403)'); else fail(`期望 403 实际 ${r.status}`);
  r = await call('GET', '/api/admin/users', null, tokenA);
  if (r.status === 403) ok('普通用户访问 users 被拒'); else fail('users 越权未拒');
  r = await call('GET', '/api/admin/stats');
  if (r.status === 401) ok('未登录访问 admin 被拒(401)'); else fail('未登录未拒');
  r = await call('POST', '/api/admin/user/delete', { username: UA }, tokenA);
  if (r.status === 403) ok('普通用户删除被拒'); else fail('删除越权未拒');

  console.log('\n=== 5. 管理员登录 + 后台数据 ===');
  r = await call('POST', '/api/auth/login', { username: 'admin', password: 'C3@Quiz2026' });
  if (r.status === 200) ok('管理员登录'); else fail('管理员登录失败');
  const adminToken = r.data.token;
  if (r.data.user.role === 'admin') ok('管理员角色正确'); else fail('角色错');

  // 造数据
  await call('POST', '/api/auth/register', { username: UC, password: 'pass123456', name: '同事一' });
  r = await call('POST', '/api/auth/login', { username: UC, password: 'pass123456' });
  const tokenC = r.data.token;
  await call('POST', '/api/progress', { stats: { answered: 50, correct: 42, sessions: 4, bySet: { sd_c: { answered: 50, correct: 42 } } }, wrong: { q1: { q: '错题1', a: 'C', count: 3 }, q2: { q: '错题2', a: 'A', count: 1 } } }, tokenC);
  await call('POST', '/api/progress', { stats: { answered: 20, correct: 10, sessions: 2 } }, tokenA);

  r = await call('GET', '/api/admin/stats', null, adminToken);
  if (r.status === 200) ok('admin/stats 200'); else fail('admin/stats ' + r.status);
  console.log('    summary:', JSON.stringify(r.data.summary));
  const rows = r.data.rows;
  const c1 = rows.find(x => x.username === UC);
  if (c1 && c1.answered === 50 && c1.accuracy === 84) ok('同事进度正确(50题/84%)');
  else fail('同事进度错误: ' + JSON.stringify(c1));
  if (r.data.summary.users >= 3) ok(`用户数 ${r.data.summary.users}`);
  // 总答题 = 同事50 + 用户A20 + 历史遗留(不固定,只校验 >= 70)
  if (r.data.summary.totalAnswered >= 70) ok(`总答题 ${r.data.summary.totalAnswered} (>=70)`);
  else fail('总答题 ' + r.data.summary.totalAnswered);

  console.log('\n=== 6. 进度隔离 ===');
  r = await call('GET', '/api/progress', null, tokenA);
  if (r.data.stats.answered === 20) ok('用户A 看到自己的 20 题');
  else fail('用户A 数据串了: ' + r.data.stats.answered);
  r = await call('GET', '/api/progress', null, tokenC);
  if (r.data.stats.answered === 50) ok('同事看到自己的 50 题');
  else fail('同事数据串了');
  r = await call('GET', '/api/progress', null, adminToken);
  if (r.data.uid === 'admin') ok('管理员自己的进度独立');

  console.log('\n=== 7. uid 伪造防护 ===');
  await call('POST', '/api/progress', { uid: 'HACKED', stats: { answered: 999 } }, tokenC);
  r = await call('GET', '/api/progress', null, tokenC);
  if (r.data.uid === UC && r.data.stats.answered === 999) ok('uid 被强制为用户名(数据写入正确用户)');
  else fail('uid 伪造未阻止: ' + r.data.uid);

  console.log('\n=== 8. 管理员操作 ===');
  r = await call('POST', '/api/admin/user/active', { username: UC, active: false }, adminToken);
  if (r.status === 200) ok('禁用用户'); else fail('禁用失败');
  r = await call('GET', '/api/auth/me', null, tokenC);
  if (r.status === 401) ok('禁用后会话立即失效'); else fail('禁用后会话仍有效');
  r = await call('POST', '/api/auth/login', { username: UC, password: 'pass123456' });
  if (r.status === 401) ok('禁用后无法登录'); else fail('禁用后仍能登录');

  r = await call('POST', '/api/admin/user/active', { username: UC, active: true }, adminToken);
  r = await call('POST', '/api/auth/login', { username: UC, password: 'pass123456' });
  if (r.status === 200) ok('重新启用后可登录'); else fail('重新启用失败');

  r = await call('POST', '/api/admin/user/role', { username: UC, role: 'admin' }, adminToken);
  if (r.status === 200) ok('提升为管理员'); else fail('提升角色失败');
  r = await call('POST', '/api/auth/login', { username: UC, password: 'pass123456' });
  const newAdminToken = r.data.token;
  r = await call('GET', '/api/admin/stats', null, newAdminToken);
  if (r.status === 200) ok('新管理员能访问后台'); else fail('新管理员无法访问');
  await call('POST', '/api/admin/user/role', { username: UC, role: 'user' }, adminToken);

  r = await call('POST', '/api/admin/user/reset-password', { username: UC, newPassword: 'newpass123' }, adminToken);
  if (r.status === 200) ok('重置密码'); else fail('重置密码失败');
  r = await call('POST', '/api/auth/login', { username: UC, password: 'newpass123' });
  if (r.status === 200) ok('新密码可登录'); else fail('新密码登录失败');

  console.log('\n=== 9. 管理员操作自己 ===');
  r = await call('POST', '/api/admin/user/delete', { username: 'admin' }, adminToken);
  if (r.status === 400) ok('不能删除自己'); else fail('删除自己未被阻止');
  r = await call('POST', '/api/admin/user/delete', { username: 'nonexistent' }, adminToken);
  if (r.status === 400) ok('删除不存在用户报错'); else fail('应报错');

  console.log('\n=== 10. 后台页面渲染 ===');
  let html = fs.readFileSync(path.join(WEB, 'admin.html'), 'utf-8');
  html = html.replace('<script>',
`<script>
window.fetch=function(u,o){o=o||{};var h=Object.assign({},o.headers||{});return new Promise(function(r,j){var x=new XMLHttpRequest();x.open(o.method||'GET',u);for(var k in h)x.setRequestHeader(k,h[k]);x.onload=function(){var d=null;try{d=JSON.parse(x.responseText)}catch(e){};r({ok:x.status>=200&&x.status<300,status:x.status,json:function(){return Promise.resolve(d||{})}})};x.onerror=j;x.send(o.body);});};
</script><script>`);
  // 在脚本执行前注入 token(localStorage 在 dom 构造后才有,所以用 beforeParse)
  const dom = new JSDOM(html, {
    url: `${BASE}/admin.html`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(window) {
      window.localStorage.setItem('c3m-token', adminToken);
    },
  });
  dom.window.confirm = () => true;
  dom.window.prompt = () => 'newpass456';
  dom.window.alert = () => {};
  await new Promise(r => setTimeout(r, 2500));

  const doc = dom.window.document;
  const kpis = doc.querySelectorAll('.kpi');
  console.log(`    KPI 数: ${kpis.length}`);
  if (kpis.length >= 4) ok('后台 KPI 渲染'); else fail('KPI 缺失');
  const rowsRendered = doc.querySelectorAll('.tbl tbody tr');
  console.log(`    表格行数: ${rowsRendered.length}`);
  if (rowsRendered.length >= 3) ok('用户表格渲染'); else fail('表格行数 ' + rowsRendered.length);
  const tabs = doc.querySelectorAll('.tab');
  if (tabs.length === 3) ok('Tab 渲染(进度/排行榜/用户管理)');
  else fail('Tab 数量 ' + tabs.length + '(应为 3)');
  const rankTab = Array.from(tabs).find(t => t.textContent.includes('排行榜'));
  if (rankTab) ok('有排行榜 Tab'); else fail('缺排行榜 Tab');
  const exportBtn = Array.from(doc.querySelectorAll('button')).find(b => b.textContent.includes('导出进度'));
  if (exportBtn) ok('有导出按钮'); else fail('缺导出按钮');

  console.log('\n=== 11. 后台切到用户管理 Tab ===');
  const usersTab = Array.from(tabs).find(t => t.textContent.includes('用户管理'));
  usersTab?.click();
  await new Promise(r => setTimeout(r, 400));
  const userCards = doc.querySelectorAll('.card');
  console.log(`    用户卡片: ${userCards.length}`);
  if (userCards.length >= 3) ok('用户管理列表渲染'); else fail('用户管理列表 ' + userCards.length);
  const hasAdminTag = Array.from(doc.querySelectorAll('.tag')).some(t => t.textContent.includes('管理员'));
  if (hasAdminTag) ok('管理员标签显示'); else fail('管理员标签缺失');

  console.log('\n=== 12. 登录页渲染 (前端) ===');
  let idxHtml = fs.readFileSync(path.join(WEB, 'index.html'), 'utf-8');
  idxHtml = idxHtml.replace('<script>',
`<script>
window.fetch=function(u,o){o=o||{};var h=Object.assign({},o.headers||{});return new Promise(function(r,j){var x=new XMLHttpRequest();x.open(o.method||'GET',u);for(var k in h)x.setRequestHeader(k,h[k]);x.onload=function(){var d=null;try{d=JSON.parse(x.responseText)}catch(e){};r({ok:x.status>=200&&x.status<300,status:x.status,json:function(){return Promise.resolve(d||{})},text:function(){return Promise.resolve(x.responseText)}})};x.onerror=j;x.send(o.body);});};
</script><script>`);
  const dom2 = new JSDOM(idxHtml, {
    url: `${BASE}/index.html`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  dom2.window.confirm = () => true;
  dom2.window.alert = () => {};
  await new Promise(r => setTimeout(r, 2500));
  const doc2 = dom2.window.document;
  const loginBtn = Array.from(doc2.querySelectorAll('.btn')).find(b => b.textContent.includes('登录'));
  if (loginBtn) ok('首页有登录按钮'); else fail('无登录按钮');
  // 点登录 → 出登录页
  loginBtn?.click();
  await new Promise(r => setTimeout(r, 400));
  const inputs = doc2.querySelectorAll('.inp');
  console.log(`    登录页输入框: ${inputs.length}`);
  if (inputs.length >= 2) ok('登录表单渲染'); else fail('登录表单缺失');
  const errBox = doc2.querySelector('#aerr');
  if (errBox) ok('错误提示框存在'); else fail('无错误框');

  console.log('\n=== 13. 注册流程(前端) ===');
  const regBtn = Array.from(doc2.querySelectorAll('.btn')).find(b => b.textContent.trim() === '注册');
  regBtn?.click();
  await new Promise(r => setTimeout(r, 300));
  const inputs2 = doc2.querySelectorAll('.inp');
  console.log(`    注册页输入框: ${inputs2.length} (期望 3: 用户名/姓名/密码)`);
  if (inputs2.length === 3) ok('注册表单含姓名字段'); else fail('注册表单字段数 ' + inputs2.length);

  srv.kill();
  console.log('\n' + (process.exitCode ? '❌ 有失败' : '✅ 全部通过'));
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌ 崩溃:', e); process.exit(1); });
