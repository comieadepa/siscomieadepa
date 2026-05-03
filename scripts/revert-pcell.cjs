const fs = require('fs');
let c = fs.readFileSync('src/components/DocCasaDoPastor.tsx', 'utf8');

c = c.replace(/style=\{pLbl\}/g, 'style={lbl}');
c = c.replace(/style=\{pCell\}/g, 'style={cell}');
c = c.replace(/\{\.\.\.pCell,/g, '{...cell,');
c = c.replace(/\{\.\.\.pLbl,/g, '{...lbl,');
c = c.replace(/`\$\{13 \+ inc\}px`/g, "'13px'");
c = c.replace(
  /style=\{pObs\}/g,
  "style={{ ...cell, background: '#fff', fontWeight: 'bold', color: '#dc2626', textAlign: 'right', border: '1px solid #bbb', paddingRight: '8px' }}"
);

const remaining = (c.match(/pCell|pLbl|pObs|inc\b/g) || []).length;
fs.writeFileSync('src/components/DocCasaDoPastor.tsx', c, 'utf8');
console.log('done. Remaining refs:', remaining);
