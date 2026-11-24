import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;

  let guard = await requireEventoPermission(request, eventoId, 'equipe');
  let isHospedagemOnly = false;
  if (!guard.ok) {
    const hospGuard = await requireEventoPermission(request, eventoId, 'hospedagem');
    if (hospGuard.ok) {
      guard = hospGuard;
      isHospedagemOnly = true;
    } else {
      return guard.response;
    }
  }

  let body: { equipe_id?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body invalido.' }, { status: 400 });
  }

  const equipeId = (body.equipe_id || '').trim();
  if (!equipeId) {
    return NextResponse.json({ error: 'equipe_id obrigatorio.' }, { status: 400 });
  }

  const supabase = guard.ctx.supabaseAdmin;

  if (isHospedagemOnly) {
    const { data: membro } = await supabase
      .from('evento_equipe')
      .select('id,tipo')
      .eq('id', equipeId)
      .eq('evento_id', eventoId)
      .single();

    if (!membro) {
      return NextResponse.json({ error: 'Membro não encontrado.' }, { status: 404 });
    }
    if (membro.tipo !== 'checkin_hospedagem') {
      return NextResponse.json(
        { error: 'Admin de Hospedagem só pode revogar acesso de integrantes de Check-in de Hospedagem.' },
        { status: 403 }
      );
    }
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from('evento_equipe')
    .update({
      ativo: false,
      atualizado_em: now,
    })
    .eq('id', equipeId)
    .eq('evento_id', eventoId);

  if (error) {
    return NextResponse.json({ error: 'Erro ao revogar acesso.' }, { status: 500 });
  }

  void logDB({
    acao: 'desativar_membro_equipe',
    modulo: 'eventos',
    entidade: 'evento_equipe',
    descricao: 'Membro de equipe desativado pelo painel (rota revogar).',
    status: 'sucesso',
    detalhes: { eventoId, equipeId },
    request,
  });

  return NextResponse.json({ ok: true });
}
