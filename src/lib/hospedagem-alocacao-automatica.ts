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

export interface AlocacaoResultado {
  success: boolean;
  status: 'alocada' | 'lista_espera' | 'pago_sem_alocacao' | 'ignorada' | 'erro';
  motivo: string;
  detalhes?: any;
}

export async function alocarLeitoParaInscricao(supabase: any, inscricaoId: string): Promise<AlocacaoResultado> {
  console.warn(`[Autoalocacao] Iniciando alocarLeitoParaInscricao para ID: ${inscricaoId}`);
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
      const msg = `Inscrição não encontrada: ${inscricaoId}. Erro: ${errInsc?.message}`;
      console.warn(`[Autoalocacao] ${msg}`);
      return { success: false, status: 'erro', motivo: msg };
    }

    // 2. Busca o evento
    const { data: evento, error: errEv } = await supabase
      .from('eventos')
      .select('id, departamento, permite_hospedagem')
      .eq('id', inscricao.evento_id)
      .single();

    if (errEv || !evento) {
      const msg = `Evento não encontrado: ${inscricao.evento_id}. Erro: ${errEv?.message}`;
      console.warn(`[Autoalocacao] ${msg}`);
      return { success: false, status: 'erro', motivo: msg };
    }

    let temHospedagem = !!inscricao.hospedagem;
    let hospedagemExistente = null;

    const { data: hospExistente } = await supabase
      .from('evento_hospedagens')
      .select('id, status, alojamento_id, tipo_cama, numero_cama, observacoes, grupo_hospedagem')
      .eq('inscricao_id', inscricaoId)
      .maybeSingle();

    if (hospExistente) {
      hospedagemExistente = hospExistente;
      if (!temHospedagem) {
        console.warn(`[Autoalocacao] inscricao.hospedagem vem false/nulo mas hospedagem existe em evento_hospedagens com ID ${hospExistente.id}. Usando como fonte auxiliar.`);
        temHospedagem = true;
      }
    }

    console.warn(`[Autoalocacao] Dados carregados:`, {
      inscricaoId,
      nome: inscricao.nome_inscrito,
      evento_id: evento.id,
      departamento: evento.departamento,
      permite_hospedagem: evento.permite_hospedagem,
      hospedagem_solicitada: temHospedagem,
      status_pagamento: inscricao.status_pagamento,
      fluxo: evento.departamento === 'AGO' ? 'AGO' : 'EVENTO_COMUM'
    });

    if (!evento.permite_hospedagem) {
      const msg = `Evento não permite hospedagem`;
      console.warn(`[Autoalocacao] Retorno antecipado: ${msg}`);
      return { success: false, status: 'ignorada', motivo: msg };
    }

    if (!temHospedagem) {
      const msg = `Hospedagem não solicitada pelo inscrito`;
      console.warn(`[Autoalocacao] Retorno antecipado: ${msg}`);
      return { success: false, status: 'ignorada', motivo: msg };
    }

    const statusPg = (inscricao.status_pagamento || '').toLowerCase();
    if (!['pago', 'isento'].includes(statusPg)) {
      const msg = `Pagamento pendente ou inválido (${inscricao.status_pagamento})`;
      console.warn(`[Autoalocacao] Retorno antecipado: ${msg}`);
      return { success: false, status: 'pago_sem_alocacao', motivo: msg };
    }

    if (evento.departamento === 'AGO') {
      console.warn(`[Autoalocacao] Direcionando para fluxo AGO`);
      return await alocarLeitoParaInscricaoAGO(supabase, inscricaoId, inscricao, evento, hospedagemExistente);
    } else {
      console.warn(`[Autoalocacao] Direcionando para fluxo EVENTO_COMUM`);
      return await alocarLeitoParaInscricaoEventoComum(supabase, inscricaoId, inscricao, evento, hospedagemExistente);
    }
  } catch (err: any) {
    const msg = `Erro crítico na autoalocação: ${err.message}`;
    console.error(`[Autoalocacao] ${msg}`);
    return { success: false, status: 'erro', motivo: msg };
  }
}

export async function alocarLeitoParaInscricaoAGO(
  supabase: any,
  inscricaoId: string,
  inscricao: any,
  evento: any,
  hospedagemExistente?: any
): Promise<AlocacaoResultado> {
  console.warn(`[Autoalocacao] [AGO] Entrou no fluxo AGO para inscrição ${inscricaoId}`);
  
  let hospedagem = hospedagemExistente;
  console.warn(`[Autoalocacao] [AGO] Encontrou registro em evento_hospedagens? ${hospedagem ? 'Sim (ID: ' + hospedagem.id + ')' : 'Não'}`);
  if (hospedagem) {
    console.warn(`[Autoalocacao] [AGO] Status atual da hospedagem: ${hospedagem.status}`);
    const jaTemLeito = !!(hospedagem.alojamento_id && hospedagem.numero_cama);
    console.warn(`[Autoalocacao] [AGO] Já tem leito? ${jaTemLeito ? 'Sim (Aloj: ' + hospedagem.alojamento_id + ', Cama: ' + hospedagem.numero_cama + ')' : 'Não'}`);
    if (['alocada', 'confirmada', 'checkin_realizado'].includes(hospedagem.status) || jaTemLeito) {
      return {
        success: true,
        status: 'alocada',
        motivo: `Hospedagem já alocada/confirmada (Status: ${hospedagem.status}, Alojamento: ${hospedagem.alojamento_id}, Cama: ${hospedagem.numero_cama})`,
        detalhes: { alojamento_id: hospedagem.alojamento_id, numero_cama: hospedagem.numero_cama }
      };
    }
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
      const msg = `Erro ao criar hospedagem para ${inscricaoId}: ${errInsertHosp.message}`;
      console.error(`[Autoalocacao] [AGO] ${msg}`);
      return { success: false, status: 'erro', motivo: msg };
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
    const msg = `Nenhum alojamento ativo encontrado para o evento ${evento.id}`;
    console.error(`[Autoalocacao] [AGO] ${msg}`);
    await colocarEmListaEspera(supabase, hospedagem.id, prioridade);
    return { success: false, status: 'lista_espera', motivo: msg };
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

  const totalVagasLivresCandidatos = candidatos.reduce((acc: number, a: any) => acc + (a.vagas_livres ?? 0), 0);
  console.warn(`[Autoalocacao] [AGO] Total de alojamentos compatíveis: ${candidatos.length}`);
  console.warn(`[Autoalocacao] [AGO] Total de leitos/vagas livres nos alojamentos compatíveis: ${totalVagasLivresCandidatos}`);

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
    const msg = `Sem leito disponível compatível nos alojamentos. Vagas livres restantes: ${totalVagasLivresCandidatos}`;
    console.warn(`[Autoalocacao] [AGO] Motivo não alocou: ${msg}`);
    await colocarEmListaEspera(supabase, hospedagem.id, prioridade);
    return { success: false, status: 'lista_espera', motivo: msg };
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
  let ultimoErroLeito = '';
  let numeroCamaAlocada = '';
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
          status: 'confirmada',
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
      numeroCamaAlocada = numeroCama;
      break;
    }

    // Se o erro for de restrição única (23505), tentamos o próximo número
    if (errInsertLeito.code === '23505') {
      console.warn(`[Autoalocacao] [AGO] Conflito de leito ${numeroCama} no alojamento ${alojId}. Tentando proximo...`);
      continue;
    }

    // Qualquer outro erro, abortamos o loop
    ultimoErroLeito = errInsertLeito.message;
    console.error(`[Autoalocacao] [AGO] Erro inesperado ao inserir leito para ${inscricaoId}:`, errInsertLeito.message);
    break;
  }

  if (alocadoComSucesso) {
    return {
      success: true,
      status: 'alocada',
      motivo: `Hospedagem alocada com sucesso no alojamento ${alojId}, leito ${numeroCamaAlocada}`,
      detalhes: { alojamento_id: alojId, numero_cama: numeroCamaAlocada, tipo_cama: sugestao.tipo_cama }
    };
  } else {
    const msg = `Não foi possível alocar leito após tentativas para ${inscricaoId}. erro: ${ultimoErroLeito}`;
    console.error(`[Autoalocacao] [AGO] Motivo não alocou: ${msg}`);
    await colocarEmListaEspera(supabase, hospedagem.id, prioridade);
    return { success: false, status: 'lista_espera', motivo: msg };
  }
}

export async function alocarLeitoParaInscricaoEventoComum(
  supabase: any,
  inscricaoId: string,
  inscricao: any,
  evento: any,
  hospedagemExistente?: any
): Promise<AlocacaoResultado> {
  console.warn(`[Autoalocacao] [Comum] Entrou no fluxo Evento Comum para inscrição ${inscricaoId}`);

  // Requisito 3: Idempotência - verificar se já possui leito
  const { data: leitoExistente } = await supabase
    .from('evento_hospedagem_leitos')
    .select('id, alojamento_id, numero')
    .eq('inscricao_id', inscricaoId)
    .maybeSingle();

  if (leitoExistente) {
    const msg = `Idempotência: Inscrito ${inscricaoId} já possui o leito ${leitoExistente.numero} no alojamento ${leitoExistente.alojamento_id}.`;
    console.warn(`[Autoalocacao] [Comum] Já tem leito: ${msg}`);
    
    // Garante que o registro de hospedagem também está atualizado
    const { data: hosp } = await supabase
      .from('evento_hospedagens')
      .select('id, status')
      .eq('inscricao_id', inscricaoId)
      .maybeSingle();

    if (hosp && hosp.status !== 'confirmada') {
      await supabase
        .from('evento_hospedagens')
        .update({
          alojamento_id: leitoExistente.alojamento_id,
          tipo_cama:     null,
          numero_cama:   leitoExistente.numero,
          status:        'confirmada',
          alocacao_automatica: true,
        })
        .eq('id', hosp.id);
    }

    return {
      success: true,
      status: 'alocada',
      motivo: msg,
      detalhes: { alojamento_id: leitoExistente.alojamento_id, numero_cama: leitoExistente.numero }
    };
  }

  let hospedagem = hospedagemExistente;
  console.warn(`[Autoalocacao] [Comum] Encontrou registro em evento_hospedagens? ${hospedagem ? 'Sim (ID: ' + hospedagem.id + ')' : 'Não'}`);

  if (hospedagem) {
    console.warn(`[Autoalocacao] [Comum] Status atual da hospedagem: ${hospedagem.status}`);
    if (['alocada', 'confirmada', 'checkin_realizado'].includes(hospedagem.status)) {
      const msg = `Idempotência: Hospedagem ${hospedagem.id} já está alocada/confirmada.`;
      console.warn(`[Autoalocacao] [Comum] ${msg}`);
      return {
        success: true,
        status: 'alocada',
        motivo: msg,
        detalhes: { alojamento_id: hospedagem.alojamento_id, numero_cama: hospedagem.numero_cama }
      };
    }
  }

  // Requisito 4: Se pago mas ainda sem registro de hospedagem, cria com status solicitada
  if (!hospedagem) {
    const { data: novaHosp, error: errInsert } = await supabase
      .from('evento_hospedagens')
      .insert(normalizePayloadUppercase({
        evento_id:           evento.id,
        inscricao_id:        inscricaoId,
        status:              'solicitada',
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
      const msg = `Erro ao criar hospedagem: ${errInsert.message}`;
      console.error(`[Autoalocacao] [Comum] ${msg}`);
      return { success: false, status: 'erro', motivo: msg };
    }
    hospedagem = novaHosp;
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
    const msg = `Erro ao buscar alojamentos: ${errAloj.message}`;
    console.error(`[Autoalocacao] [Comum] ${msg}`);
    return { success: false, status: 'erro', motivo: msg };
  }

  const totalAlojamentos = todosAlojamentos?.length ?? 0;

  if (totalAlojamentos === 0) {
    const msg = `EVENTO_SEM_ALOJAMENTOS_CONFIGURADOS: Nenhum alojamento cadastrado no evento ${evento.id}`;
    console.warn(`[Autoalocacao] [Comum] Motivo não alocou: ${msg}`);
    await logDB({
      acao: 'EVENTO_SEM_ALOJAMENTOS_CONFIGURADOS',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: hospedagem.id,
      descricao: `[Hospedagem] EVENTO_SEM_ALOJAMENTOS_CONFIGURADOS. Não existem alojamentos cadastrados para o evento. Mantendo status pago_sem_alocacao.`,
    });
    return { success: false, status: 'pago_sem_alocacao', motivo: msg };
  }

  const alojamentosRaw = (todosAlojamentos ?? []).filter((a: any) => a.ativo);

  if (alojamentosRaw.length === 0) {
    const msg = `Nenhum alojamento ativo no evento ${evento.id}`;
    console.warn(`[Autoalocacao] [Comum] Motivo não alocou: ${msg}`);
    await colocarEmListaEspera(supabase, hospedagem.id, 0);
    await logDB({
      acao: 'hospedagem_lista_espera',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: hospedagem.id,
      descricao: `[Hospedagem] Sem alojamento ativo. ${inscricao.nome_inscrito} enviado para lista de espera.`,
    });
    return { success: false, status: 'lista_espera', motivo: msg };
  }

  // 5. Filtra alojamentos compatíveis por sexo/público
  const sexoUpper = (inscricao.sexo ?? '').toUpperCase();
  const candidatos = alojamentosRaw.filter((a: any) => {
    const nameUpper = String(a.nome || '').toUpperCase();
    if (sexoUpper === 'M' && (nameUpper.includes('MASCULINO') || a.sexo === 'M' || a.publico === 'masculino_geral')) {
      return true;
    }
    if (sexoUpper === 'F' && (nameUpper.includes('FEMININO') || a.sexo === 'F' || a.publico === 'feminino')) {
      return true;
    }
    if (a.sexo && a.sexo !== sexoUpper) return false;
    if (a.publico === 'feminino' && sexoUpper !== 'F') return false;
    if (a.publico === 'masculino_geral' && sexoUpper !== 'M') return false;
    return true;
  });

  if (candidatos.length === 0) {
    const msg = `Sem alojamento compatível com o sexo/público (${sexoUpper})`;
    console.warn(`[Autoalocacao] [Comum] Motivo não alocou: ${msg}`);
    await colocarEmListaEspera(supabase, hospedagem.id, 0);
    await logDB({
      acao: 'hospedagem_lista_espera',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: hospedagem.id,
      descricao: `[Hospedagem] Sem alojamento compatível com o sexo/público para ${inscricao.nome_inscrito}. Enviado para lista de espera.`,
    });
    return { success: false, status: 'lista_espera', motivo: msg };
  }

  // 6. Conta ocupantes atuais para verificar vagas livres
  const { data: ocupantesDb, error: errOcup } = await supabase
    .from('evento_hospedagens')
    .select('alojamento_id, tipo_cama')
    .eq('evento_id', evento.id)
    .in('status', ['alocada', 'confirmada', 'checkin_realizado'])
    .not('alojamento_id', 'is', null);

  if (errOcup) {
    const msg = `Erro ao contar ocupantes: ${errOcup.message}`;
    console.error(`[Autoalocacao] [Comum] ${msg}`);
    return { success: false, status: 'erro', motivo: msg };
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

  const totalVagasLivresCandidatos = candidatos.reduce((acc: number, a: any) => acc + (a.total_vagas - ocupantes.filter((o: any) => o.alojamento_id === a.id).length), 0);
  console.warn(`[Autoalocacao] [Comum] Total de alojamentos compatíveis: ${candidatos.length}`);
  console.warn(`[Autoalocacao] [Comum] Total de leitos/vagas livres nos alojamentos compatíveis: ${totalVagasLivresCandidatos}`);

  // Se não houver vaga disponível
  if (alojamentosComVagas.length === 0) {
    const msg = `Sem vagas disponíveis nos alojamentos compatíveis. Vagas livres restantes: ${totalVagasLivresCandidatos}`;
    console.warn(`[Autoalocacao] [Comum] Motivo não alocou: ${msg}`);
    await colocarEmListaEspera(supabase, hospedagem.id, 0);
    await logDB({
      acao: 'hospedagem_lista_espera',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: hospedagem.id,
      descricao: `[Hospedagem] Sem vagas disponíveis nos alojamentos compatíveis. ${inscricao.nome_inscrito} enviado para lista de espera.`,
    });
    return { success: false, status: 'lista_espera', motivo: msg };
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
  let numeroCamaAlocada = '';
  let ultimoErroLeito = '';
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
          tipo_cama:     tipoCama === 'unico' ? null : tipoCama,
          numero_cama:   numeroCama,
          status:        'confirmada',
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
      numeroCamaAlocada = numeroCama;
      break;
    }

    if (errInsertLeito.code === '23505') {
      continue;
    }

    ultimoErroLeito = errInsertLeito.message;
    console.error(`[Autoalocacao] [Comum] Erro inesperado ao alocar leito para ${inscricaoId}:`, errInsertLeito.message);
    break;
  }

  if (alocadoComSucesso) {
    return {
      success: true,
      status: 'alocada',
      motivo: `Hospedagem alocada com sucesso no alojamento ${alojSelecionado.id}, leito ${numeroCamaAlocada}`,
      detalhes: { alojamento_id: alojSelecionado.id, numero_cama: numeroCamaAlocada, tipo_cama: tipoCama }
    };
  } else {
    const msg = `Falha ao atribuir leito após tentativas para ${inscricao.nome_inscrito}. erro: ${ultimoErroLeito}`;
    console.error(`[Autoalocacao] [Comum] Motivo não alocou: ${msg}`);
    await colocarEmListaEspera(supabase, hospedagem.id, 0);
    await logDB({
      acao: 'hospedagem_lista_espera',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: hospedagem.id,
      descricao: `[Hospedagem] Falha ao atribuir leito após tentativas para ${inscricao.nome_inscrito}. Enviado para lista de espera.`,
    });
    return { success: false, status: 'lista_espera', motivo: msg };
  }
}
