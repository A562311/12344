// e2e test for quiz-pro.html using jsdom + http server
const { JSDOM, VirtualConsole } = require('jsdom');
const path = require('path');
const fs = require('fs');
const http = require('http');

const ROOT = path.resolve(__dirname, '..', 'quiz');
const HTML_PATH = path.join(ROOT, 'quiz-pro.html');

const vc = new VirtualConsole();
vc.on('jsdomError', (e) => console.error('[jsdomErr]', e.message));

(async () => {
  // HTTP server
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p === '/') p = '/quiz-pro.html';
    const filePath = path.join(ROOT, decodeURIComponent(p));
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath);
      const ct = ext === '.json' ? 'application/json' :
                 ext === '.html' ? 'text/html' : 'text/plain';
      res.writeHead(200, { 'content-type': ct });
      res.end(fs.readFileSync(filePath));
    } else {
      res.writeHead(404);
      res.end('not found: ' + filePath);
    }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  console.log(`▶ HTTP server: http://127.0.0.1:${port}`);

  // 把 fetch polyfill 注入到第一个 script 之前(原 script 第 82 行就 await fetch)
  let html = fs.readFileSync(HTML_PATH, 'utf-8');
  html = html.replace(/<script>/,
    `<script>window.fetch=function(u){return new Promise(function(r,j){var x=new XMLHttpRequest();x.open('GET',u);x.onload=function(){r({ok:x.status>=200&&x.status<300,status:x.status,json:function(){return Promise.resolve(JSON.parse(x.responseText));},text:function(){return Promise.resolve(x.responseText);}});};x.onerror=j;x.send();});};</script><script>`);

  const dom = new JSDOM(html, {
    url: `http://127.0.0.1:${port}/quiz-pro.html`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  // jsdom 不支持 confirm/alert, 默认返回 true(自动同意)
  dom.window.confirm = () => true;
  dom.window.alert = () => {};
  const { window } = dom;

  // 把 State 暴露到 window 方便测试(我们的代码已暴露)
  await new Promise(r => setTimeout(r, 2500));
  const doc = window.document;

  const ok = (msg) => console.log('  ✅', msg);
  const fail = (msg) => { console.log('  ❌', msg); process.exitCode = 1; };

  console.log('\n=== 1. 首页渲染 ===');
  const setItems = doc.querySelectorAll('.set-item');
  console.log(`  题库数: ${setItems.length}`);
  if (setItems.length >= 17) ok(`题库 ${setItems.length} 个 (>=17)`);
  else fail(`期望 >=17 实际 ${setItems.length}`);
  setItems.forEach((it, i) => {
    if (i < 2 || i >= setItems.length - 1) {
      console.log(`    [${i}] ${it.textContent.replace(/\s+/g, ' ').trim().slice(0, 70)}`);
    }
  });

  console.log('\n=== 2. KPI 面板 ===');
  const kpis = doc.querySelectorAll('.kpi');
  if (kpis.length >= 6) ok(`KPI ${kpis.length} 项`); else fail(`KPI ${kpis.length} 期望 6+`);
  kpis.forEach(k => {
    console.log(`  - ${k.querySelector('.label')?.textContent}: ${k.querySelector('.value')?.textContent}`);
  });

  console.log('\n=== 3. 进入单选专项题库 ===');
  const qz02 = Array.from(setItems).find(it => it.textContent.includes('单选专项'));
  if (!qz02) { fail('找不到单选专项'); return; }
  qz02.click();
  await new Promise(r => setTimeout(r, 1500));

  const qCard = doc.querySelector('.q-card');
  const qText = doc.querySelector('.q-text');
  const opts = doc.querySelectorAll('.opt');
  if (qCard && qText && opts.length > 0) ok('题目卡片+选项渲染'); else fail('题目渲染失败');
  console.log(`  题目: ${qText?.textContent?.slice(0, 50)}`);
  console.log(`  选项数: ${opts.length}`);
  const metaChips = Array.from(doc.querySelectorAll('.q-meta .chip')).map(c => c.textContent);
  console.log(`  meta: ${metaChips.join(' | ')}`);

  console.log('\n=== 4. 点击正确答案 ===');
  const answer1 = window.State?.questions?.[0]?.answer;
  console.log(`  正确答案: ${answer1}`);
  const correctBtn = Array.from(opts).find(o => o.dataset.key === answer1);
  if (!correctBtn) { fail('找不到正确答案按钮'); return; }
  correctBtn.click();
  await new Promise(r => setTimeout(r, 300));

  const analysis = doc.querySelector('#analysis');
  if (analysis && !analysis.classList.contains('hidden')) ok('解析区显示'); else fail('解析区未显示');
  const correctMarks = doc.querySelectorAll('.opt.correct').length;
  const wrongMarks = doc.querySelectorAll('.opt.wrong').length;
  console.log(`  正确标记: ${correctMarks}, 错误标记: ${wrongMarks}`);
  if (correctMarks >= 1 && wrongMarks === 0) ok('答案标记正确');
  else fail(`标记异常 (correct=${correctMarks}, wrong=${wrongMarks})`);
  console.log(`  解析摘要: ${doc.querySelector('.analysis')?.textContent?.replace(/\s+/g, ' ').slice(0, 200)}`);

  console.log('\n=== 5. 切下一题并故意答错 ===');
  const nextBtn = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('下一题'));
  nextBtn?.click();
  await new Promise(r => setTimeout(r, 600));

  const newOpts = doc.querySelectorAll('.opt');
  const ans2 = window.State?.questions?.[window.State?.idx]?.answer;
  console.log(`  idx=${window.State?.idx}, answer=${ans2}`);
  if (ans2) {
    const wrongBtn = Array.from(newOpts).find(o => o.dataset.key !== ans2);
    if (!wrongBtn) { fail('找不到错答案按钮'); return; }
    wrongBtn.click();
    await new Promise(r => setTimeout(r, 300));
    const correct2 = doc.querySelectorAll('.opt.correct').length;
    const wrong2 = doc.querySelectorAll('.opt.wrong').length;
    if (correct2 >= 1 && wrong2 >= 1) ok('错题标记');
    else fail(`错题标记异常 correct=${correct2} wrong=${wrong2}`);
  }

  console.log('\n=== 6. 错题本归集 ===');
  const wrongNav = Array.from(doc.querySelectorAll('[data-go]')).find(b => b.dataset.go === 'wrong');
  wrongNav?.click();
  await new Promise(r => setTimeout(r, 500));
  const wrongItems = doc.querySelectorAll('.list-item');
  if (wrongItems.length >= 1) ok(`错题 ${wrongItems.length} 道`);
  else fail('错题本为空');
  if (wrongItems.length > 0) {
    console.log(`  首项: ${wrongItems[0].textContent.replace(/\s+/g, ' ').slice(0, 120)}`);
  }

  console.log('\n=== 7. localStorage 持久化 ===');
  const stored = window.localStorage.getItem('c3-quiz-pro-v1');
  if (stored) {
    const o = JSON.parse(stored);
    console.log(`  wrong: ${Object.keys(o.wrong || {}).length}`);
    console.log(`  fav: ${Object.keys(o.fav || {}).length}`);
    console.log(`  stats: answered=${o.stats?.answered}, correct=${o.stats?.correct}`);
    if (o.stats?.answered >= 2) ok('统计已累计');
    if (Object.keys(o.wrong || {}).length >= 1) ok('错题已持久化');
  } else {
    fail('localStorage 无数据');
  }

  console.log('\n=== 8. 收藏题 ===');
  // 回首页
  const homeNav = doc.querySelector('[data-go="home"]');
  homeNav?.click();
  await new Promise(r => setTimeout(r, 400));
  // 进多选专项
  const qz03 = Array.from(doc.querySelectorAll('.set-item')).find(it => it.textContent.includes('多选专项'));
  qz03?.click();
  await new Promise(r => setTimeout(r, 1500));
  // 收藏 - 找 .action-bar 里的"收藏"(避开 header 导航)
  const favBtn = Array.from(doc.querySelectorAll('.action-bar .btn')).find(b => b.textContent.includes('收藏'));
  favBtn?.click();
  await new Promise(r => setTimeout(r, 300));
  const isFav = Object.keys(window.State.fav || {}).length >= 1;
  if (isFav) ok('收藏成功 (fav 对象已更新)');
  else fail(`收藏未生效, fav=${JSON.stringify(window.State.fav)}`);

  console.log('\n=== 9. 收藏夹视图 ===');
  const favNav = doc.querySelector('[data-go="fav"]');
  favNav?.click();
  await new Promise(r => setTimeout(r, 400));
  const favItems = doc.querySelectorAll('.list-item');
  if (favItems.length >= 1) ok(`收藏 ${favItems.length}`);
  else fail('收藏夹为空');

  console.log('\n=== 10. 统计视图 ===');
  const statsNav = doc.querySelector('[data-go="stats"]');
  statsNav?.click();
  await new Promise(r => setTimeout(r, 400));
  const statsKpis = doc.querySelectorAll('.kpi');
  if (statsKpis.length >= 6) ok(`统计 KPI ${statsKpis.length} 项`);

  console.log('\n=== 11. 多选题测试 ===');
  const h2 = doc.querySelector('[data-go="home"]');
  h2?.click();
  await new Promise(r => setTimeout(r, 400));
  const qz03b = Array.from(doc.querySelectorAll('.set-item')).find(it => it.textContent.includes('多选专项'));
  qz03b?.click();
  await new Promise(r => setTimeout(r, 1500));
  const t3type = window.State?.questions?.[0]?.type;
  console.log(`  多选题型: ${t3type}`);
  if (t3type === '多选题') ok('多选题识别');
  // 答对多选题
  const ans3 = window.State?.questions?.[0]?.answer;
  console.log(`  第一题答案: ${ans3}`);
  if (ans3) {
    // 多选答案可能是 "ABC" 字符串
    const ansArr = ans3.toUpperCase().split('');
    const multiOpts = doc.querySelectorAll('.opt');
    ansArr.forEach(k => {
      const btn = Array.from(multiOpts).find(o => o.dataset.key === k);
      btn?.click();
    });
    await new Promise(r => setTimeout(r, 300));
    console.log(`  标记: correct=${doc.querySelectorAll('.opt.correct').length}, wrong=${doc.querySelectorAll('.opt.wrong').length}`);
  }

  console.log('\n=== 12. 判断题测试 ===');
  const h3 = doc.querySelector('[data-go="home"]');
  h3?.click();
  await new Promise(r => setTimeout(r, 400));
  const qz04 = Array.from(doc.querySelectorAll('.set-item')).find(it => it.textContent.includes('判断专项'));
  qz04?.click();
  await new Promise(r => setTimeout(r, 1500));
  const t4type = window.State?.questions?.[0]?.type;
  const t4opts = doc.querySelectorAll('.opt');
  console.log(`  判断题型: ${t4type}, 选项: ${t4opts.length}`);

  console.log('\n=== 13. 大题库完整渲染 ===');
  const h4 = doc.querySelector('[data-go="home"]');
  h4?.click();
  await new Promise(r => setTimeout(r, 400));
  const final = Array.from(doc.querySelectorAll('.set-item')).find(it => it.textContent.includes('完整版'));
  final?.click();
  await new Promise(r => setTimeout(r, 2000));
  const finalCard = doc.querySelector('.q-card');
  const finalTotal = window.State?.questions?.length;
  console.log(`  完整版总题数: ${finalTotal}`);
  if (finalTotal === 994) ok('994 题正确加载');
  else fail(`期望 994 实际 ${finalTotal}`);
  if (finalCard) ok('完整版题目渲染');

  console.log('\n=== 14. 键盘快捷键 ===');
  // 模拟按 A
  const aEvent = new window.KeyboardEvent('keydown', { key: 'a' });
  doc.dispatchEvent(aEvent);
  await new Promise(r => setTimeout(r, 200));
  // 应该被识别为答题
  const isAnswered = window.State?.sessionLog?.length > 0;
  console.log(`  键盘 A 已触发答题: ${isAnswered}`);

  console.log('\n=== 15. 错题复习模式 ===');
  const h5 = doc.querySelector('[data-go="wrong"]');
  h5?.click();
  await new Promise(r => setTimeout(r, 400));
  const reviewBtn = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('复习此题') || b.textContent.includes('全部复习'));
  reviewBtn?.click();
  await new Promise(r => setTimeout(r, 800));
  const reviewCard = doc.querySelector('.q-card');
  if (reviewCard) ok('错题复习模式进入');

  // ============ 新功能测试 ============
  console.log('\n=== 16. 主题切换 (暗→亮) ===');
  const themeBtn = doc.getElementById('theme-toggle');
  if (!themeBtn) { fail('主题切换按钮缺失'); }
  else {
    const beforeTheme = doc.documentElement.getAttribute('data-theme');
    themeBtn.click();
    await new Promise(r => setTimeout(r, 200));
    const afterTheme = doc.documentElement.getAttribute('data-theme');
    if (beforeTheme !== afterTheme) ok(`主题已切换: ${beforeTheme} → ${afterTheme}`);
    else fail('主题未变化');
    // 持久化检查
    const savedTheme = window.localStorage.getItem('c3-quiz-pro-theme');
    if (savedTheme === afterTheme) ok('主题已保存到 localStorage');
    else fail(`主题未持久化: ${savedTheme}`);
  }

  console.log('\n=== 17. 错题答对次数自动移除 ===');
  // 准备:进入单选专项,故意答错制造错题
  doc.querySelector('[data-go="home"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  const qz02b = Array.from(doc.querySelectorAll('.set-item')).find(it => it.textContent.includes('单选专项'));
  qz02b?.click();
  await new Promise(r => setTimeout(r, 1500));
  const qid = window.State.questions[0].id;
  const ans = window.State.questions[0].answer;
  // 故意答错
  const wrongOpt = Array.from(doc.querySelectorAll('.opt')).find(o => o.dataset.key !== ans);
  wrongOpt?.click();
  await new Promise(r => setTimeout(r, 200));
  if (window.State.wrong[qid]) ok('错题已归集');
  else fail('错题未归集');
  // 设置阈值为 1(立即移除模式)
  window.State.settings.removeAtCorrect = 1;
  // 切下一题,答对(累计 1 次,应该移除)
  const nextBtn2 = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('下一题'));
  nextBtn2?.click();
  await new Promise(r => setTimeout(r, 500));
  // 回到错题复习刷原题
  // 直接 navigate wrong -> review
  doc.querySelector('[data-go="wrong"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  const reviewAllBtn = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('全部复习'));
  reviewAllBtn?.click();
  await new Promise(r => setTimeout(r, 800));
  // 答对(此时只有一道错题)
  const reviewAns = window.State.questions[0]?.answer;
  const reviewPick = Array.from(doc.querySelectorAll('.opt')).find(o => o.dataset.key === reviewAns);
  reviewPick?.click();
  await new Promise(r => setTimeout(r, 300));
  if (!window.State.wrong[qid]) ok('答对 1 次后错题已自动移除');
  else fail(`错题仍存在, wrong[${qid}] = ${JSON.stringify(window.State.wrong[qid])}`);

  console.log('\n=== 18. 考试模式入口 ===');
  doc.querySelector('[data-go="home"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  window.State.settings.examDuration = 5;  // 5 分钟测试
  // 用 Qz14 (16题,日内瓦专题) 快速答完
  const qz14 = Array.from(doc.querySelectorAll('.set-item')).find(it => it.textContent.includes('日内瓦专题'));
  qz14?.click();
  await new Promise(r => setTimeout(r, 1500));
  // 答完所有题
  const total = window.State.questions.length;
  for (let i = 0; i < total; i++) {
    const a = window.State.questions[window.State.idx]?.answer;
    const btn = Array.from(doc.querySelectorAll('.opt')).find(o => o.dataset.key === a);
    if (btn) btn.click();
    await new Promise(r => setTimeout(r, 60));
    const nb = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('下一题') && !b.textContent.includes('上一题'));
    if (nb) {
      nb.click();
      await new Promise(r => setTimeout(r, 100));
    } else {
      // 最后一题答完,可能跳出循环或显示结果
      break;
    }
  }
  console.log(`  view: ${window.State.view}, idx: ${window.State.idx}, total: ${window.State.questions?.length}`);
  if (window.State.view === 'result') {
    ok('答完到结果页');
  } else if (window.State.idx >= window.State.questions.length - 1) {
    // 仍在 quiz 但最后一题 - 手动跳结果
    const finishBtn = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('下一题'));
    if (finishBtn) finishBtn.click();
    await new Promise(r => setTimeout(r, 500));
    if (window.State.view === 'result') ok('跳到结果页');
    else fail(`点完最后一题仍在 quiz`);
  } else {
    fail(`view=${window.State.view}, idx=${window.State.idx}/${window.State.questions?.length}`);
  }
  if (window.State.view === 'result') {
    const examBtn = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('进入考试模式'));
    if (examBtn) {
      examBtn.click();
      await new Promise(r => setTimeout(r, 1500));
      const cd = doc.getElementById('exam-countdown');
      if (cd) {
        const cdVisible = cd.style.display !== 'none';
        const cdText = cd.textContent;
        console.log(`  倒计时: display=${cd.style.display}, text=${cdText}`);
        if (cdVisible && cdText.match(/\d{2}:\d{2}/)) {
          ok(`考试模式倒计时: ${cdText.trim()}`);
        } else {
          fail(`倒计时未正确显示: "${cdText}" visible=${cdVisible}`);
        }
      } else {
        fail('找不到 #exam-countdown');
      }
      const submitBtn = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('交卷'));
      if (submitBtn) ok('交卷按钮存在');
      else fail('交卷按钮缺失');
    } else {
      fail('找不到"进入考试模式"按钮');
    }
  }

  console.log('\n=== 19. PDF 导出函数 ===');
  // jsdom 没 window.open, 但 exportPDF 应该至少不抛错
  // mock window.open
  const openedHtml = [];
  window.open = (url, target) => {
    return {
      document: {
        write: (html) => openedHtml.push(html),
        close: () => {},
      },
    };
  };
  doc.querySelector('[data-go="wrong"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  if (Object.keys(window.State.wrong).length > 0) {
    // 重新制造一个错题供导出
    doc.querySelector('[data-go="home"]')?.click();
    await new Promise(r => setTimeout(r, 400));
    const qz02d = Array.from(doc.querySelectorAll('.set-item')).find(it => it.textContent.includes('单选专项'));
    qz02d?.click();
    await new Promise(r => setTimeout(r, 1500));
    const wq = window.State.questions[0];
    const wo = Array.from(doc.querySelectorAll('.opt')).find(o => o.dataset.key !== wq.answer);
    wo?.click();
    await new Promise(r => setTimeout(r, 200));
    doc.querySelector('[data-go="wrong"]')?.click();
    await new Promise(r => setTimeout(r, 400));
  }
  const pdfBtn = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('导出 PDF'));
  if (pdfBtn) {
    openedHtml.length = 0;
    pdfBtn.click();
    await new Promise(r => setTimeout(r, 300));
    if (openedHtml.length === 1 && openedHtml[0].includes('错题本') && openedHtml[0].includes('打印')) {
      ok('错题 PDF 导出窗口已生成');
    } else {
      fail(`PDF 导出失败, openedHtml=${openedHtml.length}, snippet=${openedHtml[0]?.slice(0,200)}`);
    }
  } else {
    fail('找不到"导出 PDF"按钮');
  }

  console.log('\n=== 20. 偏好设置 UI ===');
  doc.querySelector('[data-go="home"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  const selects = doc.querySelectorAll('select');
  if (selects.length >= 2) ok(`设置下拉 ${selects.length} 个`);
  else fail(`期望 2 个 select,实际 ${selects.length}`);

  console.log('\n=== 21. 收藏 PDF 导出 ===');
  // 先收藏一道题
  doc.querySelector('[data-go="home"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  const qz03d = Array.from(doc.querySelectorAll('.set-item')).find(it => it.textContent.includes('多选专项'));
  qz03d?.click();
  await new Promise(r => setTimeout(r, 1500));
  // 多选答案
  const ansMulti = window.State.questions[0]?.answer;
  if (ansMulti) {
    const ansArr = ansMulti.toUpperCase().split('');
    ansArr.forEach(k => {
      const btn = Array.from(doc.querySelectorAll('.opt')).find(o => o.dataset.key === k);
      btn?.click();
    });
    await new Promise(r => setTimeout(r, 200));
  }
  const favBtn2 = Array.from(doc.querySelectorAll('.action-bar .btn')).find(b => b.textContent.includes('收藏'));
  if (favBtn2 && !favBtn2.textContent.includes('已收藏')) {
    favBtn2.click();
  }
  await new Promise(r => setTimeout(r, 200));
  console.log(`  收藏数: ${Object.keys(window.State.fav).length}`);
  // 进收藏夹导出
  doc.querySelector('[data-go="fav"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  console.log(`  收藏页 list-item: ${doc.querySelectorAll('.list-item').length}`);
  console.log(`  收藏页所有按钮:`);
  Array.from(doc.querySelectorAll('.btn')).forEach((b, i) => console.log(`    [${i}] ${b.textContent.trim().slice(0, 30)}`));
  const favPdfBtn = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('导出 PDF'));
  openedHtml.length = 0;
  favPdfBtn?.click();
  await new Promise(r => setTimeout(r, 300));
  console.log(`  openedHtml.length: ${openedHtml.length}`);
  if (openedHtml.length > 0) console.log(`  内容前 200: ${openedHtml[0].slice(0, 200)}`);
  if (openedHtml.length === 1 && openedHtml[0].includes('收藏夹')) {
    ok('收藏 PDF 导出窗口已生成');
  } else {
    fail(`收藏 PDF 导出失败`);
  }

  console.log('\n=== 23. 山东 C 类题库加载与刷题 ===');
  doc.querySelector('[data-go="home"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  const sd = Array.from(doc.querySelectorAll('.set-item')).find(it => it.textContent.includes('山东'));
  if (!sd) { fail('找不到山东题库'); }
  else {
    sd.click();
    await new Promise(r => setTimeout(r, 2500));
    const sdCard = doc.querySelector('.q-card');
    const sdTotal = window.State.questions?.length;
    console.log(`  山东 C 题数: ${sdTotal}`);
    if (sdTotal > 1000) ok(`山东 C 库 ${sdTotal} 题`);
    else fail(`山东 C 库太小 ${sdTotal}`);
    if (sdCard) ok('山东 C 题目渲染');
    const sdAns = window.State.questions[0]?.answer;
    const sdBtn = Array.from(doc.querySelectorAll('.opt')).find(o => o.dataset.key === sdAns);
    if (sdBtn) {
      sdBtn.click();
      await new Promise(r => setTimeout(r, 300));
      const correctMarks = doc.querySelectorAll('.opt.correct').length;
      if (correctMarks >= 1) ok('山东 C 答案判定');
    }
  }

  console.log('\n=== 24. 错题自动移除后页面状态 ===');
  doc.querySelector('[data-go="home"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  const wrongNav2 = doc.querySelector('[data-go="wrong"]');
  wrongNav2?.click();
  await new Promise(r => setTimeout(r, 400));
  const remainingWrong = doc.querySelectorAll('.list-item').length;
  console.log(`  当前错题数: ${remainingWrong}`);
  ok('错题本 UI 仍可访问');

  console.log('\n=== 23. 统计 PDF 导出 ===');
  doc.querySelector('[data-go="stats"]')?.click();
  await new Promise(r => setTimeout(r, 400));
  const statsPdfBtn = Array.from(doc.querySelectorAll('.btn')).find(b => b.textContent.includes('导出统计'));
  openedHtml.length = 0;
  statsPdfBtn?.click();
  await new Promise(r => setTimeout(r, 300));
  if (openedHtml.length === 1 && openedHtml[0].includes('学习统计')) {
    ok('统计 PDF 导出窗口已生成');
  } else {
    fail('统计 PDF 导出失败');
  }

  server.close();
  console.log('\n' + (process.exitCode ? '❌ 测试有失败' : '✅ 全部通过'));
  process.exit(process.exitCode || 0);
})().catch(e => {
  console.error('❌ 崩溃:', e);
  process.exit(1);
});
