import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

// POST /api/eventos/[eventoId]/encerrar
// Encerra o evento AGO: congela dados, consolida frequência, gera lista de ausentes
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

  // 1. Verifica pré-condições
  const { data: evento, error: evErr } = await supabase
    .from('eventos')
    .select('id, nome, departamento, status, configuracoes_ago')
    .eq('id', eventoId)
    .single();

  if (evErr || !evento)
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  if (evento.departamento !== 'AGO')
    return NextResponse.json({ error: 'Apenas eventos AGO podem ser encerrados por este endpoint.' }, { status: 400 });
  if (evento.status === 'encerrado')
    return NextResponse.json({ error: 'Evento já encerrado.' }, { status: 409 });
  if (evento.status !== 'programado')
    return NextResponse.json({ error: 'Apenas eventos com status "programado" podem ser encerrados.' }, { status: 400 });

  const cfg = (evento.configuracoes_ago ?? {}) as Record<string, unknown>;
  const plenariasDatas: string[] = Array.isArray(cfg.plenarias_datas) ? (cfg.plenarias_datas as string[]) : [];
  const totalPlenarias = plenariasDatas.length;
  const encerradoEm = new Date().toISOString();

  // 2. Encerra o evento
  const { error: updErr } = await supabase
    .from('eventos')
    .update({ status: 'encerrado', encerrado_em: encerradoEm, inscricoes_abertas: false, checkin_ativo: false })
    .eq('id', eventoId);

  if (updErr)
    return NextResponse.json({ error: 'Erro ao encerrar evento: ' + updErr.message }, { status: 500 });

  // 3. Busca todas as inscrições ativas
  const { data: inscricoes } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, cpf, tipo_inscricao, supervisao_id, campo_id, ministro_snapshot')
    .eq('evento_id', eventoId)
    .neq('status_pagamento', 'cancelado');

  if (!inscricoes || inscricoes.length === 0) {
    void logDB({ userId, acao: 'encerrar_evento_ago', modulo: 'eventos', entidade: 'eventos', entidadeId: eventoId, status: 'sucesso', descricao: `Evento AGO encerrado sem inscrições: ${evento.nome}` });
    return NextResponse.json({ ok: true, encerrado_em: encerradoEm, total_processados: 0, total_ausentes: 0 });
  }

  // 4. Busca nomes de supervisões e campos
  const supIds  = [...new Set(inscricoes.map(i => i.supervisao_id).filter(Boolean))];
  const campoIds = [...new Set(inscricoes.map(i => i.campo_id).filter(Boolean))];

  const { data: supsData }    = await supabase.from('supervisoes').select('id, nome').in('id', supIds);
  const { data: camposData }  = await supabase.from('campos').select('id, nome').in('id', campoIds);

  const supMap   = new Map((supsData   ?? []).map(s => [s.id, s.nome]));
  const campoMap = new Map((camposData ?? []).map(c => [c.id, c.nome]));

  // 5. Para cada inscrição conta presenças nas plenárias
  const inscricaoIds = inscricoes.map(i => i.id);

  const { data: checkins } = await supabase
    .from('evento_checkins')
    .select('inscricao_id, data_plenaria')
    .eq('tipo_checkin', 'plenaria')
    .in('inscricao_id', inscricaoIds);

  // Agrupa presenças por inscricao_id
  const presencasMap = new Map<string, Set<string>>();
  for (const ck of checkins ?? []) {
    if (!ck.inscricao_id || !ck.data_plenaria) continue;
    if (!presencasMap.has(ck.inscricao_id)) presencasMap.set(ck.inscricao_id, new Set());
    presencasMap.get(ck.inscricao_id)!.add(ck.data_plenaria);
  }

  // 6. Monta registros de frequência final e ausentes
  const freqRecords: Record<string, unknown>[] = [];
  const ausentesRecords: Record<string, unknown>[] = [];

  for (const insc of inscricoes) {
    const snap = (insc.ministro_snapshot ?? {}) as Record<string, unknown>;
    const nome       = (snap.nome as string | undefined) || insc.nome_inscrito;
    const supervisao = (snap.supervisao as string | undefined) || supMap.get(insc.supervisao_id ?? '') || null;
    const campo      = (snap.campo as string | undefined)      || campoMap.get(insc.campo_id ?? '')      || null;
    const ministroId = (snap.ministro_id as string | undefined) || null;

    const presencasSet = presencasMap.get(insc.id) ?? new Set<string>();
    const presencas    = presencasSet.size;
    const faltas       = Math.max(0, totalPlenarias - presencas);
    const percentual   = totalPlenarias > 0 ? Math.round((presencas / totalPlenarias) * 10000) / 100 : 0;

    freqRecords.push({
      evento_id: eventoId,
      inscricao_id: insc.id,
      ministro_id: ministroId,
      nome,
      categoria: insc.tipo_inscricao ?? null,
      campo,
      supervisao,
      total_plenarias: totalPlenarias,
      presencas,
      faltas,
      percentual_frequencia: percentual,
    });

    // Ausente = menos de 100% de presença (ou sem plenárias configuradas)
    if (totalPlenarias === 0 || percentual < 100) {
      ausentesRecords.push({
        evento_id: eventoId,
        inscricao_id: insc.id,
        nome,
        cpf: insc.cpf ?? null,
        campo,
        supervisao,
        categoria: insc.tipo_inscricao ?? null,
        percentual_frequencia: percentual,
        faltas,
      });
    }
  }

  // 7. Insere frequência final (upsert para idempotência)
  if (freqRecords.length > 0) {
    const { error: freqErr } = await supabase
      .from('evento_ago_frequencia_final')
      .upsert(freqRecords, { onConflict: 'evento_id,inscricao_id' });
    if (freqErr) {
      // Reverte o status do evento em caso de falha crítica
      await supabase.from('eventos').update({ status: 'programado', encerrado_em: null, inscricoes_abertas: true, checkin_ativo: true }).eq('id', eventoId);
      return NextResponse.json({ error: 'Erro ao consolidar frequência: ' + freqErr.message }, { status: 500 });
    }
  }

  // 8. Insere ausentes
  if (ausentesRecords.length > 0) {
    await supabase.from('evento_ago_ausentes').upsert(ausentesRecords, { onConflict: 'evento_id,inscricao_id' });
  }

  // 9. Auditoria
  void logDB({
    userId,
    acao: 'encerrar_evento_ago',
    modulo: 'eventos',
    entidade: 'eventos',
    entidadeId: eventoId,
    status: 'sucesso',
    descricao: `Evento AGO encerrado: ${evento.nome}. Processados: ${freqRecords.length}, Ausentes: ${ausentesRecords.length}`,
    request,
  });

  return NextResponse.json({
    ok: true,
    encerrado_em: encerradoEm,
    total_processados: freqRecords.length,
    total_ausentes: ausentesRecords.length,
  });
}
