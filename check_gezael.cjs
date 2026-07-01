const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

// Parse .env.local
const env = {};
if (fs.existsSync('.env.local')) {
  const content = fs.readFileSync('.env.local', 'utf8');
  content.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx !== -1) {
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
      env[key] = val;
    }
  });
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: inscricoes, error } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, evento_id, qr_code, eventos(nome, departamento)')
    .ilike('nome_inscrito', '%Gezael%');

  if (error) {
    console.error(error);
    return;
  }

  console.log('=== Inscrições encontradas para Gezael ===');
  console.log(JSON.stringify(inscricoes, null, 2));
})();
