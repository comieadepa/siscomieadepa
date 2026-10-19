import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';

export interface EventoLocalCheckinRow {
  id: string;
  evento_id: string;
  tipo: 'plenaria' | 'refeitorio';
  nome: string;
  descricao: string | null;
  ativo: boolean;
  ordem: number;
  created_at: string;
  updated_at: string;
}

// ─── Helpers de Autenticação e Autorização Segura ────────────────────────────

async function resolveAuthUser(request: NextRequest) {
  // 1. Tentar ler sessão via cookies (@supabase/ssr padrão)
  try {
    const userClient = await createServerClientFromCookies();
    const { data: { user } } = await userClient.auth.getUser();
    if (user) return user;
  } catch {
    // Falha silenciosa nos cookies, tenta via Bearer token
  }

  // 2. Tentar ler via cabeçalho Authorization: Bearer
  const authHeader = request.headers.get('Authorization') || request.headers.get('authorization') || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (token) {
    const admin = createServerClient();
    const { data: { user } } = await admin.auth.getUser(token);
    if (user) return user;
  }

  return null;
}

async function verifyEventoAdmin(user: any, eventoId: string): Promise<{ isAdmin: boolean; isGlobal: boolean }> {
  const admin = createServerClient();

  // 1. Validar no banco se é Administrador Global ativo (public.users)
  const { data: dbUser } = await admin
    .from('users')
    .select('role, is_active')
    .eq('id', user.id)
    .maybeSingle();

  if (dbUser?.is_active && ['super', 'admin', 'administrador'].includes(dbUser.role)) {
    return { isAdmin: true, isGlobal: true };
  }

  // 2. Validar metadados do JWT (fallback confiável para super/admin)
  const meta = user.user_metadata || {};
  const nivel = meta.nivel || meta.role;
  if (['super', 'admin', 'administrador'].includes(nivel)) {
    return { isAdmin: true, isGlobal: true };
  }

  // 3. Validar se possui papel explícito 'admin_evento' em public.usuario_eventos
  const { data: ue } = await admin
    .from('usuario_eventos')
    .select('permissao')
    .eq('user_id', user.id)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (ue?.permissao === 'admin_evento') {
    return { isAdmin: true, isGlobal: false };
  }

  // 4. Subcategoria TODOS para operadores de nível inscrição autorizados administrativamente
  if (nivel === 'inscricao' && meta.subcategoria === 'TODOS') {
    return { isAdmin: true, isGlobal: false };
  }

  return { isAdmin: false, isGlobal: false };
}

async function verifyEventoReadAccess(user: any, eventoId: string): Promise<boolean> {
  // Se for admin, já tem leitura total
  const adminCheck = await verifyEventoAdmin(user, eventoId);
  if (adminCheck.isAdmin) return true;

  const admin = createServerClient();

  // Usuário vinculado como equipe/operador em usuario_eventos
  const { data: ue } = await admin
    .from('usuario_eventos')
    .select('id')
    .eq('user_id', user.id)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (ue) return true;

  // Usuário com acesso concedido em usuario_eventos_permitidos
  const { data: uep } = await admin
    .from('usuario_eventos_permitidos')
    .select('id')
    .eq('usuario_id', user.id)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (uep) return true;

  return false;
}

// ─── GET: Listar locais de check-in do evento ────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  if (!eventoId) {
    return NextResponse.json({ error: 'Parâmetro eventoId ausente.' }, { status: 400 });
  }

  const user = await resolveAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão expirada ou não autenticada.' }, { status: 401 });
  }

  const hasAccess = await verifyEventoReadAccess(user, eventoId);
  if (!hasAccess) {
    return NextResponse.json(
      { error: 'Acesso não autorizado para consultar locais deste evento.' },
      { status: 403 }
    );
  }

  const admin = createServerClient();
  const searchParams = request.nextUrl.searchParams;
  const tipoFilter = searchParams.get('tipo');

  let query = admin
    .from('evento_locais_checkin')
    .select('*')
    .eq('evento_id', eventoId)
    .order('ordem', { ascending: true })
    .order('created_at', { ascending: true });

  if (tipoFilter && (tipoFilter === 'plenaria' || tipoFilter === 'refeitorio')) {
    query = query.eq('tipo', tipoFilter);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ locais: data ?? [] });
}

// ─── POST: Cadastrar novo local de check-in (Plenária ou Refeitório) ──────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  if (!eventoId) {
    return NextResponse.json({ error: 'Parâmetro eventoId ausente.' }, { status: 400 });
  }

  const user = await resolveAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão expirada ou não autenticada.' }, { status: 401 });
  }

  const adminCheck = await verifyEventoAdmin(user, eventoId);
  if (!adminCheck.isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores podem cadastrar setores de plenária e restaurantes.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body) {
    return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
  }

  const tipo = String(body.tipo || '').trim().toLowerCase();
  const nome = String(body.nome || '').trim();
  const descricao = body.descricao ? String(body.descricao).trim() : null;
  const ativo = body.ativo !== undefined ? Boolean(body.ativo) : true;
  let ordem = typeof body.ordem === 'number' ? body.ordem : null;

  // Validações estritas de domínio
  if (tipo !== 'plenaria' && tipo !== 'refeitorio') {
    return NextResponse.json(
      { error: "Tipo inválido. Deve ser 'plenaria' ou 'refeitorio'." },
      { status: 400 }
    );
  }

  if (!nome || nome.length < 2 || nome.length > 120) {
    return NextResponse.json(
      { error: 'O nome do setor deve ter entre 2 e 120 caracteres.' },
      { status: 400 }
    );
  }

  const admin = createServerClient();

  // Validar se evento existe
  const { data: evento, error: evErr } = await admin
    .from('eventos')
    .select('id')
    .eq('id', eventoId)
    .single();

  if (evErr || !evento) {
    return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
  }

  // Se ordem não foi informada, calcular a próxima ordem do mesmo tipo
  if (ordem === null) {
    const { data: lastItem } = await admin
      .from('evento_locais_checkin')
      .select('ordem')
      .eq('evento_id', eventoId)
      .eq('tipo', tipo)
      .order('ordem', { ascending: false })
      .limit(1)
      .maybeSingle();

    ordem = lastItem?.ordem !== undefined ? lastItem.ordem + 1 : 0;
  }

  const { data: novoLocal, error: insertError } = await admin
    .from('evento_locais_checkin')
    .insert([
      {
        evento_id: eventoId,
        tipo,
        nome,
        descricao,
        ativo,
        ordem,
      },
    ])
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json(
    { local: novoLocal, message: 'Local cadastrado com sucesso.' },
    { status: 201 }
  );
}

// ─── PATCH: Atualizar nome, descrição, ativo ou ordem de um local existente ──
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  if (!eventoId) {
    return NextResponse.json({ error: 'Parâmetro eventoId ausente.' }, { status: 400 });
  }

  const user = await resolveAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão expirada ou não autenticada.' }, { status: 401 });
  }

  const adminCheck = await verifyEventoAdmin(user, eventoId);
  if (!adminCheck.isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores podem alterar setores e restaurantes do evento.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.id) {
    return NextResponse.json({ error: 'ID do local não informado.' }, { status: 400 });
  }

  const id = String(body.id).trim();
  const admin = createServerClient();

  // Verificar existência e pertinência estrita ao evento (blindagem multi-evento)
  const { data: existing, error: findError } = await admin
    .from('evento_locais_checkin')
    .select('id, evento_id, tipo, nome')
    .eq('id', id)
    .eq('evento_id', eventoId)
    .maybeSingle();

  if (findError || !existing) {
    return NextResponse.json(
      { error: 'Setor não encontrado para este evento.' },
      { status: 404 }
    );
  }

  const updates: Record<string, any> = {};

  if (body.nome !== undefined) {
    const nomeNorm = String(body.nome).trim();
    if (!nomeNorm || nomeNorm.length < 2 || nomeNorm.length > 120) {
      return NextResponse.json(
        { error: 'O nome do setor deve ter entre 2 e 120 caracteres.' },
        { status: 400 }
      );
    }
    updates.nome = nomeNorm;
  }

  if (body.descricao !== undefined) {
    updates.descricao = body.descricao ? String(body.descricao).trim() : null;
  }

  if (body.ativo !== undefined) {
    updates.ativo = Boolean(body.ativo);
  }

  if (body.ordem !== undefined && typeof body.ordem === 'number') {
    updates.ordem = Math.max(0, Math.floor(body.ordem));
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nenhum campo fornecido para atualização.' }, { status: 400 });
  }

  const { data: updatedLocal, error: updateError } = await admin
    .from('evento_locais_checkin')
    .update(updates)
    .eq('id', id)
    .eq('evento_id', eventoId)
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    local: updatedLocal,
    message: 'Local atualizado com sucesso.',
  });
}

// ─── PUT: Reordenação em lote dos locais do evento ───────────────────────────
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  if (!eventoId) {
    return NextResponse.json({ error: 'Parâmetro eventoId ausente.' }, { status: 400 });
  }

  const user = await resolveAuthUser(request);
  if (!user) {
    return NextResponse.json({ error: 'Sessão expirada ou não autenticada.' }, { status: 401 });
  }

  const adminCheck = await verifyEventoAdmin(user, eventoId);
  if (!adminCheck.isAdmin) {
    return NextResponse.json(
      { error: 'Apenas administradores podem reordenar setores do evento.' },
      { status: 403 }
    );
  }

  const body = await request.json().catch(() => null);
  const itens = body?.itens as Array<{ id: string; ordem: number }> | undefined;

  if (!Array.isArray(itens) || itens.length === 0) {
    return NextResponse.json({ error: 'Lista de ordenação inválida.' }, { status: 400 });
  }

  const admin = createServerClient();

  // Executar atualização de ordem para cada item do evento
  for (const item of itens) {
    if (item.id && typeof item.ordem === 'number') {
      await admin
        .from('evento_locais_checkin')
        .update({ ordem: Math.max(0, Math.floor(item.ordem)) })
        .eq('id', item.id)
        .eq('evento_id', eventoId);
    }
  }

  return NextResponse.json({ ok: true, message: 'Ordem dos setores atualizada.' });
}

// ─── DELETE: Bloqueio explícito de exclusão física ───────────────────────────
export async function DELETE() {
  return NextResponse.json(
    {
      error:
        'A exclusão física de locais não é permitida para proteger a rastreabilidade histórica dos check-ins e consumos. Utilize a inativação do setor.',
    },
    { status: 405 }
  );
}
