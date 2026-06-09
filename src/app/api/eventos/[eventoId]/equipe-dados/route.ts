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

  if (tipo === 'evento') {
    const { data: evento, error } = await supabase
      .from('eventos')
      .select('*')
      .eq('id', eventoId)
      .single();

    if (error || !evento) {
      return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
    }

    return NextResponse.json({ evento });
  }

  if (tipo === 'inscricoes') {
    let allInsc = [];
    let page = 0;
    const limit = 1000;
    while (true) {
      const { data: chunk, error } = await supabase
        .from('evento_inscricoes')
        .select('*')
        .eq('evento_id', eventoId)
        .order('created_at', { ascending: false })
        .range(page * limit, (page + 1) * limit - 1);

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      if (!chunk || chunk.length === 0) break;
      allInsc.push(...chunk);
      if (chunk.length < limit) break;
      page++;
    }

    return NextResponse.json({ inscricoes: allInsc });
  }

  return NextResponse.json({ error: 'tipo invalido. Use: evento | inscricoes' }, { status: 400 });
}
