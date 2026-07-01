const fs = require('fs');
const path = require('path');

// Parse .env.local manually
const envPath = path.join(__dirname, '.env.local');
const envContent = fs.readFileSync(envPath, 'utf-8');
const env = {};
envContent.split('\n').forEach(line => {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) return;
  const match = trimmed.match(/^([^=]+)=(.*)$/);
  if (match) {
    let key = match[1].trim();
    let val = match[2].trim();
    // Remove quotes if present
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    env[key] = val;
  }
});

const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
// Wait! If SUPABASE_SERVICE_ROLE_KEY is empty in .env.local, let's see if we can find it in another file or if there's any other place
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

console.log("Supabase URL:", supabaseUrl);
console.log("Service Role Key length:", serviceRoleKey ? serviceRoleKey.length : 0);

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing supabaseUrl or serviceRoleKey in .env.local");
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const sb = createClient(supabaseUrl, serviceRoleKey);

(async () => {
  try {
    const { data: eventos } = await sb
      .from('eventos')
      .select('id, nome, departamento');

    const umadespa = (eventos || []).find(e => e.departamento === 'UMADESPA' || e.nome.includes('UMADESPA'));
    if (!umadespa) {
      console.log("UMADESPA event not found. Events found:", eventos);
      return;
    }

    console.log(`Using event: ${umadespa.nome} (${umadespa.id})`);

    const { count: leitosCount } = await sb
      .from('evento_hospedagem_leitos')
      .select('*', { count: 'exact', head: true })
      .eq('evento_id', umadespa.id)
      .eq('ocupado', true);
    console.log(`Leitos ocupados: ${leitosCount}`);

    const { data: hospedagens } = await sb
      .from('evento_hospedagens')
      .select('id, status, alojamento_id, numero_cama')
      .eq('evento_id', umadespa.id);

    console.log(`Total hospedagens: ${hospedagens?.length}`);
    const statusCounts = {};
    (hospedagens || []).forEach(h => {
      statusCounts[h.status] = (statusCounts[h.status] || 0) + 1;
    });
    console.log("Status counts:", statusCounts);

    const alocadas = (hospedagens || []).filter(h => h.status === 'alocada');
    console.log("Sample alocadas:", alocadas.slice(0, 5));

  } catch (err) {
    console.error(err);
  }
})();
