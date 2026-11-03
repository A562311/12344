const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// 二分确保错误信息相同(说明错误就在分割点附近)
function errAt(mid) {
  try {
    new Function(code.slice(0, mid));
    return null;
  } catch(e) {
    return e.message;
  }
}
let lo = 0, hi = code.length;
const targetErr = 'missing ) after argument list';
while (hi - lo > 50) {
  const mid = (lo + hi) >> 1;
  const err = errAt(mid);
  if (err === targetErr) {
    hi = mid;  // 还有错,错误在 mid 之前
  } else {
    lo = mid;  // mid OK,错误在 mid 之后
  }
}
console.log(`错误在 byte ${lo}-${hi}`);
console.log('---');
console.log(code.slice(Math.max(0, lo-400), hi+100));
console.log('---');
const lines = code.slice(0, hi).split('\n');
console.log(`Error line: ${lines.length}`);
console.log(lines[lines.length-3]);
console.log(lines[lines.length-2]);
console.log(lines[lines.length-1]);
