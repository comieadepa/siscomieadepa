const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

async function run() {
  const { data: membro } = await supabase
    .from('members')
    .select('id,name,cpf,status,cargo_ministerial,pastor_presidente,pastor_auxiliar,jubilado,campo_id,congregacao_id,congregacoes!congregacao_id(campo_id,nome),custom_fields')
    .eq('cpf', '184.337.402-10') // CPF do Jose Martins da Costa ou do Jose de Jesus? 
    // Vamos buscar pelo CPF '18433740210' limpo ou pesquisar por nome.
    // Vamos buscar por nome para garantir
    .ilike('name', '%Jose de Jesus da Silva%')
    .maybeSingle();

  console.log('Membro encontrado:', JSON.stringify(membro, null, 2));

  if (membro) {
    const campoIdDireto = String(membro.campo_id ?? '').trim() || null;
    const campoIdViaCong = membro.congregacoes?.campo_id
      ? String(membro.congregacoes.campo_id).trim() || null
      : null;
    
    console.log('campoIdDireto:', campoIdDireto);
    console.log('campoIdViaCong:', campoIdViaCong);

    const campoIdSnapshot = campoIdDireto ?? campoIdViaCong;
    if (campoIdSnapshot) {
      const { data: campoData } = await supabase
        .from('campos')
        .select('nome,is_campo_missionario')
        .eq('id', campoIdSnapshot)
        .maybeSingle();
      console.log('Campo encontrado:', campoData);
    }
  }
}

run();
