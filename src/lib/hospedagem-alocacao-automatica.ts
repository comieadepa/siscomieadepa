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
import { enviarEmailHospedagemComplementar } from '@/lib/hospedagem-email-service';
import { normalizePayloadUppercase } from '@/lib/text';

async function fetchAllRows<T>(queryBuilder: any): Promise<T[]> {
  const allRows: T[] = [];
  let from = 0;
  const step = 1000;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await queryBuilder.range(from, from + step - 1);
    if (error) throw error;
    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allRows.push(...data);
      if (data.length < step) {
        hasMore = false;
      } else {
        from += step;
      }
    }
  }
  return allRows;
}

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
  
  // Requisito de Idempotência: verificar se o inscrito já possui leito ocupado físico na tabela de leitos
  const { data: leitoFisicoExistente } = await supabase
    .from('evento_hospedagem_leitos')
    .select('id, alojamento_id, numero, posicao')
    .eq('inscricao_id', inscricaoId)
    .maybeSingle();

  if (leitoFisicoExistente) {
    const msg = `Idempotência: Inscrito ${inscricaoId} já possui o leito ${leitoFisicoExistente.numero} no alojamento ${leitoFisicoExistente.alojamento_id}.`;
    console.warn(`[Autoalocacao] [AGO] Já tem leito físico registrado: ${msg}`);
    
    // Garante que o registro correspondente em evento_hospedagens esteja sincronizado com status confirmada
    const { data: hosp } = await supabase
      .from('evento_hospedagens')
      .select('id, status')
      .eq('inscricao_id', inscricaoId)
      .maybeSingle();

    const tipoCamaSinc = leitoFisicoExistente.posicao === 'unico' ? null : leitoFisicoExistente.posicao;
    if (hosp && hosp.status !== 'confirmada') {
      await supabase
        .from('evento_hospedagens')
        .update({
          alojamento_id: leitoFisicoExistente.alojamento_id,
          tipo_cama:     tipoCamaSinc,
          numero_cama:   leitoFisicoExistente.numero,
          status:        'confirmada',
          alocacao_automatica: true,
        })
        .eq('id', hosp.id);
    }

    return {
      success: true,
      status: 'alocada',
      motivo: msg,
      detalhes: { alojamento_id: leitoFisicoExistente.alojamento_id, numero_cama: leitoFisicoExistente.numero, tipo_cama: tipoCamaSinc }
    };
  }

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

  // 4. Busca os alojamentos ativos (para eventos AGO, consome exclusivamente a projeção oficial sincronizada com a SSOT e exclui emergenciais)
  let queryAloj = supabase
    .from('evento_alojamentos')
    .select('id, setor_key, nome, publico, sexo, total_vagas, camas_inferiores, camas_superiores, colchonetes, ativo, is_emergencial')
    .eq('evento_id', evento.id)
    .eq('ativo', true);

  if (evento?.departamento === 'AGO' || Boolean((evento?.configuracoes_ago as any)?.setores?.length)) {
    queryAloj = queryAloj.not('setor_key', 'is', null);
  }

  const { data: alojamentosRawList, error: errAloj } = await queryAloj;
  const alojamentosRaw = (alojamentosRawList ?? []).filter((a: any) => !a.is_emergencial);

  if (errAloj || !alojamentosRaw || alojamentosRaw.length === 0) {
    const msg = `Nenhum alojamento ativo encontrado para o evento ${evento.id}`;
    console.error(`[Autoalocacao] [AGO] ${msg}`);
    await colocarEmListaEspera(supabase, hospedagem.id, prioridade);
    return { success: false, status: 'lista_espera', motivo: msg };
  }

  // Se houver configuracoes_ago.setores (SSOT oficial), alinha as capacidades nominais diretamente da SSOT
  const setoresSSOT = (evento?.configuracoes_ago?.setores as any[] | undefined) ?? [];
  const alojamentosAjustados = alojamentosRaw.map((a: any) => {
    let totalVagasOficial = Number(a.total_vagas || 0);
    let infOficial = Number(a.camas_inferiores || 0);
    let supOficial = Number(a.camas_superiores || 0);
    let colchOficial = Number(a.colchonetes || 0);

    const s = setoresSSOT.find((set: any) =>
      set.id === a.setor_key ||
      (set.nome && a.nome && set.nome.trim().toUpperCase() === a.nome.trim().toUpperCase())
    );

    if (s) {
      const matchCol = (s.observacoes || '').match(/(\d+)\s*(?:leitos são colchonetes|colchonetes)/i);
      colchOficial = s.quantidade_colchonetes !== undefined
        ? Number(s.quantidade_colchonetes)
        : (matchCol ? parseInt(matchCol[1], 10) : 0);
      totalVagasOficial = Number(s.quantidade_leitos || 0);
      infOficial = Number(s.quantidade_leitos_inferiores || 0);
      // Em beliches pareados, cada beliche possui 1 inferior e 1 superior
      supOficial = s.quantidade_leitos_superiores !== undefined
        ? Number(s.quantidade_leitos_superiores)
        : Math.min(infOficial, Math.max(0, totalVagasOficial - infOficial - colchOficial));
    }

    return {
      ...a,
      total_vagas: totalVagasOficial,
      camas_inferiores: infOficial,
      camas_superiores: supOficial,
      colchonetes: colchOficial,
    };
  });

  // 5. Conta ocupantes atuais e busca leitos físicos livres cadastrados
  let ocupantesDb: any[] = [];
  try {
    ocupantesDb = await fetchAllRows<any>(
      supabase
        .from('evento_hospedagens')
        .select('alojamento_id, tipo_cama')
        .eq('evento_id', evento.id)
        .in('status', ['alocada', 'confirmada', 'checkin_realizado'])
        .not('alojamento_id', 'is', null)
    );
  } catch (err: any) {
    console.error(`[Autoalocacao] [AGO] Erro ao buscar ocupantes:`, err.message);
  }

  const { data: leitosLivresRawTotal } = await supabase
    .from('evento_hospedagem_leitos')
    .select('id, alojamento_id, numero, tipo_leito, posicao, is_emergencial')
    .eq('evento_id', evento.id)
    .eq('ocupado', false)
    .is('inscricao_id', null);

  const leitosLivresFiltrados = (leitosLivresRawTotal ?? []).filter((l: any) => !l.is_emergencial);

  const vagasMap: Record<string, { total: number; inferiores: number; superiores: number; colchonetes: number }> = {};
  for (const aloj of alojamentosAjustados) {
    const conf = (ocupantesDb ?? []).filter((c: any) => c.alojamento_id === aloj.id);
    vagasMap[aloj.id] = {
      total:       Math.max(0, aloj.total_vagas - conf.length),
      inferiores:  Math.max(0, aloj.camas_inferiores - conf.filter((c: any) => c.tipo_cama === 'inferior').length),
      superiores:  Math.max(0, aloj.camas_superiores - conf.filter((c: any) => c.tipo_cama === 'superior').length),
      colchonetes: Math.max(0, (aloj.colchonetes || 0) - conf.filter((c: any) => c.tipo_cama === 'colchonete').length),
    };
  }

  const alojamentos = alojamentosAjustados.map((a: any) => ({
    ...a,
    evento_id:          evento.id,
    vagas_livres:       vagasMap[a.id]?.total       ?? 0,
    inferiores_livres:  vagasMap[a.id]?.inferiores  ?? 0,
    superiores_livres:  vagasMap[a.id]?.superiores  ?? 0,
    colchonetes_livres: vagasMap[a.id]?.colchonetes ?? 0,
  })) as Alojamento[];

  // 6. Alojamentos candidatos compatíveis
  // Requisito 2: Priorizar alojamentos que possuem leitos existentes, livres e compatíveis
  const candidatos = alojamentos
    .filter(a => grupoMatchesAlojamento(grupoHosp, a))
    .sort((a, b) => {
      // Prioridade 1: quem possui leito físico previamente cadastrado e livre compatível (excluindo emergenciais)
      const aTemFisico = (leitosLivresFiltrados ?? []).some((l: any) => l.alojamento_id === a.id);
      const bTemFisico = (leitosLivresFiltrados ?? []).some((l: any) => l.alojamento_id === b.id);
      if (aTemFisico !== bTemFisico) return aTemFisico ? -1 : 1;

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

  // 7. Alocação de leito transacional com bloqueio pessimista
  const alojId = sugestao.alojamento_id;

  // Requisitos 8 e 9: Execução transacional atômica obrigatória via RPC no Supabase.
  // Elimina qualquer fallback não atômico: a transação no PostgreSQL é o único caminho autorizado.
  const { data: rpcRes, error: rpcErr } = await supabase.rpc('alocar_hospedagem_atomica', {
    p_evento_id: evento.id,
    p_inscricao_id: inscricaoId,
    p_alojamento_id: alojId,
    p_tipo_cama: sugestao.tipo_cama,
    p_prioridade: prioridade,
    p_origem_alocacao: 'sistema',
  });

  if (rpcErr) {
    const msg = `Falha na execução transacional da RPC alocar_hospedagem_atomica: ${rpcErr.message}`;
    console.error(`[Autoalocacao] [AGO] ${msg}`);
    return { success: false, status: 'erro', motivo: msg };
  }

  if (rpcRes) {
    if (rpcRes.success) {
      return {
        success: true,
        status: 'alocada',
        motivo: rpcRes.motivo,
        detalhes: rpcRes.detalhes,
      };
    } else if (rpcRes.status === 'lista_espera') {
      await colocarEmListaEspera(supabase, hospedagem.id, prioridade);
      return {
        success: false,
        status: 'lista_espera',
        motivo: rpcRes.motivo,
      };
    } else {
      return {
        success: false,
        status: rpcRes.status || 'recusado',
        motivo: rpcRes.motivo || 'Alocação não realizada pela RPC transacional.',
      };
    }
  }

  return { success: false, status: 'erro', motivo: 'Resposta nula retornada pela RPC transacional.' };
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
  let ocupantesDb: any[] = [];
  try {
    ocupantesDb = await fetchAllRows<any>(
      supabase
        .from('evento_hospedagens')
        .select('alojamento_id, tipo_cama')
        .eq('evento_id', evento.id)
        .in('status', ['alocada', 'confirmada', 'checkin_realizado'])
        .not('alojamento_id', 'is', null)
    );
  } catch (errOcup: any) {
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

  // 8.1. Tentar reutilizar leito cadastrado disponível (excluindo leitos emergenciais)
  const posicaoDesejada = tipoCama === 'unico' ? 'unico' : tipoCama;
  const { data: leitoLivre } = await supabase
    .from('evento_hospedagem_leitos')
    .select('id, numero, tipo_leito')
    .eq('evento_id', evento.id)
    .eq('alojamento_id', alojSelecionado.id)
    .eq('posicao', posicaoDesejada)
    .eq('ocupado', false)
    .neq('is_emergencial', true)
    .is('inscricao_id', null)
    .order('numero', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (leitoLivre) {
    const { data: claimLeito, error: errClaim } = await supabase
      .from('evento_hospedagem_leitos')
      .update({ ocupado: true, inscricao_id: inscricaoId })
      .eq('id', leitoLivre.id)
      .eq('ocupado', false)
      .select('id, numero')
      .maybeSingle();

    if (claimLeito && !errClaim) {
      alocadoComSucesso = true;
      numeroCamaAlocada = claimLeito.numero;

      await supabase
        .from('evento_hospedagens')
        .update({
          alojamento_id: alojSelecionado.id,
          tipo_cama:     tipoCama === 'unico' ? null : tipoCama,
          numero_cama:   numeroCamaAlocada,
          status:        'confirmada',
          alocacao_automatica: true,
        })
        .eq('id', hospedagem.id);

      await logDB({
        acao: 'hospedagem_leito_atribuido',
        modulo: 'eventos',
        entidade: 'evento_hospedagens',
        entidadeId: hospedagem.id,
        descricao: `[Hospedagem] Alocação concluída em leito cadastrado: Cama ${numeroCamaAlocada} (${tipoCama}) no alojamento ${alojSelecionado.nome} atribuída a ${inscricao.nome_inscrito}.`,
        detalhes: { inscricaoId, alojamentoId: alojSelecionado.id, numeroCama: numeroCamaAlocada, tipoCama },
      });
    }
  }

  // 8.2. Fallback JIT apenas se não encontrou leito pré-cadastrado
  if (!alocadoComSucesso) {
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
          descricao: `[Hospedagem] Alocação concluída JIT. Cama ${numeroCama} (${tipoCama}) no alojamento ${alojSelecionado.nome} atribuída a ${inscricao.nome_inscrito}.`,
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
  }

  if (alocadoComSucesso) {
    return {
      success: true,
      status: 'alocada',
      motivo: `Hospedagem alocada com sucesso no alojamento ${alojSelecionado.id}, leito ${numeroCamaAlocada}`,
      detalhes: { alojamento_id: alojSelecionado.id, numero_cama: numeroCamaAlocada, tipo_cama: tipoCama }
    };
  } else {
    const msg = `Falha técnica temporária ao atribuir leito após tentativas para ${inscricao.nome_inscrito}. erro: ${ultimoErroLeito}`;
    console.error(`[Autoalocacao] [Comum] Falha temporária: ${msg}`);
    return { success: false, status: 'erro', motivo: msg };
  }
}

/**
 * Reprocessa a lista de espera e inscrições elegíveis não alocadas para um evento ou globalmente.
 * Executado quando surgem vagas, cancelamentos ou periodicamente via jobs cron.
 */
export async function reprocessarFilaEsperaHospedagem(
  supabase: any,
  options?: { eventoId?: string; limit?: number }
): Promise<{
  processados: number;
  alocados: number;
  mantidos_espera: number;
  erros: number;
  detalhes: Array<{ inscricao_id: string; status: string; motivo: string }>;
}> {
  const maxLimit = options?.limit ?? 50;
  console.log(`[Autoalocacao] Iniciando reprocessarFilaEsperaHospedagem (limite: ${maxLimit})...`);

  // Se não foi especificado eventoId, busca apenas eventos ativos que permitem hospedagem
  let targetEventoIds: string[] = [];
  if (options?.eventoId) {
    targetEventoIds = [options.eventoId];
  } else {
    const { data: eventosAtivos } = await supabase
      .from('eventos')
      .select('id')
      .eq('permite_hospedagem', true);
    targetEventoIds = (eventosAtivos ?? []).map((e: any) => e.id);
  }

  if (targetEventoIds.length === 0) {
    return { processados: 0, alocados: 0, mantidos_espera: 0, erros: 0, detalhes: [] };
  }

  // 1. Prioridade Máxima: buscar quem já tem status 'lista_espera' ou já possui leito gravado
  let query = supabase
    .from('evento_hospedagens')
    .select(`
      id,
      evento_id,
      inscricao_id,
      status,
      prioridade,
      alojamento_id,
      tipo_cama,
      numero_cama,
      evento_inscricoes (
        id,
        nome_inscrito,
        status_pagamento,
        hospedagem,
        checkin_realizado,
        checkin_at
      )
    `)
    .in('status', ['lista_espera', 'solicitada', 'pago_sem_alocacao'])
    .in('evento_id', targetEventoIds)
    .is('alojamento_id', null)
    .is('checkin_at', null);

  // Ordenação inteligente: lista_espera primeiro para destravar quem já foi bloqueado
  const { data: pendentes, error: pendErr } = await query
    .order('prioridade', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(maxLimit * 4);

  if (pendErr || !pendentes || pendentes.length === 0) {
    return { processados: 0, alocados: 0, mantidos_espera: 0, erros: 0, detalhes: [] };
  }

  // Filtra apenas aqueles com pagamento elegível ('pago' ou 'isento'), sem check-in realizado, e prioriza quem está em 'lista_espera'
  const elegiveis = pendentes
    .filter((h: any) => {
      // Requisito 5: Não incluir participantes com check-in realizado na alocação automática de pendências
      if (h.status === 'checkin_realizado' || !!h.checkin_at) return false;
      const ins = h.evento_inscricoes;
      if (!ins || !ins.hospedagem) return false;
      if (ins.checkin_realizado || !!ins.checkin_at) return false;
      const stPg = String(ins.status_pagamento ?? '').toLowerCase();
      return stPg === 'pago' || stPg === 'isento';
    })
    .sort((a: any, b: any) => {
      // Prioridade 1: status 'lista_espera' vem antes de 'solicitada'
      const aEspera = a.status === 'lista_espera' ? 1 : 0;
      const bEspera = b.status === 'lista_espera' ? 1 : 0;
      if (bEspera !== aEspera) return bEspera - aEspera;
      // Prioridade 2: score de prioridade de hospedagem
      const pDiff = (b.prioridade || 0) - (a.prioridade || 0);
      if (pDiff !== 0) return pDiff;
      // Prioridade 3: antiguidade de criação
      return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
    })
    .slice(0, maxLimit);

  let alocados = 0;
  let mantidos_espera = 0;
  let erros = 0;
  const detalhes: Array<{ inscricao_id: string; status: string; motivo: string }> = [];

  for (const item of elegiveis) {
    try {
      const res = await alocarLeitoParaInscricao(supabase, item.inscricao_id);
      if (res.success || res.status === 'alocada') {
        alocados++;
        // Se a inscrição foi regularizada / alocada com sucesso no reprocessamento da lista de espera,
        // envia o e-mail complementar de hospedagem confirmada de forma segura e deduplicada
        try {
          await enviarEmailHospedagemComplementar(supabase, { inscricaoId: item.inscricao_id });
        } catch (mailErr: any) {
          console.error(`[Autoalocacao] Erro ao enviar e-mail complementar para ${item.inscricao_id}:`, mailErr?.message);
        }
      } else if (res.status === 'lista_espera') {
        mantidos_espera++;
      } else {
        erros++;
      }
      detalhes.push({
        inscricao_id: item.inscricao_id,
        status: res.status,
        motivo: res.motivo,
      });
    } catch (err: any) {
      erros++;
      detalhes.push({
        inscricao_id: item.inscricao_id,
        status: 'erro',
        motivo: err?.message || 'Erro inesperado',
      });
    }
  }

  console.log(`[Autoalocacao] Reprocessamento finalizado: ${elegiveis.length} processados | ${alocados} alocados | ${mantidos_espera} em espera | ${erros} erros.`);
  return {
    processados: elegiveis.length,
    alocados,
    mantidos_espera,
    erros,
    detalhes,
  };
}
