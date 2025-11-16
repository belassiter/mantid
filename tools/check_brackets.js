const fs = require('fs');
const path = 'src/components/GameBoard.jsx';
const s = fs.readFileSync(path, 'utf8');
const opens = [];
for (let i = 0; i < s.length; i++) {
  const ch = s[i];
  if (ch === '"' || ch === "'" ) {
    // skip string
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === ch && s[j-1] !== '\\') break;
      j++;
    }
    i = j;
    continue;
  }
  if (ch === '`') {
    let j = i + 1;
    while (j < s.length) {
      if (s[j] === '`' && s[j-1] !== '\\') break;
      j++;
    }
    i = j;
    continue;
  }
  if ('([{'.includes(ch)) {
    opens.push({ch, i});
  }
  if (')]}'.includes(ch)) {
    const last = opens.pop();
    if (!last) {
      console.log('Unmatched closing', ch, 'at', i);
      process.exit(2);
    }
    const match = {'(': ')','[':']','{':'}'}[last.ch];
    if (match !== ch) {
      console.log('Mismatched', last.ch, 'at', last.i, 'closed by', ch, 'at', i);
      process.exit(3);
    }
  }
}
if (opens.length > 0) {
  console.log('Unclosed tokens:');
  console.log(opens.slice(0, 10));
  process.exit(4);
}
console.log('Brackets appear balanced');
