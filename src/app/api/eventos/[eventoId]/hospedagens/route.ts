import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { normalizePayloadUppercase } from '@/lib/text';
import { logDB } from '@/lib/audit';
import { grupoMatchesAlojamento } from '@/lib/hospedagem-helpers';
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
  const { data: inscricoes, error: insErr } = await supabase
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
    .order('nome_inscrito');

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  // 2. Registros de alocação existentes
  const { data: alocacoes } = await supabase
    .from('evento_hospedagens')
    .select(`
      id, inscricao_id, alojamento_id, status, prioridade,
      tipo_cama, numero_cama, observacoes, alocacao_automatica,
      grupo_hospedagem,
      checkin_at, checkout_at, checkin_operador, checkout_operador,
      evento_alojamentos ( id, nome, publico, total_vagas )
    `)
    .eq('evento_id', eventoId);

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
    const grupoIncompativel = !!(aloj && (aloc?.grupo_hospedagem ?? ei.grupo_hospedagem) && !grupoMatchesAlojamento(
      (aloc?.grupo_hospedagem ?? ei.grupo_hospedagem) as string,
      { publico: String((aloj as AlocRow).publico ?? ''), nome: String((aloj as AlocRow).nome ?? '') },
    ));

    if (isPagamentoElegivel(statusPagamento) && !aloc?.alojamento_id) pendencias.push('pagou_mas_nao_alocado');
    if (!isPagamentoElegivel(statusPagamento)) pendencias.push('solicitou_sem_pagamento');
    if (!!(ei.hosp_cama_inferior) && aloc?.tipo_cama && aloc.tipo_cama !== 'inferior') pendencias.push('prioridade_sem_leito_inferior');
    if (!(aloc?.grupo_hospedagem ?? ei.grupo_hospedagem)) pendencias.push('sem_grupo_calculado');
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
      grupo_hospedagem:      (aloc?.grupo_hospedagem ?? ei.grupo_hospedagem) ?? null,
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
          numero_cama, observacoes, grupo_hospedagem } = body;

  if (!inscricao_id) {
    return NextResponse.json({ error: 'inscricao_id obrigatório' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;
  const payload = normalizePayloadUppercase({
    evento_id:            eventoId,
    inscricao_id,
    alojamento_id:        alojamento_id || null,
    status:               status        ?? 'solicitada',
    prioridade:           prioridade    ?? 0,
    necessidade_especial: necessidade_especial ?? false,
    descricao_necessidade: descricao_necessidade ?? null,
    cama_inferior:        cama_inferior ?? false,
    tipo_cama:            tipo_cama     || null,
    numero_cama:          numero_cama   || null,
    observacoes:          observacoes   || null,
    grupo_hospedagem:     (grupo_hospedagem as string)?.trim() || null,
    alocacao_automatica:  false, // Manual
  });

  const { data, error } = await supabase
    .from('evento_hospedagens')
    .upsert([payload], { onConflict: 'inscricao_id' })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
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
