const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// 用 Node 内置 parser 直接定位
const parser = require('node:vm');
try {
  new parser.Script(code, { filename: 'inline.js' });
} catch(e) {
  console.log('err:', e.message);
  // vm.Script 错误 stack 含 line
  const m = e.stack && e.stack.match(/inline\.js:(\d+)/);
  if (m) {
    const ln = parseInt(m[1]);
    console.log(`line ${ln}:`);
    const lines = code.split('\n');
    for (let i = Math.max(0, ln-3); i < Math.min(lines.length, ln+3); i++) {
      console.log(`  ${i+1}: ${lines[i].slice(0, 250)}`);
    }
  }
}
