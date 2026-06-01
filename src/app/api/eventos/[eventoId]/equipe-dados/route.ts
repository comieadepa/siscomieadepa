/**
 * GET /api/eventos/[eventoId]/equipe-dados
 *
 * Endpoint para usuários de equipe (sem conta Supabase) buscarem
 * dados do evento e inscrições. Autentica via equipeId (UUID ativo
 * em evento_equipe) em vez de sessão Supabase.
 *
 * Query params:
 *   equipeId  — UUID do registro em evento_equipe
 *   tipo      — 'evento' | 'inscricoes'  (default: 'evento')
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const { searchParams } = new URL(request.url);
  const equipeId = (searchParams.get('equipeId') || '').trim();
  const tipo     = (searchParams.get('tipo')     || 'evento').trim();

  if (!equipeId) {
    return NextResponse.json({ error: 'equipeId obrigatorio.' }, { status: 400 });
  }

  const supabase = createServerClient();

  // Valida que equipeId é ativo para este evento
  const { data: equipe } = await supabase
    .from('evento_equipe')
    .select('id, evento_id, ativo, tipo')
    .eq('id', equipeId)
    .eq('evento_id', eventoId)
    .eq('ativo', true)
    .maybeSingle();

  if (!equipe) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const tipoEquipe = (equipe as { tipo?: string | null }).tipo ?? null;

  if (tipo === 'evento') {
    const { data: evento, error } = await supabase
      .from('eventos')
      .select('*')
      .eq('id', eventoId)
      .single();

    if (error || !evento) {
      return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
    }

    if ((evento as { status?: string | null }).status !== 'programado') {
      return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
    }

    return NextResponse.json({ evento });
  }

  if (tipo === 'inscricoes') {
    if (tipoEquipe === 'checkin' || tipoEquipe === 'checkin_hospedagem' || tipoEquipe === 'hospedagem') {
      return NextResponse.json({ error: 'Acesso não autorizado para esta função.' }, { status: 403 });
    }

    const { data: evento } = await supabase
      .from('eventos')
      .select('id,status')
      .eq('id', eventoId)
      .single();

    if (!evento) {
      return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
    }

    if ((evento as { status?: string | null }).status !== 'programado') {
      return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
    }

    const { data: inscricoes } = await supabase
      .from('evento_inscricoes')
      .select('*')
      .eq('evento_id', eventoId)
      .order('created_at', { ascending: false });

    return NextResponse.json({ inscricoes: inscricoes || [] });
  }

  return NextResponse.json({ error: 'tipo invalido. Use: evento | inscricoes' }, { status: 400 });
}
