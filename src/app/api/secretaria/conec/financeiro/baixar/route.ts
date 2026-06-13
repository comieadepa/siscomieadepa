import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';

export async function POST(request: NextRequest) {
  try {
    // 1. Validar autenticação
    const userClient = await createServerClientFromCookies();
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    // 2. Extrair dados
    const {
      credenciamentoId,
      data_pagamento,
      forma_pagamento,
      observacoes_financeiras,
    } = await request.json();

    if (!credenciamentoId) {
      return NextResponse.json({ error: 'ID do credenciamento é obrigatório.' }, { status: 400 });
    }

    if (!data_pagamento) {
      return NextResponse.json({ error: 'Data do pagamento é obrigatória.' }, { status: 400 });
    }

    if (!forma_pagamento) {
      return NextResponse.json({ error: 'Forma de pagamento é obrigatória.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 3. Buscar credenciamento
    const { data: cred, error: credError } = await supabase
      .from('conec_credenciamentos')
      .select('*')
      .eq('id', credenciamentoId)
      .single();

    if (credError || !cred) {
      return NextResponse.json({ error: 'Credenciamento não encontrado.' }, { status: 404 });
    }

    // 4. Aplicar regras de validação obrigatórias
    if (cred.deleted_at) {
      return NextResponse.json({ error: 'Este credenciamento foi excluído.' }, { status: 422 });
    }

    if (cred.status_pagamento === 'pago') {
      return NextResponse.json({ error: 'Este credenciamento já está pago.' }, { status: 422 });
    }

    if (cred.status_credenciamento === 'cancelado' || cred.status_credenciamento === 'suspenso') {
      return NextResponse.json({
        error: `Não é possível confirmar o pagamento de um credenciamento com status ${cred.status_credenciamento}.`,
      }, { status: 422 });
    }

    // 5. Executar a baixa manual
    const { data: updatedCred, error: updateError } = await supabase
      .from('conec_credenciamentos')
      .update({
        status_pagamento: 'pago',
        status_credenciamento: 'ativo',
        data_emissao: new Date().toISOString(),
        data_pagamento,
        forma_pagamento,
        observacoes_financeiras: observacoes_financeiras || null,
      })
      .eq('id', credenciamentoId)
      .select()
      .single();

    if (updateError || !updatedCred) {
      throw updateError || new Error('Erro ao salvar atualização no banco de dados.');
    }

    return NextResponse.json({
      message: 'Pagamento confirmado com sucesso!',
      credenciamento: updatedCred,
    });

  } catch (err: any) {
    console.error('[CONEC FINANCEIRO MANUAL ERROR]', err);
    return NextResponse.json({ error: err.message || 'Erro interno ao processar baixa.' }, { status: 500 });
  }
}
