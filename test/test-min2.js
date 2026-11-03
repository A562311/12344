const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

try {
  // Node 解析器报 row/col
  new Function(code);
} catch(e) {
  console.log('err:', e.message);
  const m = e.stack.match(/<anonymous>:(\d+):(\d+)/);
  if (m) {
    const ln = parseInt(m[1]), col = parseInt(m[2]);
    const lines = code.split('\n');
    console.log(`LINE ${ln} COL ${col}:`);
    console.log(lines[ln-1]);
    if (col > 0) console.log(' '.repeat(col-1) + '^');
    console.log('\nContext:');
    for (let i = Math.max(0, ln-3); i < Math.min(lines.length, ln+3); i++) {
      console.log(`  ${i+1}: ${lines[i].slice(0, 200)}`);
    }
  }
}
