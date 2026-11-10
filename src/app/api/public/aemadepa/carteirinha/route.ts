import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { verifyAemadepaToken } from '@/lib/aemadepa-token';
import { cleanCpf, isValidCpf } from '@/lib/cpf';
import {
  getOrCreateAsaasCustomerForAemadepa,
  createAemadepaPixCharge,
  findAsaasPaymentByExternalReference,
} from '@/lib/aemadepa/carteirinha-service';
import { getAsaasPixQrCode } from '@/lib/asaas';
import { VALOR_CARTEIRINHA_AEMADEPA } from '@/lib/aemadepa/constants';

/**
 * POST /api/public/aemadepa/carteirinha
 *
 * Cria ou recupera a solicitação de carteirinha AEMADEPA (R$ 20,00 via PIX).
 *
 * Protocolo de Resiliência Financeira:
 * 1. ZERO deleção compensatória: registros jamais são deletados sob falha/timeout.
 * 2. Reconciliação antes de criação: busca cobrança existente por externalReference determinística.
 * 3. Idempotência por lock pessimista e índice único parcial.
 * 4. Concorrência garantida: se já houver pedido ativo (incluindo processando/aguardando), reutiliza ou bloqueia.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Parâmetros inválidos' }, { status: 400 });
    }

    const { ministroId, confirmacao } = body;
    const token = request.headers.get('x-aemadepa-token') || body.token;

    if (!ministroId) {
      return NextResponse.json({ error: 'Ministro vinculado não informado.' }, { status: 400 });
    }

    if (!confirmacao) {
      return NextResponse.json(
        { error: 'A solicitação de carteirinha exige confirmação explícita da associada.' },
        { status: 400 }
      );
    }

    // 1. Validação de autenticação HMAC
    const authResult = verifyAemadepaToken(token, ministroId);
    if (!authResult.valid) {
      return NextResponse.json(
        { error: 'Sessão expirada ou não autorizada. Valide seus dados novamente.' },
        { status: 401 }
      );
    }

    const supabase = createServerClient();

    // 2. Localiza a associada vinculada ao ministro
    const { data: associada, error: assocErr } = await supabase
      .from('aemadepa_associadas')
      .select('id, ministro_id, nome, cpf, data_nascimento, fone, email, foto_url, status')
      .eq('ministro_id', ministroId)
      .maybeSingle();

    if (assocErr || !associada) {
      return NextResponse.json(
        { error: 'Cadastro de associada não localizado para o ministro informado.' },
        { status: 404 }
      );
    }

    // 3. Validação de completude: exige dados obrigatórios, foto cadastrada e CPF matematicamente válido
    const temNome = Boolean(associada.nome && associada.nome.trim().length >= 3);
    const cpfLimpo = cleanCpf(associada.cpf);
    const temCpfValido = Boolean(cpfLimpo && cpfLimpo.length === 11 && isValidCpf(cpfLimpo));
    const temNascimento = Boolean(associada.data_nascimento);
    const temFoto = Boolean(associada.foto_url && associada.foto_url.trim().length > 0);

    if (!temNome || !temCpfValido || !temNascimento || !temFoto) {
      const msgErro = !temCpfValido
        ? 'O CPF da associada está ausente ou é inválido. Por favor, atualize os dados com um CPF válido antes de solicitar a carteirinha.'
        : 'Para solicitar a carteirinha, complete o cadastro da associada (nome, CPF, nascimento e foto 3x4).';
      return NextResponse.json(
        {
          error: msgErro,
          detalhes: { temNome, temCpf: temCpfValido, temNascimento, temFoto },
        },
        { status: 422 }
      );
    }

    // 4. Verifica pedidos existentes para a associada
    const { data: pedidosExistentes, error: pedErr } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select('*')
      .eq('associada_id', associada.id)
      .order('created_at', { ascending: false });

    if (pedErr) {
      console.error('[CARTEIRINHA AEMADEPA] Erro ao buscar pedidos existentes:', pedErr);
      return NextResponse.json({ error: 'Erro ao verificar solicitações anteriores.' }, { status: 500 });
    }

    const pedidoAtivo = pedidosExistentes?.find((p) =>
      ['processando_cobranca', 'aguardando_pagamento', 'pago', 'em_impressao', 'impressa'].includes(p.status)
    );

    // 4.1 Se houver pedido pago ou em produção: bloqueia nova solicitação
    if (pedidoAtivo && !['processando_cobranca', 'aguardando_pagamento'].includes(pedidoAtivo.status)) {
      return NextResponse.json(
        {
          error: 'Já existe uma solicitação ativa em processamento ou impressa para esta associada.',
          pedido: {
            id: pedidoAtivo.id,
            via: pedidoAtivo.via,
            status: pedidoAtivo.status,
            valor: Number(pedidoAtivo.valor),
            pago_em: pedidoAtivo.pago_em,
            solicitado_em: pedidoAtivo.solicitado_em,
          },
        },
        { status: 409 }
      );
    }

    // 4.2 Se houver pedido ativo (aguardando_pagamento ou processando_cobranca): reconcilia/reaproveita
    if (pedidoAtivo) {
      let pixQrCode = pedidoAtivo.pix_qr_code_url;
      let pixCopiaECola = pedidoAtivo.pix_copia_cola;
      let asaasPaymentId = pedidoAtivo.asaas_payment_id;

      // Se ainda não temos paymentId ou QR Code:
      // Consulta o gateway pelo externalReference antes de qualquer nova ação
      if (!asaasPaymentId || !pixQrCode || !pixCopiaECola) {
        try {
          const reconciliado = await findAsaasPaymentByExternalReference(pedidoAtivo.id);
          if (reconciliado) {
            asaasPaymentId = reconciliado.paymentId;
            pixQrCode = reconciliado.pixQrCode || pixQrCode;
            pixCopiaECola = reconciliado.pixCopiaECola || pixCopiaECola;

            await supabase
              .from('aemadepa_carteirinhas_solicitacoes')
              .update({
                asaas_payment_id: asaasPaymentId,
                asaas_customer_id: reconciliado.customerId || pedidoAtivo.asaas_customer_id,
                pix_qr_code_url: pixQrCode,
                pix_copia_cola: pixCopiaECola,
                invoice_url: reconciliado.invoiceUrl || pedidoAtivo.invoice_url,
                status: 'aguardando_pagamento',
                observacoes: 'Reconciliado via externalReference após resposta incerta',
                updated_at: new Date().toISOString(),
              })
              .eq('id', pedidoAtivo.id);
          } else if (asaasPaymentId) {
            const freshPix = await getAsaasPixQrCode(asaasPaymentId);
            if (freshPix.encodedImage || freshPix.payload) {
              pixQrCode = freshPix.encodedImage || pixQrCode;
              pixCopiaECola = freshPix.payload || pixCopiaECola;
              await supabase
                .from('aemadepa_carteirinhas_solicitacoes')
                .update({
                  pix_qr_code_url: pixQrCode,
                  pix_copia_cola: pixCopiaECola,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', pedidoAtivo.id);
            }
          }
        } catch (recErr: any) {
          console.warn('[CARTEIRINHA AEMADEPA] Falha na reconciliação prévia:', recErr.message);
        }
      }

      // Se após a consulta temos QR Code ou Cobrança, retorna com sucesso
      if (pixQrCode || pixCopiaECola || asaasPaymentId) {
        return NextResponse.json({
          sucesso: true,
          reutilizado: true,
          solicitacao: {
            id: pedidoAtivo.id,
            via: pedidoAtivo.via,
            status: 'aguardando_pagamento',
            valor: Number(pedidoAtivo.valor),
            pix_copia_cola: pixCopiaECola,
            pix_qr_code: pixQrCode,
            invoice_url: pedidoAtivo.invoice_url,
            solicitado_em: pedidoAtivo.solicitado_em,
          },
        });
      }

      // SE ESTIVER EM 'processando_cobranca':
      // Se não recuperou dados no gateway por externalReference, NUNCA libera novo POST /payments
      // apenas pelo tempo decorrido ou consulta vazia. Mantém o pedido bloqueado para conciliação administrativa
      // evitando terminantemente cobranças duplicadas no ASAAS.
      if (pedidoAtivo.status === 'processando_cobranca') {
        return NextResponse.json(
          {
            error:
              'A sua solicitação está em fase de conciliação financeira com o ASAAS. Não foi gerada nova cobrança. Por favor, aguarde alguns minutos ou contate a Secretaria da COMIEADEPA.',
            solicitacaoId: pedidoAtivo.id,
            status: 'processando_cobranca',
          },
          { status: 409 }
        );
      }

      // Se estiver em 'aguardando_pagamento' mas sem payment ID (ex: pedido que falhou antes de chamar o gateway):
      // Tenta gerar cobrança para este pedido ativo com trava atômica
      return await gerarCobrancaParaPedidoExistente(supabase, pedidoAtivo, associada);
    }

    // 5. Inserção de Novo Pedido (Cálculo da próxima via)
    const proximaVia =
      pedidosExistentes && pedidosExistentes.length > 0
        ? Math.max(...pedidosExistentes.map((p) => Number(p.via) || 1)) + 1
        : 1;

    const idempotencyKey = `cart:${associada.id}:v${proximaVia}`;

    // Insere o registro preliminar persistente no banco (NUNCA será deletado)
    const { data: novaSolicitacao, error: insertErr } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .insert({
        associada_id: associada.id,
        ministro_id: associada.ministro_id,
        valor: VALOR_CARTEIRINHA_AEMADEPA,
        via: proximaVia,
        status: 'aguardando_pagamento',
        idempotency_key: idempotencyKey,
      })
      .select('id, associada_id, ministro_id, valor, via, status, idempotency_key, solicitado_em')
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return NextResponse.json(
          { error: 'Uma solicitação já foi iniciada simultaneamente. Recarregue a página.' },
          { status: 409 }
        );
      }
      console.error('[CARTEIRINHA AEMADEPA] Erro ao registrar solicitação:', insertErr);
      return NextResponse.json({ error: 'Erro interno ao registrar solicitação.' }, { status: 500 });
    }

    return await gerarCobrancaParaPedidoExistente(supabase, novaSolicitacao, associada);
  } catch (err: any) {
    console.error('[CARTEIRINHA AEMADEPA] Erro geral na rota:', err);
    return NextResponse.json(
      { error: err?.message || 'Erro inesperado ao processar solicitação.' },
      { status: 500 }
    );
  }
}

/**
 * Função utilitária que gera ou reconcilia cobrança ASAAS para um pedido que JÁ EXISTE no banco.
 * ZERO deleção compensatória: em caso de erro, documenta o erro nas observações mantendo a solicitação.
 */
/**
 * Função utilitária que gera ou reconcilia cobrança ASAAS para um pedido que JÁ EXISTE no banco.
 * ZERO deleção compensatória: em caso de erro, documenta o erro nas observações mantendo a solicitação.
 * EXCLUSÃO MÚTUA ESTREITA: Adquire trava no banco marcando status = 'processando_cobranca'
 * de forma atômica para impedir que duas requisições concorrentes chamem o gateway simultaneamente.
 */
async function gerarCobrancaParaPedidoExistente(
  supabase: any,
  solicitacao: any,
  associada: any
) {
  // 0. Trava de Exclusão Mútua Atômica:
  // Se o pedido já possui payment ID ou QR Code gerado, retorna imediatamente
  if (solicitacao.asaas_payment_id && (solicitacao.pix_copia_cola || solicitacao.pix_qr_code_url)) {
    return NextResponse.json({
      sucesso: true,
      reutilizado: true,
      solicitacao: {
        id: solicitacao.id,
        via: solicitacao.via,
        status: solicitacao.status === 'processando_cobranca' ? 'aguardando_pagamento' : solicitacao.status,
        valor: Number(solicitacao.valor || 20.0),
        pix_copia_cola: solicitacao.pix_copia_cola,
        pix_qr_code: solicitacao.pix_qr_code_url,
        invoice_url: solicitacao.invoice_url,
        solicitado_em: solicitacao.solicitado_em,
      },
    });
  }

  // Tenta assumir a execução do gateway marcando status 'processando_cobranca'
  // EXCLUSÃO MÚTUA ESTREITA: Permitida SOMENTE a partir de 'aguardando_pagamento', NUNCA de 'processando_cobranca'
  const agoraIso = new Date().toISOString();
  const { data: lockAdquirido, error: lockErr } = await supabase
    .from('aemadepa_carteirinhas_solicitacoes')
    .update({
      status: 'processando_cobranca',
      observacoes: 'Iniciando comunicação com gateway ASAAS',
      updated_at: agoraIso,
    })
    .eq('id', solicitacao.id)
    .eq('status', 'aguardando_pagamento')
    .select('id, via, status, asaas_payment_id, pix_copia_cola, pix_qr_code_url, invoice_url, solicitado_em')
    .maybeSingle();

  if (lockErr || !lockAdquirido) {
    // Outra thread concorrente já adquiriu o lock e está processando
    return NextResponse.json(
      {
        error: 'A cobrança PIX já está sendo gerada por outra requisição. Aguarde alguns segundos e recarregue a página.',
      },
      { status: 409 }
    );
  }

  // Se a consulta pós-lock indicar que outra thread já preencheu a cobrança:
  if (lockAdquirido.asaas_payment_id && (lockAdquirido.pix_copia_cola || lockAdquirido.pix_qr_code_url)) {
    return NextResponse.json({
      sucesso: true,
      reutilizado: true,
      solicitacao: {
        id: lockAdquirido.id,
        via: lockAdquirido.via,
        status: 'aguardando_pagamento',
        valor: Number(solicitacao?.valor || VALOR_CARTEIRINHA_AEMADEPA),
        pix_copia_cola: lockAdquirido.pix_copia_cola,
        pix_qr_code: lockAdquirido.pix_qr_code_url,
        invoice_url: lockAdquirido.invoice_url,
        solicitado_em: lockAdquirido.solicitado_em,
      },
    });
  }

  // 1. Obtém ou cria cliente ASAAS
  let asaasCustomerId: string;
  try {
    asaasCustomerId = await getOrCreateAsaasCustomerForAemadepa({
      nome: associada.nome,
      cpf: associada.cpf,
      email: associada.email,
      fone: associada.fone,
    });
  } catch (custErr: any) {
    console.error('[CARTEIRINHA AEMADEPA] Erro ao cadastrar pagador no ASAAS:', custErr.message);
    await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .update({
        status: 'aguardando_pagamento', // Libera o lock
        observacoes: `Erro ao obter cliente ASAAS: ${custErr.message}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', solicitacao.id);

    return NextResponse.json(
      { error: `Falha na comunicação financeira: ${custErr.message}. Tente novamente em instantes.` },
      { status: 502 }
    );
  }

  // 2. Consulta se já não existe cobrança no ASAAS para esta solicitação específica (ex: retry)
  try {
    const existenteNoGateway = await findAsaasPaymentByExternalReference(solicitacao.id);
    if (existenteNoGateway) {
      await supabase
        .from('aemadepa_carteirinhas_solicitacoes')
        .update({
          asaas_payment_id: existenteNoGateway.paymentId,
          asaas_customer_id: existenteNoGateway.customerId || asaasCustomerId,
          pix_copia_cola: existenteNoGateway.pixCopiaECola,
          pix_qr_code_url: existenteNoGateway.pixQrCode,
          invoice_url: existenteNoGateway.invoiceUrl,
          status: 'aguardando_pagamento',
          observacoes: 'Cobrança recuperada e reconciliada com sucesso',
          updated_at: new Date().toISOString(),
        })
        .eq('id', solicitacao.id);

      return NextResponse.json({
        sucesso: true,
        reutilizado: true,
        solicitacao: {
          id: solicitacao.id,
          via: solicitacao.via,
          status: 'aguardando_pagamento',
          valor: Number(solicitacao?.valor || VALOR_CARTEIRINHA_AEMADEPA),
          pix_copia_cola: existenteNoGateway.pixCopiaECola,
          pix_qr_code: existenteNoGateway.pixQrCode,
          invoice_url: existenteNoGateway.invoiceUrl,
          solicitado_em: solicitacao.solicitado_em,
        },
      });
    }
  } catch (verifErr: any) {
    console.warn('[CARTEIRINHA AEMADEPA] Erro ao verificar duplicidade no gateway:', verifErr.message);
  }

  // 3. Cria a cobrança PIX no ASAAS com exclusão mútua garantida
  try {
    const charge = await createAemadepaPixCharge({
      customerId: asaasCustomerId,
      solicitacaoId: solicitacao.id,
      via: solicitacao.via,
    });

    await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .update({
        asaas_payment_id: charge.paymentId,
        asaas_customer_id: charge.customerId,
        pix_copia_cola: charge.pixCopiaECola,
        pix_qr_code_url: charge.pixQrCode,
        invoice_url: charge.invoiceUrl,
        status: 'aguardando_pagamento',
        updated_at: new Date().toISOString(),
      })
      .eq('id', solicitacao.id);

    return NextResponse.json({
      sucesso: true,
      reutilizado: false,
      solicitacao: {
        id: solicitacao.id,
        via: solicitacao.via,
        status: 'aguardando_pagamento',
        valor: Number(solicitacao?.valor || VALOR_CARTEIRINHA_AEMADEPA),
        pix_copia_cola: charge.pixCopiaECola,
        pix_qr_code: charge.pixQrCode,
        invoice_url: charge.invoiceUrl,
        solicitado_em: solicitacao.solicitado_em || new Date().toISOString(),
      },
    });
  } catch (chargeErr: any) {
    console.error('[CARTEIRINHA AEMADEPA] Timeout ou falha no ASAAS ao criar PIX:', chargeErr.message);

    // PERSISTÊNCIA E ESTADO INCERTO:
    // Se ocorreu timeout ou erro desconhecido na criação, NÃO libera o lock para 'aguardando_pagamento'.
    // Mantém 'processando_cobranca' e registra o erro em observações.
    // Qualquer nova requisição consultará primeiramente o gateway por externalReference
    // e NÃO tentará criar outra cobrança às cegas!
    await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .update({
        observacoes: `Timeout/Resposta incerta do ASAAS: ${chargeErr.message}. Aguardando reconciliação.`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', solicitacao.id);

    return NextResponse.json(
      {
        error:
          'O gateway de pagamentos demorou para responder. Seu pedido foi preservado e está em verificação. Por favor, recarregue a página em instantes para consultar o QR Code.',
        solicitacaoId: solicitacao.id,
      },
      { status: 504 }
    );
  }
}

/**
 * GET /api/public/aemadepa/carteirinha?ministroId=...
 *
 * Consulta o estado atual da solicitação e dados PIX para a associada.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ministroId = searchParams.get('ministroId');
    const token = request.headers.get('x-aemadepa-token') || searchParams.get('token');

    if (!ministroId) {
      return NextResponse.json({ error: 'Ministro vinculado não informado.' }, { status: 400 });
    }

    if (!token) {
      return NextResponse.json({ error: 'Token de autorização não fornecido.' }, { status: 401 });
    }

    const authResult = verifyAemadepaToken(token, ministroId);
    if (!authResult.valid) {
      return NextResponse.json({ error: 'Sessão expirada ou não autorizada.' }, { status: 401 });
    }

    const supabase = createServerClient();

    const { data: associada } = await supabase
      .from('aemadepa_associadas')
      .select('id, status, nome, cpf, data_nascimento, foto_url')
      .eq('ministro_id', ministroId)
      .maybeSingle();

    if (!associada) {
      return NextResponse.json({ error: 'Associada não encontrada.' }, { status: 404 });
    }

    const { data: pedidos, error: pErr } = await supabase
      .from('aemadepa_carteirinhas_solicitacoes')
      .select('id, via, status, valor, pix_copia_cola, pix_qr_code_url, invoice_url, solicitado_em, pago_em, impresso_em, entregue_em')
      .eq('associada_id', associada.id)
      .order('via', { ascending: false });

    if (pErr) {
      return NextResponse.json({ error: 'Erro ao consultar solicitações.' }, { status: 500 });
    }

    const pedidoAtivo = pedidos?.find((p) =>
      ['processando_cobranca', 'aguardando_pagamento', 'pago', 'em_impressao', 'impressa'].includes(p.status)
    );
    const ultimoPedido = pedidos && pedidos.length > 0 ? pedidos[0] : null;

    const podeSolicitarNovaVia =
      !pedidoAtivo &&
      ultimoPedido !== null &&
      ['entregue', 'cancelada'].includes(ultimoPedido.status);

    const podeSolicitarPrimeiraVia = !pedidoAtivo && !ultimoPedido;

    return NextResponse.json({
      associadaId: associada.id,
      pedidoAtivo: pedidoAtivo
        ? {
            id: pedidoAtivo.id,
            via: pedidoAtivo.via,
            status: pedidoAtivo.status,
            valor: Number(pedidoAtivo.valor),
            pix_copia_cola: pedidoAtivo.pix_copia_cola,
            pix_qr_code: pedidoAtivo.pix_qr_code_url,
            invoice_url: pedidoAtivo.invoice_url,
            solicitado_em: pedidoAtivo.solicitado_em,
            pago_em: pedidoAtivo.pago_em,
          }
        : null,
      ultimoPedido: ultimoPedido
        ? {
            id: ultimoPedido.id,
            via: ultimoPedido.via,
            status: ultimoPedido.status,
            entregue_em: ultimoPedido.entregue_em,
          }
        : null,
      elegibilidade: {
        podeSolicitar: podeSolicitarPrimeiraVia || podeSolicitarNovaVia,
        tipoVia: podeSolicitarNovaVia ? 'segunda_via' : 'primeira_via',
        motivoBloqueio: pedidoAtivo
          ? `Já existe a ${pedidoAtivo.via}ª via em status '${pedidoAtivo.status}'.`
          : null,
      },
      historicoVias: pedidos || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Erro ao consultar status.' },
      { status: 500 }
    );
  }
}
