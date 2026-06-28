import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { normalizePayloadUppercase } from '@/lib/text';
import { generateQRCodeToken } from '@/lib/qrcode-token';
import { logDB } from '@/lib/audit';

/**
 * POST /api/eventos/[eventoId]/balcao/equipe-rapida
 *
 * Fluxo exclusivo para inscrição rápida de equipe do evento.
 * Não passa por validações ministeriais, de pagamento, hospedagem ou Campo Missionário.
 * A inscrição é sempre isenta, sem hospedagem, com 12 refeições por padrão.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  const guard = await requireEventoPermission(request, eventoId, 'inscricoes');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  // ── Identificar operador ──────────────────────────────────────
  let equipeId: string | null = guard.ctx.equipe?.id || null;
  let operadorNome: string | null = null;

  if (equipeId) {
    const { data: eq } = await supabase
      .from('evento_equipe')
      .select('nome')
      .eq('id', equipeId)
      .maybeSingle();
    if (eq) operadorNome = eq.nome;
  } else if (guard.ctx.user?.email) {
    const { data: eq } = await supabase
      .from('evento_equipe')
      .select('id, nome')
      .eq('evento_id', eventoId)
      .eq('email', guard.ctx.user.email)
      .eq('ativo', true)
      .maybeSingle();
    if (eq) { equipeId = eq.id; operadorNome = eq.nome; }
  }

  // Admins globais/departamento podem operar sem caixa aberto
  const isGlobalOrDeptAdmin =
    guard.ctx.role === 'admin_evento' ||
    guard.ctx.source === 'global' ||
    guard.ctx.source === 'departamento';

  if (!equipeId && !isGlobalOrDeptAdmin) {
    return NextResponse.json(
      { error: 'Operador não identificado para este evento.' },
      { status: 403 }
    );
  }

  // Caixa (opcional para equipe rápida — não bloqueia)
  let caixaSessaoId: string | null = null;
  if (equipeId) {
    const { data: sessao } = await supabase
      .from('evento_caixa_sessoes')
      .select('id')
      .eq('evento_id', eventoId)
      .eq('operador_id', equipeId)
      .eq('status', 'aberto')
      .maybeSingle();
    if (sessao) caixaSessaoId = sessao.id;
  }

  const operadorId = equipeId || guard.ctx.user?.id || undefined;
  const dbOperadorNome = operadorNome || guard.ctx.user?.email || 'Operador';

  try {
    const body = await request.json() as Record<string, unknown>;
    const nome = String(body.nome ?? '').trim();
    const equipe = String(body.equipe ?? '').trim();
    const qtdRefeicoes = typeof body.qtd_refeicoes === 'number'
      ? Math.max(0, body.qtd_refeicoes)
      : 12;
    const supervisaoId = body.supervisao_id ? String(body.supervisao_id).trim() : null;

    // ── Validações mínimas ────────────────────────────────────
    if (!nome) {
      return NextResponse.json({ error: 'Nome é obrigatório.' }, { status: 400 });
    }
    if (!equipe) {
      return NextResponse.json({ error: 'Equipe é obrigatória.' }, { status: 400 });
    }

    // ── Busca dados do evento ─────────────────────────────────
    const { data: evento } = await supabase
      .from('eventos')
      .select('id, nome, slug, departamento, status')
      .eq('id', eventoId)
      .single();

    if (!evento) {
      return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
    }

    // ── Busca primeira supervisão disponível se não informada ─
    let supId = supervisaoId;
    if (!supId) {
      const { data: primeirasSups } = await supabase
        .from('supervisoes')
        .select('id')
        .limit(1)
        .maybeSingle();
      supId = (primeirasSups as any)?.id ?? null;
    }

    const qrCode = generateQRCodeToken();
    const tipoInscricao = 'Equipe de Apoio';
    const observacaoEquipe = `Equipe: ${equipe}`;

    // ── Criar lote simples ────────────────────────────────────
    const { data: lote, error: loteErr } = await supabase
      .from('evento_lotes_inscricao')
      .insert([normalizePayloadUppercase({
        evento_id:            eventoId,
        codigo:               'EQUIPE-' + Date.now().toString(36).toUpperCase(),
        responsavel_nome:     nome,
        valor_total:          0,
        status_pagamento:     'isento',
        desconto_valor:       0,
      })])
      .select('id')
      .single();

    if (loteErr || !lote) {
      console.error('[EQUIPE_RAPIDA] Erro ao criar lote:', loteErr);
      return NextResponse.json(
        { error: 'Erro interno ao criar inscrição de equipe.' },
        { status: 500 }
      );
    }

    // ── Inserir inscrição ─────────────────────────────────────
    const row = normalizePayloadUppercase({
      evento_id:                    eventoId,
      lote_id:                      lote.id,
      nome_inscrito:                nome,
      cpf:                          null,
      email:                        null,
      whatsapp:                     null,
      sexo:                         null,
      data_nascimento:              null,
      supervisao_id:                supId,
      campo_id:                     null,
      hospedagem:                   false,
      alimentacao:                  qtdRefeicoes > 0,
      brinde:                       false,
      tipo_inscricao:               tipoInscricao,
      valor_original:               0,
      cupom_codigo:                 null,
      desconto_valor:               0,
      valor_final:                  0,
      valor_pago:                   0,
      status_pagamento:             'isento',
      forma_pagamento:              'isento',
      refeicoes_total:              qtdRefeicoes,
      refeicoes_utilizadas:         0,
      quantidade_refeicoes_total:   qtdRefeicoes,
      quantidade_refeicoes_usadas:  0,
      quantidade_refeicoes_saldo:   qtdRefeicoes,
      observacoes:                  observacaoEquipe,
      qr_code:                      qrCode,
      operador_id:                  operadorId,
      operador_nome:                dbOperadorNome,
      caixa_sessao_id:              caixaSessaoId,
      origem:                       'equipe_rapida',
      lgpd_aceito:                  true,
      lgpd_aceito_em:               new Date().toISOString(),
    });

    const { data: inscricao, error: insErr } = await supabase
      .from('evento_inscricoes')
      .insert([row])
      .select('id, nome_inscrito, cpf, supervisao_id, campo_id, status_pagamento, hospedagem, alimentacao, brinde, qr_code, checkin_realizado')
      .single();

    if (insErr || !inscricao) {
      console.error('[EQUIPE_RAPIDA] Erro ao inserir inscrição:', insErr);
      return NextResponse.json(
        { error: `Erro ao salvar inscrição de equipe: ${insErr?.message ?? 'desconhecido'}` },
        { status: 500 }
      );
    }

    // ── Auditoria ─────────────────────────────────────────────
    await logDB({
      userEmail: guard.ctx.user?.email ?? dbOperadorNome,
      acao: 'criar',
      modulo: 'eventos',
      entidade: 'evento_inscricoes',
      entidadeId: inscricao.id,
      descricao: `Equipe Rápida: ${nome} — ${equipe}`,
      detalhes: {
        nome,
        equipe,
        tipo_inscricao: tipoInscricao,
        origem: 'equipe_rapida',
        qtd_refeicoes: qtdRefeicoes,
      },
    } as any);

    return NextResponse.json({
      ok: true,
      inscricao: {
        ...inscricao,
        qr_code: qrCode,
      },
      equipe,
      qtd_refeicoes: qtdRefeicoes,
    });

  } catch (err: any) {
    console.error('[EQUIPE_RAPIDA] Erro inesperado:', err);
    return NextResponse.json(
      { error: err?.message ?? 'Erro interno no servidor.' },
      { status: 500 }
    );
  }
}
