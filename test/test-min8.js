const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

// 用更精确的方法:逐字符删除找错误字符
for (let i = 14500; i > 14000; i--) {
  try {
    new Function(code.slice(0, i));
    console.log(`删到 ${i} OK, 真正错误在 ${i} 附近`);
    // 看 i 位置附近
    const around = code.slice(i-300, i+100);
    console.log('---');
    console.log(around);
    console.log('---');
    break;
  } catch(e) { /* */ }
}
