import { logDB } from '@/lib/audit';
import {
  calcularPrioridadeHospedagem,
  resolveGrupoHospedagemAGO,
  sugerirAlojamento,
  grupoMatchesAlojamento,
  resolveCamaInferiorAutomatica,
  type Alojamento,
} from '@/lib/hospedagem-helpers';
import {
  formatarNumeroLeitoSequencial,
} from '@/lib/hospedagem-operacional';
import { normalizePayloadUppercase } from '@/lib/text';

async function colocarEmListaEspera(supabase: any, hospedagemId: string, prioridade: number) {
  const { error } = await supabase
    .from('evento_hospedagens')
    .update({
      status: 'lista_espera',
      alojamento_id: null,
      tipo_cama: null,
      numero_cama: null,
      alocacao_automatica: true,
      prioridade,
    })
    .eq('id', hospedagemId);

  if (error) {
    console.error(`[Autoalocacao] Erro ao colocar hospedagem ${hospedagemId} em lista de espera:`, error.message);
  }

  await logDB({
    acao: 'hospedagem_lista_espera',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: hospedagemId,
    descricao: `[Hospedagem] Sem vagas disponíveis. Inscrição enviada para lista de espera.`,
  });
}

export async function alocarLeitoParaInscricao(supabase: any, inscricaoId: string) {
  try {
    // 1. Busca a inscrição
    const { data: inscricao, error: errInsc } = await supabase
      .from('evento_inscricoes')
      .select(`
        id,
        evento_id,
        nome_inscrito,
        sexo,
        data_nascimento,
        tipo_inscricao,
        hospedagem,
        status_pagamento,
        hosp_necessidade_especial,
        hosp_descricao_necessidade,
        hosp_cama_inferior,
        hosp_observacoes,
        hosp_possui_comorbidade,
        hosp_descricao_comorbidade
      `)
      .eq('id', inscricaoId)
      .single();

    if (errInsc || !inscricao) {
      console.error(`[Autoalocacao] Inscricao nao encontrada: ${inscricaoId}`, errInsc?.message);
      return;
    }

    // 2. Busca o evento
    const { data: evento, error: errEv } = await supabase
      .from('eventos')
      .select('id, departamento, permite_hospedagem')
      .eq('id', inscricao.evento_id)
      .single();

    if (errEv || !evento) {
      console.error(`[Autoalocacao] Evento nao encontrado: ${inscricao.evento_id}`, errEv?.message);
      return;
    }

    // Se não for evento AGO, ou se o evento não permite hospedagem, ou se o inscrito não solicitou hospedagem
    if (evento.departamento !== 'AGO' || !evento.permite_hospedagem || !inscricao.hospedagem) {
      return;
    }

    // Se o pagamento não for pago/isento
    if (!['pago', 'isento'].includes((inscricao.status_pagamento || '').toLowerCase())) {
      return;
    }

    // 3. Recupera ou cria registro de hospedagem
    let { data: hospedagem, error: errHosp } = await supabase
      .from('evento_hospedagens')
      .select('id, status, alojamento_id, tipo_cama, numero_cama, observacoes, grupo_hospedagem')
      .eq('inscricao_id', inscricaoId)
      .maybeSingle();

    if (errHosp) {
      console.error(`[Autoalocacao] Erro ao buscar hospedagem para ${inscricaoId}:`, errHosp.message);
      return;
    }

    // Se já estiver alocada, confirmada ou checkin_realizado, não faz nada
    if (hospedagem && ['alocada', 'confirmada', 'checkin_realizado'].includes(hospedagem.status)) {
      return;
    }

    const grupoHosp = resolveGrupoHospedagemAGO({
      sexo: inscricao.sexo,
      data_nascimento: inscricao.data_nascimento,
      tipo_inscricao: inscricao.tipo_inscricao,
      hosp_necessidade_especial: !!inscricao.hosp_necessidade_especial,
      hosp_possui_comorbidade: !!inscricao.hosp_possui_comorbidade,
    });

    const prioridade = calcularPrioridadeHospedagem({
      id: inscricao.id,
      nome_inscrito: inscricao.nome_inscrito,
      sexo: inscricao.sexo,
      data_nascimento: inscricao.data_nascimento,
      tipo_inscricao: inscricao.tipo_inscricao,
      hosp_necessidade_especial: !!inscricao.hosp_necessidade_especial,
      hosp_descricao_necessidade: inscricao.hosp_descricao_necessidade,
      hosp_cama_inferior: !!inscricao.hosp_cama_inferior,
      hosp_observacoes: inscricao.hosp_observacoes,
      hosp_possui_comorbidade: !!inscricao.hosp_possui_comorbidade,
      hosp_descricao_comorbidade: inscricao.hosp_descricao_comorbidade,
    });

    const camaInferiorNecessaria = resolveCamaInferiorAutomatica({
      sexo: inscricao.sexo,
      data_nascimento: inscricao.data_nascimento,
      tipo_inscricao: inscricao.tipo_inscricao,
      hosp_necessidade_especial: !!inscricao.hosp_necessidade_especial,
      hosp_possui_comorbidade: !!inscricao.hosp_possui_comorbidade,
    });

    if (!hospedagem) {
      const { data: novaHosp, error: errInsertHosp } = await supabase
        .from('evento_hospedagens')
        .insert(normalizePayloadUppercase({
          evento_id:            evento.id,
          inscricao_id:         inscricaoId,
          status:               'solicitada',
          prioridade,
          necessidade_especial: !!inscricao.hosp_necessidade_especial,
          descricao_necessidade: inscricao.hosp_descricao_necessidade ?? null,
          cama_inferior:        camaInferiorNecessaria,
          observacoes:          inscricao.hosp_observacoes ?? null,
          grupo_hospedagem:     grupoHosp,
          alocacao_automatica:  true,
        }))
        .select()
        .single();

      if (errInsertHosp) {
        console.error(`[Autoalocacao] Erro ao criar hospedagem para ${inscricaoId}:`, errInsertHosp.message);
        return;
      }
      hospedagem = novaHosp;
    } else {
      // Atualizar grupo_hospedagem se estiver vazio ou diferente
      if (hospedagem.grupo_hospedagem !== grupoHosp) {
        await supabase
          .from('evento_hospedagens')
          .update({ grupo_hospedagem: grupoHosp })
          .eq('id', hospedagem.id);
        hospedagem.grupo_hospedagem = grupoHosp;
      }
    }

    // 4. Busca os alojamentos ativos
    const { data: alojamentosRaw, error: errAloj } = await supabase
      .from('evento_alojamentos')
      .select('id, nome, publico, sexo, total_vagas, camas_inferiores, camas_superiores, ativo')
      .eq('evento_id', evento.id)
      .eq('ativo', true);

    if (errAloj || !alojamentosRaw || alojamentosRaw.length === 0) {
      console.error(`[Autoalocacao] Nenhum alojamento ativo encontrado para o evento ${evento.id}`);
      await colocarEmListaEspera(supabase, hospedagem.id, prioridade);
      return;
    }

    // 5. Conta ocupantes atuais
    const { data: ocupantesDb } = await supabase
      .from('evento_hospedagens')
      .select('alojamento_id, tipo_cama')
      .eq('evento_id', evento.id)
      .in('status', ['alocada', 'confirmada', 'checkin_realizado'])
      .not('alojamento_id', 'is', null);

    const vagasMap: Record<string, { total: number; inferiores: number; superiores: number }> = {};
    for (const aloj of alojamentosRaw) {
      const conf = (ocupantesDb ?? []).filter((c: any) => c.alojamento_id === aloj.id);
      vagasMap[aloj.id] = {
        total:      aloj.total_vagas      - conf.length,
        inferiores: aloj.camas_inferiores - conf.filter((c: any) => c.tipo_cama === 'inferior').length,
        superiores: aloj.camas_superiores - conf.filter((c: any) => c.tipo_cama === 'superior').length,
      };
    }

    const alojamentos = alojamentosRaw.map((a: any) => ({
      ...a,
      evento_id:         evento.id,
      vagas_livres:      vagasMap[a.id]?.total      ?? 0,
      inferiores_livres: vagasMap[a.id]?.inferiores ?? 0,
      superiores_livres: vagasMap[a.id]?.superiores ?? 0,
    })) as Alojamento[];

    // 6. Alojamentos candidatos compatíveis
    const candidatos = alojamentos
      .filter(a => grupoMatchesAlojamento(grupoHosp, a))
      .sort((a, b) => {
        const ratioA = a.total_vagas > 0 ? (a.total_vagas - (a.vagas_livres ?? 0)) / a.total_vagas : 1;
        const ratioB = b.total_vagas > 0 ? (b.total_vagas - (b.vagas_livres ?? 0)) / b.total_vagas : 1;
        return ratioA - ratioB;
      });

    const sugestao = sugerirAlojamento({
      id: inscricao.id,
      nome_inscrito: inscricao.nome_inscrito,
      sexo: inscricao.sexo,
      data_nascimento: inscricao.data_nascimento,
      tipo_inscricao: inscricao.tipo_inscricao,
      hosp_necessidade_especial: !!inscricao.hosp_necessidade_especial,
      hosp_descricao_necessidade: inscricao.hosp_descricao_necessidade,
      hosp_cama_inferior: camaInferiorNecessaria,
      hosp_observacoes: inscricao.hosp_observacoes,
      hosp_possui_comorbidade: !!inscricao.hosp_possui_comorbidade,
      hosp_descricao_comorbidade: inscricao.hosp_descricao_comorbidade,
    }, candidatos, prioridade);

    if (!sugestao.alojamento_id || sugestao.status === 'lista_espera') {
      await colocarEmListaEspera(supabase, hospedagem.id, prioridade);
      return;
    }

    // 7. Loop de alocação de leito com tratamento de concorrência
    const alojId = sugestao.alojamento_id;
    const { data: leitosExistentes } = await supabase
      .from('evento_hospedagem_leitos')
      .select('numero')
      .eq('evento_id', evento.id)
      .eq('alojamento_id', alojId);

    let maxNum = 0;
    for (const l of leitosExistentes ?? []) {
      const num = parseInt(l.numero) || 0;
      if (num > maxNum) maxNum = num;
    }

    let alocadoComSucesso = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const nextNum = maxNum + 1 + attempt;
      const numeroCama = formatarNumeroLeitoSequencial(nextNum);
      const posicao = sugestao.tipo_cama === 'inferior' ? 'inferior' : (sugestao.tipo_cama === 'superior' ? 'superior' : 'unico');

      // Tenta inserir na tabela de leitos
      const { error: errInsertLeito } = await supabase
        .from('evento_hospedagem_leitos')
        .insert({
          evento_id: evento.id,
          alojamento_id: alojId,
          inscricao_id: inscricaoId,
          numero: numeroCama,
          tipo_leito: 'beliche',
          posicao,
          ocupado: true,
        });

      if (!errInsertLeito) {
        // Alocado com sucesso! Atualiza a tabela evento_hospedagens
        const observacaoAtual = String(hospedagem.observacoes ?? '').trim();
        const alertaTxt = sugestao.prioridadeInferiorNaoAtendida ? 'PRIORIDADE SEM LEITO INFERIOR DISPONIVEL' : '';
        const observacaoNova = [observacaoAtual, alertaTxt].filter(Boolean).join(' | ') || null;

        const { error: errUpdateHosp } = await supabase
          .from('evento_hospedagens')
          .update({
            alojamento_id: alojId,
            tipo_cama: sugestao.tipo_cama,
            numero_cama: numeroCama,
            status: 'alocada',
            prioridade,
            observacoes: observacaoNova,
            alocacao_automatica: true,
          })
          .eq('id', hospedagem.id);

        if (errUpdateHosp) {
          console.error(`[Autoalocacao] Erro ao atualizar status da hospedagem ${hospedagem.id}:`, errUpdateHosp.message);
        }

        await logDB({
          acao: 'hospedagem_alocada',
          modulo: 'eventos',
          entidade: 'evento_hospedagens',
          entidadeId: evento.id,
          descricao: `[Hospedagem] Alocação automática individual: ${inscricao.nome_inscrito} alocado no leito ${numeroCama} do alojamento ${alojId}`,
          detalhes: { inscricaoId, alojamentoId: alojId, numeroCama, posicao },
        });

        alocadoComSucesso = true;
        break;
      }

      // Se o erro for de restrição única (23505), tentamos o próximo número
      if (errInsertLeito.code === '23505') {
        console.warn(`[Autoalocacao] Conflito de leito ${numeroCama} no alojamento ${alojId}. Tentando proximo...`);
        continue;
      }

      // Qualquer outro erro, abortamos o loop
      console.error(`[Autoalocacao] Erro inesperado ao inserir leito para ${inscricaoId}:`, errInsertLeito.message);
      break;
    }

    if (!alocadoComSucesso) {
      // Se falhou todas as tentativas, coloca em lista de espera
      console.error(`[Autoalocacao] Nao foi possivel alocar leito após tentativas para ${inscricaoId}. Movendo para lista de espera.`);
      await colocarEmListaEspera(supabase, hospedagem.id, prioridade);
    }
  } catch (err: any) {
    console.error(`[Autoalocacao] Erro crítico na autoalocação da inscrição ${inscricaoId}:`, err.message);
  }
}
