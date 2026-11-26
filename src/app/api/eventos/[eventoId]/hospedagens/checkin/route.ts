import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

/**
 * GET /api/eventos/[eventoId]/hospedagens/checkin?q=<inscricao_id_ou_cpf>
 * Busca inscrição para tela operacional de check-in.
 *
 * POST /api/eventos/[eventoId]/hospedagens/checkin
 * Confirma check-in ou checkout.
 * Body: { inscricao_id, acao: 'checkin'|'checkout', operador? }
 */

// ─── GET: busca por UUID, CPF, Nome ou QR Code ──────────────────
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(req, eventoId, 'hospedagem_checkin');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  const q = req.nextUrl.searchParams.get('q')?.trim() ?? '';
  if (!q) return NextResponse.json({ error: 'Parâmetro q obrigatório.' }, { status: 400 });

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
  const cpfNorm = q.replace(/\D/g, '');

  // Busca flexível de inscrições (sem o filtro de hospedagem=true para podermos alertar adequadamente)
  let query = supabase
    .from('evento_inscricoes')
    .select(`
      id, nome_inscrito, cpf, sexo, tipo_inscricao,
      supervisao_id, campo_id, status_pagamento,
      hospedagem, alimentacao,
      evento_hospedagens (
        id, status, alojamento_id, tipo_cama, numero_cama,
        checkin_at, checkout_at, checkin_operador, checkout_operador,
        evento_alojamentos ( nome, publico )
      ),
      evento_hospedagem_leitos (
        numero, tipo_leito, posicao
      )
    `)
    .eq('evento_id', eventoId);

  if (isUuid) {
    query = query.eq('id', q);
  } else if (cpfNorm && cpfNorm.length >= 11) {
    query = query.eq('cpf', cpfNorm);
  } else {
    // Busca flexível: por Nome parcial, QR Code exato, ou CPF parcial se for numérico
    const orParts = [`nome_inscrito.ilike.%${q}%`, `qr_code.eq.${q}`];
    if (cpfNorm) {
      orParts.push(`cpf.eq.${cpfNorm}`);
    }
    query = query.or(orParts.join(','));
  }

  const { data: inscricoes, error: queryError } = await query.limit(30);

  if (queryError) {
    console.error('[HOSPEDAGEM CHECKIN] Erro query:', queryError);
    return NextResponse.json({ error: queryError.message }, { status: 500 });
  }

  if (!inscricoes || inscricoes.length === 0) {
    return NextResponse.json(
      { error: 'Nenhum inscrito encontrado com esse termo.' },
      { status: 404 },
    );
  }

  // Mapeia e normaliza os resultados retornando relações aninhadas
  const results = inscricoes.map((insc: any) => {
    const hospRaw = insc.evento_hospedagens;
    const hospedagem = Array.isArray(hospRaw) ? (hospRaw[0] ?? null) : (hospRaw ?? null);

    const leitoRaw = insc.evento_hospedagem_leitos;
    const leito = Array.isArray(leitoRaw) ? (leitoRaw[0] ?? null) : (leitoRaw ?? null);

    const alojRaw = hospedagem?.evento_alojamentos;
    const alojObj = Array.isArray(alojRaw) ? (alojRaw[0] ?? null) : (alojRaw ?? null);

    return {
      inscricao: {
        id: insc.id,
        nome: insc.nome_inscrito,
        cpf: insc.cpf,
        sexo: insc.sexo,
        categoria: insc.tipo_inscricao,
        supervisao_id: insc.supervisao_id,
        campo_id: insc.campo_id,
        status_pagamento: insc.status_pagamento,
        hospedagem: !!insc.hospedagem,
        alimentacao: insc.alimentacao,
      },
      hospedagem: hospedagem
        ? {
            id: hospedagem.id,
            status: hospedagem.status,
            alojamento_nome: alojObj?.nome ?? null,
            tipo_cama: hospedagem.tipo_cama,
            numero_cama: hospedagem.numero_cama,
            checkin_at: hospedagem.checkin_at,
            checkout_at: hospedagem.checkout_at,
            checkin_operador: hospedagem.checkin_operador,
            checkout_operador: hospedagem.checkout_operador,
          }
        : null,
      leito: leito
        ? {
            numero: leito.numero,
            tipo_leito: leito.tipo_leito,
            posicao: leito.posicao,
          }
        : null,
    };
  });

  return NextResponse.json({ results });
}

// ─── POST: confirma check-in ou checkout ─────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;

  // O requireEventoPermission é executado primeiro. Se o header x-evento-equipe-id estiver presente,
  // a sessão será resolvida imediatamente a partir do header sem ler o body stream, prevenindo conflito de stream.
  const guard = await requireEventoPermission(req, eventoId, 'hospedagem_checkin');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

  const body = await req.json().catch(() => ({}));
  const { inscricao_id, acao, operador } = body as {
    inscricao_id?: string;
    acao?: 'checkin' | 'checkout';
    operador?: string;
    equipe_id?: string;
  };

  if (!inscricao_id || !acao) {
    return NextResponse.json(
      { error: 'inscricao_id e acao são obrigatórios.' },
      { status: 400 },
    );
  }
  if (!['checkin', 'checkout'].includes(acao)) {
    return NextResponse.json({ error: 'acao deve ser checkin ou checkout.' }, { status: 400 });
  }

  // Identificação segura do operador: prioriza sessão autenticada real
  let operadorIdentificado = 'Equipe de Hospedagem';
  if (guard.ctx.user?.email) {
    operadorIdentificado = guard.ctx.user.email;
  } else if (guard.ctx.equipe?.id) {
    // Busca o nome do membro de equipe autenticado na tabela oficial
    const { data: membroEquipe } = await supabase
      .from('evento_equipe')
      .select('nome, email')
      .eq('id', guard.ctx.equipe.id)
      .eq('evento_id', eventoId)
      .maybeSingle();

    operadorIdentificado = membroEquipe?.nome || membroEquipe?.email || operador?.trim() || 'Equipe de Hospedagem';
  } else if (operador?.trim()) {
    operadorIdentificado = operador.trim();
  }

  const { data: hospedagem } = await supabase
    .from('evento_hospedagens')
    .select('id, status, checkin_at, checkout_at, numero_cama, tipo_cama, alojamento_id')
    .eq('evento_id', eventoId)
    .eq('inscricao_id', inscricao_id)
    .maybeSingle();

  if (!hospedagem) {
    return NextResponse.json({ error: 'Hospedagem não encontrada para esta inscrição.' }, { status: 404 });
  }

  const now = new Date().toISOString();
  let updatedRows: any[] | null = null;
  let updateError: any = null;

  if (acao === 'checkin') {
    if (hospedagem.status === 'checkin_realizado') {
      return NextResponse.json({ error: 'Check-in já realizado anteriormente.' }, { status: 409 });
    }
    if (hospedagem.status === 'checkout_realizado') {
      return NextResponse.json({ error: 'Hospedagem já finalizada (saída realizada).' }, { status: 409 });
    }
    if (!hospedagem.numero_cama || !hospedagem.alojamento_id) {
      return NextResponse.json(
        {
          error:
            'Participante não possui cama atribuída. Atribua um leito no mapa de hospedagem antes de realizar o check-in de acomodação.',
          code: 'LEITO_NAO_ATRIBUIDO',
        },
        { status: 422 },
      );
    }
    const update = {
      status: 'checkin_realizado',
      checkin_at: now,
      checkin_operador: operadorIdentificado,
    };
    // Atualização condicional atômica: garante que o status ainda seja diferente de checkin_realizado e checkout_realizado
    const res = await supabase
      .from('evento_hospedagens')
      .update(update)
      .eq('id', hospedagem.id)
      .eq('evento_id', eventoId)
      .neq('status', 'checkin_realizado')
      .neq('status', 'checkout_realizado')
      .select('id, status, checkin_at, checkin_operador, checkout_at, checkout_operador');
    updatedRows = res.data;
    updateError = res.error;
  } else {
    // Checkout: bloqueio rigoroso no servidor caso o checkin não tenha sido feito
    if (hospedagem.status !== 'checkin_realizado' || !hospedagem.checkin_at) {
      return NextResponse.json(
        { error: 'Check-in ainda não realizado. Não é possível registrar saída.' },
        { status: 409 },
      );
    }
    if (hospedagem.status === 'checkout_realizado') {
      return NextResponse.json({ error: 'Check-out já realizado anteriormente.' }, { status: 409 });
    }
    const update = {
      status: 'checkout_realizado',
      checkout_at: now,
      checkout_operador: operadorIdentificado,
    };
    // Atualização condicional atômica: garante que o status no banco ainda seja checkin_realizado e checkout_at seja nulo
    const res = await supabase
      .from('evento_hospedagens')
      .update(update)
      .eq('id', hospedagem.id)
      .eq('evento_id', eventoId)
      .eq('status', 'checkin_realizado')
      .is('checkout_at', null)
      .select('id, status, checkin_at, checkin_operador, checkout_at, checkout_operador');
    updatedRows = res.data;
    updateError = res.error;
  }

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  // Proteção contra concorrência: se nenhuma linha foi afetada, outro operador processou simultaneamente
  if (!updatedRows || updatedRows.length === 0) {
    return NextResponse.json(
      {
        error:
          acao === 'checkin'
            ? 'A entrada já foi processada por outro operador concorrentemente.'
            : 'A saída já foi processada ou a entrada foi modificada por outro operador.',
      },
      { status: 409 },
    );
  }

  const rowFinal = updatedRows[0];

  // Registro de Auditoria no banco de dados
  void logDB({
    userId: guard.ctx.user?.id,
    userEmail: guard.ctx.user?.email,
    acao: acao === 'checkin' ? 'checkin_hospedagem' : 'checkout_hospedagem',
    modulo: 'eventos',
    entidade: 'evento_hospedagens',
    entidadeId: hospedagem.id,
    descricao: `[Hospedagem] ${acao === 'checkin' ? 'Entrada' : 'Saída'} registrada para o leito ${hospedagem.numero_cama || 'S/N'}`,
    detalhes: {
      evento_id: eventoId,
      inscricao_id,
      acao,
      operador: operadorIdentificado,
      timestamp: now,
      alojamento_id: hospedagem.alojamento_id,
      numero_cama: hospedagem.numero_cama,
    },
  });

  return NextResponse.json({
    ok: true,
    dados: {
      status: rowFinal.status,
      checkin_at: rowFinal.checkin_at,
      checkin_operador: rowFinal.checkin_operador,
      checkout_at: rowFinal.checkout_at,
      checkout_operador: rowFinal.checkout_operador,
    },
  });
}
