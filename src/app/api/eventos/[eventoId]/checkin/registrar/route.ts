import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireEventoAccess } from '@/lib/evento-guard';

type EventoRow = {
  id: string;
  status: 'programado' | 'realizado' | 'cancelado';
  checkin_ativo: boolean | null;
};

type EquipeRow = {
  id: string;
  evento_id: string;
  tipo: 'operador' | 'checkin';
  ativo: boolean;
  convite_expira_em?: string | null;
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
};

const SELECT_INSC = 'id,evento_id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,checkin_realizado,checkin_at,qr_code';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  let body: { qr?: string; equipe_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const qrToken = String(body.qr || '').trim();
  const equipeId = String(body.equipe_id || '').trim();
  if (!qrToken) {
    return NextResponse.json({ error: 'QR obrigatorio.' }, { status: 400 });
  }

  const supabase = createServerClient();

  if (!equipeId) {
    const guard = await requireEventoAccess(request, eventoId);
    if (!guard.ok) return guard.response;
  } else {
    const { data: equipe } = await supabase
      .from('evento_equipe')
      .select('id,evento_id,tipo,ativo,convite_expira_em')
      .eq('id', equipeId)
      .eq('evento_id', eventoId)
      .single();

    if (!equipe) {
      return NextResponse.json({ error: 'Equipe nao encontrada.' }, { status: 404 });
    }

    const equipeRow = equipe as EquipeRow;
    if (!equipeRow.ativo) {
      return NextResponse.json({ error: 'Acesso encerrado.' }, { status: 403 });
    }
    if (equipeRow.tipo !== 'checkin') {
      return NextResponse.json({ error: 'Tipo nao autorizado.' }, { status: 403 });
    }
    if (equipeRow.convite_expira_em && new Date(equipeRow.convite_expira_em) < new Date()) {
      return NextResponse.json({ error: 'Codigo expirado.' }, { status: 403 });
    }
  }

  const { data: evento } = await supabase
    .from('eventos')
    .select('id,status,checkin_ativo')
    .eq('id', eventoId)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  }

  const evRow = evento as EventoRow;
  if (evRow.status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }
  if (evRow.checkin_ativo !== true) {
    return NextResponse.json({ error: 'Check-in desativado.' }, { status: 403 });
  }

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

    if (outra) {
      return NextResponse.json({ status: 'wrong_event', inscricao: outra }, { status: 200 });
    }

    return NextResponse.json({ status: 'invalid' }, { status: 200 });
  }

  const inscRow = inscricao as InscricaoRow;
  if (inscRow.checkin_realizado) {
    return NextResponse.json({ status: 'already', inscricao: inscRow }, { status: 200 });
  }

  const now = new Date().toISOString();
  const { error: updError } = await supabase
    .from('evento_inscricoes')
    .update({ checkin_realizado: true, checkin_at: now })
    .eq('id', inscRow.id);

  if (updError) {
    return NextResponse.json({ error: 'Erro ao registrar check-in.' }, { status: 500 });
  }

  await supabase
    .from('evento_checkins')
    .insert([{ evento_id: eventoId, inscricao_id: inscRow.id, metodo: 'qrcode' }]);

  return NextResponse.json({
    status: 'success',
    inscricao: { ...inscRow, checkin_realizado: true, checkin_at: now },
  });
}
