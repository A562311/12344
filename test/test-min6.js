const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// 错误在最后 18001 字节之前
// 二分找精确位置
let lo = 15000, hi = code.length;
while (hi - lo > 10) {
  const mid = (lo + hi) >> 1;
  try {
    new Function(code.slice(0, mid));
    lo = mid;  // 前 mid 字节 OK,错误在 mid 之后
  } catch(e) {
    hi = mid;  // 前 mid 字节有错,错误在 mid 之前
  }
}
console.log(`错误在 ~${lo}-${hi} 之间 (总长 ${code.length})`);
console.log('---');
console.log(code.slice(lo - 200, hi + 200));
console.log('---');
