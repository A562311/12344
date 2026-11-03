/**
 * 未登录场景测试
 * 现在必须登录才能刷题 —— 验证所有绕过路径都被堵死
 */
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.join(__dirname, '..', 'server');
const WEB = path.join(ROOT, 'web');
const DATA = path.join(ROOT, 'data');

let pass = 0, fail = 0;
const ok = (m) => { console.log('  ✅', m); pass++; };
const bad = (m) => { console.log('  ❌', m); fail++; process.exitCode = 1; };

(async () => {
  console.log('='.repeat(62));
  console.log('  未登录场景测试');
  console.log('='.repeat(62));

  // mock server
  const server = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    if (p === '/api/sets') {
      const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'sets_c3_2025.json'), 'utf-8'));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        sets: meta.map(x => ({ n: x.name, l: x.label, c: x.count, d: x.desc, a: x.has_analysis ? 1 : 0 })),
        total: meta.reduce((a, x) => a + x.count, 0),
      }));
    }
    if (p === '/api/questions/' || p.startsWith('/api/questions/')) {
      // 未登录 → 401
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '请先登录' }));
    }
    if (p === '/api/progress') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ uid: 'x', wrong: {}, fav: {}, stats: {}, settings: {} }));
    }
    if (p === '/api/auth/me') {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '未登录' }));
    }
    if (p === '/') p = '/index.html';
    const fp = path.join(WEB, p);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ext = path.extname(fp);
      const ct = ext === '.json' ? 'application/json' : ext === '.svg' ? 'image/svg+xml' : 'text/html';
      res.writeHead(200, { 'Content-Type': ct });
      return res.end(fs.readFileSync(fp));
    }
    res.writeHead(404); res.end('nf');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  let html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf-8');
  // 注意:这里【不】预置 token —— 模拟全新未登录用户
  html = html.replace('<script>',
`<script>
window.fetch=function(u,o){o=o||{};return new Promise(function(r,j){var x=new XMLHttpRequest();
x.open(o.method||'GET',u);
if(o.headers){for(var k in o.headers){try{x.setRequestHeader(k,o.headers[k]);}catch(e){}}}
x.onload=function(){r({ok:x.status>=200&&x.status<300,status:x.status,json:function(){return Promise.resolve(JSON.parse(x.responseText));},text:function(){return Promise.resolve(x.responseText);}});};
x.onerror=j;
x.send(o.body||null);});};
</script><script>`);

  const vc = new VirtualConsole();
  vc.on('jsdomError', () => {});   // 忽略资源加载错误
  const dom = new JSDOM(html, {
    url: `http://127.0.0.1:${port}/index.html`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  const doc = window.document;
  await new Promise(r => setTimeout(r, 2500));

  console.log('\n=== 1. 首页应只显示登录页 ===');
  const banks = doc.querySelectorAll('.bank');
  if (banks.length === 0) ok('题库卡片 0 个(看不到题库)'); else bad(`题库卡片 ${banks.length} 个,应隐藏`);

  const inputs = doc.querySelectorAll('#au, #ap');
  if (inputs.length >= 2) ok('显示用户名/密码输入框'); else bad('登录表单缺失');

  const hasSkip = (doc.body.textContent||doc.body.innerText||"").includes('不登录直接刷题');
  if (!hasSkip) ok('没有「不登录直接刷题」入口'); else bad('仍有跳过登录入口');

  const hasHint = (doc.body.textContent||doc.body.innerText||"").includes('请登录后刷题');
  if (hasHint) ok('显示「请登录后刷题」提示'); else bad('缺少提示文案');

  console.log('\n=== 2. 视图切换应被拦住 ===');
  // 直接调 go() 试图去别的视图
  const view1 = window.eval("go('home'); S.view");
  if (view1 === 'auth') ok("go('home') 被拦回 auth"); else bad(`go('home') → ${view1}`);

  const view2 = window.eval("go('wrong'); S.view");
  if (view2 === 'auth') ok("go('wrong') 被拦回 auth"); else bad(`go('wrong') → ${view2}`);

  const view3 = window.eval("go('stats'); S.view");
  if (view3 === 'auth') ok("go('stats') 被拦回 auth"); else bad(`go('stats') → ${view3}`);

  console.log('\n=== 3. 点顶栏按钮也不能进入 ===');
  for (const id of ['#btn-wrong', '#btn-fav', '#btn-stats']) {
    const btn = doc.querySelector(id);
    if (!btn) { bad(`${id} 不存在`); continue; }
    btn.click();
    await new Promise(r => setTimeout(r, 200));
    if (window.eval('S.view') === 'auth') ok(`${id} 点击后仍停在 auth`);
    else bad(`${id} 点击后跑到 ${window.eval('S.view')}`);
  }

  console.log('\n=== 4. startBank 应拒绝 ===');
  const bankCount = window.eval('S.sets.length');
  if (bankCount > 0) {
    ok(`题库索引仍加载(${bankCount} 个,只用于显示总数)`);
    const res = await window.eval(`
      (async () => {
        try {
          await startBank(S.sets[0]);
          return 'no-throw';
        } catch(e) { return 'threw'; }
      })()
    `);
    await new Promise(r => setTimeout(r, 500));
    if (window.eval('S.view') === 'auth') ok('startBank 后回到 auth(未登录不能刷题)');
    else bad(`startBank 后 S.view=${window.eval('S.view')}`);
  } else {
    ok('题库索引为空(未登录不加载)');
  }

  console.log('\n=== 5. render() 是最后一道防线 ===');
  const forced = await window.eval(`
    (() => {
      S.view = 'home';
      render();
      return document.querySelectorAll('.bank').length;
    })()
  `);
  if (forced === 0) ok('强制 S.view=home 后仍渲染登录页');
  else bad(`强制切视图后渲染了 ${forced} 个题库`);

  server.close();
  const summary = fail === 0 ? '✅ 全部通过' : '❌ 有失败';
  console.log('\n' + '='.repeat(62));
  console.log('  ' + summary + '  (' + pass + ' 项通过, ' + fail + ' 项失败)');
  console.log('='.repeat(62));
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
