const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// 已知错误位置 ~15000,二分细化
let lo = 14500, hi = 15500;
while (hi - lo > 5) {
  const mid = (lo + hi) >> 1;
  try {
    new Function(code.slice(0, mid));
    lo = mid;
  } catch(e) {
    hi = mid;
  }
}
console.log(`错误在 byte ${lo}-${hi} 之间`);
// 输出附近代码
const lines = code.slice(0, hi).split('\n');
console.log(`最后一段:`);
console.log('  ' + lines.slice(-10).join('\n  '));
