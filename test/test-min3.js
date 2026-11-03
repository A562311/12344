const fs = require('fs');
const vm = require('vm');
const code = fs.readFileSync('../quiz/quiz-pro.html', 'utf-8')
  .match(/<script>([\s\S]*?)<\/script>/)[1];

try {
  new vm.Script(code);
} catch(e) {
  console.log('msg:', e.message);
  // vm.Script 错误会带 lineNumber
  if (e.stack) console.log(e.stack.split('\n').slice(0,8).join('\n'));
}
