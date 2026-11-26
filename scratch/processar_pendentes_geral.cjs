require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const EVENTO_ID = '4307ecd3-e74a-4855-9de7-c4e29216a190';

// Removida importação relativa TS pura

async function main() {
  console.log('=== PROCESSAMENTO DOS PARTICIPANTES PENDENTES ===');

  // 1. Buscar participantes pagos/isentos que solicitaram hospedagem
  const { data: inscricoes, error: errInsc } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, sexo, data_nascimento, tipo_inscricao, status_pagamento, hospedagem, checkin_realizado, hosp_necessidade_especial, hosp_descricao_necessidade, hosp_cama_inferior, hosp_observacoes, hosp_possui_comorbidade, hosp_descricao_comorbidade')
    .eq('evento_id', EVENTO_ID)
    .eq('hospedagem', true)
    .in('status_pagamento', ['pago', 'isento']);

  if (errInsc || !inscricoes) {
    console.error('Erro ao buscar inscricoes:', errInsc);
    return;
  }

  // 2. Buscar hospedagens ativas e leitos ocupados para identificar pendentes puros
  const { data: hosp } = await supabase
    .from('evento_hospedagens')
    .select('inscricao_id, status, numero_cama, alojamento_id')
    .eq('evento_id', EVENTO_ID);

  const { data: leitos } = await supabase
    .from('evento_hospedagem_leitos')
    .select('inscricao_id')
    .eq('evento_id', EVENTO_ID)
    .eq('ocupado', true);

  const inscComLeito = new Set((leitos || []).filter(l => l.inscricao_id).map(l => l.inscricao_id));
  const inscComHosp = new Set((hosp || []).filter(h => h.alojamento_id && h.numero_cama && ['confirmada', 'checkin_realizado', 'checkout_realizado'].includes(h.status)).map(h => h.inscricao_id));

  // Pendentes reais sem leito físico e sem hospedagem confirmada com cama
  const pendentes = inscricoes.filter(i => !inscComLeito.has(i.id) && !inscComHosp.has(i.id));

  console.log(`Total de inscritos com hospedagem solicitada e pagos: ${inscricoes.length}`);
  console.log(`Total de inscritos pendentes para alocação: ${pendentes.length}`);

  // 3. Buscar alojamentos ativos
  const { data: alojamentos } = await supabase
    .from('evento_alojamentos')
    .select('*')
    .eq('evento_id', EVENTO_ID)
    .eq('ativo', true);

  // Ordenar pendentes: prioridade máxima para necessidades especiais e cama inferior
  pendentes.sort((a, b) => {
    const prioA = (a.hosp_necessidade_especial ? 100 : 0) + (a.hosp_cama_inferior ? 50 : 0);
    const prioB = (b.hosp_necessidade_especial ? 100 : 0) + (b.hosp_cama_inferior ? 50 : 0);
    return prioB - prioA;
  });

  const resultados = {
    alocados: [],
    preservados: [],
    recusados: []
  };

  for (const insc of pendentes) {
    const sexoNorm = (insc.sexo || '').trim().toUpperCase();
    const isFem = sexoNorm === 'F' || sexoNorm === 'FEMININO';
    const exigeInferior = !!(insc.hosp_necessidade_especial || insc.hosp_cama_inferior);

    // Mapeia alojamentos candidatos por compatibilidade
    let candidatos = alojamentos.filter(a => {
      const pub = (a.publico || '').toLowerCase();
      if (isFem && pub !== 'feminino') return false;
      if (!isFem && pub === 'feminino') return false;
      return true;
    });

    // Se mulher, o Rosa está lotado (124/124), o destino oficial é o AZUL
    if (isFem) {
      candidatos = candidatos.filter(a => a.nome.includes('AZUL'));
    } else {
      // Homens: distribuir conforme cargo/grupo
      const tipo = (insc.tipo_inscricao || '').toUpperCase();
      if (tipo.includes('PRESIDENTE') || tipo.includes('JUBILADO')) {
        // Prédio Novo ou AAME
        candidatos = candidatos.filter(a => a.nome.includes('NOVO') || a.nome.includes('AAME'));
      } else {
        // Pastor Auxiliar / Juventude / Apoio -> Mário Covas
        candidatos = candidatos.filter(a => a.nome.includes('MÁRIO COVAS') || a.nome.includes('MARIO COVAS'));
      }
    }

    if (candidatos.length === 0) {
      resultados.recusados.push({ nome: insc.nome_inscrito, motivo: 'Nenhum alojamento compatível disponível' });
      continue;
    }

    const alojDestino = candidatos[0];
    const tipoCamaDesejada = exigeInferior ? 'inferior' : (alojDestino.colchonetes > 0 ? 'superior' : 'inferior');

    console.log(`Tentando alocar: ${insc.nome_inscrito} (${insc.tipo_inscricao}) no ${alojDestino.nome} (tipo: ${tipoCamaDesejada})...`);

    const { data: rpcRes, error: rpcErr } = await supabase.rpc('alocar_hospedagem_atomica', {
      p_evento_id: EVENTO_ID,
      p_inscricao_id: insc.id,
      p_alojamento_id: alojDestino.id,
      p_tipo_cama: tipoCamaDesejada,
      p_prioridade: exigeInferior ? 2 : 0,
      p_origem_alocacao: 'processamento_oficial_leitos_materializados'
    });

    if (rpcErr) {
      console.error(`Erro RPC para ${insc.nome_inscrito}:`, rpcErr);
      resultados.recusados.push({ nome: insc.nome_inscrito, motivo: rpcErr.message });
    } else if (rpcRes.success) {
      console.log(`-> ALOCADO: ${insc.nome_inscrito} no Leito ${rpcRes.detalhes?.numero_cama} (${rpcRes.detalhes?.tipo_cama}) do ${alojDestino.nome}`);
      resultados.alocados.push({
        nome: insc.nome_inscrito,
        alojamento: alojDestino.nome,
        leito: rpcRes.detalhes?.numero_cama,
        tipo_cama: rpcRes.detalhes?.tipo_cama
      });
    } else if (rpcRes.status === 'preservado') {
      resultados.preservados.push({ nome: insc.nome_inscrito, motivo: rpcRes.motivo });
    } else {
      // Tentar colchonete ou outra posição caso tenha esgotado a desejada
      console.warn(`Tentativa alternativa para ${insc.nome_inscrito} (retorno anterior: ${rpcRes.motivo})`);
      const { data: rpcRes2 } = await supabase.rpc('alocar_hospedagem_atomica', {
        p_evento_id: EVENTO_ID,
        p_inscricao_id: insc.id,
        p_alojamento_id: alojDestino.id,
        p_tipo_cama: tipoCamaDesejada === 'inferior' ? 'superior' : 'colchonete',
        p_prioridade: 0,
        p_origem_alocacao: 'processamento_oficial_alternativo'
      });
      if (rpcRes2 && rpcRes2.success) {
        resultados.alocados.push({
          nome: insc.nome_inscrito,
          alojamento: alojDestino.nome,
          leito: rpcRes2.detalhes?.numero_cama,
          tipo_cama: rpcRes2.detalhes?.tipo_cama
        });
      } else {
        resultados.recusados.push({ nome: insc.nome_inscrito, motivo: rpcRes.motivo });
      }
    }
  }

  console.log('\n=== RESULTADO FINAL DO PROCESSAMENTO ===');
  console.log(`Total Alocados com Sucesso: ${resultados.alocados.length}`);
  console.log(`Total Preservados (check-in de hospedagem prévio): ${resultados.preservados.length}`);
  console.log(`Total Recusados/Pendentes: ${resultados.recusados.length}`);
  if (resultados.alocados.length > 0) {
    console.log('Alocados:', resultados.alocados);
  }
  if (resultados.recusados.length > 0) {
    console.log('Recusados:', resultados.recusados);
  }
}

main();
