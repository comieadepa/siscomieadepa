import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { createServerClient } from '@/lib/supabase-server';
import { getUmadespaConfiguracoesVigentes } from '@/lib/umadespa';
import { registrarAuditoria } from '@/lib/audit';

/**
 * GET /api/v1/secretaria/umadespa/configuracoes
 * Retorna as configurações operacionais da UMADESPA para o exercício solicitado ou vigente
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const supabase = createServerClient();
    const { searchParams } = new URL(request.url);
    const ano = searchParams.get('ano');

    if (ano) {
      const { data, error } = await supabase
        .from('umadespa_configuracoes')
        .select('*')
        .eq('ano_exercicio', parseInt(ano, 10))
        .maybeSingle();

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      if (!data) {
        return NextResponse.json({ error: 'Configuração para o ano solicitado não encontrada.' }, { status: 404 });
      }

      return NextResponse.json({ data });
    }

    // Retorna a vigente
    const config = await getUmadespaConfiguracoesVigentes();
    return NextResponse.json({ data: config });
  } catch (err: any) {
    console.error('[UMADESPA CONFIG API] Erro em GET /configuracoes:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}

/**
 * PUT /api/v1/secretaria/umadespa/configuracoes
 * Atualiza ou insere configurações de taxas, validade e regras da UMADESPA
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'umadespa');
    if (!auth.ok) return auth.response;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Corpo da requisição inválido.' }, { status: 400 });
    }

    const anoExercicio = parseInt(body.ano_exercicio || new Date().getFullYear().toString(), 10);
    const taxa1aVia = parseFloat(body.taxa_primeira_via);
    const taxa2aVia = parseFloat(body.taxa_segunda_via);
    const mesesValidade = parseInt(body.meses_validade_carteirinha, 10);
    const idadeMaxPublico = parseInt(body.idade_maxima_cadastro_publico, 10);
    const permiteCadastroPublico = body.permite_cadastro_publico !== false;

    if (isNaN(taxa1aVia) || taxa1aVia < 0 || isNaN(taxa2aVia) || taxa2aVia < 0) {
      return NextResponse.json({ error: 'Taxas de carteirinha devem ser números válidos não-negativos.' }, { status: 422 });
    }

    if (isNaN(mesesValidade) || mesesValidade < 1 || mesesValidade > 120) {
      return NextResponse.json({ error: 'Validade em meses deve estar entre 1 e 120.' }, { status: 422 });
    }

    if (isNaN(idadeMaxPublico) || idadeMaxPublico < 12 || idadeMaxPublico > 99) {
      return NextResponse.json({ error: 'Idade máxima para cadastro público deve estar entre 12 e 99 anos.' }, { status: 422 });
    }

    const supabase = createServerClient();

    const payload = {
      ano_exercicio: anoExercicio,
      taxa_primeira_via: taxa1aVia,
      taxa_segunda_via: taxa2aVia,
      meses_validade_carteirinha: mesesValidade,
      idade_maxima_cadastro_publico: idadeMaxPublico,
      permite_cadastro_publico: permiteCadastroPublico,
      chave_pix_manual: body.chave_pix_manual ? String(body.chave_pix_manual).trim() : null,
      instrucoes_pagamento: body.instrucoes_pagamento ? String(body.instrucoes_pagamento).trim() : null,
      criado_por: auth.ctx.userId,
    };

    const { data: upserted, error } = await supabase
      .from('umadespa_configuracoes')
      .upsert(payload, { onConflict: 'ano_exercicio' })
      .select('*')
      .single();

    if (error || !upserted) {
      console.error('[UMADESPA CONFIG API] Erro ao atualizar configurações:', error);
      return NextResponse.json({ error: error?.message || 'Erro ao salvar configuração.' }, { status: 500 });
    }

    await registrarAuditoria({
      userId: auth.ctx.userId,
      userEmail: auth.ctx.user.email,
      modulo: 'configuracoes',
      acao: 'editar',
      entidade: 'umadespa_configuracoes',
      entidadeId: upserted.id,
      descricao: `Configuração UMADESPA atualizada para exercício ${anoExercicio}`,
    });

    return NextResponse.json({ data: upserted });
  } catch (err: any) {
    console.error('[UMADESPA CONFIG API] Erro fatal em PUT /configuracoes:', err);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
