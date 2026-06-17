import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { normalizePayloadUppercase } from '@/lib/text';
import { logDB } from '@/lib/audit';
import { alocarLeitoParaInscricao } from '@/lib/hospedagem-alocacao-automatica';
import {
  calcularPrioridadeHospedagem,
  grupoMatchesAlojamento,
  resolveCamaInferiorAutomatica,
  resolveGrupoHospedagemAGO,
} from '@/lib/hospedagem-helpers';
import {
  isElegivelAutoalocacao,
  isPagamentoElegivel,
  resolveStatusOperacionalHospedagem,
} from '@/lib/hospedagem-operacional';

// GET /api/eventos/[eventoId]/hospedagens
// Lista todas as solicitações de hospedagem (inscricoes com hospedagem=true)
// Abordagem híbrida: inscricoes como fonte primária + LEFT JOIN evento_hospedagens
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(_req, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  // 1. Todas as inscrições com hospedagem solicitada
  let inscricoes: any[] = [];
  let insFrom = 0;
  const limit = 1000;
  let insHasMore = true;

  while (insHasMore) {
    const { data: pageData, error: insErr } = await supabase
      .from('evento_inscricoes')
      .select(`
        id, nome_inscrito, cpf, sexo, data_nascimento,
        supervisao_id, campo_id, tipo_inscricao, status_pagamento,
        hosp_necessidade_especial, hosp_descricao_necessidade,
        hosp_cama_inferior, hosp_observacoes,
        hosp_possui_comorbidade, hosp_descricao_comorbidade,
        grupo_hospedagem
      `)
      .eq('evento_id', eventoId)
      .eq('hospedagem', true)
      .order('nome_inscrito')
      .range(insFrom, insFrom + limit - 1);

    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    if (pageData && pageData.length > 0) {
      inscricoes = [...inscricoes, ...pageData];
      if (pageData.length < limit) {
        insHasMore = false;
      } else {
        insFrom += limit;
      }
    } else {
      insHasMore = false;
    }
  }

  // 1.5. Leitos ocupados para checar ocupação real
  let leitosOcupados: any[] = [];
  let leitosFrom = 0;
  let leitosHasMore = true;

  while (leitosHasMore) {
    const { data: pageData, error: leitosErr } = await supabase
      .from('evento_hospedagem_leitos')
      .select('inscricao_id')
      .eq('evento_id', eventoId)
      .eq('ocupado', true)
      .range(leitosFrom, leitosFrom + limit - 1);

    if (leitosErr) return NextResponse.json({ error: leitosErr.message }, { status: 500 });

    if (pageData && pageData.length > 0) {
      leitosOcupados = [...leitosOcupados, ...pageData];
      if (pageData.length < limit) {
        leitosHasMore = false;
      } else {
        leitosFrom += limit;
      }
    } else {
      leitosHasMore = false;
    }
  }

  // 2. Registros de alocação existentes
  let alocacoes: any[] = [];
  let alocFrom = 0;
  let alocHasMore = true;

  while (alocHasMore) {
    const { data: pageData, error: alocErr } = await supabase
      .from('evento_hospedagens')
      .select(`
        id, inscricao_id, alojamento_id, status, prioridade,
        tipo_cama, numero_cama, observacoes, alocacao_automatica,
        grupo_hospedagem,
        checkin_at, checkout_at, checkin_operador, checkout_operador,
        evento_alojamentos ( id, nome, publico, total_vagas )
      `)
      .eq('evento_id', eventoId)
      .range(alocFrom, alocFrom + limit - 1);

    if (alocErr) return NextResponse.json({ error: alocErr.message }, { status: 500 });

    if (pageData && pageData.length > 0) {
      alocacoes = [...alocacoes, ...pageData];
      if (pageData.length < limit) {
        alocHasMore = false;
      } else {
        alocFrom += limit;
      }
    } else {
      alocHasMore = false;
    }
  }

  // 3. Mapa inscricao_id → alocação
  type AlocRow = Record<string, unknown>;
  const alocMap = new Map<string, AlocRow>();
  (alocacoes ?? []).forEach(a => {
    const raw = a as unknown as AlocRow;
    alocMap.set(raw.inscricao_id as string, raw);
  });

  // 4. Merge: inscrições como base + alocações como overlay
  type InscRow = Record<string, unknown>;
  const hospedagens = (inscricoes ?? []).map(insc => {
    const ei = insc as unknown as InscRow;
    const aloc = alocMap.get(insc.id);
    const aloj = aloc ? (aloc.evento_alojamentos as AlocRow | null) : null;
    const grupoFallback =
      (aloc?.grupo_hospedagem ?? ei.grupo_hospedagem) ||
      resolveGrupoHospedagemAGO({
        sexo: (insc.sexo as string | null) ?? null,
        data_nascimento: (insc.data_nascimento as string | null) ?? null,
        tipo_inscricao: (insc.tipo_inscricao as string | null) ?? null,
        hosp_necessidade_especial: !!(ei.hosp_necessidade_especial),
        hosp_possui_comorbidade: !!(ei.hosp_possui_comorbidade),
      });

    const statusOperacional = resolveStatusOperacionalHospedagem({
      status: (aloc?.status ?? 'solicitada') as string,
      status_pagamento: insc.status_pagamento ?? null,
      alojamento_id: (aloc?.alojamento_id ?? null) as string | null,
      tipo_cama: (aloc?.tipo_cama ?? null) as string | null,
      numero_cama: (aloc?.numero_cama ?? null) as string | null,
      hospedagem: true,
    });
    const elegivelAutoalocacao = isElegivelAutoalocacao({
      status: (aloc?.status ?? 'solicitada') as string,
      status_pagamento: insc.status_pagamento ?? null,
      alojamento_id: (aloc?.alojamento_id ?? null) as string | null,
      tipo_cama: (aloc?.tipo_cama ?? null) as string | null,
      numero_cama: (aloc?.numero_cama ?? null) as string | null,
      hospedagem: true,
    });
    const pendencias: string[] = [];
    const statusPagamento = String(insc.status_pagamento ?? '').toLowerCase();
    const alocacaoIncompleta = !!(aloc?.alojamento_id) && (!aloc?.tipo_cama || !aloc?.numero_cama);
    const grupoIncompativel = !!(aloj && grupoFallback && !grupoMatchesAlojamento(
      grupoFallback as string,
      { publico: String((aloj as AlocRow).publico ?? ''), nome: String((aloj as AlocRow).nome ?? '') },
    ));

    if (isPagamentoElegivel(statusPagamento) && !aloc?.alojamento_id && aloc?.status !== 'lista_espera') pendencias.push('pagou_mas_nao_alocado');
    if (!isPagamentoElegivel(statusPagamento)) pendencias.push('solicitou_sem_pagamento');
    if (!!(ei.hosp_cama_inferior) && aloc?.tipo_cama && aloc.tipo_cama !== 'inferior') pendencias.push('prioridade_sem_leito_inferior');
    if (!grupoFallback) pendencias.push('sem_grupo_calculado');
    if (grupoIncompativel) pendencias.push('grupo_incompativel_alojamento');
    if (alocacaoIncompleta) pendencias.push('sem_numero_leito');

    return {
      id:                    aloc?.id              ?? null,
      inscricao_id:          insc.id,
      alojamento_id:         aloc?.alojamento_id   ?? null,
      status:                (aloc?.status         ?? 'solicitada') as string,
      prioridade:            (aloc?.prioridade     ?? 0) as number,
      necessidade_especial:  !!(ei.hosp_necessidade_especial),
      descricao_necessidade: ei.hosp_descricao_necessidade ?? null,
      cama_inferior:         !!(ei.hosp_cama_inferior),
      possui_comorbidade:    !!(ei.hosp_possui_comorbidade),
      descricao_comorbidade: ei.hosp_descricao_comorbidade ?? null,
      grupo_hospedagem:      grupoFallback ?? null,
      tipo_cama:             (aloc?.tipo_cama       ?? null) as string | null,
      numero_cama:           (aloc?.numero_cama     ?? null) as string | null,
      observacoes:           (aloc?.observacoes     ?? ei.hosp_observacoes) ?? null,
      alocacao_automatica:   !!(aloc ? aloc.alocacao_automatica : true),
      checkin_at:            (aloc?.checkin_at         ?? null) as string | null,
      checkout_at:           (aloc?.checkout_at        ?? null) as string | null,
      checkin_operador:      (aloc?.checkin_operador   ?? null) as string | null,
      checkout_operador:     (aloc?.checkout_operador  ?? null) as string | null,
      // Dados da inscrição
      nome_inscrito:     insc.nome_inscrito,
      cpf:               insc.cpf               ?? null,
      sexo:              insc.sexo              ?? null,
      data_nascimento:   insc.data_nascimento   ?? null,
      supervisao_id:     insc.supervisao_id     ?? null,
      campo_id:          insc.campo_id          ?? null,
      tipo_inscricao:    insc.tipo_inscricao    ?? null,
      status_pagamento:  insc.status_pagamento  ?? null,
      status_operacional: statusOperacional,
      elegivel_autoalocacao: elegivelAutoalocacao,
      tem_leito_ocupado: (leitosOcupados ?? []).some(l => l.inscricao_id === insc.id),
      pendencias,
      // Alojamento
      alojamento_nome:   aloj?.nome             ?? null,
    };
  });

  // Pendencia de capacidade (global): alojamento acima da capacidade
  const capacidadeMap = new Map<string, { capacidade: number; ocupados: number }>();
  for (const a of alocacoes ?? []) {
    const alojRaw = (a as unknown as AlocRow).evento_alojamentos as AlocRow | AlocRow[] | null;
    const alojObj = Array.isArray(alojRaw) ? (alojRaw[0] ?? null) : alojRaw;
    const alojId = String((a as unknown as AlocRow).alojamento_id ?? '');
    if (!alojId || !alojObj) continue;
    const capacidade = Number((alojObj as AlocRow).total_vagas ?? 0);
    if (!capacidadeMap.has(alojId)) capacidadeMap.set(alojId, { capacidade, ocupados: 0 });
    const atual = capacidadeMap.get(alojId)!;
    if (['alocada', 'confirmada', 'checkin_realizado'].includes(String((a as unknown as AlocRow).status ?? ''))) {
      atual.ocupados += 1;
    }
  }
  const acimaCapacidade = new Set<string>();
  for (const [alojId, cap] of capacidadeMap.entries()) {
    if (cap.capacidade > 0 && cap.ocupados > cap.capacidade) acimaCapacidade.add(alojId);
  }
  hospedagens.forEach((h) => {
    const alojId = typeof h.alojamento_id === 'string' ? h.alojamento_id : null;
    if (alojId && acimaCapacidade.has(alojId)) {
      h.pendencias = Array.from(new Set([...(h.pendencias ?? []), 'alojamento_acima_capacidade']));
    }
  });

  return NextResponse.json({ hospedagens });
}

// POST /api/eventos/[eventoId]/hospedagens
// Cria registro de hospedagem manualmente (admin)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const body = await request.json();
  const { inscricao_id, alojamento_id, tipo_cama, status, prioridade,
          necessidade_especial, descricao_necessidade, cama_inferior,
          numero_cama, observacoes, grupo_hospedagem,
          possui_comorbidade, descricao_comorbidade } = body;

  if (!inscricao_id) {
    return NextResponse.json({ error: 'inscricao_id obrigatório' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;
  const { data: inscricao, error: insErr } = await supabase
    .from('evento_inscricoes')
    .select(`
      id, evento_id, sexo, data_nascimento, tipo_inscricao,
      hosp_necessidade_especial, hosp_possui_comorbidade,
      grupo_hospedagem
    `)
    .eq('id', inscricao_id)
    .eq('evento_id', eventoId)
    .single();

  if (insErr || !inscricao) {
    return NextResponse.json({ error: 'Inscricao nao encontrada neste evento.' }, { status: 404 });
  }

  const grupoHospedagem =
    (grupo_hospedagem as string)?.trim()
    || inscricao.grupo_hospedagem
    || resolveGrupoHospedagemAGO({
      sexo: inscricao.sexo ?? null,
      data_nascimento: inscricao.data_nascimento ?? null,
      tipo_inscricao: inscricao.tipo_inscricao ?? null,
      hosp_necessidade_especial: !!inscricao.hosp_necessidade_especial,
      hosp_possui_comorbidade: !!inscricao.hosp_possui_comorbidade,
    });

  const temNecessidadeEspecial = necessidade_especial !== undefined
    ? !!necessidade_especial
    : !!inscricao.hosp_necessidade_especial;
  const temComorbidade = possui_comorbidade !== undefined
    ? !!possui_comorbidade
    : !!inscricao.hosp_possui_comorbidade;
  const camaInferiorAuto = resolveCamaInferiorAutomatica({
    sexo: inscricao.sexo ?? null,
    data_nascimento: inscricao.data_nascimento ?? null,
    tipo_inscricao: inscricao.tipo_inscricao ?? null,
    hosp_necessidade_especial: temNecessidadeEspecial,
    hosp_possui_comorbidade: temComorbidade,
  });
  const precisaCamaInferior = cama_inferior !== undefined ? !!cama_inferior : camaInferiorAuto;
  const prioridadeCalculada = calcularPrioridadeHospedagem({
    id: inscricao.id,
    nome_inscrito: '',
    sexo: inscricao.sexo ?? null,
    data_nascimento: inscricao.data_nascimento ?? null,
    tipo_inscricao: inscricao.tipo_inscricao ?? null,
    hosp_necessidade_especial: temNecessidadeEspecial,
    hosp_descricao_necessidade: descricao_necessidade ?? null,
    hosp_cama_inferior: precisaCamaInferior,
    hosp_observacoes: observacoes ?? null,
    hosp_possui_comorbidade: temComorbidade,
    hosp_descricao_comorbidade: descricao_comorbidade ?? null,
  });

  const payload = normalizePayloadUppercase({
    evento_id:            eventoId,
    inscricao_id,
    alojamento_id:        alojamento_id || null,
    status:               status        ?? 'solicitada',
    prioridade:           prioridade    ?? prioridadeCalculada,
    necessidade_especial: temNecessidadeEspecial,
    descricao_necessidade: descricao_necessidade ?? null,
    cama_inferior:        precisaCamaInferior,
    tipo_cama:            tipo_cama     || null,
    numero_cama:          numero_cama   || null,
    observacoes:          observacoes   || null,
    grupo_hospedagem:     grupoHospedagem || null,
    alocacao_automatica:  false, // Manual
  });

  const { data, error } = await supabase
    .from('evento_hospedagens')
    .upsert([payload], { onConflict: 'inscricao_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { error: insUpdateErr } = await supabase
    .from('evento_inscricoes')
    .update(normalizePayloadUppercase({
      hospedagem: true,
      grupo_hospedagem: grupoHospedagem || null,
      hosp_necessidade_especial: temNecessidadeEspecial,
      hosp_descricao_necessidade: descricao_necessidade ?? null,
      hosp_cama_inferior: precisaCamaInferior,
      hosp_possui_comorbidade: temComorbidade,
      hosp_descricao_comorbidade: descricao_comorbidade ?? null,
    }))
    .eq('id', inscricao_id)
    .eq('evento_id', eventoId);

  if (insUpdateErr) return NextResponse.json({ error: insUpdateErr.message }, { status: 500 });

  await alocarLeitoParaInscricao(supabase, inscricao_id);

  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'ajuste_manual_hospedagem',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: String(data?.id ?? inscricao_id),
    descricao: '[Hospedagem] Criacao/ajuste manual de hospedagem',
    detalhes: { evento_id: eventoId, inscricao_id },
    request,
  });
  return NextResponse.json({ hospedagem: data });
}

// PATCH /api/eventos/[eventoId]/hospedagens
// Atualiza uma hospedagem (alterar alojamento, cama, status, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const body = await request.json();
  const { id, ...updates } = body;
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });

  // Se está alterando alojamento/cama manualmente, marca como não automático
  if (updates.alojamento_id !== undefined || updates.tipo_cama !== undefined) {
    updates.alocacao_automatica = false;
  }

  const supabase = guard.ctx.supabaseAdmin;

  // Verificar limite de vagas se está confirmando e mudando alojamento
  if (updates.alojamento_id && updates.status === 'confirmada') {
    const { data: aloj } = await supabase
      .from('evento_alojamentos')
      .select('total_vagas, camas_inferiores, camas_superiores')
      .eq('id', updates.alojamento_id)
      .single();

    if (aloj) {
      const { count: ocupTotal } = await supabase
        .from('evento_hospedagens')
        .select('id', { count: 'exact', head: true })
        .eq('alojamento_id', updates.alojamento_id)
        .eq('status', 'confirmada')
        .neq('id', id);

      if ((ocupTotal ?? 0) >= aloj.total_vagas) {
        return NextResponse.json(
          { error: 'Alojamento sem vagas disponíveis. Mude para lista de espera ou escolha outro alojamento.' },
          { status: 409 }
        );
      }

      if (updates.tipo_cama === 'inferior') {
        const { count: ocupInf } = await supabase
          .from('evento_hospedagens')
          .select('id', { count: 'exact', head: true })
          .eq('alojamento_id', updates.alojamento_id)
          .eq('tipo_cama', 'inferior')
          .eq('status', 'confirmada')
          .neq('id', id);

        if ((ocupInf ?? 0) >= aloj.camas_inferiores) {
          return NextResponse.json(
            { error: 'Sem camas inferiores disponíveis neste alojamento.' },
            { status: 409 }
          );
        }
      }
    }
  }

  const updatesNormalized = normalizePayloadUppercase(updates);

  const { error } = await supabase
    .from('evento_hospedagens')
    .update(updatesNormalized)
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'ajuste_manual_hospedagem',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: id,
    descricao: '[Hospedagem] Edicao manual de hospedagem',
    detalhes: { evento_id: eventoId, updates: updatesNormalized },
    request,
  });
  return NextResponse.json({ ok: true });
}

// DELETE /api/eventos/[eventoId]/hospedagens?id=xxx
// Remove completamente um registro de hospedagem
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;
  const { error } = await supabase
    .from('evento_hospedagens')
    .delete()
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'ajuste_manual_hospedagem',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: id,
    descricao: '[Hospedagem] Remocao manual de hospedagem',
    detalhes: { evento_id: eventoId },
    request,
  });
  return NextResponse.json({ ok: true });
}
