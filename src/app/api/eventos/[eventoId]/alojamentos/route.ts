import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { normalizePayloadUppercase } from '@/lib/text';
import { logDB } from '@/lib/audit';

async function isEventoAGO(supabase: any, eventoId: string): Promise<boolean> {
  const { data: evento } = await supabase
    .from('eventos')
    .select('departamento, configuracoes_ago')
    .eq('id', eventoId)
    .single();

  if (!evento) return false;
  if (evento.departamento === 'AGO') return true;
  const cfg = evento.configuracoes_ago as Record<string, unknown> | null;
  const setores = cfg?.setores as unknown[] | undefined;
  return Boolean(setores && setores.length > 0);
}

// GET /api/eventos/[eventoId]/alojamentos
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(_req, eventoId, 'hospedagem_checkin');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  // Busca configurações AGO para obter a SSOT oficial de setores se for evento AGO
  const { data: evento } = await supabase
    .from('eventos')
    .select('departamento, configuracoes_ago')
    .eq('id', eventoId)
    .single();

  const cfg = evento?.configuracoes_ago as Record<string, unknown> | null;
  const setoresSSOT = (cfg?.setores as any[] | undefined) ?? [];

  const { data, error } = await supabase
    .from('evento_alojamentos')
    .select('id,setor_key,origem,nome,publico,sexo,total_vagas,camas_inferiores,camas_superiores,colchonetes,ativo,created_at,is_emergencial,observacoes')
    .eq('evento_id', eventoId)
    .order('nome');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Contagem de ocupados e total de leitos físicos via paginação para superar o limite de 1000 registros do PostgREST
  let todosLeitosFisicos: any[] = [];
  const PAGE_SIZE = 1000;
  let from = 0;

  while (true) {
    const { data: chunk, error: errChunk } = await supabase
      .from('evento_hospedagem_leitos')
      .select('id, alojamento_id, posicao, ocupado, inscricao_id')
      .eq('evento_id', eventoId)
      .range(from, from + PAGE_SIZE - 1);

    if (errChunk) return NextResponse.json({ error: errChunk.message }, { status: 500 });
    if (!chunk || chunk.length === 0) break;
    todosLeitosFisicos.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const countsFisicos = new Map<string, number>();
  todosLeitosFisicos.forEach(l => {
    countsFisicos.set(l.alojamento_id, (countsFisicos.get(l.alojamento_id) || 0) + 1);
  });

  const leitosOcupados = todosLeitosFisicos.filter(l => Boolean(l.ocupado && l.inscricao_id));

  let hospOcupadas: any[] = [];
  if (leitosOcupados.length === 0) {
    let fromHosp = 0;
    while (true) {
      const { data: chunkHosp, error: errHosp } = await supabase
        .from('evento_hospedagens')
        .select('alojamento_id, tipo_cama')
        .eq('evento_id', eventoId)
        .in('status', ['alocada', 'confirmada', 'checkin_realizado'])
        .range(fromHosp, fromHosp + PAGE_SIZE - 1);

      if (errHosp) break;
      if (!chunkHosp || chunkHosp.length === 0) break;
      hospOcupadas.push(...chunkHosp);
      if (chunkHosp.length < PAGE_SIZE) break;
      fromHosp += PAGE_SIZE;
    }
  }

  const ocupadosPorAlojamento: Record<string, { total: number; inferiores: number; superiores: number; colchonetes: number }> = {};

  const processOcupante = (alojId: string, tipoCama: string | null) => {
    if (!alojId) return;
    if (!ocupadosPorAlojamento[alojId]) {
      ocupadosPorAlojamento[alojId] = { total: 0, inferiores: 0, superiores: 0, colchonetes: 0 };
    }
    ocupadosPorAlojamento[alojId].total++;
    if (tipoCama === 'inferior') ocupadosPorAlojamento[alojId].inferiores++;
    else if (tipoCama === 'superior') ocupadosPorAlojamento[alojId].superiores++;
    else if (tipoCama === 'colchonete') ocupadosPorAlojamento[alojId].colchonetes++;
  };

  // Se houver leitos reais ocupados, usá-los prioritariamente
  if (leitosOcupados.length > 0) {
    for (const l of leitosOcupados) {
      processOcupante(l.alojamento_id, l.posicao === 'unico' ? null : l.posicao);
    }
  } else {
    for (const h of hospOcupadas) {
      processOcupante(h.alojamento_id, h.tipo_cama);
    }
  }

  const result = (data ?? []).map(a => {
    let totalVagasOficial = a.total_vagas;
    let infOficial = a.camas_inferiores;
    let supOficial = a.camas_superiores;
    let colchOficial = Number(a.colchonetes ?? 0);

    // Se houver configuração na SSOT oficial, prioriza estritamente os quantitativos oficiais
    const setorSSOT = setoresSSOT.find((s: any) =>
      s.id === a.setor_key ||
      (s.nome && a.nome && s.nome.trim().toUpperCase() === a.nome.trim().toUpperCase())
    );

    if (setorSSOT) {
      const matchCol = (setorSSOT.observacoes || '').match(/(\d+)\s*(?:leitos são colchonetes|colchonetes)/i);
      colchOficial = setorSSOT.quantidade_colchonetes !== undefined
        ? Number(setorSSOT.quantidade_colchonetes)
        : (matchCol ? parseInt(matchCol[1], 10) : 0);
      totalVagasOficial = Number(setorSSOT.quantidade_leitos || 0);
      infOficial = Number(setorSSOT.quantidade_leitos_inferiores || 0);
      supOficial = setorSSOT.quantidade_leitos_superiores !== undefined
        ? Number(setorSSOT.quantidade_leitos_superiores)
        : Math.max(0, totalVagasOficial - infOficial - colchOficial);
    }

    const oc = ocupadosPorAlojamento[a.id] ?? { total: 0, inferiores: 0, superiores: 0, colchonetes: 0 };
    const totalFisico = countsFisicos.get(a.id) || 0;

    return {
      ...a,
      total_vagas:        totalVagasOficial,
      camas_inferiores:   infOficial,
      camas_superiores:   supOficial,
      colchonetes:        colchOficial,
      ocupadas:           oc.total,
      inferiores_usadas:  oc.inferiores,
      superiores_usadas:  oc.superiores,
      colchonetes_usados: oc.colchonetes,
      vagas_livres:       Math.max(0, totalVagasOficial - oc.total),
      inferiores_livres:  Math.max(0, infOficial - oc.inferiores),
      superiores_livres:  Math.max(0, supOficial - oc.superiores),
      colchonetes_livres: Math.max(0, colchOficial - oc.colchonetes),
      total_leitos_fisicos: totalFisico,
      leitos_fisicos_livres: Math.max(0, totalFisico - oc.total),
    };
  });

  return NextResponse.json({ alojamentos: result });
}

// POST /api/eventos/[eventoId]/alojamentos
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  // Bloqueio estrito para eventos AGO: configuração exclusiva via Editar Evento > Hospedagem AGO
  if (await isEventoAGO(supabase, eventoId)) {
    return NextResponse.json(
      { error: 'Eventos AGO utilizam fonte única de verdade gerenciada exclusivamente nas Configurações do Evento. Não é permitida a criação manual de alojamentos.' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const { nome, publico, sexo, total_vagas, camas_inferiores, camas_superiores, colchonetes } = body;

  if (!nome?.trim() || !publico?.trim() || total_vagas == null) {
    return NextResponse.json({ error: 'Campos obrigatórios: nome, publico, total_vagas' }, { status: 400 });
  }

  const payload = normalizePayloadUppercase({
    evento_id:        eventoId,
    nome:             nome.trim(),
    publico:          publico.trim(),
    sexo:             sexo || null,
    total_vagas:      Number(total_vagas),
    camas_inferiores: Number(camas_inferiores ?? 0),
    camas_superiores: Number(camas_superiores ?? 0),
    colchonetes:      Number(colchonetes ?? 0),
  });

  const { data, error } = await supabase
    .from('evento_alojamentos')
    .insert([payload])
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alojamento: data });
}

// PATCH /api/eventos/[eventoId]/alojamentos
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

  const supabase = guard.ctx.supabaseAdmin;

  // 1. Buscar alojamento atual
  const { data: currentAloj, error: errFetch } = await supabase
    .from('evento_alojamentos')
    .select('nome, publico, total_vagas, camas_inferiores, camas_superiores, colchonetes, ativo, setor_key, origem')
    .eq('id', id)
    .eq('evento_id', eventoId)
    .single();

  if (errFetch || !currentAloj) {
    return NextResponse.json({ error: 'Alojamento não encontrado.' }, { status: 404 });
  }

  // 1.1 Bloqueia alteração manual em evento AGO ou alojamento originado de setor da configuração do evento
  const eventoEhAgo = await isEventoAGO(supabase, eventoId);
  if (eventoEhAgo || currentAloj.setor_key || currentAloj.origem === 'configuracoes_ago') {
    return NextResponse.json(
      { error: 'Alojamentos de eventos AGO são gerenciados exclusivamente nas Configurações do Evento (Hospedagem AGO). Não é permitida a edição direta.' },
      { status: 403 }
    );
  }

  // 2. Calcular ocupação atual
  const { count: leitosCount } = await supabase
    .from('evento_hospedagem_leitos')
    .select('id', { count: 'exact', head: true })
    .eq('alojamento_id', id)
    .eq('ocupado', true);

  let totalOcupados = leitosCount ?? 0;
  if (totalOcupados === 0) {
    const { count: hospCount } = await supabase
      .from('evento_hospedagens')
      .select('id', { count: 'exact', head: true })
      .eq('alojamento_id', id)
      .in('status', ['alocada', 'confirmada', 'checkin_realizado']);
    totalOcupados = hospCount ?? 0;
  }

  // 3. Validar nova capacidade >= ocupados
  const newTotal = updates.total_vagas !== undefined ? Number(updates.total_vagas) : currentAloj.total_vagas;
  if (newTotal < totalOcupados) {
    return NextResponse.json(
      { error: `Não é possível reduzir a capacidade abaixo da quantidade de leitos ocupados (${totalOcupados} ocupados).` },
      { status: 400 }
    );
  }

  // 4. Validar se tenta alterar grupo/público com hóspedes alocados
  const newPublico = updates.publico !== undefined ? String(updates.publico) : currentAloj.publico;
  if (newPublico !== currentAloj.publico && totalOcupados > 0) {
    return NextResponse.json(
      { error: 'Não é possível alterar o público/grupo de um alojamento com hóspedes alocados.' },
      { status: 400 }
    );
  }

  // 5. Validar desativação de alojamento com hóspedes alocados
  const newAtivo = updates.ativo !== undefined ? !!updates.ativo : currentAloj.ativo;
  if (!newAtivo && totalOcupados > 0) {
    return NextResponse.json(
      { error: 'Não é possível desativar o alojamento porque existem hospedagens alocadas nele. Realoque os ocupantes primeiro.' },
      { status: 400 }
    );
  }

  // 6. Atualizar registro
  const updatesNormalized = normalizePayloadUppercase(updates);
  const { error: errUpdate } = await supabase
    .from('evento_alojamentos')
    .update(updatesNormalized)
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (errUpdate) return NextResponse.json({ error: errUpdate.message }, { status: 500 });

  // 7. Registrar auditoria
  await logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email ?? undefined,
    acao: 'alojamento_editado',
    modulo: 'hospedagem',
    entidade: 'evento_alojamentos',
    entidadeId: id,
    descricao: `[Hospedagem] Alojamento "${updates.nome || currentAloj.nome}" editado. Capacidade: ${currentAloj.total_vagas} -> ${newTotal}.`,
    detalhes: {
      alojamento_id: id,
      capacidade_anterior: currentAloj.total_vagas,
      capacidade_nova: newTotal,
      leitos_inferiores_anterior: currentAloj.camas_inferiores,
      leitos_inferiores_novo: updates.camas_inferiores !== undefined ? Number(updates.camas_inferiores) : currentAloj.camas_inferiores,
      leitos_superiores_anterior: currentAloj.camas_superiores,
      leitos_superiores_novo: updates.camas_superiores !== undefined ? Number(updates.camas_superiores) : currentAloj.camas_superiores,
      colchonetes_anterior: currentAloj.colchonetes || 0,
      colchonetes_novo: updates.colchonetes !== undefined ? Number(updates.colchonetes) : (currentAloj.colchonetes || 0),
      operador: guard.ctx.user?.email ?? 'desconhecido'
    },
    request,
  });

  return NextResponse.json({ ok: true });
}

// DELETE /api/eventos/[eventoId]/alojamentos
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'hospedagem');
  if (!guard.ok) return guard.response;
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 });

  const supabase = guard.ctx.supabaseAdmin;

  // Verifica se o alojamento é vinculado a um setor ou evento AGO
  const { data: alojCheck } = await supabase
    .from('evento_alojamentos')
    .select('id, setor_key, origem')
    .eq('id', id)
    .eq('evento_id', eventoId)
    .single();

  const eventoEhAgo = await isEventoAGO(supabase, eventoId);
  if (eventoEhAgo || alojCheck?.setor_key || alojCheck?.origem === 'configuracoes_ago') {
    return NextResponse.json(
      { error: 'Alojamentos de eventos AGO não podem ser excluídos diretamente. Gerencie os setores nas Configurações do Evento (Hospedagem AGO).' },
      { status: 403 }
    );
  }

  // Verifica se há hospedagens ocupadas neste alojamento
  const { count: leitosCount } = await supabase
    .from('evento_hospedagem_leitos')
    .select('id', { count: 'exact', head: true })
    .eq('alojamento_id', id)
    .eq('ocupado', true);

  let totalOcupados = leitosCount ?? 0;
  if (totalOcupados === 0) {
    const { count: hospCount } = await supabase
      .from('evento_hospedagens')
      .select('id', { count: 'exact', head: true })
      .eq('alojamento_id', id)
      .in('status', ['alocada', 'confirmada', 'checkin_realizado']);
    totalOcupados = hospCount ?? 0;
  }

  if (totalOcupados > 0) {
    return NextResponse.json(
      { error: 'Não é possível excluir: há hospedagens ocupadas neste alojamento.' },
      { status: 409 }
    );
  }

  const { error } = await supabase
    .from('evento_alojamentos')
    .delete()
    .eq('id', id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
