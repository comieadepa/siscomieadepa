import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';
import { registrarAuditoria } from '@/lib/audit';

// Leitura: 'super', 'administrador', 'comissao'
const READ_ROLES = ['super', 'administrador', 'comissao'] as const;
// Gestão administrativa: 'super', 'administrador'
const ADMIN_ROLES = ['super', 'administrador'] as const;

// GET /api/v1/comissoes/[id] - Obter detalhes completos da comissão (Leitura)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, READ_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ID não fornecido' }, { status: 400 });

  const supabase = createServerClient();

  try {
    const { data: comissao, error: comissaoError } = await supabase
      .from('comissoes')
      .select(`
        *,
        evento:eventos(id, nome, data_inicio)
      `)
      .eq('id', id)
      .is('deleted_at', null)
      .single();

    if (comissaoError || !comissao) {
      return NextResponse.json({ error: 'Comissão não encontrada.' }, { status: 404 });
    }

    // Buscar integrantes com dados do ministro e ordenação hierárquica
    const { data: integrantes, error: intError } = await supabase
      .from('comissao_integrantes')
      .select(`
        *,
        ministro:members!comissao_integrantes_ministro_id_fkey(
          id, name, cpf, cargo_ministerial, numero_cgadb, registro_comieadepa, phone, whatsapp, foto_url
        ),
        substituido_por:members!comissao_integrantes_substituido_por_id_fkey(
          id, name
        )
      `)
      .eq('comissao_id', id)
      .is('deleted_at', null)
      .order('ordem_hierarquia', { ascending: true })
      .order('data_entrada', { ascending: false });

    if (intError) {
      console.error('Erro ao buscar integrantes da comissão:', intError);
    }

    return NextResponse.json({
      ...comissao,
      integrantes: integrantes || [],
    });
  } catch (err: any) {
    console.error('Erro ao obter detalhes da comissão:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}

// PUT /api/v1/comissoes/[id] - Atualizar dados da comissão (EXCLUSIVO: 'super', 'administrador')
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ID não fornecido' }, { status: 400 });

  try {
    const body = await request.json();
    const { nome, sigla, finalidade, tipo, status, ato_nomeacao, data_inicio, ano_referencia, evento_id, observacoes } = body;

    const supabase = createServerClient();

    // Obter dados anteriores para auditoria
    const { data: oldData } = await supabase
      .from('comissoes')
      .select('*')
      .eq('id', id)
      .single();

    const updatePayload: Record<string, any> = {};
    if (nome !== undefined) updatePayload.nome = nome.trim();
    if (sigla !== undefined) updatePayload.sigla = sigla ? sigla.trim() : null;
    if (finalidade !== undefined) updatePayload.finalidade = finalidade.trim();
    if (tipo !== undefined) updatePayload.tipo = tipo;
    if (status !== undefined) {
      updatePayload.status = status;
      // Se a comissão for alterada para 'concluida', registra a data real de encerramento sem sobrescrever caso já exista
      if (status === 'concluida') {
        if (!oldData?.data_fim) {
          updatePayload.data_fim = new Date().toISOString().split('T')[0];
        }
      }
    }
    if (ato_nomeacao !== undefined) updatePayload.ato_nomeacao = ato_nomeacao ? ato_nomeacao.trim() : null;
    if (data_inicio !== undefined) updatePayload.data_inicio = data_inicio;
    if (ano_referencia !== undefined) updatePayload.ano_referencia = Number(ano_referencia);
    if (evento_id !== undefined) updatePayload.evento_id = evento_id || null;
    if (observacoes !== undefined) updatePayload.observacoes = observacoes ? observacoes.trim() : null;

    const { data, error } = await supabase
      .from('comissoes')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auditoria
    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user?.email,
      acao: 'editar',
      modulo: 'comissao',
      entidade: 'comissoes',
      entidadeId: id,
      descricao: `Atualizou a comissão: ${data.nome}`,
      detalhes: { oldData, newData: updatePayload },
    }, request);

    return NextResponse.json(data);
  } catch (err: any) {
    console.error('Erro ao atualizar comissão:', err);
    return NextResponse.json({ error: err.message || 'Erro ao processar atualização' }, { status: 500 });
  }
}

// DELETE /api/v1/comissoes/[id] - Exclusão lógica (soft delete) (EXCLUSIVO: 'super', 'administrador')
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'ID não fornecido' }, { status: 400 });

  const supabase = createServerClient();

  try {
    const { data: oldData } = await supabase
      .from('comissoes')
      .select('nome')
      .eq('id', id)
      .single();

    const { error } = await supabase
      .from('comissoes')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Auditoria
    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user?.email,
      acao: 'deletar',
      modulo: 'comissao',
      entidade: 'comissoes',
      entidadeId: id,
      descricao: `Excluiu (soft delete) a comissão: ${oldData?.nome || id}`,
    }, request);

    return NextResponse.json({ success: true, message: 'Comissão excluída com sucesso.' });
  } catch (err: any) {
    console.error('Erro ao excluir comissão:', err);
    return NextResponse.json({ error: err.message || 'Erro ao processar exclusão' }, { status: 500 });
  }
}
