// e2e test for the mobile web app
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', 'server');
const WEB = path.join(ROOT, 'web');
const DATA = path.join(ROOT, 'data');

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => console.error('[jsdomErr]', e.message));

(async () => {
  // 静态 + API server
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    const q = new URL(req.url, 'http://x');
    if (p === '/api/health') {
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:true,banks:18}));
    }
    if (p === '/api/sets') {
      const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'sets_c3_2025.json'),'utf-8'));
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({sets: meta.map(x=>({n:x.name,l:x.label,c:x.count,d:x.desc,a:x.has_analysis?1:0})), total: meta.reduce((a,x)=>a+x.count,0)}));
    }
    if (p === '/api/auth/me') {
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({user:{username:'tester', name:'测试员', role:'user', active:true}}));
    }
    if (p === '/api/auth/login') {
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({ok:true, token:'mock-token', user:{username:'tester', name:'测试员', role:'user', active:true}}));
    }
    if (p.startsWith('/api/questions/')) {
      const name = p.split('/')[3];
      const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'sets_c3_2025.json'),'utf-8'));
      const m = meta.find(x=>x.name===name);
      const arr = JSON.parse(fs.readFileSync(path.join(DATA, path.basename(m.file)),'utf-8'));
      const size = parseInt(q.searchParams.get('size')) || 50;
      const page = parseInt(q.searchParams.get('page')) || 1;
      const slice = arr.slice((page-1)*size, (page-1)*size+size);
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({
        bank:name, page, size, total: arr.length, pages: Math.ceil(arr.length/size),
        questions: slice.map(x=>({id:x.id,t:x.type,q:x.question,o:x.options,a:x.answer,c:x.category}))
      }));
    }
    if (p === '/api/progress') {
      res.writeHead(200, {'Content-Type':'application/json'});
      return res.end(JSON.stringify({uid:q.searchParams.get('uid')||'x', wrong:{}, fav:{}, stats:{}, settings:{}}));
    }
    // 静态
    if (p === '/') p = '/index.html';
    const fp = path.join(WEB, p);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      const ext = path.extname(fp);
      const ct = ext === '.json' ? 'application/json' : ext === '.svg' ? 'image/svg+xml' : 'text/html';
      res.writeHead(200, {'Content-Type': ct});
      return res.end(fs.readFileSync(fp));
    }
    res.writeHead(404); res.end('nf');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  let html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf-8');
  // 预置登录态 —— 必须在 app 脚本执行前写入 localStorage
  // (现在必须登录才能刷题)
  html = html.replace('<script>',
`<script>
try {
  localStorage.setItem('c3m-token','mock-token');
  localStorage.setItem('c3m-user',JSON.stringify({username:'tester',name:'测试员',role:'user',active:true}));
  localStorage.setItem('c3m-uid','tester');
} catch(e){}
</script><script>
window.fetch=function(u,o){o=o||{};return new Promise(function(r,j){var x=new XMLHttpRequest();
x.open(o.method||'GET',u);
if(o.headers){for(var k in o.headers){try{x.setRequestHeader(k,o.headers[k]);}catch(e){}}}
x.onload=function(){r({ok:x.status>=200&&x.status<300,status:x.status,json:function(){return Promise.resolve(JSON.parse(x.responseText));},text:function(){return Promise.resolve(x.responseText);}});};
x.onerror=j;
x.send(o.body||null);});};
</script><script>`);

  const dom = new JSDOM(html, {
    url: `http://127.0.0.1:${port}/index.html`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  dom.window.confirm = () => true;
  dom.window.alert = () => {};
  const { window } = dom;
  const doc = window.document;

  const ok = m => console.log('  ✅', m);
  const fail = m => { console.log('  ❌', m); process.exitCode = 1; };

  await new Promise(r => setTimeout(r, 2000));

  console.log('\n=== 1. 首页加载 ===');
  const banks = doc.querySelectorAll('.bank');
  console.log(`  题库数: ${banks.length}`);
  if (banks.length === 18) ok('18 个题库'); else fail(`期望 18 实际 ${banks.length}`);
  const kpis = doc.querySelectorAll('.kpi');
  if (kpis.length >= 3) ok(`KPI ${kpis.length} 项`); else fail('KPI 缺失');
  console.log('  标题:', doc.querySelector('.hero h1')?.textContent);

  console.log('\n=== 2. 进入题库 ===');
  const sd = Array.from(banks).find(b => b.textContent.includes('山东'));
  if (!sd) fail('找不到山东题库');
  else {
    sd.click();
    await new Promise(r => setTimeout(r, 1500));
    const card = doc.querySelector('.qcard');
    const opts = doc.querySelectorAll('.opt');
    const qtext = doc.querySelector('.qtext');
    if (card && opts.length > 0) ok('题目渲染');
    else fail('题目渲染失败');
    console.log(`  题目: ${qtext?.textContent?.slice(0,45)}`);
    console.log(`  选项: ${opts.length} 个`);
    // 底部操作条
    const dockBtns = doc.querySelectorAll('#dock .btn');
    console.log(`  底部按钮: ${dockBtns.length} 个`);
    if (dockBtns.length >= 4) ok('底部操作条'); else fail('底部操作条缺失');
  }

  console.log('\n=== 3. 答题 + 解析 ===');
  const st = window.S || null;
  const opts = doc.querySelectorAll('.opt');
  if (opts.length) {
    // 选第一个
    opts[0].click();
    await new Promise(r => setTimeout(r, 400));
    const ana = doc.querySelector('#ana');
    const marked = doc.querySelectorAll('.opt.ok').length + doc.querySelectorAll('.opt.no').length;
    if (ana && !ana.classList.contains('hidden')) ok('解析区显示');
    else fail('解析区未显示');
    if (marked >= 1) ok(`答案标记 (${marked})`); else fail('无标记');
    console.log(`  解析: ${ana?.textContent?.replace(/\s+/g,' ').slice(0,120)}`);
  }

  console.log('\n=== 4. 下一题 ===');
  const dockBtnsNow = Array.from(doc.querySelectorAll('#dock .btn'));
  console.log('  dock 按钮文字:', dockBtnsNow.map(b => b.textContent.trim()).join(' | '));
  const nextBtn = dockBtnsNow.find(b => b.textContent.includes('下一题'));
  console.log('  找到下一题:', !!nextBtn);
  nextBtn?.click();
  await new Promise(r => setTimeout(r, 500));
  const bar = doc.querySelector('.qbar .n')?.textContent;
  console.log(`  进度: ${bar}`);
  if (bar && !bar.startsWith('1/')) ok('翻页正常'); else fail('翻页失败');

  console.log('\n=== 5. 收藏 ===');
  const favBtn = Array.from(doc.querySelectorAll('#dock .btn')).find(b => b.textContent.trim() === '☆');
  favBtn?.click();
  await new Promise(r => setTimeout(r, 300));
  const favBadge = doc.querySelector('#badge-fav');
  if (favBadge && !favBadge.classList.contains('hidden')) ok(`收藏徽章显示 (${favBadge.textContent})`);
  else fail('收藏徽章未显示');

  console.log('\n=== 6. 错题本 ===');
  // 故意答错
  const o2 = doc.querySelectorAll('.opt');
  if (o2.length) {
    o2[o2.length-1].click();
    await new Promise(r => setTimeout(r, 300));
    doc.querySelector('#btn-wrong').click();
    await new Promise(r => setTimeout(r, 500));
    const items = doc.querySelectorAll('.item');
    console.log(`  错题数: ${items.length}`);
    if (items.length >= 1) ok('错题归集'); else fail('错题未归集');
    console.log(`  副标题: ${doc.querySelector('.sec-h')?.textContent}`);
  }

  console.log('\n=== 7. 收藏夹 ===');
  doc.querySelector('#btn-fav').click();
  await new Promise(r => setTimeout(r, 400));
  const favItems = doc.querySelectorAll('.item');
  console.log(`  收藏数: ${favItems.length}`);
  if (favItems.length >= 1) ok('收藏列表'); else fail('收藏列表空');

  console.log('\n=== 8. 统计 ===');
  doc.querySelector('#btn-stats').click();
  await new Promise(r => setTimeout(r, 400));
  const statKpi = doc.querySelectorAll('.kpi');
  if (statKpi.length >= 3) ok(`统计 KPI ${statKpi.length}`); else fail('统计缺失');
  statKpi.forEach(k => console.log(`    ${k.querySelector('.l')?.textContent}: ${k.querySelector('.v')?.textContent}`));

  console.log('\n=== 9. 主题切换 ===');
  const before = doc.documentElement.getAttribute('data-theme');
  doc.querySelector('#btn-theme').click();
  await new Promise(r => setTimeout(r, 200));
  const after = doc.documentElement.getAttribute('data-theme');
  if (before !== after) ok(`主题切换 ${before} → ${after}`); else fail('主题未切换');

  console.log('\n=== 10. PWA manifest ===');
  const mf = await window.fetch('/manifest.json').then(r => r.json());
  if (mf.name && mf.display) ok(`PWA: ${mf.name} / ${mf.display}`); else fail('manifest 无效');
  if (mf.icons && mf.icons.length) ok('有图标');

  console.log('\n=== 11. localStorage 持久化 ===');
  const ls = window.localStorage.getItem('c3m-progress');
  if (ls) {
    const d = JSON.parse(ls);
    console.log(`  wrong: ${Object.keys(d.wrong||{}).length}, fav: ${Object.keys(d.fav||{}).length}, stats.answered: ${d.stats?.answered}`);
    if (d.stats?.answered >= 1) ok('进度已保存'); else fail('进度未保存');
  } else fail('localStorage 无数据');

  console.log('\n=== 12. uid ===');
  const uid = window.localStorage.getItem('c3m-uid');
  // 登录用户下 uid = 用户名(后台按这个统计),不再随机生成
  if (uid && uid.length >= 3) ok(`uid: ${uid}`); else fail('uid 未生成');

  server.close();
  console.log('\n' + (process.exitCode ? '❌ 有失败' : '✅ 全部通过'));
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌ 崩溃:', e); process.exit(1); });
