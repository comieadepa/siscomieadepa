import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { requireRole } from '@/lib/auth/require-auth';
import { registrarAuditoria } from '@/lib/audit';

// Leitura: 'super', 'administrador', 'comissao'
// Escrita / Gestão de Integrantes: restrita exclusivamente a 'super' e 'administrador'
const ADMIN_ROLES = ['super', 'administrador'] as const;

// POST /api/v1/comissoes/[id]/integrantes - Adicionar novo integrante ou efetuar substituição via RPC atômica
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const { id: comissaoId } = await params;
  if (!comissaoId) return NextResponse.json({ error: 'ID da comissão não fornecido' }, { status: 400 });

  try {
    const body = await request.json();
    const {
      ministro_id,
      cargo,
      ordem_hierarquia,
      data_entrada,
      observacoes,
      substituindo_integrante_id, // Se fornecido, aciona a RPC atômica transacional
      motivo_substituicao
    } = body;

    if (!ministro_id) {
      return NextResponse.json({ error: 'Ministro é obrigatório.' }, { status: 400 });
    }
    if (!cargo || !cargo.trim()) {
      return NextResponse.json({ error: 'Cargo é obrigatório.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1. FLUXO ATÔMICO DE SUBSTITUIÇÃO (VIA RPC TRANSACIONAL POSTGRESQL)
    if (substituindo_integrante_id) {
      const { data: rpcResult, error: rpcErr } = await supabase.rpc(
        'substituir_integrante_comissao',
        {
          p_comissao_id: comissaoId,
          p_integrante_anterior_id: substituindo_integrante_id,
          p_novo_ministro_id: ministro_id,
          p_cargo: cargo.trim(),
          p_ordem_hierarquia: ordem_hierarquia !== undefined ? Number(ordem_hierarquia) : 99,
          p_data_substituicao: data_entrada || new Date().toISOString().split('T')[0],
          p_motivo_substituicao: motivo_substituicao || 'Substituição formal de comissão',
          p_observacoes: observacoes ? observacoes.trim() : null
        }
      );

      if (rpcErr) {
        console.error('Erro na RPC de substituição de integrante:', rpcErr);
        // Tratar mensagens de negócio lançadas pela RPC
        let msg = rpcErr.message;
        if (msg.includes('COMISSAO_NOT_FOUND')) msg = 'Comissão não encontrada ou inativa.';
        else if (msg.includes('INTEGRANTE_NOT_FOUND')) msg = 'Integrante anterior não encontrado nesta comissão.';
        else if (msg.includes('INTEGRANTE_NOT_ACTIVE')) msg = 'Integrante anterior já não está ativo.';
        else if (msg.includes('MINISTRO_NOT_FOUND')) msg = 'Ministro sucessor não encontrado no cadastro oficial.';
        else if (msg.includes('SAME_MINISTER')) msg = 'O ministro sucessor não pode ser o mesmo já designado.';
        else if (msg.includes('MINISTRO_ALREADY_ACTIVE')) msg = 'O ministro sucessor já possui designação ativa nesta comissão.';

        return NextResponse.json({ error: msg }, { status: 400 });
      }

      // Buscar registro completo do novo integrante para retorno
      const { data: novoRec } = await supabase
        .from('comissao_integrantes')
        .select(`
          *,
          ministro:members!comissao_integrantes_ministro_id_fkey(
            id, name, cpf, cargo_ministerial, numero_cgadb, registro_comieadepa, phone, foto_url
          )
        `)
        .eq('id', rpcResult.novo_integrante_id)
        .single();

      // Auditoria completa da substituição atômica
      await registrarAuditoria({
        userId: auth.ctx.userId,
        userEmail: auth.ctx.user?.email,
        acao: 'editar',
        modulo: 'comissao',
        entidade: 'comissao_integrantes',
        entidadeId: rpcResult.novo_integrante_id,
        descricao: `Substituição atômica de integrante na comissão. Sucessor: ${rpcResult.novo_ministro_nome}`,
        detalhes: {
          comissaoId,
          integranteAnteriorId: substituindo_integrante_id,
          novoIntegranteId: rpcResult.novo_integrante_id,
          novoMinistroId: ministro_id,
          cargo: cargo.trim(),
          motivo: motivo_substituicao,
        },
      }, request);

      return NextResponse.json({
        message: 'Substituição realizada com sucesso e histórico preservado.',
        integrante: novoRec || rpcResult
      }, { status: 201 });
    }

    // 2. FLUXO DE INCLUSÃO DIRETA
    // 2.1 Verificar se comissão existe e está ativa
    const { data: comissao, error: comissaoErr } = await supabase
      .from('comissoes')
      .select('id, nome, status')
      .eq('id', comissaoId)
      .is('deleted_at', null)
      .single();

    if (comissaoErr || !comissao) {
      return NextResponse.json({ error: 'Comissão não encontrada ou inativa.' }, { status: 404 });
    }

    // 2.2 Verificar ministro no cadastro oficial
    const { data: ministro, error: ministroErr } = await supabase
      .from('members')
      .select('id, name, cpf, cargo_ministerial')
      .eq('id', ministro_id)
      .single();

    if (ministroErr || !ministro) {
      return NextResponse.json({ error: 'Ministro não encontrado no cadastro oficial.' }, { status: 404 });
    }

    // 2.3 Verificar se o ministro já está ATIVO nesta comissão
    const { data: existente } = await supabase
      .from('comissao_integrantes')
      .select('id, cargo')
      .eq('comissao_id', comissaoId)
      .eq('ministro_id', ministro_id)
      .eq('status', 'ativo')
      .is('deleted_at', null)
      .maybeSingle();

    if (existente) {
      return NextResponse.json({
        error: `O ministro ${ministro.name} já participa ativamente desta comissão como "${existente.cargo}".`
      }, { status: 400 });
    }

    // 2.4 Inserir integrante
    const { data: novoIntegrante, error: insertErr } = await supabase
      .from('comissao_integrantes')
      .insert({
        comissao_id: comissaoId,
        ministro_id,
        cargo: cargo.trim(),
        ordem_hierarquia: ordem_hierarquia !== undefined ? Number(ordem_hierarquia) : 99,
        status: 'ativo',
        data_entrada: data_entrada || new Date().toISOString().split('T')[0],
        observacoes: observacoes ? observacoes.trim() : null
      })
      .select(`
        *,
        ministro:members!comissao_integrantes_ministro_id_fkey(
          id, name, cpf, cargo_ministerial, numero_cgadb, registro_comieadepa, phone, foto_url
        )
      `)
      .single();

    if (insertErr) {
      console.error('Erro ao inserir integrante da comissão:', insertErr);
      if (insertErr.code === '23505') {
        return NextResponse.json({
          error: `O ministro ${ministro.name} já possui designação ativa nesta comissão.`
        }, { status: 400 });
      }
      return NextResponse.json({ error: 'Erro ao cadastrar integrante: ' + insertErr.message }, { status: 500 });
    }

    // 2.5 Auditoria da inclusão
    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user?.email,
      acao: 'criar',
      modulo: 'comissao',
      entidade: 'comissao_integrantes',
      entidadeId: novoIntegrante.id,
      descricao: `Designou ${ministro.name} como ${cargo.trim()} na comissão`,
      detalhes: {
        comissaoId,
        ministroId: ministro_id,
        cargo: cargo.trim(),
        ordemHierarquia: ordem_hierarquia,
      },
    }, request);

    return NextResponse.json({
      message: 'Integrante adicionado com sucesso',
      integrante: novoIntegrante
    }, { status: 201 });
  } catch (err: any) {
    console.error('Erro ao processar integrante da comissão:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}

// PUT /api/v1/comissoes/[id]/integrantes - Atualizar cargo ou registrar desligamento (EXCLUSIVO: 'super', 'administrador')
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const { id: comissaoId } = await params;
  if (!comissaoId) return NextResponse.json({ error: 'ID da comissão não fornecido' }, { status: 400 });

  try {
    const body = await request.json();
    const {
      integrante_id,
      cargo,
      ordem_hierarquia,
      status, // 'ativo' | 'inativo' | 'substituido' | 'desligado'
      data_saida,
      motivo_saida,
      observacoes
    } = body;

    if (!integrante_id) {
      return NextResponse.json({ error: 'ID do integrante é obrigatório.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // Obter dados atuais do integrante
    const { data: integranteAtual, error: fetchErr } = await supabase
      .from('comissao_integrantes')
      .select('*, ministro:members(name)')
      .eq('id', integrante_id)
      .eq('comissao_id', comissaoId)
      .is('deleted_at', null)
      .single();

    if (fetchErr || !integranteAtual) {
      return NextResponse.json({ error: 'Integrante não encontrado nesta comissão.' }, { status: 404 });
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString()
    };

    if (cargo !== undefined) updates.cargo = cargo.trim();
    if (ordem_hierarquia !== undefined) updates.ordem_hierarquia = Number(ordem_hierarquia);
    if (status !== undefined) updates.status = status;
    if (data_saida !== undefined) updates.data_saida = data_saida;
    if (motivo_saida !== undefined) updates.motivo_saida = motivo_saida;
    if (observacoes !== undefined) updates.observacoes = observacoes;

    // Se estiver desligando/encerrando mandato e não tiver data_saida definida
    if ((status === 'desligado' || status === 'inativo') && !updates.data_saida && !integranteAtual.data_saida) {
      updates.data_saida = new Date().toISOString().split('T')[0];
    }

    const { data: updated, error: updErr } = await supabase
      .from('comissao_integrantes')
      .update(updates)
      .eq('id', integrante_id)
      .select(`
        *,
        ministro:members!comissao_integrantes_ministro_id_fkey(
          id, name, cpf, cargo_ministerial, foto_url
        )
      `)
      .single();

    if (updErr) {
      return NextResponse.json({ error: 'Erro ao atualizar integrante: ' + updErr.message }, { status: 500 });
    }

    // Auditoria
    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user?.email,
      acao: 'editar',
      modulo: 'comissao',
      entidade: 'comissao_integrantes',
      entidadeId: integrante_id,
      descricao: `Atualizou integrante ${integranteAtual.ministro?.name || integrante_id} na comissão`,
      detalhes: { updates, oldData: integranteAtual },
    }, request);

    return NextResponse.json({
      message: 'Integrante atualizado com sucesso',
      integrante: updated
    });
  } catch (err: any) {
    console.error('Erro ao atualizar integrante:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}

// DELETE /api/v1/comissoes/[id]/integrantes - Exclusão lógica (soft delete) de integrante (EXCLUSIVO: 'super', 'administrador')
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireRole(request, ADMIN_ROLES);
  if (!auth.ok) return auth.response;

  const { id: comissaoId } = await params;
  const { searchParams } = new URL(request.url);
  const integranteId = searchParams.get('integrante_id');

  if (!comissaoId || !integranteId) {
    return NextResponse.json({ error: 'Parâmetros comissao_id e integrante_id são obrigatórios.' }, { status: 400 });
  }

  const supabase = createServerClient();

  try {
    const { data: integrante, error: findErr } = await supabase
      .from('comissao_integrantes')
      .select('*, ministro:members(name)')
      .eq('id', integranteId)
      .eq('comissao_id', comissaoId)
      .is('deleted_at', null)
      .single();

    if (findErr || !integrante) {
      return NextResponse.json({ error: 'Integrante não encontrado.' }, { status: 404 });
    }

    // Soft delete: preserva histórico referencial
    const { error: delErr } = await supabase
      .from('comissao_integrantes')
      .update({
        deleted_at: new Date().toISOString(),
        status: 'inativo'
      })
      .eq('id', integranteId);

    if (delErr) {
      return NextResponse.json({ error: 'Erro ao remover integrante: ' + delErr.message }, { status: 500 });
    }

    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user?.email,
      acao: 'deletar',
      modulo: 'comissao',
      entidade: 'comissao_integrantes',
      entidadeId: integranteId,
      descricao: `Removeu (soft delete) integrante ${integrante.ministro?.name || integranteId} da comissão`,
      detalhes: { comissaoId, integranteId },
    }, request);

    return NextResponse.json({ message: 'Integrante removido com sucesso' });
  } catch (err: any) {
    console.error('Erro ao remover integrante:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}
