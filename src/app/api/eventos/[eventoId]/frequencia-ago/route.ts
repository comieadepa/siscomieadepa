import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

// GET /api/eventos/[eventoId]/frequencia-ago
// Retorna relatorio de frequencia nas plenarias AGO
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'relatorios_ago');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  // Busca configuracoes do evento (plenarias_datas vem em configuracoes_ago)
  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nome, departamento, data_inicio, data_fim, cidade, local, configuracoes_ago')
    .eq('id', eventoId)
    .single();

  if (!evento) return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });

  const cfg = (evento.configuracoes_ago as Record<string, unknown> | null) ?? {};
  const plenarias_datas: string[] = Array.isArray(cfg.plenarias_datas) ? (cfg.plenarias_datas as string[]) : [];

  // Busca todas as inscricoes confirmadas
  const { data: inscricoes } = await supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, cpf, supervisao_id, campo_id, tipo_inscricao, status_pagamento')
    .eq('evento_id', eventoId)
    .in('status_pagamento', ['pago', 'isento'])
    .order('nome_inscrito');

  if (!inscricoes) return NextResponse.json({ error: 'Erro ao buscar inscricoes.' }, { status: 500 });

  // Busca todas as presenças de plenaria para este evento
  const inscricaoIds = inscricoes.map(i => i.id);

  let presencas: Array<{ inscricao_id: string; data_plenaria: string }> = [];
  if (inscricaoIds.length > 0) {
    const { data } = await supabase
      .from('evento_checkins')
      .select('inscricao_id, data_plenaria')
      .eq('evento_id', eventoId)
      .eq('tipo_checkin', 'plenaria')
      .in('inscricao_id', inscricaoIds)
      .not('data_plenaria', 'is', null);
    presencas = (data ?? []) as Array<{ inscricao_id: string; data_plenaria: string }>;
  }

  // Agrupa presencas por inscricao
  const presencasPorInscricao: Record<string, Set<string>> = {};
  for (const p of presencas) {
    if (!presencasPorInscricao[p.inscricao_id]) {
      presencasPorInscricao[p.inscricao_id] = new Set();
    }
    presencasPorInscricao[p.inscricao_id].add(p.data_plenaria);
  }

  const diasEsperados = plenarias_datas.length;

  const inscritos = inscricoes.map(ins => {
    const dias_presentes_set = presencasPorInscricao[ins.id] ?? new Set<string>();
    const dias_presentes     = dias_presentes_set.size;
    const dias_ausentes      = Math.max(0, diasEsperados - dias_presentes);
    const percentual         = diasEsperados > 0
      ? Math.round((dias_presentes / diasEsperados) * 100)
      : null;
    const status =
      diasEsperados === 0 ? 'sem_plenaria_configurada' :
      dias_presentes === diasEsperados ? 'regular' :
      dias_presentes === 0 ? 'ausente_total' :
      'ausente_parcial';

    return {
      id:                ins.id,
      nome_inscrito:     ins.nome_inscrito,
      cpf:               ins.cpf,
      supervisao_id:     ins.supervisao_id,
      campo_id:          ins.campo_id,
      tipo_inscricao:    ins.tipo_inscricao,
      status_pagamento:  ins.status_pagamento,
      dias_esperados:    diasEsperados,
      dias_presentes,
      dias_ausentes,
      percentual,
      status,
      presencas:         Array.from(dias_presentes_set).sort(),
    };
  });

  return NextResponse.json({
    evento_id:      eventoId,
    evento_nome: evento.nome,
    evento_data_inicio: evento.data_inicio,
    evento_data_fim: evento.data_fim,
    evento_cidade: evento.cidade,
    evento_local: evento.local,
    plenarias_datas,
    total_inscritos: inscritos.length,
    inscritos,
  });
}
