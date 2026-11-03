const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// 先二分到大致行
let lo = 0, hi = code.length;
while (hi - lo > 5) {
  const mid = (lo + hi) >> 1;
  try {
    new Function(code.slice(0, mid) + '\n/*trailer*/');
    lo = mid;
  } catch(e) {
    hi = mid;
  }
}
console.log(`错误在 byte ${hi}`);
console.log('---');
console.log(code.slice(Math.max(0, hi-500), hi+100));
console.log('---');
console.log('Line of byte', hi, ':');
const lines = code.slice(0, hi).split('\n');
console.log(`Line ${lines.length}: ${lines[lines.length-1]}`);
