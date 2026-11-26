require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const EVENTO_ID = '4307ecd3-e74a-4855-9de7-c4e29216a190';
const ALOJ_ROSA_ID = 'fbb5d408-e9de-42ee-bfb5-2d4f0d33a0d8';

async function testConcorrencia() {
  console.log('=== TESTE DE CONCORRÊNCIA PELA ÚLTIMA VAGA (DADOS SINTÉTICOS) ===');

  // Cria 2 inscrições sintéticas temporárias para o teste de colisão
  const { data: insc1, error: err1 } = await supabase
    .from('evento_inscricoes')
    .insert([{
      evento_id: EVENTO_ID,
      nome_inscrito: 'TESTE SINTETICO CONCORRENCIA A',
      cpf: '99999999901',
      sexo: 'F',
      tipo_inscricao: 'VISITANTE',
      status_pagamento: 'pago',
      hospedagem: true
    }])
    .select('id')
    .single();

  const { data: insc2, error: err2 } = await supabase
    .from('evento_inscricoes')
    .insert([{
      evento_id: EVENTO_ID,
      nome_inscrito: 'TESTE SINTETICO CONCORRENCIA B',
      cpf: '99999999902',
      sexo: 'F',
      tipo_inscricao: 'VISITANTE',
      status_pagamento: 'pago',
      hospedagem: true
    }])
    .select('id')
    .single();

  if (err1 || err2 || !insc1 || !insc2) {
    console.error('Erro ao criar inscricoes de teste:', err1 || err2);
    return;
  }

  console.log(`Inscrições sintéticas criadas: A (${insc1.id}) e B (${insc2.id})`);

  try {
    // Dispara as duas tentativas concorrentemente no Rosa (que possui exatamente 0 vagas livres)
    const [resA, resB] = await Promise.all([
      supabase.rpc('alocar_hospedagem_atomica', {
        p_evento_id: EVENTO_ID,
        p_inscricao_id: insc1.id,
        p_alojamento_id: ALOJ_ROSA_ID,
        p_tipo_cama: 'colchonete',
        p_prioridade: 0,
        p_origem_alocacao: 'teste_sintetico_concorrencia'
      }),
      supabase.rpc('alocar_hospedagem_atomica', {
        p_evento_id: EVENTO_ID,
        p_inscricao_id: insc2.id,
        p_alojamento_id: ALOJ_ROSA_ID,
        p_tipo_cama: 'colchonete',
        p_prioridade: 0,
        p_origem_alocacao: 'teste_sintetico_concorrencia'
      })
    ]);

    console.log('\n--- RESULTADO CONCORRÊNCIA ---');
    console.log('Resultado Tentativa A:', resA.data);
    console.log('Resultado Tentativa B:', resB.data);

    // Ambas devem ter sido devidamente barradas ou no máximo uma obter a vaga sem sobreposição
    const sucessoA = resA.data?.success;
    const sucessoB = resB.data?.success;
    console.log(`\nValidado: Duplicidade evitada? ${!(sucessoA && sucessoB)} (A=${sucessoA}, B=${sucessoB})`);
  } finally {
    // Limpeza estrita dos dados sintéticos
    console.log('\nLimpando registros sintéticos de teste...');
    await supabase.from('evento_hospedagens').delete().in('inscricao_id', [insc1.id, insc2.id]);
    await supabase.from('evento_hospedagem_leitos').update({ ocupado: false, inscricao_id: null }).in('inscricao_id', [insc1.id, insc2.id]);
    await supabase.from('evento_inscricoes').delete().in('id', [insc1.id, insc2.id]);
    console.log('Registros sintéticos removidos com sucesso.');
  }
}

testConcorrencia();
