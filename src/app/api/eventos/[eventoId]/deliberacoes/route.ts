import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';
import { logDB } from '@/lib/audit';
import { normalizePayloadUppercase } from '@/lib/text';

export const dynamic = 'force-dynamic';

const TIPOS_VALIDOS = [
  'consagracao', 'ordenacao', 'separacao_ministerio', 'recebimento',
  'transferencia', 'jubilacao', 'mudanca_cargo', 'aprovacao_candidato',
  'exclusao', 'observacao_geral',
] as const;

// GET /api/eventos/[eventoId]/deliberacoes
// Query params: tipo, status, campo, supervisao
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'centro_controle');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;
  const { searchParams } = new URL(request.url);
  const tipo       = searchParams.get('tipo') ?? '';
  const status     = searchParams.get('status') ?? '';
  const campo      = searchParams.get('campo') ?? '';
  const supervisao = searchParams.get('supervisao') ?? '';

  let q = supabase
    .from('evento_ago_deliberacoes')
    .select('*')
    .eq('evento_id', eventoId)
    .order('created_at', { ascending: false });

  if (tipo)       q = q.eq('tipo', tipo);
  if (status)     q = q.eq('status', status);
  if (campo)      q = q.ilike('ministro_campo', `%${campo}%`);
  if (supervisao) q = q.ilike('ministro_supervisao', `%${supervisao}%`);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const records = data ?? [];
  const stats = {
    total:    records.length,
    rascunho: records.filter(r => r.status === 'rascunho').length,
    aprovado: records.filter(r => r.status === 'aprovado').length,
    aplicado: records.filter(r => r.status === 'aplicado').length,
  };

  return NextResponse.json({ records, stats });
}

// POST /api/eventos/[eventoId]/deliberacoes
// Cria nova deliberação (status='rascunho')
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'centro_controle');
  if (!guard.ok) return guard.response;

  const supabase  = guard.ctx.supabaseAdmin;
  const userId    = guard.ctx.user?.id;
  const userMeta  = (guard.ctx.user?.user_metadata ?? {}) as Record<string, unknown>;
  const userName  = (userMeta?.nome as string | undefined) || (guard.ctx.user?.email ?? 'Admin');

  // Valida evento AGO
  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nome, departamento')
    .eq('id', eventoId)
    .single();

  if (!evento || evento.departamento !== 'AGO')
    return NextResponse.json({ error: 'Apenas eventos AGO suportam deliberações.' }, { status: 400 });

  const raw = await request.json() as Record<string, unknown>;

  const {
    ministro_id,
    ministro_nome,
    ministro_matricula,
    ministro_campo,
    ministro_supervisao,
    tipo,
    data_deliberacao,
    situacao_anterior,
    situacao_nova,
    observacao,
    numero_ata,
  } = raw;

  if (!ministro_nome || typeof ministro_nome !== 'string' || !ministro_nome.trim())
    return NextResponse.json({ error: 'Nome do ministro é obrigatório.' }, { status: 400 });
  if (!tipo || !TIPOS_VALIDOS.includes(tipo as typeof TIPOS_VALIDOS[number]))
    return NextResponse.json({ error: 'Tipo inválido.' }, { status: 400 });

  const normalized = normalizePayloadUppercase({
    ministro_nome: String(ministro_nome).trim(),
    ministro_campo: ministro_campo ? String(ministro_campo).trim() : null,
    ministro_supervisao: ministro_supervisao ? String(ministro_supervisao).trim() : null,
    situacao_anterior: situacao_anterior ? String(situacao_anterior).trim() : null,
    situacao_nova: situacao_nova ? String(situacao_nova).trim() : null,
  });

  const { data: inserted, error } = await supabase
    .from('evento_ago_deliberacoes')
    .insert({
      evento_id:           eventoId,
      ministro_id:         ministro_id ? String(ministro_id) : null,
      ministro_nome:       normalized.ministro_nome,
      ministro_matricula:  ministro_matricula ? String(ministro_matricula).trim() : null,
      ministro_campo:      normalized.ministro_campo,
      ministro_supervisao: normalized.ministro_supervisao,
      tipo,
      data_deliberacao:    data_deliberacao ? String(data_deliberacao) : null,
      situacao_anterior:   normalized.situacao_anterior,
      situacao_nova:       normalized.situacao_nova,
      observacao:          observacao ? String(observacao).trim() : null,
      numero_ata:          numero_ata ? String(numero_ata).trim() : null,
      status:              'rascunho',
      created_by_id:       userId,
      created_by_nome:     userName,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  void logDB({
    userId,
    acao: 'criar_deliberacao_ago',
    modulo: 'eventos',
    entidade: 'evento_ago_deliberacoes',
    entidadeId: inserted.id,
    status: 'sucesso',
    descricao: `Deliberação ${tipo} criada para ${normalized.ministro_nome} (${evento.nome}).`,
    request,
  });

  return NextResponse.json({ ok: true, record: inserted }, { status: 201 });
}
