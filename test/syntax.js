const fs = require('fs');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];
try {
  new Function(code);
  console.log('✅ JS 语法 OK');
} catch(e) {
  console.log('❌', e.message);
}
