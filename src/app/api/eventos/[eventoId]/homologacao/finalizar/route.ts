import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// POST /api/eventos/[eventoId]/homologacao/finalizar
// Finaliza a homologação:
// 1. Valida que não há pendentes
// 2. Grava no Histórico Ministerial (member_history)
// 3. Sincroniza selecionado_para_advertencia em evento_ago_ausentes
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
  const userMeta = guard.ctx.user.user_metadata as Record<string, unknown>;
  const userName = (userMeta?.nome as string | undefined) || (guard.ctx.user.email ?? 'Admin');

  // Valida evento
  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nome, departamento, status, data_inicio')
    .eq('id', eventoId)
    .single();

  if (!evento || evento.departamento !== 'AGO' || evento.status !== 'encerrado')
    return NextResponse.json({ error: 'Evento inválido para finalizar homologação.' }, { status: 400 });

  // Busca todos os registros de homologação
  const { data: records } = await supabase
    .from('evento_ago_homologacao')
    .select('*')
    .eq('evento_id', eventoId);

  if (!records || records.length === 0)
    return NextResponse.json({ error: 'Homologação não iniciada para este evento.' }, { status: 400 });

  const pendentes = records.filter(r => r.status === 'pendente_analise');
  if (pendentes.length > 0) {
    return NextResponse.json({
      error: `Existem ${pendentes.length} registro(s) ainda pendente(s) de análise. Homologue todos antes de finalizar.`,
    }, { status: 400 });
  }

  const anoAGO = evento.data_inicio
    ? new Date(evento.data_inicio).getFullYear()
    : new Date().getFullYear();

  const ocorrencia = evento.data_inicio
    ? evento.data_inicio.slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  // Mapeamento de status para histórico
  const STATUS_HISTORICO: Record<string, {
    tipo: string;
    titulo: (ano: number) => string;
    descricao: (rec: Record<string, unknown>, ano: number) => string;
  }> = {
    regular: {
      tipo: 'participacao_ago',
      titulo: (a) => `Participou da AGO ${a}`,
      descricao: (r, a) =>
        `Participou da Assembleia Geral Ordinária ${a}. Presenças: ${r.presencas}/${r.total_plenarias} plenárias (${r.percentual_frequencia}%).`,
    },
    ausente: {
      tipo: 'falta_ago',
      titulo: (a) => `Ausente na AGO ${a}`,
      descricao: (r, a) =>
        `Ausente na Assembleia Geral Ordinária ${a}. Presenças: ${r.presencas}/${r.total_plenarias} plenárias (${r.percentual_frequencia}%).`,
    },
    ausencia_justificada: {
      tipo: 'participacao_ago',
      titulo: (a) => `Ausência justificada na AGO ${a}`,
      descricao: (r, a) =>
        `Ausência justificada na Assembleia Geral Ordinária ${a}. Motivo: ${r.motivo_justificativa || '(não informado)'}.`,
    },
    dispensado: {
      tipo: 'participacao_ago',
      titulo: (a) => `Dispensado da AGO ${a}`,
      descricao: (r, a) =>
        `Dispensado da Assembleia Geral Ordinária ${a}. Motivo: ${r.motivo_justificativa || '(não informado)'}.`,
    },
  };

  // Grava histórico para cada ministro identificado (ministro_id != null, não registrado ainda)
  const paraRegistrar = records.filter(r => r.ministro_id && !r.historico_registrado);
  let historicosRegistrados = 0;
  const falhasHistorico: string[] = [];

  for (const rec of paraRegistrar) {
    const cfg = STATUS_HISTORICO[rec.status as string];
    if (!cfg) continue;

    // Evitar duplicata: origem=AGO + referencia_id=eventoId + member_id já registrado
    const { data: dup } = await supabase
      .from('member_history')
      .select('id')
      .eq('member_id', rec.ministro_id)
      .eq('origem', 'AGO')
      .eq('referencia_id', eventoId)
      .maybeSingle();

    if (dup?.id) {
      // Já registrado anteriormente — só marca como registrado
      await supabase
        .from('evento_ago_homologacao')
        .update({ historico_registrado: true, updated_at: new Date().toISOString() })
        .eq('id', rec.id);
      historicosRegistrados++;
      continue;
    }

    const { error: histErr } = await supabase
      .from('member_history')
      .insert({
        member_id:         rec.ministro_id,
        tipo:              cfg.tipo,
        titulo:            cfg.titulo(anoAGO),
        descricao:         cfg.descricao(rec as unknown as Record<string, unknown>, anoAGO),
        usuario_nome:      userName,
        usuario_id:        userId,
        ocorrencia,
        origem:            'AGO',
        referencia_id:     eventoId,
      });

    if (!histErr) {
      await supabase
        .from('evento_ago_homologacao')
        .update({ historico_registrado: true, updated_at: new Date().toISOString() })
        .eq('id', rec.id);
      historicosRegistrados++;
    } else {
      falhasHistorico.push(rec.nome as string);
      console.error('[finalizar_homologacao] histórico falhou:', rec.nome, histErr.message);
    }
  }

  // Sincroniza selecionado_para_advertencia:
  // Apenas status 'ausente' → true; todo o resto → false
  const ausentesInscricaoIds = records
    .filter(r => r.status === 'ausente')
    .map(r => r.inscricao_id as string);

  const naoAusentesInscricaoIds = records
    .filter(r => r.status !== 'ausente')
    .map(r => r.inscricao_id as string);

  if (ausentesInscricaoIds.length > 0) {
    await supabase
      .from('evento_ago_ausentes')
      .update({ selecionado_para_advertencia: true })
      .eq('evento_id', eventoId)
      .in('inscricao_id', ausentesInscricaoIds);
  }

  if (naoAusentesInscricaoIds.length > 0) {
    await supabase
      .from('evento_ago_ausentes')
      .update({ selecionado_para_advertencia: false })
      .eq('evento_id', eventoId)
      .in('inscricao_id', naoAusentesInscricaoIds);
  }

  void logDB({
    userId,
    acao: 'finalizar_homologacao_ago',
    modulo: 'eventos',
    entidade: 'evento_ago_homologacao',
    entidadeId: eventoId,
    status: 'sucesso',
    descricao: `Homologação AGO finalizada: ${evento.nome}. Histórico: ${historicosRegistrados} registros. Advertências: ${ausentesInscricaoIds.length}. Falhas: ${falhasHistorico.length}.`,
    request,
  });

  return NextResponse.json({
    ok:                    true,
    total_homologados:     records.length,
    historicos_registrados: historicosRegistrados,
    advertencias:          ausentesInscricaoIds.length,
    dispensados:           records.filter(r => r.status === 'dispensado').length,
    justificados:          records.filter(r => r.status === 'ausencia_justificada').length,
    regulares:             records.filter(r => r.status === 'regular').length,
    falhas_historico:      falhasHistorico,
  });
}
