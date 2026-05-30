import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';

/**
 * POST /api/eventos/[eventoId]/hospedagens/realocar
 * Move participante para outro alojamento/leito.
 * Body: { hospedagem_id, novo_alojamento_id, novo_tipo_cama?, novo_numero_cama?, motivo?, operador? }
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) {
  const { eventoId } = await params;
  const guard = await requireEventoAccess(req, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeHospedagem) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }
  const supabase = guard.ctx.supabaseAdmin;

  const body = await req.json().catch(() => ({}));
  const {
    hospedagem_id,
    novo_alojamento_id,
    novo_tipo_cama,
    novo_numero_cama,
    motivo,
    operador,
  } = body as {
    hospedagem_id?: string;
    novo_alojamento_id?: string;
    novo_tipo_cama?: string;
    novo_numero_cama?: string;
    motivo?: string;
    operador?: string;
  };

  if (!hospedagem_id || !novo_alojamento_id) {
    return NextResponse.json(
      { error: 'hospedagem_id e novo_alojamento_id são obrigatórios.' },
      { status: 400 },
    );
  }

  // Busca hospedagem atual
  const { data: hospedagem } = await supabase
    .from('evento_hospedagens')
    .select('id, inscricao_id, alojamento_id, tipo_cama, numero_cama, status')
    .eq('id', hospedagem_id)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (!hospedagem) {
    return NextResponse.json({ error: 'Hospedagem não encontrada.' }, { status: 404 });
  }

  // Verifica alojamento destino e vagas
  const { data: aloj } = await supabase
    .from('evento_alojamentos')
    .select('total_vagas, camas_inferiores')
    .eq('id', novo_alojamento_id)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (!aloj) {
    return NextResponse.json({ error: 'Alojamento destino não encontrado.' }, { status: 404 });
  }

  const { count: ocupTotal } = await supabase
    .from('evento_hospedagens')
    .select('id', { count: 'exact', head: true })
    .eq('alojamento_id', novo_alojamento_id)
    .in('status', ['confirmada', 'checkin_realizado', 'checkout_realizado'])
    .neq('id', hospedagem_id);

  if ((ocupTotal ?? 0) >= aloj.total_vagas) {
    return NextResponse.json(
      { error: 'Alojamento destino sem vagas disponíveis.' },
      { status: 409 },
    );
  }

  // 1. Libera leito antigo
  if (hospedagem.alojamento_id) {
    await supabase
      .from('evento_hospedagem_leitos')
      .update({ ocupado: false, inscricao_id: null })
      .eq('evento_id', eventoId)
      .eq('inscricao_id', hospedagem.inscricao_id);
  }

  // 2. Calcula número sequencial no novo alojamento
  const { data: leitosExist } = await supabase
    .from('evento_hospedagem_leitos')
    .select('numero')
    .eq('evento_id', eventoId)
    .eq('alojamento_id', novo_alojamento_id);

  const maxNum = Math.max(0, ...((leitosExist ?? []).map(l => parseInt(l.numero) || 0)));
  const novoNumero = novo_numero_cama?.trim() || String(maxNum + 1);
  const posicao: 'inferior' | 'superior' | 'unico' =
    novo_tipo_cama === 'inferior' ? 'inferior'
    : novo_tipo_cama === 'superior' ? 'superior'
    : 'unico';

  // 3. Cria novo leito no alojamento destino
  await supabase
    .from('evento_hospedagem_leitos')
    .upsert(
      [{
        evento_id:     eventoId,
        alojamento_id: novo_alojamento_id,
        inscricao_id:  hospedagem.inscricao_id,
        numero:        novoNumero,
        tipo_leito:    'beliche',
        posicao,
        ocupado:       true,
      }],
      { onConflict: 'inscricao_id' },
    );

  // 4. Atualiza hospedagem
  const { error } = await supabase
    .from('evento_hospedagens')
    .update({
      alojamento_id:       novo_alojamento_id,
      tipo_cama:           novo_tipo_cama    || null,
      numero_cama:         novoNumero,
      alocacao_automatica: false,
    })
    .eq('id', hospedagem_id)
    .eq('evento_id', eventoId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // 5. Registra ocorrência de realocação (best-effort)
  await supabase
    .from('evento_hospedagem_ocorrencias')
    .insert({
      evento_id:    eventoId,
      hospedagem_id,
      inscricao_id: hospedagem.inscricao_id,
      tipo:         'mudanca_alojamento',
      descricao:    motivo?.trim() || null,
      operador:     operador?.trim() || null,
    });

  return NextResponse.json({ ok: true, novo_numero_leito: novoNumero });
}
