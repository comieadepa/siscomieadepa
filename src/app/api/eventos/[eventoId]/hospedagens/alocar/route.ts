import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { materializarSetoresHospedagemAGO } from '@/lib/materializar-setores';
import { logDB } from '@/lib/audit';
import {
  calcularPrioridadeHospedagem,
  resolveGrupoHospedagemAGO,
  sugerirAlojamento,
  grupoMatchesAlojamento,
  type Alojamento,
  type InscricaoParaHospedagem,
} from '@/lib/hospedagem-helpers';
import {
  formatarNumeroLeitoSequencial,
  isElegivelAutoalocacao,
  resolveStatusOperacionalHospedagem,
} from '@/lib/hospedagem-operacional';

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(_req, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'autoalocacao_iniciada',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: eventoId,
    descricao: `[Hospedagem] Autoalocacao iniciada para evento ${eventoId}`,
    request: _req,
  });

  const fetchAlojAtivos = () =>
    supabase
      .from('evento_alojamentos')
      .select('id,nome,publico,sexo,total_vagas,camas_inferiores,camas_superiores,ativo')
      .eq('evento_id', eventoId)
      .eq('ativo', true);

  const { data: alojamentosRaw0, error: errAloj } = await fetchAlojAtivos();
  if (errAloj) return NextResponse.json({ error: errAloj.message }, { status: 500 });

  let alojamentosRaw = alojamentosRaw0;
  if ((alojamentosRaw ?? []).length === 0) {
    await materializarSetoresHospedagemAGO(supabase, eventoId);
    const { data: recarregados } = await fetchAlojAtivos();
    alojamentosRaw = recarregados ?? alojamentosRaw0;
  }

  const { data: todasInscricoes } = await supabase
    .from('evento_inscricoes')
    .select(`
      id, nome_inscrito, sexo, data_nascimento, tipo_inscricao,
      status_pagamento,
      hosp_necessidade_especial, hosp_descricao_necessidade,
      hosp_cama_inferior, hosp_observacoes, grupo_hospedagem,
      hosp_possui_comorbidade, hosp_descricao_comorbidade
    `)
    .eq('evento_id', eventoId)
    .eq('hospedagem', true);

  const { data: hospExistentes } = await supabase
    .from('evento_hospedagens')
    .select('inscricao_id')
    .eq('evento_id', eventoId);

  const idsComRegistro = new Set((hospExistentes ?? []).map(h => h.inscricao_id));
  const semRegistro = (todasInscricoes ?? []).filter(i => !idsComRegistro.has(i.id));

  if (semRegistro.length > 0) {
    const { error: errUpsert } = await supabase
      .from('evento_hospedagens')
      .upsert(
        semRegistro.map(i => ({
          evento_id:            eventoId,
          inscricao_id:         i.id,
          status:               'solicitada',
          prioridade:           calcularPrioridadeHospedagem(i as InscricaoParaHospedagem),
          necessidade_especial: Boolean(i.hosp_necessidade_especial),
          descricao_necessidade: i.hosp_descricao_necessidade ?? null,
          cama_inferior:        Boolean(i.hosp_cama_inferior),
          observacoes:          i.hosp_observacoes ?? null,
          grupo_hospedagem:     i.grupo_hospedagem ?? null,
          alocacao_automatica:  true,
        })),
        { onConflict: 'inscricao_id' },
      );
    if (errUpsert) console.error('[alocar] upsert hospedagens:', errUpsert.message);
  }

  const { data: hospedagensRaw, error: errHosp } = await supabase
    .from('evento_hospedagens')
    .select(`
      id, prioridade, necessidade_especial, descricao_necessidade,
      cama_inferior, inscricao_id, grupo_hospedagem,
      status, alojamento_id, tipo_cama, numero_cama, observacoes,
      evento_inscricoes (
        id, nome_inscrito, sexo, data_nascimento, tipo_inscricao,
        status_pagamento,
        hosp_necessidade_especial, hosp_descricao_necessidade,
        hosp_cama_inferior, hosp_observacoes, grupo_hospedagem,
        hosp_possui_comorbidade, hosp_descricao_comorbidade
      )
    `)
    .eq('evento_id', eventoId);

  if (errHosp) return NextResponse.json({ error: errHosp.message }, { status: 500 });

  const pendentesPagamento: string[] = [];
  const atualizacoesPendencia: Array<PromiseLike<unknown>> = [];
  const atualizacoesGrupo: Array<PromiseLike<unknown>> = [];

  for (const hosp of hospedagensRaw ?? []) {
    const insc = hosp.evento_inscricoes as unknown as Record<string, unknown> | null;
    const statusPagamento = (insc?.status_pagamento as string | null) ?? null;
    const grupoAtual = (hosp.grupo_hospedagem as string | null) ?? (insc?.grupo_hospedagem as string | null) ?? null;
    if (!grupoAtual && insc) {
      const grupoCalculado = resolveGrupoHospedagemAGO({
        sexo: (insc.sexo as string | null) ?? null,
        data_nascimento: (insc.data_nascimento as string | null) ?? null,
        tipo_inscricao: (insc.tipo_inscricao as string | null) ?? null,
        hosp_necessidade_especial: Boolean(insc.hosp_necessidade_especial),
        hosp_possui_comorbidade: Boolean(insc.hosp_possui_comorbidade),
      });
      if (grupoCalculado) {
        atualizacoesGrupo.push(
          supabase
            .from('evento_inscricoes')
            .update({ grupo_hospedagem: grupoCalculado })
            .eq('id', hosp.inscricao_id as string)
            .eq('evento_id', eventoId),
        );
        atualizacoesGrupo.push(
          supabase
            .from('evento_hospedagens')
            .update({ grupo_hospedagem: grupoCalculado })
            .eq('id', hosp.id)
            .eq('evento_id', eventoId),
        );
        hosp.grupo_hospedagem = grupoCalculado;
        if (insc) insc.grupo_hospedagem = grupoCalculado;
      }
    }

    const oper = resolveStatusOperacionalHospedagem({
      status: hosp.status as string | null,
      status_pagamento: statusPagamento,
      alojamento_id: hosp.alojamento_id as string | null,
      tipo_cama: hosp.tipo_cama as string | null,
      numero_cama: hosp.numero_cama as string | null,
      hospedagem: true,
    });

    if (oper === 'aguardando_pagamento') {
      pendentesPagamento.push(hosp.inscricao_id as string);
      if (hosp.alojamento_id || hosp.numero_cama || hosp.tipo_cama) {
        atualizacoesPendencia.push(
          supabase
            .from('evento_hospedagens')
            .update({
              alojamento_id: null,
              tipo_cama: null,
              numero_cama: null,
              observacoes: `${String(hosp.observacoes ?? '').trim()} [AUTO] desalocado por pagamento pendente`.trim(),
            })
            .eq('id', hosp.id)
            .eq('evento_id', eventoId),
        );
        atualizacoesPendencia.push(
          supabase
            .from('evento_hospedagem_leitos')
            .delete()
            .eq('evento_id', eventoId)
            .eq('inscricao_id', hosp.inscricao_id as string),
        );
      }
    }
  }

  if (atualizacoesPendencia.length > 0) {
    await Promise.allSettled(atualizacoesPendencia);
  }

  if (atualizacoesGrupo.length > 0) {
    await Promise.allSettled(atualizacoesGrupo);
  }

  if (pendentesPagamento.length > 0) {
    await logDB({
      userId: guard.ctx.user?.id,
      userEmail: guard.ctx.user?.email ?? undefined,
      acao: 'hospedagem_nao_alocada_pagamento_pendente',
      modulo: 'eventos',
      entidade: 'evento_hospedagens',
      entidadeId: eventoId,
      descricao: `[Hospedagem] Inscricoes bloqueadas por pagamento pendente: ${pendentesPagamento.length}`,
      detalhes: { quantidade: pendentesPagamento.length },
      request: _req,
    });
  }

  const { data: ocupantesDb } = await supabase
    .from('evento_hospedagens')
    .select('alojamento_id, tipo_cama')
    .eq('evento_id', eventoId)
    .in('status', ['alocada', 'confirmada', 'checkin_realizado'])
    .not('alojamento_id', 'is', null);

  const vagasMap: Record<string, { total: number; inferiores: number; superiores: number }> = {};
  for (const aloj of alojamentosRaw ?? []) {
    const conf = (ocupantesDb ?? []).filter(c => c.alojamento_id === aloj.id);
    vagasMap[aloj.id] = {
      total:      aloj.total_vagas      - conf.length,
      inferiores: aloj.camas_inferiores - conf.filter(c => c.tipo_cama === 'inferior').length,
      superiores: aloj.camas_superiores - conf.filter(c => c.tipo_cama === 'superior').length,
    };
  }

  const { data: leitosExistentes } = await supabase
    .from('evento_hospedagem_leitos')
    .select('alojamento_id, numero')
    .eq('evento_id', eventoId);

  const leitoNumMap: Record<string, number> = {};
  for (const l of leitosExistentes ?? []) {
    const num = parseInt(l.numero) || 0;
    if ((leitoNumMap[l.alojamento_id] ?? 0) < num) {
      leitoNumMap[l.alojamento_id] = num;
    }
  }

  const alojamentos: Alojamento[] = (alojamentosRaw ?? []).map(a => ({
    ...a,
    evento_id:         eventoId,
    vagas_livres:      vagasMap[a.id]?.total      ?? 0,
    inferiores_livres: vagasMap[a.id]?.inferiores ?? 0,
    superiores_livres: vagasMap[a.id]?.superiores ?? 0,
  })) as unknown as Alojamento[];

  const elegiveis = (hospedagensRaw ?? [])
    .filter(h => {
      const insc = h.evento_inscricoes as unknown as Record<string, unknown> | null;
      return isElegivelAutoalocacao({
        hospedagem: true,
        status: h.status as string | null,
        status_pagamento: (insc?.status_pagamento as string | null) ?? null,
        alojamento_id: h.alojamento_id as string | null,
        tipo_cama: h.tipo_cama as string | null,
        numero_cama: h.numero_cama as string | null,
      });
    })
    .sort((a, b) => {
      const pa = Number(a.prioridade ?? 0);
      const pb = Number(b.prioridade ?? 0);
      return pb - pa;
    });

  let alocadas_count = 0;
  let lista_espera_count = 0;
  let leitos_atribuidos = 0;
  let prioridadeSemInferior = 0;
  let semVaga = 0;

  for (const hosp of elegiveis) {
    const insc = hosp.evento_inscricoes as unknown as (InscricaoParaHospedagem & { grupo_hospedagem?: string | null }) | null;
    if (!insc) continue;

    const prioridade = calcularPrioridadeHospedagem(insc);

    for (const a of alojamentos) {
      a.vagas_livres      = vagasMap[a.id]?.total      ?? 0;
      a.inferiores_livres = vagasMap[a.id]?.inferiores ?? 0;
      a.superiores_livres = vagasMap[a.id]?.superiores ?? 0;
    }

    const grupoHosp = insc.grupo_hospedagem ?? (hosp.grupo_hospedagem as string | null) ?? null;
    const candidatos = alojamentos
      .filter(a => grupoMatchesAlojamento(grupoHosp, a))
      .sort((a, b) => {
        const ratioA = a.total_vagas > 0 ? (a.total_vagas - (a.vagas_livres ?? 0)) / a.total_vagas : 1;
        const ratioB = b.total_vagas > 0 ? (b.total_vagas - (b.vagas_livres ?? 0)) / b.total_vagas : 1;
        return ratioA - ratioB;
      });

    const sugestao = sugerirAlojamento(insc, candidatos, prioridade);

    if (!sugestao.alojamento_id || sugestao.status === 'lista_espera') {
      await supabase
        .from('evento_hospedagens')
        .update({
          status: 'lista_espera',
          alojamento_id: null,
          tipo_cama: null,
          numero_cama: null,
          alocacao_automatica: true,
        })
        .eq('id', hosp.id)
        .eq('evento_id', eventoId);
      await supabase
        .from('evento_hospedagem_leitos')
        .delete()
        .eq('evento_id', eventoId)
        .eq('inscricao_id', hosp.inscricao_id as string);
      semVaga++;
      lista_espera_count++;
      continue;
    }

    const alojId = sugestao.alojamento_id;
    leitoNumMap[alojId] = (leitoNumMap[alojId] ?? 0) + 1;
    const numeroCama = formatarNumeroLeitoSequencial(leitoNumMap[alojId]);
    const posicao: 'inferior' | 'superior' | 'unico' =
      sugestao.tipo_cama === 'inferior' ? 'inferior'
      : sugestao.tipo_cama === 'superior' ? 'superior'
      : 'unico';

    const alertaInferior = !!sugestao.prioridadeInferiorNaoAtendida;
    if (alertaInferior) prioridadeSemInferior++;

    const observacaoAtual = String(hosp.observacoes ?? '').trim();
    const alertaTxt = alertaInferior ? 'PRIORIDADE SEM LEITO INFERIOR DISPONIVEL' : '';
    const observacaoNova = [observacaoAtual, alertaTxt].filter(Boolean).join(' | ') || null;

    await supabase
      .from('evento_hospedagens')
      .update({
        alojamento_id: alojId,
        tipo_cama: sugestao.tipo_cama,
        numero_cama: numeroCama,
        status: 'alocada',
        prioridade: sugestao.prioridade,
        observacoes: observacaoNova,
        alocacao_automatica: true,
      })
      .eq('id', hosp.id)
      .eq('evento_id', eventoId);

    const { error: errLeito } = await supabase
      .from('evento_hospedagem_leitos')
      .upsert(
        [{
          evento_id: eventoId,
          alojamento_id: alojId,
          inscricao_id: hosp.inscricao_id,
          numero: numeroCama,
          tipo_leito: 'beliche',
          posicao,
          ocupado: true,
        }],
        { onConflict: 'inscricao_id' },
      );

    if (!errLeito) {
      leitos_atribuidos++;
    }

    vagasMap[alojId].total--;
    if (sugestao.tipo_cama === 'inferior') vagasMap[alojId].inferiores--;
    if (sugestao.tipo_cama === 'superior') vagasMap[alojId].superiores--;
    alocadas_count++;
  }

  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'hospedagem_alocada',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: eventoId,
    descricao: `[Hospedagem] Alocacoes automaticas realizadas: ${alocadas_count}`,
    detalhes: { quantidade: alocadas_count },
    request: _req,
  });

  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'hospedagem_lista_espera',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: eventoId,
    descricao: `[Hospedagem] Lista de espera gerada: ${lista_espera_count}`,
    detalhes: { quantidade: lista_espera_count },
    request: _req,
  });

  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'hospedagem_sem_vaga',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: eventoId,
    descricao: `[Hospedagem] Sem vaga para alocacao: ${semVaga}`,
    detalhes: { quantidade: semVaga },
    request: _req,
  });

  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'autoalocacao_concluida',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: eventoId,
    descricao: `[Hospedagem] Autoalocacao concluida no evento ${eventoId}`,
    detalhes: {
      elegiveis: elegiveis.length,
      alocadas: alocadas_count,
      lista_espera: lista_espera_count,
      leitos_atribuidos,
      aguardando_pagamento: pendentesPagamento.length,
      prioridade_sem_leito_inferior: prioridadeSemInferior,
    },
    request: _req,
  });

  return NextResponse.json({
    ok: true,
    processados:      elegiveis.length,
    confirmados:      alocadas_count,
    lista_espera:     lista_espera_count,
    leitos_atribuidos,
    aguardando_pagamento: pendentesPagamento.length,
    prioridade_sem_leito_inferior: prioridadeSemInferior,
  });
}
