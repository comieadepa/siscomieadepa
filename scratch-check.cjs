const dotenv = require('dotenv');
dotenv.config({ path: '.env.local', quiet: true });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  try {
    const { data: eventos } = await sb
      .from('eventos')
      .select('id, nome, departamento');
    console.log("=== EVENTOS ===");
    console.log(JSON.stringify(eventos, null, 2));

    const umadespa = (eventos || []).find(e => e.departamento === 'UMADESPA' || e.nome.includes('UMADESPA'));
    if (!umadespa) {
      console.log("UMADESPA event not found.");
      return;
    }

    // 1. Check leitos occupied
    const { count: leitosCount } = await sb
      .from('evento_hospedagem_leitos')
      .select('*', { count: 'exact', head: true })
      .eq('evento_id', umadespa.id)
      .eq('ocupado', true);
    console.log(`\nLeitos ocupados no banco: ${leitosCount}`);

    // 2. Check hospedagens
    const { data: hospedagens } = await sb
      .from('evento_hospedagens')
      .select('id, status, alojamento_id, numero_cama')
      .eq('evento_id', umadespa.id);
    
    console.log(`\nTotal hospedagens para o evento: ${hospedagens?.length}`);
    const statusCounts = {};
    (hospedagens || []).forEach(h => {
      statusCounts[h.status] = (statusCounts[h.status] || 0) + 1;
    });
    console.log("Status counts:", statusCounts);

    // 3. Look at some alocadas
    const alocadas = (hospedagens || []).filter(h => h.status === 'alocada');
    console.log(`\nSample alocadas (first 5):`, alocadas.slice(0, 5));

  } catch (err) {
    console.error(err);
  }
})();
