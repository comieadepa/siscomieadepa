import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// GET /api/eventos/[eventoId]/homologacao
// Retorna todos os registros de homologação + estatísticas
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  const { data: records, error } = await supabase
    .from('evento_ago_homologacao')
    .select('*')
    .eq('evento_id', eventoId)
    .order('nome', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const r = records ?? [];
  const stats = {
    total:               r.length,
    iniciado:            r.length > 0,
    finalizado:          r.length > 0 && r.every(rec => rec.status !== 'pendente_analise'),
    pendente_analise:    r.filter(rec => rec.status === 'pendente_analise').length,
    regular:             r.filter(rec => rec.status === 'regular').length,
    ausente:             r.filter(rec => rec.status === 'ausente').length,
    ausencia_justificada:r.filter(rec => rec.status === 'ausencia_justificada').length,
    dispensado:          r.filter(rec => rec.status === 'dispensado').length,
  };

  return NextResponse.json({ records: r, stats });
}

// POST /api/eventos/[eventoId]/homologacao
// Inicia a homologação: cria registros a partir de evento_ago_frequencia_final
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

  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nome, departamento, status')
    .eq('id', eventoId)
    .single();

  if (!evento)
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  if (evento.departamento !== 'AGO')
    return NextResponse.json({ error: 'Apenas eventos AGO suportam homologação.' }, { status: 400 });
  if (evento.status !== 'encerrado')
    return NextResponse.json({ error: 'O evento precisa estar encerrado para iniciar a homologação.' }, { status: 400 });

  // Idempotência: se já iniciada, retorna ok
  const { count: existing } = await supabase
    .from('evento_ago_homologacao')
    .select('id', { count: 'exact', head: true })
    .eq('evento_id', eventoId);

  if ((existing ?? 0) > 0)
    return NextResponse.json({ ok: true, total: existing, reaproveitado: true });

  // Busca frequência consolidada
  const { data: freqRecords } = await supabase
    .from('evento_ago_frequencia_final')
    .select('*')
    .eq('evento_id', eventoId);

  if (!freqRecords || freqRecords.length === 0)
    return NextResponse.json({ error: 'Nenhum registro de frequência encontrado. Execute o encerramento primeiro.' }, { status: 400 });

  // Busca matrículas via ministro_snapshot nas inscrições
  const inscricaoIds = freqRecords.map(r => r.inscricao_id);
  const { data: inscricoes } = await supabase
    .from('evento_inscricoes')
    .select('id, ministro_snapshot')
    .in('id', inscricaoIds);

  const snapMap = new Map(
    (inscricoes ?? []).map(i => [i.id, (i.ministro_snapshot ?? {}) as Record<string, unknown>])
  );

  const rows = freqRecords.map(fr => {
    const snap      = snapMap.get(fr.inscricao_id) ?? {};
    const matricula = (snap.matricula as string | undefined) ?? null;
    const status    = fr.percentual_frequencia >= 100 ? 'regular' : 'pendente_analise';

    return {
      evento_id:             eventoId,
      inscricao_id:          fr.inscricao_id,
      ministro_id:           fr.ministro_id ?? null,
      nome:                  fr.nome,
      matricula,
      campo:                 fr.campo ?? null,
      supervisao:            fr.supervisao ?? null,
      categoria:             fr.categoria ?? null,
      total_plenarias:       fr.total_plenarias ?? 0,
      presencas:             fr.presencas ?? 0,
      faltas:                fr.faltas ?? 0,
      percentual_frequencia: fr.percentual_frequencia ?? 0,
      status,
    };
  });

  const { error: insErr } = await supabase
    .from('evento_ago_homologacao')
    .insert(rows);

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  void logDB({
    userId,
    acao: 'iniciar_homologacao_ago',
    modulo: 'eventos',
    entidade: 'evento_ago_homologacao',
    entidadeId: eventoId,
    status: 'sucesso',
    descricao: `Homologação AGO iniciada: ${evento.nome}. ${rows.length} registros criados.`,
    request,
  });

  return NextResponse.json({ ok: true, total: rows.length, reaproveitado: false });
}
