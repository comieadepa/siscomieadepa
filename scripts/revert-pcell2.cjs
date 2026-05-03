const fs = require('fs');
let c = fs.readFileSync('src/components/DocCasaDoPastor.tsx', 'utf8');

// Replace all spread forms: { ...pCell,  =>  { ...cell,
c = c.replace(/\{\s*\.\.\.pCell,/g, '{ ...cell,');
c = c.replace(/\{\s*\.\.\.pLbl,/g, '{ ...lbl,');

const remaining = (c.match(/pCell|pLbl|pObs|\binc\b/g) || []).length;
fs.writeFileSync('src/components/DocCasaDoPastor.tsx', c, 'utf8');
console.log('done. Remaining refs:', remaining);
