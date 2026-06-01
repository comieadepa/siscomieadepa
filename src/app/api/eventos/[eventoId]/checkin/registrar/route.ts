import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireEventoPermission } from '@/lib/evento-guard';

type EventoRow = {
  id: string;
  status: 'programado' | 'realizado' | 'cancelado';
  checkin_ativo: boolean | null;
};

type InscricaoRow = {
  id: string;
  evento_id: string;
  nome_inscrito: string;
  cpf: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
  status_pagamento: string;
  checkin_realizado: boolean;
  checkin_at: string | null;
  qr_code: string | null;
  refeicoes_total: number;
  refeicoes_utilizadas: number;
};

type TipoCheckin = 'credenciamento' | 'plenaria' | 'refeitorio';

const SELECT_INSC = [
  'id', 'evento_id', 'nome_inscrito', 'cpf',
  'supervisao_id', 'campo_id', 'status_pagamento',
  'checkin_realizado', 'checkin_at', 'qr_code',
  'refeicoes_total', 'refeicoes_utilizadas',
].join(',');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  let body: {
    qr?: string;
    equipe_id?: string;
    tipo_checkin?: TipoCheckin;
    data_plenaria?: string;
    checkin_user?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const qrToken      = String(body.qr || '').trim();
  const tipoCheckin: TipoCheckin = (['credenciamento', 'plenaria', 'refeitorio'].includes(body.tipo_checkin as string)
    ? body.tipo_checkin as TipoCheckin
    : 'credenciamento');
  const dataPlenaria = body.data_plenaria ?? new Date().toISOString().slice(0, 10);
  const checkinUser  = body.checkin_user ?? null;

  if (!qrToken) return NextResponse.json({ error: 'QR obrigatorio.' }, { status: 400 });

  const supabase = createServerClient();

  const guard = await requireEventoPermission(request, eventoId, 'checkin');
  if (!guard.ok) return guard.response;

  // ── Valida evento ────────────────────────────────────────
  const { data: evento } = await supabase
    .from('eventos')
    .select('id,status,checkin_ativo')
    .eq('id', eventoId)
    .single();
  if (!evento) return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  const evRow = evento as EventoRow;
  if (evRow.status !== 'programado')
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  if (evRow.checkin_ativo !== true)
    return NextResponse.json({ error: 'Check-in desativado.' }, { status: 403 });

  // ── Busca inscricao ──────────────────────────────────────
  const { data: inscricao } = await supabase
    .from('evento_inscricoes')
    .select(SELECT_INSC)
    .eq('evento_id', eventoId)
    .or(`qr_code.eq.${qrToken},id.eq.${qrToken}`)
    .maybeSingle();

  if (!inscricao) {
    const { data: outra } = await supabase
      .from('evento_inscricoes')
      .select(SELECT_INSC)
      .or(`qr_code.eq.${qrToken},id.eq.${qrToken}`)
      .maybeSingle();
    if (outra) return NextResponse.json({ status: 'wrong_event', inscricao: outra }, { status: 200 });
    return NextResponse.json({ status: 'invalid' }, { status: 200 });
  }

  const ins = inscricao as unknown as InscricaoRow;

  // ── MODO CREDENCIAMENTO ──────────────────────────────────
  if (tipoCheckin === 'credenciamento') {
    if (ins.checkin_realizado) {
      return NextResponse.json({ status: 'already', inscricao: ins }, { status: 200 });
    }
    const now = new Date().toISOString();
    const { error: updError } = await supabase
      .from('evento_inscricoes')
      .update({ checkin_realizado: true, checkin_at: now })
      .eq('id', ins.id);
    if (updError) return NextResponse.json({ error: 'Erro ao registrar check-in.' }, { status: 500 });
    await supabase.from('evento_checkins').insert([{
      evento_id: eventoId, inscricao_id: ins.id,
      metodo: 'qrcode', tipo_checkin: 'credenciamento', checkin_user: checkinUser,
    }]);
    return NextResponse.json({ status: 'success', inscricao: { ...ins, checkin_realizado: true, checkin_at: now } });
  }

  // ── MODO PLENARIA ────────────────────────────────────────
  if (tipoCheckin === 'plenaria') {
    const { data: jaPresente } = await supabase
      .from('evento_checkins')
      .select('id')
      .eq('inscricao_id', ins.id)
      .eq('tipo_checkin', 'plenaria')
      .eq('data_plenaria', dataPlenaria)
      .maybeSingle();

    if (jaPresente) {
      return NextResponse.json({ status: 'already_plenaria', inscricao: ins, data_plenaria: dataPlenaria }, { status: 200 });
    }

    const { error: insErr } = await supabase.from('evento_checkins').insert([{
      evento_id: eventoId, inscricao_id: ins.id,
      metodo: 'qrcode', tipo_checkin: 'plenaria',
      data_plenaria: dataPlenaria, checkin_user: checkinUser,
    }]);
    if (insErr) return NextResponse.json({ error: 'Erro ao registrar presenca.' }, { status: 500 });
    return NextResponse.json({ status: 'success', inscricao: ins, data_plenaria: dataPlenaria });
  }

  // ── MODO REFEITORIO ──────────────────────────────────────
  if (tipoCheckin === 'refeitorio') {
    const total      = ins.refeicoes_total ?? 0;
    const utilizadas = ins.refeicoes_utilizadas ?? 0;

    // total = 0 -> nao configurado -> permite sem debitar saldo
    if (total === 0) {
      await supabase.from('evento_checkins').insert([{
        evento_id: eventoId, inscricao_id: ins.id,
        metodo: 'qrcode', tipo_checkin: 'refeitorio',
        saldo_antes: null, saldo_depois: null,
        observacao: 'Refeicoes nao configuradas',
        checkin_user: checkinUser,
      }]);
      return NextResponse.json({ status: 'success', inscricao: ins, saldo_antes: null, saldo_depois: null, nao_configurado: true });
    }

    const saldoAtual = total - utilizadas;
    if (saldoAtual <= 0) {
      return NextResponse.json({ status: 'sem_saldo', inscricao: ins, saldo_antes: 0, saldo_depois: 0 }, { status: 200 });
    }

    const { data: updatedInsc, error: updErr } = await supabase
      .from('evento_inscricoes')
      .update({ refeicoes_utilizadas: utilizadas + 1 })
      .eq('id', ins.id)
      .select('id,refeicoes_total,refeicoes_utilizadas')
      .single();

    if (updErr || !updatedInsc)
      return NextResponse.json({ error: 'Erro ao debitar refeicao.' }, { status: 500 });

    const saldoDepois = (updatedInsc.refeicoes_total ?? total) - (updatedInsc.refeicoes_utilizadas ?? utilizadas + 1);

    await supabase.from('evento_checkins').insert([{
      evento_id: eventoId, inscricao_id: ins.id,
      metodo: 'qrcode', tipo_checkin: 'refeitorio',
      saldo_antes: saldoAtual, saldo_depois: saldoDepois,
      checkin_user: checkinUser,
    }]);

    return NextResponse.json({
      status: 'success',
      inscricao: { ...ins, refeicoes_utilizadas: utilizadas + 1 },
      saldo_antes: saldoAtual,
      saldo_depois: saldoDepois,
    });
  }

  return NextResponse.json({ error: 'Modo invalido.' }, { status: 400 });
}
