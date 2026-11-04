import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';
import { registrarAuditoria } from '@/lib/audit';

// Leitura: 'super', 'administrador', 'comissao'
const READ_ROLES = ['super', 'administrador', 'comissao'] as const;
// Escrita / Criação / Gestão: restrita exclusivamente a 'super' e 'administrador'
const ADMIN_ROLES = ['super', 'administrador'] as const;

// GET /api/v1/comissoes - Listar comissões com filtros (Leitura autorizada para comissao)
export async function GET(request: NextRequest) {
  const auth = await requireRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const tipo = searchParams.get('tipo');
  const ano = searchParams.get('ano');
  const search = searchParams.get('search')?.trim();

  const supabase = createServerClient();

  try {
    let query = supabase
      .from('comissoes')
      .select(`
        *,
        evento:eventos(id, nome, data_inicio),
        integrantes:comissao_integrantes(
          id,
          ministro_id,
          cargo,
          ordem_hierarquia,
          status,
          data_entrada,
          data_saida,
          ministro:members!comissao_integrantes_ministro_id_fkey(id, name, cpf, cargo_ministerial, foto_url)
        )
      `)
      .is('deleted_at', null)
      .order('data_inicio', { ascending: false });

    if (status && status !== 'todos') {
      query = query.eq('status', status);
    }

    if (tipo && tipo !== 'todos') {
      query = query.eq('tipo', tipo);
    }

    if (ano) {
      const anoNum = Number(ano);
      if (!isNaN(anoNum)) {
        query = query.eq('ano_referencia', anoNum);
      }
    }

    if (search) {
      query = query.or(`nome.ilike.%${search}%,sigla.ilike.%${search}%,finalidade.ilike.%${search}%`);
    }

    const { data, error } = await query;

    if (error) {
      // Se a tabela ainda não foi criada no banco (migration pendente)
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        return NextResponse.json({
          comissoes: [],
          stats: { ativas: 0, concluidas: 0, totalIntegrantes: 0 },
          migrationPending: true,
          message: 'Tabela de comissões não encontrada no banco. Execute a migration 20261104_modulo_comissoes_fase1.sql'
        });
      }
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Processar contadores
    const comissoes = data || [];
    const ativas = comissoes.filter((c: any) => c.status === 'ativa').length;
    const concluidas = comissoes.filter((c: any) => c.status === 'concluida').length;

    // Contar integrantes ativos únicos
    const ministrosAtivosSet = new Set<string>();
    comissoes.forEach((c: any) => {
      (c.integrantes || []).forEach((i: any) => {
        if (i.status === 'ativo' && i.ministro_id) {
          ministrosAtivosSet.add(i.ministro_id);
        }
      });
    });

    return NextResponse.json({
      comissoes,
      stats: {
        ativas,
        concluidas,
        totalIntegrantes: ministrosAtivosSet.size,
      },
    });
  } catch (err: any) {
    console.error('Erro ao listar comissões:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}

// POST /api/v1/comissoes - Criar nova comissão (EXCLUSIVO: 'super', 'administrador')
export async function POST(request: NextRequest) {
  const auth = await requireRole(request, ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  try {
    const body = await request.json();
    const { nome, sigla, finalidade, tipo, status, ato_nomeacao, data_inicio, data_fim, ano_referencia, evento_id, observacoes } = body;

    if (!nome || typeof nome !== 'string' || !nome.trim()) {
      return NextResponse.json({ error: 'O nome da comissão é obrigatório.' }, { status: 400 });
    }

    if (!finalidade || typeof finalidade !== 'string' || !finalidade.trim()) {
      return NextResponse.json({ error: 'A finalidade da comissão é obrigatória.' }, { status: 400 });
    }

    if (!data_inicio) {
      return NextResponse.json({ error: 'A data de início da comissão é obrigatória.' }, { status: 400 });
    }

    const supabase = createServerClient();

    const insertPayload = {
      nome: nome.trim(),
      sigla: sigla ? sigla.trim() : null,
      finalidade: finalidade.trim(),
      tipo: tipo || 'permanente',
      status: status || 'ativa',
      ato_nomeacao: ato_nomeacao ? ato_nomeacao.trim() : null,
      data_inicio,
      data_fim: (status === 'concluida') ? (data_fim || new Date().toISOString().split('T')[0]) : null,
      ano_referencia: ano_referencia ? Number(ano_referencia) : new Date(data_inicio).getFullYear(),
      evento_id: evento_id || null,
      observacoes: observacoes ? observacoes.trim() : null,
    };

    const { data, error } = await supabase
      .from('comissoes')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auditoria
    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user?.email,
      acao: 'criar',
      modulo: 'comissao',
      entidade: 'comissoes',
      entidadeId: data.id,
      descricao: `Criou a comissão: ${data.nome}`,
      detalhes: { payload: insertPayload },
    }, request);

    return NextResponse.json(data, { status: 201 });
  } catch (err: any) {
    console.error('Erro ao criar comissão:', err);
    return NextResponse.json({ error: err.message || 'Erro ao processar criação da comissão' }, { status: 500 });
  }
}
