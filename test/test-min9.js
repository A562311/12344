const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// 找到第一个能 throw 的位置
for (let i = 14500; i > 13800; i--) {
  try {
    new Function(code.slice(0, i));
    console.log(`删到 byte ${i} OK, 错误在 ${i+1} 字符`);
    console.log('--- 周围代码 (i-200..i+50) ---');
    console.log(code.slice(i-200, i+50));
    console.log('---');
    break;
  } catch(e) { /* */ }
}
