import { NextRequest, NextResponse } from 'next/server';
import { createServerClient, createServerClientFromCookies } from '@/lib/supabase-server';
import { createOrFindAsaasCustomer, createEventoPayment } from '@/lib/asaas';

export async function POST(request: NextRequest) {
  try {
    // 1. Validar autenticação
    const userClient = await createServerClientFromCookies();
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Não autorizado.' }, { status: 401 });
    }

    // 2. Extrair dados
    const { instituicaoId } = await request.json();
    if (!instituicaoId) {
      return NextResponse.json({ error: 'ID da instituição é obrigatório.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // 3. Buscar instituição
    const { data: inst, error: instError } = await supabase
      .from('conec_instituicoes')
      .select('*')
      .eq('id', instituicaoId)
      .is('deleted_at', null)
      .single();

    if (instError || !inst) {
      return NextResponse.json({ error: 'Instituição não encontrada.' }, { status: 404 });
    }

    const currentYear = new Date().getFullYear();

    // 4. Verificar credenciamento existente para o ano atual
    const { data: existingCred, error: credError } = await supabase
      .from('conec_credenciamentos')
      .select('*')
      .eq('instituicao_id', instituicaoId)
      .eq('ano_referencia', currentYear)
      .is('deleted_at', null)
      .maybeSingle();

    if (credError) {
      return NextResponse.json({ error: 'Erro ao verificar credenciamento existente.' }, { status: 500 });
    }

    if (existingCred) {
      if (existingCred.status_pagamento === 'pago' || existingCred.status_credenciamento === 'ativo') {
        return NextResponse.json({
          error: 'Esta instituição já possui credenciamento pago ou ativo para o ano atual.',
        }, { status: 422 });
      }

      // Se já possui cobrança no Asaas e já tem asaas_payment_id
      if (existingCred.asaas_payment_id) {
        return NextResponse.json({
          message: 'Cobrança já existente.',
          credenciamento: existingCred,
        });
      }
    }

    // 5. Preparar dados do cliente ASAAS
    const customerId = await createOrFindAsaasCustomer({
      nome: inst.nome_instituicao,
      email: inst.email_representante || null,
      cpf: inst.cpf_representante ? inst.cpf_representante.replace(/\D/g, '') : inst.cnpj.replace(/\D/g, ''),
      whatsapp: inst.whatsapp || inst.telefone_representante || null,
    });

    if (!inst.asaas_customer_id) {
      await supabase
        .from('conec_instituicoes')
        .update({ asaas_customer_id: customerId })
        .eq('id', inst.id);
    }

    // Prazo padrão de 7 dias
    const d = new Date();
    d.setDate(d.getDate() + 7);
    const dueDate = d.toISOString().slice(0, 10);

    // 6. Criar cobrança no ASAAS
    const description = `Taxa de Credenciamento CONEC ${currentYear} — ${inst.nome_instituicao}`;
    const payment = await createEventoPayment({
      customerId,
      value: 800.00,
      dueDate,
      description,
      externalReference: inst.id,
    });

    // 7. Determinar ou criar o credenciamento do ano
    let credId = existingCred?.id;

    if (!credId) {
      // Obter próximo sequencial de registro
      const { count } = await supabase
        .from('conec_credenciamentos')
        .select('*', { count: 'exact', head: true })
        .eq('ano_referencia', currentYear);

      const nextNum = (count || 0) + 1;
      const numero_registro = `CONEC-${currentYear}-${String(nextNum).padStart(4, '0')}`;

      const { data: newCred, error: insertError } = await supabase
        .from('conec_credenciamentos')
        .insert({
          instituicao_id: instituicaoId,
          ano_referencia: currentYear,
          numero_registro,
          data_inicio: `${currentYear}-01-01`,
          data_fim: `${currentYear}-12-31`,
          status_credenciamento: 'aguardando_pagamento',
          status_pagamento: 'pendente',
          valor: 800.00,
        })
        .select()
        .single();

      if (insertError || !newCred) {
        return NextResponse.json({ error: 'Erro ao criar credenciamento.' }, { status: 500 });
      }
      credId = newCred.id;
    }

    // 8. Tentar salvar todas as informações no credenciamento (com tratamento de fallback se as colunas novas não existirem no banco)
    let updateSuccess = false;
    let fallbackUsed = false;

    // Tentar salvar com as novas colunas
    try {
      const { error: updateError } = await supabase
        .from('conec_credenciamentos')
        .update({
          status_pagamento: 'pendente',
          asaas_payment_id: payment.id,
          asaas_invoice_url: payment.invoiceUrl,
          asaas_pix_qrcode: payment.pixQrCode,
          asaas_status: payment.status,
        })
        .eq('id', credId);

      if (!updateError) {
        updateSuccess = true;
      } else {
        throw updateError;
      }
    } catch (err) {
      console.warn('Erro ao atualizar colunas estendidas do Asaas no credenciamento. Usando fallback básico.', err);
      // Fallback básico para colunas originais do MVP
      const { error: fallbackError } = await supabase
        .from('conec_credenciamentos')
        .update({
          status_pagamento: 'pendente',
          asaas_payment_id: payment.id,
        })
        .eq('id', credId);

      if (!fallbackError) {
        updateSuccess = true;
        fallbackUsed = true;
      }
    }

    if (!updateSuccess) {
      return NextResponse.json({ error: 'Falha ao salvar dados da cobrança no banco de dados.' }, { status: 500 });
    }

    // Retornar as informações do credenciamento e da cobrança
    const { data: finalCred } = await supabase
      .from('conec_credenciamentos')
      .select('*')
      .eq('id', credId)
      .single();

    return NextResponse.json({
      message: 'Cobrança gerada com sucesso!',
      fallbackUsed,
      credenciamento: finalCred,
      paymentInfo: {
        id: payment.id,
        invoiceUrl: payment.invoiceUrl,
        pixQrCode: payment.pixQrCode,
        pixCopiaECola: payment.pixCopiaECola,
      }
    });

  } catch (err: any) {
    console.error('[GERAR TAXA CONEC ERROR]', err);
    return NextResponse.json({ error: err.message || 'Erro interno ao processar taxa.' }, { status: 500 });
  }
}
