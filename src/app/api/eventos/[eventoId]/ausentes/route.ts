import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

// GET /api/eventos/[eventoId]/ausentes
// Se encerrado: lê de evento_ago_ausentes
// Se em andamento: calcula em tempo real (percentual < 100)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  const { data: evento } = await supabase
    .from('eventos')
    .select('id, status, configuracoes_ago')
    .eq('id', eventoId)
    .single();

  if (!evento) return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });

  // Evento encerrado: retorna dados consolidados
  if (evento.status === 'encerrado') {
    const { data: ausentes } = await supabase
      .from('evento_ago_ausentes')
      .select('id, inscricao_id, nome, cpf, campo, supervisao, categoria, percentual_frequencia, faltas, selecionado_para_advertencia, created_at')
      .eq('evento_id', eventoId)
      .order('percentual_frequencia', { ascending: true });

    return NextResponse.json({ encerrado: true, ausentes: ausentes ?? [] });
  }

  // Evento em andamento: cálculo em tempo real
  const cfg = (evento.configuracoes_ago ?? {}) as Record<string, unknown>;
  const plenariasDatas: string[] = Array.isArray(cfg.plenarias_datas) ? (cfg.plenarias_datas as string[]) : [];
  const totalPlenarias = plenariasDatas.length;

  const { data: inscricoes } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, cpf, tipo_inscricao, supervisao_id, campo_id, ministro_snapshot')
    .eq('evento_id', eventoId)
    .neq('status_pagamento', 'cancelado');

  if (!inscricoes || inscricoes.length === 0)
    return NextResponse.json({ encerrado: false, ausentes: [] });

  // Busca nomes de supervisões e campos
  const supIds   = [...new Set(inscricoes.map(i => i.supervisao_id).filter(Boolean))];
  const campoIds = [...new Set(inscricoes.map(i => i.campo_id).filter(Boolean))];
  const { data: supsData }   = await supabase.from('supervisoes').select('id, nome').in('id', supIds.length ? supIds : ['00000000-0000-0000-0000-000000000000']);
  const { data: camposData } = await supabase.from('campos').select('id, nome').in('id', campoIds.length ? campoIds : ['00000000-0000-0000-0000-000000000000']);
  const supMap   = new Map((supsData   ?? []).map(s => [s.id, s.nome]));
  const campoMap = new Map((camposData ?? []).map(c => [c.id, c.nome]));

  const inscricaoIds = inscricoes.map(i => i.id);
  const { data: checkins } = await supabase
    .from('evento_checkins')
    .select('inscricao_id, data_plenaria')
    .eq('tipo_checkin', 'plenaria')
    .in('inscricao_id', inscricaoIds);

  const presencasMap = new Map<string, Set<string>>();
  for (const ck of checkins ?? []) {
    if (!ck.inscricao_id || !ck.data_plenaria) continue;
    if (!presencasMap.has(ck.inscricao_id)) presencasMap.set(ck.inscricao_id, new Set());
    presencasMap.get(ck.inscricao_id)!.add(ck.data_plenaria);
  }

  const ausentes = [];
  for (const insc of inscricoes) {
    const snap = (insc.ministro_snapshot ?? {}) as Record<string, unknown>;
    const nome       = (snap.nome as string | undefined) || insc.nome_inscrito;
    const campo      = (snap.campo as string | undefined) || campoMap.get(insc.campo_id ?? '') || null;
    const supervisao = (snap.supervisao as string | undefined) || supMap.get(insc.supervisao_id ?? '') || null;

    const presencas  = presencasMap.get(insc.id)?.size ?? 0;
    const faltas     = totalPlenarias > 0 ? Math.max(0, totalPlenarias - presencas) : 0;
    const percentual = totalPlenarias > 0 ? Math.round((presencas / totalPlenarias) * 10000) / 100 : 0;

    if (totalPlenarias === 0 || percentual < 100) {
      ausentes.push({
        id: null,
        inscricao_id: insc.id,
        nome,
        cpf: insc.cpf ?? null,
        campo,
        supervisao,
        categoria: insc.tipo_inscricao ?? null,
        percentual_frequencia: percentual,
        faltas,
        selecionado_para_advertencia: false,
      });
    }
  }

  ausentes.sort((a, b) => a.percentual_frequencia - b.percentual_frequencia);

  return NextResponse.json({ encerrado: false, ausentes });
}

// POST /api/eventos/[eventoId]/ausentes
// Body: { ids: string[], selecionado: boolean }
// Atualiza selecionado_para_advertencia na tabela evento_ago_ausentes
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeEditarEvento)
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });

  const supabase = guard.ctx.supabaseAdmin;
  const userId   = guard.ctx.user.id;

  const body = (await request.json()) as { ids?: string[]; selecionado?: boolean };
  const { ids, selecionado } = body;

  if (!Array.isArray(ids) || ids.length === 0)
    return NextResponse.json({ error: 'Parâmetro "ids" é obrigatório.' }, { status: 400 });
  if (typeof selecionado !== 'boolean')
    return NextResponse.json({ error: 'Parâmetro "selecionado" deve ser booleano.' }, { status: 400 });

  const { error } = await supabase
    .from('evento_ago_ausentes')
    .update({ selecionado_para_advertencia: selecionado })
    .eq('evento_id', eventoId)
    .in('id', ids);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  void logDB({
    userId,
    acao: selecionado ? 'selecionar_ausentes_advertencia' : 'desselecionar_ausentes_advertencia',
    modulo: 'eventos',
    entidade: 'evento_ago_ausentes',
    entidadeId: eventoId,
    status: 'sucesso',
    descricao: `${ids.length} ausente(s) ${selecionado ? 'marcados' : 'desmarcados'} para advertência.`,
    request,
  });

  return NextResponse.json({ ok: true, updated: ids.length });
}
