import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

export const dynamic = 'force-dynamic';

// Mapeamento tipo → ação no cadastro de membro
interface MemberUpdate {
  field: string;
  // 'static' = valor fixo, 'situacao_nova' = usa situacao_nova da deliberação, 'date_hoje' = data de hoje
  source: 'static' | 'situacao_nova' | 'date_hoje';
  value?: unknown;
}

const MEMBER_UPDATES: Record<string, MemberUpdate[]> = {
  jubilacao: [
    { field: 'jubilado',       source: 'static', value: true },
    { field: 'data_jubilacao', source: 'date_hoje' },
  ],
  ordenacao: [
    { field: 'cargo_ministerial', source: 'situacao_nova' },
  ],
  mudanca_cargo: [
    { field: 'cargo_ministerial', source: 'situacao_nova' },
  ],
  consagracao: [
    { field: 'cargo_ministerial', source: 'situacao_nova' },
  ],
  separacao_ministerio: [
    { field: 'cargo_ministerial', source: 'situacao_nova' },
    { field: 'ministerial',       source: 'static', value: true },
  ],
  exclusao: [
    { field: 'status', source: 'static', value: 'inativo' },
  ],
};

// Títulos amigáveis para histórico ministerial
const TIPO_TITULO: Record<string, (_n: string, a: number) => string> = {
  consagracao:          (_n, a) => `Consagrado na AGO ${a}`,
  ordenacao:            (_n, a) => `Ordenado ao Santo Ministério na AGO ${a}`,
  separacao_ministerio: (_n, a) => `Separado ao Ministério na AGO ${a}`,
  recebimento:          (_n, a) => `Recebido por transferência na AGO ${a}`,
  transferencia:        (_n, a) => `Transferido na AGO ${a}`,
  jubilacao:            (_n, a) => `Jubilado na AGO ${a}`,
  mudanca_cargo:        (_n, a) => `Mudança de cargo na AGO ${a}`,
  aprovacao_candidato:  (_n, a) => `Aprovado como candidato ao ministério na AGO ${a}`,
  exclusao:             (_n, a) => `Exclusão deliberada na AGO ${a}`,
  observacao_geral:     (_n, a) => `Deliberação na AGO ${a}`,
};

const TIPO_HIST_TIPO: Record<string, string> = {
  consagracao:          'consagracao',
  ordenacao:            'consagracao',
  separacao_ministerio: 'progressao_ministerial',
  recebimento:          'transferencia',
  transferencia:        'transferencia',
  jubilacao:            'jubilacao',
  mudanca_cargo:        'progressao_ministerial',
  aprovacao_candidato:  'deliberacao_comissao',
  exclusao:             'desligamento',
  observacao_geral:     'observacao_manual',
};

// POST /api/eventos/[eventoId]/deliberacoes/[deliberacaoId]/aplicar
// Transição: aprovado → aplicado
// Também insere em member_history e atualiza members (quando aplicável)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string; deliberacaoId: string }> }
) {
  const { eventoId, deliberacaoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'centro_controle');
  if (!guard.ok) return guard.response;

  const supabase  = guard.ctx.supabaseAdmin;
  const userId    = guard.ctx.user?.id;
  const userMeta  = (guard.ctx.user?.user_metadata ?? {}) as Record<string, unknown>;
  const userName  = (userMeta?.nome as string | undefined) || (guard.ctx.user?.email ?? 'Admin');

  const { data: deliberacao } = await supabase
    .from('evento_ago_deliberacoes')
    .select('*')
    .eq('id', deliberacaoId)
    .eq('evento_id', eventoId)
    .single();

  if (!deliberacao) return NextResponse.json({ error: 'Deliberação não encontrada.' }, { status: 404 });
  if (deliberacao.status !== 'aprovado')
    return NextResponse.json({ error: 'Apenas deliberações aprovadas podem ser aplicadas.' }, { status: 400 });

  // Busca evento para saber o ano
  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nome, data_inicio')
    .eq('id', eventoId)
    .single();

  const anoAGO = evento?.data_inicio
    ? new Date(evento.data_inicio).getFullYear()
    : new Date().getFullYear();

  const ocorrencia = (deliberacao.data_deliberacao as string | null)
    ?? evento?.data_inicio?.slice(0, 10)
    ?? new Date().toISOString().slice(0, 10);

  const now = new Date().toISOString();
  const tipo = deliberacao.tipo as string;

  // 1. Registra no Histórico Ministerial (se ministro_id disponível)
  let historicoRegistrado = false;
  if (deliberacao.ministro_id) {
    // Anti-duplicata
    const { data: dup } = await supabase
      .from('member_history')
      .select('id')
      .eq('member_id', deliberacao.ministro_id)
      .eq('origem', 'AGO_DELIBERACAO')
      .eq('referencia_id', deliberacaoId)
      .maybeSingle();

    if (!dup?.id) {
      const tituloFn = TIPO_TITULO[tipo] ?? ((_n: string, a: number) => `Deliberação AGO ${a}`);
      const descricao = [
        tituloFn(deliberacao.ministro_nome as string, anoAGO),
        deliberacao.situacao_anterior ? `Situação anterior: ${deliberacao.situacao_anterior}` : null,
        deliberacao.situacao_nova     ? `Nova situação: ${deliberacao.situacao_nova}`         : null,
        deliberacao.numero_ata        ? `Ata nº ${deliberacao.numero_ata}`                   : null,
        deliberacao.observacao        ? deliberacao.observacao                                : null,
      ].filter(Boolean).join('. ');

      const { error: histErr } = await supabase
        .from('member_history')
        .insert({
          member_id:     deliberacao.ministro_id,
          tipo:          TIPO_HIST_TIPO[tipo] ?? 'observacao_manual',
          titulo:        tituloFn(deliberacao.ministro_nome as string, anoAGO),
          descricao,
          usuario_nome:  userName,
          usuario_id:    userId,
          ocorrencia,
          origem:        'AGO_DELIBERACAO',
          referencia_id: deliberacaoId,
        });

      if (!histErr) historicoRegistrado = true;
      else console.error('[aplicar_deliberacao] histórico:', histErr.message);
    } else {
      historicoRegistrado = true; // já existia
    }
  }

  // 2. Atualiza cadastro do membro (quando aplicável)
  let cadastroAtualizado = false;
  const updatesDef = MEMBER_UPDATES[tipo];
  if (deliberacao.ministro_id && updatesDef && updatesDef.length > 0) {
    const memberPatch: Record<string, unknown> = { updated_at: now };
    for (const u of updatesDef) {
      if (u.source === 'static') {
        memberPatch[u.field] = u.value;
      } else if (u.source === 'situacao_nova') {
        const val = deliberacao.situacao_nova as string | null;
        if (val) memberPatch[u.field] = val;
      } else if (u.source === 'date_hoje') {
        memberPatch[u.field] = now.slice(0, 10);
      }
    }

    const { error: memErr } = await supabase
      .from('members')
      .update(memberPatch)
      .eq('id', deliberacao.ministro_id);

    if (!memErr) cadastroAtualizado = true;
    else console.error('[aplicar_deliberacao] members update:', memErr.message);
  }

  // 3. Marca deliberação como aplicada
  const { data: updated, error } = await supabase
    .from('evento_ago_deliberacoes')
    .update({
      status:           'aplicado',
      aplicado_em:      now,
      aplicado_por_id:  userId,
      aplicado_por_nome: userName,
      updated_at:       now,
    })
    .eq('id', deliberacaoId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void logDB({
    userId,
    acao: 'aplicar_deliberacao_ago',
    modulo: 'eventos',
    entidade: 'evento_ago_deliberacoes',
    entidadeId: deliberacaoId,
    status: 'sucesso',
    descricao: `Deliberação aplicada: ${tipo} — ${deliberacao.ministro_nome}. Histórico: ${historicoRegistrado}. Cadastro: ${cadastroAtualizado}.`,
    request,
  });

  return NextResponse.json({
    ok: true,
    record: updated,
    historico_registrado: historicoRegistrado,
    cadastro_atualizado: cadastroAtualizado,
  });
}
