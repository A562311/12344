const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// Node 报 line 647 是错误位置,但可能 vm 报错是 0-based 还是 1-based?
// 试 0-based 看
try {
  new Function(code);
} catch(e) {
  console.log('msg:', e.message);
}
// 试 0-based 删除后面看错误前移
for (let cut = 0; cut < code.length; cut += 500) {
  const partial = code.slice(0, code.length - cut);
  try {
    new Function(partial + '\n');
    console.log(`cut ${cut}: OK, then cut ${cut+1}:`);
    try {
      new Function(code.slice(0, code.length - (cut+1)));
    } catch(e2) {
      console.log(`  FAIL: ${e2.message}`);
    }
    break;
  } catch(e) { /* expected */ }
}
