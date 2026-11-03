const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// 用 Node 的 parser 但更详细
try {
  require('vm').compileFunction(code, [], {});
  console.log('OK');
} catch(e) {
  console.log('msg:', e.message);
  // 找错误附近: 错误一般发生在某行末尾
  // 逐行二分
  const lines = code.split('\n');
  let lo = 1, hi = lines.length, errLine = -1;
  // 已知 vm 报 line 647 (1-based), 找更精确的 token
  // 直接搜 `el(`, `=>`, `}` 看是否有未闭合
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/^[^\/]*\bfunction\b.*[^};,]$/) && !lines[i].includes('=>')) {
      // 不一定
    }
  }
  console.log('around line 640-650:');
  for (let i = 638; i < 655; i++) console.log(`${i+1}: ${lines[i]}`);
  console.log('\naround line 700-720:');
  for (let i = 698; i < 720; i++) console.log(`${i+1}: ${lines[i]}`);
}
