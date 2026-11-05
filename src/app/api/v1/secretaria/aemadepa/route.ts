import { NextRequest, NextResponse } from 'next/server';
import { requireModuleAccess } from '@/lib/auth/require-auth';
import { createServerClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireModuleAccess(request, 'aemadepa');
    if (!auth.ok) return auth.response;

    const supabase = createServerClient();

    // 1. Busca todas as associadas cadastradas com os dados do ministro vinculado via JOIN
    const { data: associadas, error } = await supabase
      .from('aemadepa_associadas')
      .select(`
        id,
        ministro_id,
        nome,
        cpf,
        rg,
        orgao_emissor,
        data_nascimento,
        nacionalidade,
        naturalidade,
        tipo_sanguineo,
        nome_pai,
        nome_mae,
        titulo_eleitoral,
        fone,
        email,
        foto_url,
        numero_aemadepa,
        status,
        custom_fields,
        created_at,
        updated_at,
        members:ministro_id (
          id,
          name,
          matricula,
          cpf,
          cargo_ministerial,
          status,
          jubilado,
          unique_id,
          custom_fields
        )
      `)
      .order('nome', { ascending: true });

    if (error) {
      console.error('Erro ao consultar aemadepa_associadas:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // 2. Busca solicitações ativas para consolidar status financeiro de cada associada
    const { data: solicitacoes } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select('id, associada_id, via, status, valor, forma_pagamento, pago_em, impresso_em, entregue_em')
      .order('via', { ascending: false });

    const solicitacoesPorAssociada = new Map<string, any>();
    (solicitacoes || []).forEach((s) => {
      if (!solicitacoesPorAssociada.has(s.associada_id)) {
        solicitacoesPorAssociada.set(s.associada_id, s);
      }
    });

    const associadasComFinanceiro = (associadas || []).map((assoc) => {
      const solAtiva = solicitacoesPorAssociada.get(assoc.id) || null;
      const temFoto = Boolean(assoc.foto_url && assoc.foto_url.trim().length > 0);
      const regularizada = Boolean(solAtiva && ['pago', 'em_impressao', 'impressa', 'entregue'].includes(solAtiva.status));
      const podeImprimir = temFoto && regularizada;

      return {
        ...assoc,
        solicitacaoAtiva: solAtiva,
        financeiro: {
          status: solAtiva ? solAtiva.status : 'sem_solicitacao',
          formaPagamento: solAtiva?.forma_pagamento || null,
          via: solAtiva?.via || 1,
          pago: regularizada,
          podeImprimir,
          motivoBloqueio: !temFoto
            ? 'Foto não cadastrada'
            : !regularizada
            ? 'Regularização financeira pendente'
            : null,
        },
      };
    });

    return NextResponse.json({
      data: associadasComFinanceiro,
      total: associadasComFinanceiro.length,
    });
  } catch (err: any) {
    console.error('Erro interno na rota /api/v1/secretaria/aemadepa:', err);
    return NextResponse.json({ error: err.message || 'Erro interno do servidor' }, { status: 500 });
  }
}
