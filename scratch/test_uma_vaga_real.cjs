require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const EVENTO_ID = '4307ecd3-e74a-4855-9de7-c4e29216a190';
const ALOJ_ROSA_ID = 'fbb5d408-e9de-42ee-bfb5-2d4f0d33a0d8';

async function testUmaVagaReal() {
  console.log('=== TESTE DE CONCORRÊNCIA: 2 INSCRIÇÕES DISPUTANDO 1 VAGA REAL ===');

  // 1. Criar um leito de teste isolado no Rosa marcado como livre
  const { data: leitoTeste, error: errLeito } = await supabase
    .from('evento_hospedagem_leitos')
    .insert([{
      evento_id: EVENTO_ID,
      alojamento_id: ALOJ_ROSA_ID,
      numero: '999',
      tipo_leito: 'colchonete',
      posicao: 'unico',
      ocupado: false
    }])
    .select('id')
    .single();

  if (errLeito || !leitoTeste) {
    console.error('Erro ao criar leito de teste:', errLeito);
    return;
  }

  // 2. Temporariamente ajustar capacidade do Rosa para +1 para liberar exatamente 1 vaga
  const { data: rosaAtual } = await supabase
    .from('evento_alojamentos')
    .select('total_vagas, colchonetes')
    .eq('id', ALOJ_ROSA_ID)
    .single();

  await supabase
    .from('evento_alojamentos')
    .update({
      total_vagas: rosaAtual.total_vagas + 1,
      colchonetes: rosaAtual.colchonetes + 1
    })
    .eq('id', ALOJ_ROSA_ID);

  // 3. Criar 2 inscrições concorrentes isoladas
  const { data: insc1 } = await supabase
    .from('evento_inscricoes')
    .insert([{
      evento_id: EVENTO_ID,
      nome_inscrito: 'CONCORRENTE A (TESTE 1 VAGA)',
      cpf: '88888888801',
      sexo: 'F',
      tipo_inscricao: 'VISITANTE',
      status_pagamento: 'pago',
      hospedagem: true
    }])
    .select('id')
    .single();

  const { data: insc2 } = await supabase
    .from('evento_inscricoes')
    .insert([{
      evento_id: EVENTO_ID,
      nome_inscrito: 'CONCORRENTE B (TESTE 1 VAGA)',
      cpf: '88888888802',
      sexo: 'F',
      tipo_inscricao: 'VISITANTE',
      status_pagamento: 'pago',
      hospedagem: true
    }])
    .select('id')
    .single();

  try {
    console.log('Disparando 2 requisições concorrentes pela única vaga (Leito 999)...');
    const [resA, resB] = await Promise.all([
      supabase.rpc('alocar_hospedagem_atomica', {
        p_evento_id: EVENTO_ID,
        p_inscricao_id: insc1.id,
        p_alojamento_id: ALOJ_ROSA_ID,
        p_tipo_cama: 'colchonete',
        p_prioridade: 0,
        p_origem_alocacao: 'teste_uma_vaga'
      }),
      supabase.rpc('alocar_hospedagem_atomica', {
        p_evento_id: EVENTO_ID,
        p_inscricao_id: insc2.id,
        p_alojamento_id: ALOJ_ROSA_ID,
        p_tipo_cama: 'colchonete',
        p_prioridade: 0,
        p_origem_alocacao: 'teste_uma_vaga'
      })
    ]);

    console.log('\n--- RESULTADOS ---');
    console.log('Tentativa A:', resA.data?.status, resA.data?.motivo);
    console.log('Tentativa B:', resB.data?.status, resB.data?.motivo);

    const sucessoA = !!resA.data?.success;
    const sucessoB = !!resB.data?.success;

    const apenasUmaSucesso = (sucessoA && !sucessoB) || (!sucessoA && sucessoB);
    console.log('\nAPENAS UMA CONTRATOU? ' + apenasUmaSucesso + ' (A=' + sucessoA + ', B=' + sucessoB + ')');
    if (apenasUmaSucesso) {
      console.log('Vencedor:', sucessoA ? 'Tentativa A' : 'Tentativa B');
      console.log('Perdedor:', sucessoA ? 'Tentativa B foi enviada para lista de espera/bloqueada' : 'Tentativa A foi enviada para lista de espera/bloqueada');
    }
  } finally {
    console.log('\nRestaurando estado oficial e limpando ambiente isolado...');
    await supabase.from('evento_hospedagens').delete().in('inscricao_id', [insc1.id, insc2.id]);
    await supabase.from('evento_hospedagem_leitos').delete().eq('id', leitoTeste.id);
    await supabase.from('evento_inscricoes').delete().in('id', [insc1.id, insc2.id]);
    await supabase
      .from('evento_alojamentos')
      .update({
        total_vagas: rosaAtual.total_vagas,
        colchonetes: rosaAtual.colchonetes
      })
      .eq('id', ALOJ_ROSA_ID);
    console.log('Estado oficial restaurado com 124 vagas no Rosa e leito de teste removido.');
  }
}

testUmaVagaReal();
