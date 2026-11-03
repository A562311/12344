const { JSDOM } = require('jsdom');
const fs = require('fs');
(async () => {
  const html = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8');
  const dom = new JSDOM(html, {
    url: 'http://127.0.0.1:8765/quiz-pro.html',
    runScripts: 'outside-only',
  });
  // 拿到 script 文本,单独用 new Function 检查
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!scriptMatch) { console.log('no inline script'); return; }
  const code = scriptMatch[1];
  console.log('Script length:', code.length);
  try {
    new Function(code);
    console.log('✅ Syntax OK');
  } catch(e) {
    console.log('❌ Syntax error:', e.message);
    // 输出错误附近
    const m = e.message.match(/\((\d+):(\d+)\)/);
    if (m) {
      const line = parseInt(m[1]);
      const lines = code.split('\n');
      console.log(`Around line ${line}:`);
      for (let i = Math.max(0, line-3); i < Math.min(lines.length, line+3); i++) {
        console.log(`  ${i+1}: ${lines[i]}`);
      }
    }
  }
})();
