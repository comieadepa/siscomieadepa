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

// ─── GET: busca por UUID ou CPF ──────────────────────────────
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

  // Busca por QR code, inscricao_id ou CPF
  let query = supabase
    .from('evento_inscricoes')
    .select(`
      id, nome_inscrito, cpf, sexo, tipo_inscricao,
      supervisao_id, campo_id, status_pagamento,
      hosp_necessidade_especial, hosp_cama_inferior
    `)
    .eq('evento_id', eventoId)
    .eq('hospedagem', true);

  if (isUuid) {
    query = query.eq('id', q);
  } else if (cpfNorm.length >= 6) {
    query = query.eq('cpf', cpfNorm);
  } else {
    // Busca por qr_code (token)
    query = query.eq('qr_code', q);
  }

  const { data: inscricoes } = await query.limit(1);

  if (!inscricoes?.length) {
    return NextResponse.json(
      { error: 'Inscrição não encontrada ou não solicitou hospedagem.' },
      { status: 404 },
    );
  }

  const insc = inscricoes[0];

  // Busca hospedagem
  const { data: hospedagem } = await supabase
    .from('evento_hospedagens')
    .select(`
      id, status, alojamento_id, tipo_cama, numero_cama,
      checkin_at, checkout_at, checkin_operador, checkout_operador,
      evento_alojamentos ( nome, publico )
    `)
    .eq('evento_id', eventoId)
    .eq('inscricao_id', insc.id)
    .maybeSingle();

  // Busca leito individual
  const { data: leito } = await supabase
    .from('evento_hospedagem_leitos')
    .select('numero, tipo_leito, posicao')
    .eq('evento_id', eventoId)
    .eq('inscricao_id', insc.id)
    .maybeSingle();

  const alojRaw = hospedagem?.evento_alojamentos;
  const alojObj = (Array.isArray(alojRaw) ? (alojRaw[0] ?? null) : (alojRaw ?? null)) as { nome: string; publico: string } | null;

  return NextResponse.json({
    inscricao: {
      id:            insc.id,
      nome:          insc.nome_inscrito,
      cpf:           insc.cpf,
      sexo:          insc.sexo,
      categoria:     insc.tipo_inscricao,
      supervisao_id: insc.supervisao_id,
      campo_id:      insc.campo_id,
      status_pagamento: insc.status_pagamento,
    },
    hospedagem: hospedagem
      ? {
          id:               hospedagem.id,
          status:           hospedagem.status,
          alojamento_nome:  alojObj?.nome ?? null,
          tipo_cama:        hospedagem.tipo_cama,
          numero_cama:      hospedagem.numero_cama,
          checkin_at:       hospedagem.checkin_at,
          checkout_at:      hospedagem.checkout_at,
          checkin_operador: hospedagem.checkin_operador,
          checkout_operador: hospedagem.checkout_operador,
        }
      : null,
    leito: leito
      ? {
          numero:     leito.numero,
          tipo_leito: leito.tipo_leito,
          posicao:    leito.posicao,
        }
      : null,
  });
}

// ─── POST: confirma check-in ou checkout ─────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;

  const body = await req.json().catch(() => ({}));
  const { inscricao_id, acao, operador } = body as {
    inscricao_id?: string;
    acao?: 'checkin' | 'checkout';
    operador?: string;
    equipe_id?: string;
  };

  const guard = await requireEventoPermission(req, eventoId, 'hospedagem_checkin');
  if (!guard.ok) return guard.response;
  const supabase = guard.ctx.supabaseAdmin;

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
    return NextResponse.json({ error: 'Hospedagem não encontrada.' }, { status: 404 });
  }

  const now = new Date().toISOString();
  let update: Record<string, unknown>;

  if (acao === 'checkin') {
    if (hospedagem.status === 'checkin_realizado') {
      return NextResponse.json({ error: 'Check-in já realizado anteriormente.' }, { status: 409 });
    }
    update = {
      status:           'checkin_realizado',
      checkin_at:       now,
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
      status:            'checkout_realizado',
      checkout_at:       now,
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
