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

    if (evento.departamento === 'AGO') {
      await alocarLeitoParaInscricaoAGO(supabase, inscricaoId, inscricao, evento);
    } else {
      await alocarLeitoParaInscricaoEventoComum(supabase, inscricaoId, inscricao, evento);
    }
  } catch (err: any) {
    console.error(`[Autoalocacao] Erro crítico na autoalocação da inscrição ${inscricaoId}:`, err.message);
  }
}

export async function alocarLeitoParaInscricaoAGO(supabase: any, inscricaoId: string, inscricao: any, evento: any) {
  // Se o evento não permite hospedagem, ou se o inscrito não solicitou hospedagem
  if (!evento.permite_hospedagem || !inscricao.hospedagem) {
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
    console.error(`[Autoalocacao] [AGO] Erro ao buscar hospedagem para ${inscricaoId}:`, errHosp.message);
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
      console.error(`[Autoalocacao] [AGO] Erro ao criar hospedagem para ${inscricaoId}:`, errInsertHosp.message);
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
    console.error(`[Autoalocacao] [AGO] Nenhum alojamento ativo encontrado para o evento ${evento.id}`);
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
        console.error(`[Autoalocacao] [AGO] Erro ao atualizar status da hospedagem ${hospedagem.id}:`, errUpdateHosp.message);
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
      console.warn(`[Autoalocacao] [AGO] Conflito de leito ${numeroCama} no alojamento ${alojId}. Tentando proximo...`);
      continue;
    }

    // Qualquer outro erro, abortamos o loop
    console.error(`[Autoalocacao] [AGO] Erro inesperado ao inserir leito para ${inscricaoId}:`, errInsertLeito.message);
    break;
  }

  if (!alocadoComSucesso) {
    // Se falhou todas as tentativas, coloca em lista de espera
    console.error(`[Autoalocacao] [AGO] Nao foi possivel alocar leito após tentativas para ${inscricaoId}. Movendo para lista de espera.`);
    await colocarEmListaEspera(supabase, hospedagem.id, prioridade);
  }
}

export async function alocarLeitoParaInscricaoEventoComum(supabase: any, inscricaoId: string, inscricao: any, evento: any) {
  try {
    // Requisito 1: Não processa se hospedagem não for habilitada
    if (!evento.permite_hospedagem || !inscricao.hospedagem) {
      return;
    }

    // Requisito 3: Idempotência - verificar se já possui leito
    const { data: leitoExistente } = await supabase
      .from('evento_hospedagem_leitos')
      .select('id, alojamento_id, numero')
      .eq('inscricao_id', inscricaoId)
      .maybeSingle();

    if (leitoExistente) {
      console.log(`[Autoalocacao] [Comum] Idempotência: Inscrito ${inscricaoId} já possui o leito ${leitoExistente.numero} no alojamento ${leitoExistente.alojamento_id}.`);
      return;
    }

    // Busca hospedagem atual
    let { data: hospedagem, error: errHosp } = await supabase
      .from('evento_hospedagens')
      .select('id, status, alojamento_id, tipo_cama, numero_cama, observacoes')
      .eq('inscricao_id', inscricaoId)
      .maybeSingle();

    if (errHosp) {
      console.error(`[Autoalocacao] [Comum] Erro ao consultar hospedagem:`, errHosp.message);
      return;
    }

    // Requisito 3: Idempotência - já possui hospedagem alocada/confirmada ou em lista de espera?
    if (hospedagem) {
      if (['alocada', 'confirmada', 'checkin_realizado'].includes(hospedagem.status)) {
        console.log(`[Autoalocacao] [Comum] Idempotência: Hospedagem ${hospedagem.id} já está alocada/confirmada.`);
        return;
      }
      if (hospedagem.status === 'lista_espera') {
        console.log(`[Autoalocacao] [Comum] Idempotência: Hospedagem ${hospedagem.id} já está em lista de espera.`);
        return;
      }
    }

    // Requisito 2: Se não for pago ou isento, não avança.
    // Mas devemos garantir o status pago_sem_alocacao caso esteja pendente
    const isPagoOrIsento = ['pago', 'isento'].includes((inscricao.status_pagamento || '').toLowerCase());
    if (!isPagoOrIsento) {
      return;
    }

    // Requisito 4: Se pago mas ainda sem registro de hospedagem, cria com status pago_sem_alocacao
    if (!hospedagem) {
      const { data: novaHosp, error: errInsert } = await supabase
        .from('evento_hospedagens')
        .insert(normalizePayloadUppercase({
          evento_id:           evento.id,
          inscricao_id:        inscricaoId,
          status:              'pago_sem_alocacao',
          prioridade:          0,
          necessidade_especial: !!inscricao.hosp_necessidade_especial,
          descricao_necessidade: inscricao.hosp_descricao_necessidade ?? null,
          cama_inferior:       !!inscricao.hosp_cama_inferior,
          observacoes:         inscricao.hosp_observacoes ?? null,
          alocacao_automatica: true,
        }))
        .select()
        .single();

      if (errInsert) {
        console.error(`[Autoalocacao] [Comum] Erro ao criar hospedagem:`, errInsert.message);
        return;
      }
      hospedagem = novaHosp;
    } else {
      if (hospedagem.status !== 'pago_sem_alocacao') {
        const { error: errUpdateStatus } = await supabase
          .from('evento_hospedagens')
          .update({ status: 'pago_sem_alocacao' })
          .eq('id', hospedagem.id);
        if (errUpdateStatus) {
          console.error(`[Autoalocacao] [Comum] Erro ao atualizar status para pago_sem_alocacao:`, errUpdateStatus.message);
        }
        hospedagem.status = 'pago_sem_alocacao';
      }
    }

    // Requisito 5: Log de auditoria - pagamento confirmado e início do fluxo
    await logDB({
      acao: 'hospedagem_alocacao_iniciada',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: hospedagem.id,
      descricao: `[Hospedagem] Pagamento confirmado. Iniciando alocação automática para ${inscricao.nome_inscrito} no evento comum.`,
    });

    // 4. Busca os alojamentos cadastrados (todos)
    const { data: todosAlojamentos, error: errAloj } = await supabase
      .from('evento_alojamentos')
      .select('id, nome, publico, sexo, total_vagas, camas_inferiores, camas_superiores, ativo')
      .eq('evento_id', evento.id);

    if (errAloj) {
      console.error(`[Autoalocacao] [Comum] Erro ao buscar alojamentos:`, errAloj.message);
      return;
    }

    const totalAlojamentos = todosAlojamentos?.length ?? 0;

    if (totalAlojamentos === 0) {
      console.warn(`[Autoalocacao] [Comum] EVENTO_SEM_ALOJAMENTOS_CONFIGURADOS: Nenhum alojamento cadastrado no evento ${evento.id}`);
      await logDB({
        acao: 'EVENTO_SEM_ALOJAMENTOS_CONFIGURADOS',
        modulo: 'eventos',
        entidade: 'evento_hospedagens',
        entidadeId: hospedagem.id,
        descricao: `[Hospedagem] EVENTO_SEM_ALOJAMENTOS_CONFIGURADOS. Não existem alojamentos cadastrados para o evento. Mantendo status pago_sem_alocacao.`,
      });
      return;
    }

    const alojamentosRaw = (todosAlojamentos ?? []).filter((a: any) => a.ativo);

    if (alojamentosRaw.length === 0) {
      console.warn(`[Autoalocacao] [Comum] Nenhum alojamento ativo no evento ${evento.id}`);
      await colocarEmListaEspera(supabase, hospedagem.id, 0);
      await logDB({
        acao: 'hospedagem_lista_espera',
        modulo: 'eventos',
        entidade: 'evento_hospedagens',
        entidadeId: hospedagem.id,
        descricao: `[Hospedagem] Sem alojamento ativo. ${inscricao.nome_inscrito} enviado para lista de espera.`,
      });
      return;
    }

    // 5. Filtra alojamentos compatíveis por sexo/público
    const sexoUpper = (inscricao.sexo ?? '').toUpperCase();
    const candidatos = alojamentosRaw.filter((a: any) => {
      if (a.sexo && a.sexo !== sexoUpper) return false;
      if (a.publico === 'feminino' && sexoUpper !== 'F') return false;
      if (a.publico === 'masculino_geral' && sexoUpper !== 'M') return false;
      return true;
    });

    if (candidatos.length === 0) {
      await colocarEmListaEspera(supabase, hospedagem.id, 0);
      await logDB({
        acao: 'hospedagem_lista_espera',
        modulo: 'eventos',
        entidade: 'evento_hospedagens',
        entidadeId: hospedagem.id,
        descricao: `[Hospedagem] Sem alojamento compatível com o sexo/público para ${inscricao.nome_inscrito}. Enviado para lista de espera.`,
      });
      return;
    }

    // 6. Conta ocupantes atuais para verificar vagas livres
    const { data: ocupantesDb, error: errOcup } = await supabase
      .from('evento_hospedagens')
      .select('alojamento_id, tipo_cama')
      .eq('evento_id', evento.id)
      .in('status', ['alocada', 'confirmada', 'checkin_realizado'])
      .not('alojamento_id', 'is', null);

    if (errOcup) {
      console.error(`[Autoalocacao] [Comum] Erro ao contar ocupantes:`, errOcup.message);
      return;
    }

    const ocupantes = ocupantesDb ?? [];
    const alojamentosComVagas = candidatos.map((aloj: any) => {
      const conf = ocupantes.filter((c: any) => c.alojamento_id === aloj.id);
      const vagasLivres = Math.max(0, aloj.total_vagas - conf.length);
      const infLivres = Math.max(0, aloj.camas_inferiores - conf.filter((c: any) => c.tipo_cama === 'inferior').length);
      const supLivres = Math.max(0, aloj.camas_superiores - conf.filter((c: any) => c.tipo_cama === 'superior').length);
      return {
        ...aloj,
        vagas_livres: vagasLivres,
        inferiores_livres: infLivres,
        superiores_livres: supLivres,
      };
    }).filter((a: any) => a.vagas_livres > 0);

    // Se não houver vaga disponível
    if (alojamentosComVagas.length === 0) {
      await colocarEmListaEspera(supabase, hospedagem.id, 0);
      await logDB({
        acao: 'hospedagem_lista_espera',
        modulo: 'eventos',
        entidade: 'evento_hospedagens',
        entidadeId: hospedagem.id,
        descricao: `[Hospedagem] Sem vagas disponíveis nos alojamentos compatíveis. ${inscricao.nome_inscrito} enviado para lista de espera.`,
      });
      return;
    }

    // Seleciona o alojamento com mais vagas livres
    alojamentosComVagas.sort((a: any, b: any) => b.vagas_livres - a.vagas_livres);
    const alojSelecionado = alojamentosComVagas[0];

    // Log: alojamento compatível encontrado
    await logDB({
      acao: 'hospedagem_alojamento_encontrado',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: hospedagem.id,
      descricao: `[Hospedagem] Alojamento compatível encontrado: ${alojSelecionado.nome} (${alojSelecionado.vagas_livres} vagas livres).`,
    });

    // 7. Determina tipo de cama (prefere inferior se solicitado/prioritário e disponível)
    const querCamaInferior = !!inscricao.hosp_cama_inferior || !!inscricao.hosp_necessidade_especial;
    let tipoCama: 'inferior' | 'superior' | 'unico' = 'unico';
    if (alojSelecionado.camas_inferiores > 0 || alojSelecionado.camas_superiores > 0) {
      if (querCamaInferior && alojSelecionado.inferiores_livres > 0) {
        tipoCama = 'inferior';
      } else if (alojSelecionado.superiores_livres > 0) {
        tipoCama = 'superior';
      } else if (alojSelecionado.inferiores_livres > 0) {
        tipoCama = 'inferior';
      } else {
        tipoCama = 'unico';
      }
    }

    // 8. Atribuição de leito com tratamento de concorrência
    const { data: leitosExistentes } = await supabase
      .from('evento_hospedagem_leitos')
      .select('numero')
      .eq('evento_id', evento.id)
      .eq('alojamento_id', alojSelecionado.id);

    let maxNum = 0;
    for (const l of leitosExistentes ?? []) {
      const num = parseInt(l.numero) || 0;
      if (num > maxNum) maxNum = num;
    }

    let alocadoComSucesso = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      const nextNum = maxNum + 1 + attempt;
      const numeroCama = formatarNumeroLeitoSequencial(nextNum);
      const posicao = tipoCama === 'unico' ? 'unico' : tipoCama;

      // Insere na tabela de leitos
      const { error: errInsertLeito } = await supabase
        .from('evento_hospedagem_leitos')
        .insert({
          evento_id:     evento.id,
          alojamento_id: alojSelecionado.id,
          inscricao_id:  inscricaoId,
          numero:        numeroCama,
          tipo_leito:    'beliche',
          posicao,
          ocupado:       true,
        });

      if (!errInsertLeito) {
        // Atualiza hospedagem
        const { error: errUpdateHosp } = await supabase
          .from('evento_hospedagens')
          .update({
            alojamento_id: alojSelecionado.id,
            tipo_cama:     tipoCama,
            numero_cama:   numeroCama,
            status:        'alocada',
            alocacao_automatica: true,
          })
          .eq('id', hospedagem.id);

        if (errUpdateHosp) {
          console.error(`[Autoalocacao] [Comum] Erro ao atualizar status da hospedagem ${hospedagem.id}:`, errUpdateHosp.message);
        }

        // Log de sucesso
        await logDB({
          acao: 'hospedagem_leito_atribuido',
          modulo: 'eventos',
          entidade: 'evento_hospedagens',
          entidadeId: hospedagem.id,
          descricao: `[Hospedagem] Alocação concluída. Cama ${numeroCama} (${tipoCama}) no alojamento ${alojSelecionado.nome} atribuída a ${inscricao.nome_inscrito}.`,
          detalhes: { inscricaoId, alojamentoId: alojSelecionado.id, numeroCama, tipoCama },
        });

        alocadoComSucesso = true;
        break;
      }

      if (errInsertLeito.code === '23505') {
        continue;
      }

      console.error(`[Autoalocacao] [Comum] Erro inesperado ao alocar leito para ${inscricaoId}:`, errInsertLeito.message);
      break;
    }

    if (!alocadoComSucesso) {
      await colocarEmListaEspera(supabase, hospedagem.id, 0);
      await logDB({
        acao: 'hospedagem_lista_espera',
        modulo: 'eventos',
        entidade: 'evento_hospedagens',
        entidadeId: hospedagem.id,
        descricao: `[Hospedagem] Falha ao atribuir leito após tentativas para ${inscricao.nome_inscrito}. Enviado para lista de espera.`,
      });
    }

  } catch (err: any) {
    console.error(`[Autoalocacao] [Comum] Erro crítico na autoalocação da inscrição ${inscricaoId}:`, err.message);
    await logDB({
      acao: 'hospedagem_erro',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: inscricaoId,
      descricao: `[Hospedagem] Erro crítico na autoalocação de ${inscricao.nome_inscrito}: ${err.message}`,
    });
  }
}
