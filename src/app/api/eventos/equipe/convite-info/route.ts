import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

type EquipeRow = {
  id: string;
  evento_id: string;
  email: string;
  tipo: 'admin' | 'checkin';
  ativo: boolean;
  convite_expira_em: string | null;
};

type EventoRow = {
  id: string;
  nome: string;
  status: 'programado' | 'realizado' | 'cancelado';
};

// GET /api/eventos/equipe/convite-info?token=...
// Valida o token de convite SEM consumi-lo; retorna info do convite para exibição.
export async function GET(request: NextRequest) {
  const token = decodeURIComponent(request.nextUrl.searchParams.get('token') || '').trim();
  if (!token) {
    return NextResponse.json({ error: 'Token obrigatorio.' }, { status: 400 });
  }

  const supabase = createServerClient();

  const { data: equipe, error: equipeError } = await supabase
    .from('evento_equipe')
    .select('id,evento_id,email,tipo,ativo,convite_expira_em')
    .eq('convite_token', token)
    .maybeSingle();

  if (equipeError) {
    console.error('[convite-info] Erro ao buscar token:', equipeError.message, equipeError.code);
    if (equipeError.code === 'PGRST204') {
      return NextResponse.json({ error: 'Configuracao do banco desatualizada.' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Erro interno ao validar convite.' }, { status: 500 });
  }

  if (!equipe) {
    return NextResponse.json({ error: 'Token invalido ou ja utilizado.' }, { status: 404 });
  }

  const row = equipe as EquipeRow;

  if (!row.ativo) {
    return NextResponse.json({ error: 'Convite revogado.' }, { status: 403 });
  }

  if (row.convite_expira_em && new Date(row.convite_expira_em).getTime() < Date.now()) {
    return NextResponse.json({ error: 'Convite expirado.' }, { status: 403 });
  }

  const { data: evento } = await supabase
    .from('eventos')
    .select('id,nome,status')
    .eq('id', row.evento_id)
    .single();

  if (!evento) {
    return NextResponse.json({ error: 'Evento nao encontrado.' }, { status: 404 });
  }

  if ((evento as EventoRow).status !== 'programado') {
    return NextResponse.json({ error: 'Evento encerrado ou cancelado.' }, { status: 403 });
  }

  return NextResponse.json({
    email: row.email,
    eventoId: row.evento_id,
    eventoNome: (evento as EventoRow).nome,
    tipo: row.tipo,
  });
}
