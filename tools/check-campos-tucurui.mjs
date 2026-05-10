const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1` : 'https://wtifljxpoinpbzyugrfc.supabase.co/rest/v1';
const h = { 'apikey': KEY, 'Authorization': `Bearer ${KEY}`, 'Prefer': 'count=exact' };

async function get(path) {
  const r = await fetch(`${URL}${path}`, { headers: h });
  const count = r.headers.get('content-range');
  const data = await r.json();
  return { data, count };
}

// Buscar TODOS os campos com paginação
let allCampos = [];
let from = 0;
const PAGE = 1000;
while (true) {
  const r = await fetch(`${URL}/campos?select=id,nome,supervisao_id,is_active&order=nome&limit=${PAGE}&offset=${from}`, { headers: h });
  const data = await r.json();
  allCampos = allCampos.concat(data);
  if (data.length < PAGE) break;
  from += PAGE;
}
console.log(`Total campos carregados (paginado): ${allCampos.length}`);

// Buscar todas supervisões
const { data: sups } = await get('/supervisoes?select=id,nome&order=nome&limit=200');
console.log(`Total supervisoes: ${sups.length}`);

// Mostrar supervisões com discrepância
for (const sup of sups) {
  const total = allCampos.filter(c => c.supervisao_id === sup.id);
  if (total.length > 10) {
    console.log(`  ${sup.nome}: ${total.length} campos`);
  }
}


