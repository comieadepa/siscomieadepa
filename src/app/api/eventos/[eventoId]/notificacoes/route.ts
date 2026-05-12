import { NextRequest, NextResponse } from 'next/server';
import { requireEventoAccess } from '@/lib/evento-guard';

// GET /api/eventos/[eventoId]/notificacoes
// Lista a fila de notificações de um evento (paginada, filtrada)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const { searchParams } = new URL(request.url);

  const guard = await requireEventoAccess(request, eventoId);
  if (!guard.ok) return guard.response;
  if (!guard.ctx.perms.podeComunicacao) {
    return NextResponse.json({ error: 'Acesso negado.' }, { status: 403 });
  }

  const status     = searchParams.get('status');      // pendente|enviado|erro
  const tipo       = searchParams.get('tipo');         // email|whatsapp
  const gatilho    = searchParams.get('gatilho');
  const page       = parseInt(searchParams.get('page') ?? '1');
  const perPage    = Math.min(parseInt(searchParams.get('per_page') ?? '50'), 100);
  const offset     = (page - 1) * perPage;

  const supabase = guard.ctx.supabaseAdmin;

  let query = supabase
    .from('evento_notificacoes')
    .select(`
      id, tipo, status, gatilho, assunto, mensagem, erro, enviado_em, created_at,
      inscricao_id,
      evento_inscricoes!inner ( nome_inscrito, email, whatsapp )
    `, { count: 'exact' })
    .eq('evento_id', eventoId)
    .order('created_at', { ascending: false })
    .range(offset, offset + perPage - 1);

  if (status)  query = query.eq('status',  status);
  if (tipo)    query = query.eq('tipo',    tipo);
  if (gatilho) query = query.eq('gatilho', gatilho);

  const { data, error, count } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    notificacoes: data,
    total:  count ?? 0,
    page,
    pages:  Math.ceil((count ?? 0) / perPage),
  });
}
