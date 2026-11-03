// 验证 admin.html 登录流程 + 数据渲染
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path'); const fs = require('fs');
const BASE = 'http://127.0.0.1:8787';
const WEB = path.resolve(__dirname, '..', 'server', 'web');
const vc = new VirtualConsole();
vc.on('jsdomError', e => { if (!/scrollTo/.test(e.message)) console.error('[jsdomErr]', e.message); });

(async () => {
  // 自建普通用户(测试自足)
  await fetch(BASE+'/api/auth/register', {method:'POST',headers:{'Content-Type':'application/json'},
    body: JSON.stringify({username:'test_normal',password:'pass123456',name:'普通用户'})});
  await fetch(BASE+'/api/auth/login', {method:'POST',headers:{'Content-Type':'application/json'},
    body: JSON.stringify({username:'test_normal',password:'pass123456'})});

  const ok = m => console.log('  ✅', m);
  const fail = m => { console.log('  ❌', m); process.exitCode = 1; };

  let html = fs.readFileSync(path.join(WEB, 'admin.html'), 'utf-8');
  html = html.replace('<script>',
`<script>
window.fetch=function(u,o){o=o||{};var h=Object.assign({},o.headers||{});return new Promise(function(r,j){var x=new XMLHttpRequest();x.open(o.method||'GET',u);for(var k in h)x.setRequestHeader(k,h[k]);x.onload=function(){var d=null;try{d=JSON.parse(x.responseText)}catch(e){};r({ok:x.status>=200&&x.status<300,status:x.status,json:function(){return Promise.resolve(d||{})}})};x.onerror=j;x.send(o.body);});};
</script><script>`);

  const dom = new JSDOM(html, { url: BASE+'/admin.html', runScripts:'dangerously', pretendToBeVisual:true, virtualConsole: vc });
  dom.window.confirm = () => true;
  dom.window.prompt = () => 'x';
  await new Promise(r => setTimeout(r, 2000));
  const doc = dom.window.document;

  console.log('=== 1. 未登录显示登录表单 ===');
  const ins = doc.querySelectorAll('.inp');
  if (ins.length === 2) ok('登录表单 2 个输入框'); else fail('输入框 ' + ins.length);
  const loginBtn = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('登录后台'));
  if (loginBtn) ok('有登录按钮'); else fail('无登录按钮');

  console.log('\n=== 2. 错误密码 ===');
  doc.querySelector('#au').value = 'admin';
  doc.querySelector('#ap').value = 'wrongpass';
  loginBtn.click();
  await new Promise(r => setTimeout(r, 800));
  const err = doc.querySelector('#aerr');
  if (err && !err.classList.contains('hidden')) ok('显示错误: ' + err.textContent);
  else fail('无错误提示');

  console.log('\n=== 3. 非管理员登录被拒 ===');
  doc.querySelector('#au').value = 'test_normal';
  doc.querySelector('#ap').value = 'pass123456';
  loginBtn.click();
  await new Promise(r => setTimeout(r, 800));
  const err2 = doc.querySelector('#aerr');
  if (err2 && !err2.classList.contains('hidden') && err2.textContent.includes('不是管理员')) ok('非管理员被拒: ' + err2.textContent);
  else fail('非管理员未被拒: ' + (err2 && err2.textContent));

  console.log('\n=== 4. 管理员登录成功 ===');
  doc.querySelector('#au').value = 'admin';
  doc.querySelector('#ap').value = 'C3@Quiz2026';
  loginBtn.click();
  await new Promise(r => setTimeout(r, 1500));
  const kpis = doc.querySelectorAll('.kpi');
  console.log(`    KPI 数: ${kpis.length}`);
  if (kpis.length >= 4) ok('后台 KPI 渲染'); else fail('KPI ' + kpis.length);
  kpis.forEach(k => console.log(`      ${k.querySelector('.l')?.textContent}: ${k.querySelector('.v')?.textContent}`));

  const rows = doc.querySelectorAll('.tbl tbody tr');
  console.log(`    表格行: ${rows.length}`);
  if (rows.length >= 2) ok(`${rows.length} 个用户`); else fail('行数 ' + rows.length);
  // 打印表格内容
  rows.forEach(tr => {
    const tds = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.replace(/\s+/g,' ').trim());
    console.log('      ' + tds.slice(0,6).join(' | '));
  });

  console.log('\n=== 5. 搜索功能 ===');
  const search = doc.querySelector('.inp');
  if (search) {
    search.value = '普通';
    search.dispatchEvent(new dom.window.Event('input'));
    await new Promise(r => setTimeout(r, 400));
    const filtered = doc.querySelectorAll('.tbl tbody tr');
    console.log(`    搜"普通" → ${filtered.length} 行`);
    if (filtered.length === 1) ok('搜索过滤正确'); else fail('搜索结果 ' + filtered.length);
    search.value = '';
    search.dispatchEvent(new dom.window.Event('input'));
    await new Promise(r => setTimeout(r, 300));
  }

  console.log('\n=== 6. 用户详情弹窗 ===');
  const detailBtn = Array.from(doc.querySelectorAll('.tbl tbody tr td .btn')).find(b => b.textContent.includes('详情'));
  detailBtn?.click();
  await new Promise(r => setTimeout(r, 1000));
  const mbox = doc.querySelector('.mbox');
  if (mbox) {
    ok('详情弹窗打开');
    const txt = mbox.textContent.replace(/\s+/g,' ').slice(0, 200);
    console.log('    ' + txt);
  } else fail('详情弹窗未打开');

  console.log('\n=== 7. 用户管理 Tab ===');
  const usersTab = Array.from(doc.querySelectorAll('.tab')).find(t => t.textContent.includes('用户管理'));
  usersTab?.click();
  await new Promise(r => setTimeout(r, 500));
  const cards = doc.querySelectorAll('.card');
  console.log(`    用户卡片: ${cards.length}`);
  if (cards.length >= 2) ok('用户管理列表'); else fail('卡片 ' + cards.length);
  const btns = Array.from(doc.querySelectorAll('.card .btn')).map(b => b.textContent.trim());
  console.log('    操作按钮:', btns.slice(0,8).join(', '));

  console.log('\n' + (process.exitCode ? '❌ 有失败' : '✅ 全部通过'));
  process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌ 崩溃:', e); process.exit(1); });
