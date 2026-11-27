import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { createServerClient } from '@/lib/supabase-server';
import { cleanCpf, isValidCpf } from '@/lib/cpf';
import {
  validarElegibilidadeUmadespa,
  sanitizarFuncaoCadastro,
  validarHierarquiaEclesiastica,
} from '@/lib/umadespa';
import { registrarAuditoria } from '@/lib/audit';

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/secretaria/umadespa/associados/[id]
 * Detalha um associado com vínculos hierárquicos e histórico de funções
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const supabase = createServerClient();

    const { data: associado, error } = await supabase
      .from('umadespa_associados')
      .select(`
        *,
        supervisao:supervisoes(id, nome, codigo),
        campo:campos(id, nome),
        congregacao:congregacoes(id, nome)
      `)
      .eq('id', id)
      .maybeSingle();

    if (error || !associado) {
      return NextResponse.json({ error: 'Associado não encontrado.' }, { status: 404 });
    }

    // Busca histórico de funções/liderança
    const { data: historicoFuncoes } = await supabase
      .from('umadespa_funcoes_historico')
      .select('*')
      .eq('associado_id', id)
      .order('created_at', { ascending: false });

    // Busca solicitações de carteirinhas
    const { data: solicitacoes } = await supabase
      .from('umadespa_carteirinhas_solicitacoes')
      .select('*')
      .eq('associado_id', id)
      .order('via', { ascending: false });

    return NextResponse.json({
      data: {
        ...associado,
        historico_funcoes: historicoFuncoes || [],
        solicitacoes_carteirinhas: solicitacoes || [],
      },
    });
  } catch (err: any) {
    console.error('[UMADESPA ADMIN API] Erro em GET /associados/[id]:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

/**
 * PATCH /api/v1/secretaria/umadespa/associados/[id]
 * Atualiza dados cadastrais, eclesiásticos, função/liderança e status
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'ID inválido' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 1. Busca dados atuais do associado
    const { data: atual, error: buscaErr } = await supabase
      .from('umadespa_associados')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (buscaErr || !atual) {
      return NextResponse.json({ error: 'Associado não encontrado.' }, { status: 404 });
    }

    const updates: Record<string, any> = {};

    // Nome
    if (body.nome !== undefined) {
      if (String(body.nome).trim().length < 3) {
        return NextResponse.json({ error: 'Nome deve ter no mínimo 3 caracteres.' }, { status: 422 });
      }
      updates.nome = String(body.nome).trim().toUpperCase();
    }

    // CPF
    if (body.cpf !== undefined) {
      const cpfLimpo = cleanCpf(body.cpf);
      if (!cpfLimpo || cpfLimpo.length !== 11 || !isValidCpf(cpfLimpo)) {
        return NextResponse.json({ error: 'CPF inválido.' }, { status: 422 });
      }
      // Verifica se outro associado já usa este CPF
      const { data: outroCpf } = await supabase
        .from('umadespa_associados')
        .select('id')
        .eq('cpf', cpfLimpo)
        .neq('id', id)
        .maybeSingle();

      if (outroCpf) {
        return NextResponse.json({ error: 'Este CPF já pertence a outro associado.' }, { status: 409 });
      }
      updates.cpf = cpfLimpo;
    }

    // Data de nascimento
    if (body.data_nascimento !== undefined) {
      updates.data_nascimento = body.data_nascimento;
      const respCpfLimpo = body.responsavel_cpf ? cleanCpf(body.responsavel_cpf) : atual.responsavel_cpf;
      const eleg = validarElegibilidadeUmadespa({
        dataNascimento: body.data_nascimento,
        origemCadastro: 'administrativo',
        responsavelNome: body.responsavel_nome || atual.responsavel_nome,
        responsavelCpf: respCpfLimpo || undefined,
        responsavelFone: body.responsavel_fone || atual.responsavel_fone,
        responsavelTermoAceite: body.responsavel_termo_aceite ?? atual.responsavel_termo_aceite,
      });
      updates.menor_idade = eleg.menorIdade;
    }

    // Vínculos Eclesiásticos
    const supId = body.supervisao_id !== undefined ? body.supervisao_id : atual.supervisao_id;
    const cmpId = body.campo_id !== undefined ? body.campo_id : atual.campo_id;
    const congId = body.congregacao_id !== undefined ? body.congregacao_id : atual.congregacao_id;

    if (body.supervisao_id !== undefined || body.campo_id !== undefined || body.congregacao_id !== undefined) {
      const hVal = await validarHierarquiaEclesiastica({
        supervisaoId: supId,
        campoId: cmpId,
        congregacaoId: congId || null,
      });
      if (!hVal.valido) {
        return NextResponse.json({ error: hVal.erro }, { status: 422 });
      }
      updates.supervisao_id = supId;
      updates.campo_id = cmpId;
      updates.congregacao_id = congId || null;
    }

    // Outros dados pessoais
    if (body.rg !== undefined) updates.rg = body.rg ? String(body.rg).trim() : null;
    if (body.orgao_emissor !== undefined) updates.orgao_emissor = body.orgao_emissor ? String(body.orgao_emissor).trim().toUpperCase() : null;
    if (body.sexo !== undefined) updates.sexo = body.sexo === 'FEMININO' ? 'FEMININO' : 'MASCULINO';
    if (body.nacionalidade !== undefined) updates.nacionalidade = body.nacionalidade ? String(body.nacionalidade).trim().toUpperCase() : 'BRASILEIRA';
    if (body.naturalidade !== undefined) updates.naturalidade = body.naturalidade ? String(body.naturalidade).trim().toUpperCase() : null;
    if (body.tipo_sanguineo !== undefined) updates.tipo_sanguineo = body.tipo_sanguineo ? String(body.tipo_sanguineo).trim().toUpperCase() : null;
    if (body.nome_pai !== undefined) updates.nome_pai = body.nome_pai ? String(body.nome_pai).trim().toUpperCase() : null;
    if (body.nome_mae !== undefined) updates.nome_mae = body.nome_mae ? String(body.nome_mae).trim().toUpperCase() : null;
    if (body.titulo_eleitoral !== undefined) updates.titulo_eleitoral = body.titulo_eleitoral ? String(body.titulo_eleitoral).trim() : null;
    if (body.fone !== undefined) updates.fone = body.fone ? String(body.fone).trim() : null;
    if (body.email !== undefined) updates.email = body.email ? String(body.email).trim().toLowerCase() : null;
    if (body.foto_url !== undefined) updates.foto_url = body.foto_url || null;
    if (body.status !== undefined && ['ativo', 'pendente', 'inativo', 'regularizacao'].includes(body.status)) {
      updates.status = body.status;
    }

    // Responsável (se menor)
    if (body.responsavel_nome !== undefined) updates.responsavel_nome = body.responsavel_nome ? String(body.responsavel_nome).trim().toUpperCase() : null;
    if (body.responsavel_cpf !== undefined) updates.responsavel_cpf = body.responsavel_cpf ? cleanCpf(body.responsavel_cpf) : null;
    if (body.responsavel_fone !== undefined) updates.responsavel_fone = body.responsavel_fone ? String(body.responsavel_fone).trim() : null;
    if (body.responsavel_termo_aceite !== undefined) updates.responsavel_termo_aceite = body.responsavel_termo_aceite === true;

    // Alteração de Função e Liderança (com auditoria)
    let mudouFuncao = false;
    if (body.funcao !== undefined && body.funcao !== atual.funcao) {
      const novaFuncaoDef = sanitizarFuncaoCadastro({
        funcao: body.funcao,
        isLideranca: body.is_lideranca,
        origemCadastro: 'administrativo',
      });
      updates.funcao = novaFuncaoDef.funcao;
      updates.is_lideranca = novaFuncaoDef.isLideranca;
      mudouFuncao = true;
    }
    if (body.cargo_detalhe !== undefined) {
      updates.cargo_detalhe = body.cargo_detalhe ? String(body.cargo_detalhe).trim() : null;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ message: 'Nenhuma alteração informada.', data: atual });
    }

    const { data: atualizado, error: updErr } = await supabase
      .from('umadespa_associados')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();

    if (updErr || !atualizado) {
      console.error('[UMADESPA ADMIN API] Erro ao atualizar associado:', updErr);
      return NextResponse.json({ error: updErr?.message || 'Erro ao atualizar dados.' }, { status: 500 });
    }

    // Se houve mudança de função, registra no histórico
    if (mudouFuncao) {
      await supabase.from('umadespa_funcoes_historico').insert([
        {
          associado_id: id,
          funcao_anterior: atual.funcao,
          funcao_nova: atualizado.funcao,
          is_lideranca: atualizado.is_lideranca,
          alterado_por: auth.ctx.userId,
          motivo: body.motivo_mudanca_funcao ? String(body.motivo_mudanca_funcao).trim() : 'Atualização de função via administração',
        },
      ]);
    }

    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user.email,
      modulo: 'secretaria',
      acao: 'editar',
      entidade: 'umadespa_associados',
      entidadeId: id,
      descricao: `Associado UMADESPA atualizado: ${atualizado.nome}`,
    });

    return NextResponse.json({ data: atualizado });
  } catch (err: any) {
    console.error('[UMADESPA ADMIN API] Erro fatal em PATCH /associados/[id]:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
