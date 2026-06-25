import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

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

  const { data: hospedagem } = await supabase
    .from('evento_hospedagens')
    .select('id, status')
    .eq('evento_id', eventoId)
    .eq('inscricao_id', inscricao_id)
    .maybeSingle();

  if (!hospedagem) {
    return NextResponse.json({ error: 'Hospedagem não encontrada para esta inscrição.' }, { status: 404 });
  }

  const now = new Date().toISOString();
  let update: Record<string, unknown>;

  if (acao === 'checkin') {
    if (hospedagem.status === 'checkin_realizado') {
      return NextResponse.json({ error: 'Check-in já realizado anteriormente.' }, { status: 409 });
    }
    update = {
      status: 'checkin_realizado',
      checkin_at: now,
      checkin_operador: operador ?? null,
    };
  } else {
    if (hospedagem.status !== 'checkin_realizado') {
      return NextResponse.json(
        { error: 'Check-in ainda não realizado. Não é possível registrar saída.' },
        { status: 409 },
      );
    }
    update = {
      status: 'checkout_realizado',
      checkout_at: now,
      checkout_operador: operador ?? null,
    };
  }

  const { error } = await supabase
    .from('evento_hospedagens')
    .update(update)
    .eq('id', hospedagem.id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
