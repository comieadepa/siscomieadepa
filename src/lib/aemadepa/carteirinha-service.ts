import { asaasFetch, createOrFindAsaasCustomer } from '@/lib/asaas';

export interface AsaasPixResponse {
  paymentId: string;
  customerId: string;
  pixQrCode: string | null;
  pixCopiaECola: string | null;
  invoiceUrl: string | null;
  value: number;
  status: string;
}

export function formatPixDueDate(daysAhead = 3): string {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  const ano = d.getFullYear();
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/**
 * Cria ou localiza cliente ASAAS para a Associada AEMADEPA
 * Reutiliza createOrFindAsaasCustomer com sanitização, lookup por CPF e fallback mínimo resiliente.
 */
export async function getOrCreateAsaasCustomerForAemadepa(params: {
  nome: string;
  cpf: string;
  email?: string | null;
  fone?: string | null;
}): Promise<string> {
  const cleanCpf = params.cpf.replace(/\D/g, '');
  if (!cleanCpf || cleanCpf.length !== 11) {
    throw new Error('CPF da associada inválido para processamento ASAAS');
  }

  try {
    return await createOrFindAsaasCustomer({
      nome: params.nome.trim(),
      email: params.email?.trim() || null,
      cpf: cleanCpf,
      whatsapp: params.fone || null,
    });
  } catch (err: any) {
    console.error('[ASAAS AEMADEPA] Erro ao cadastrar pagadora:', err.message);
    throw new Error(`Erro ASAAS ao cadastrar pagadora: ${err.message}`);
  }
}

/**
 * Reconcilia cobrança existente no ASAAS pelo externalReference determinístico
 * Evita criar cobrança duplicada caso tenha ocorrido timeout na tentativa anterior.
 */
export async function findAsaasPaymentByExternalReference(
  solicitacaoId: string
): Promise<AsaasPixResponse | null> {
  const externalRef = `aemadepa_carteirinha:${solicitacaoId}`;
  try {
    const res = await asaasFetch(
      `/payments?externalReference=${encodeURIComponent(externalRef)}&limit=1`,
      { method: 'GET' }
    );
    const item = Array.isArray(res?.data) ? res.data[0] : null;
    if (!item?.id) return null;

    let pixQrCode: string | null = null;
    let pixCopiaECola: string | null = null;
    try {
      const pix = await asaasFetch(`/payments/${item.id}/pixQrCode`, { method: 'GET' });
      pixQrCode = pix?.encodedImage ?? null;
      pixCopiaECola = pix?.payload ?? null;
    } catch {
      // best-effort
    }

    return {
      paymentId: String(item.id),
      customerId: String(item.customer || ''),
      pixQrCode,
      pixCopiaECola,
      invoiceUrl: item.invoiceUrl ?? null,
      value: Number(item.value || 20.0),
      status: String(item.status || 'PENDING'),
    };
  } catch (err: any) {
    console.warn('[ASAAS AEMADEPA] Falha ao consultar externalReference:', err.message);
    return null;
  }
}

/**
 * Cria cobrança PIX oficial no ASAAS com externalReference exclusiva
 */
export async function createAemadepaPixCharge(params: {
  customerId: string;
  solicitacaoId: string;
  via: number;
  descricao?: string;
}): Promise<AsaasPixResponse> {
  const externalReference = `aemadepa_carteirinha:${params.solicitacaoId}`;
  const dueDate = formatPixDueDate(3); // 3 dias para pagamento PIX
  const description =
    params.descricao ||
    `AEMADEPA — Emissão de Carteirinha (${params.via}ª Via)`;

  const payment = await asaasFetch('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: params.customerId,
      billingType: 'PIX',
      value: 20.0,
      dueDate,
      description,
      externalReference,
    }),
  });

  if (!payment?.id) {
    throw new Error('ASAAS não retornou identificador da cobrança');
  }

  // Busca dados de QR Code e Copia e Cola
  let pixQrCode: string | null = null;
  let pixCopiaECola: string | null = null;

  try {
    const pixData = await asaasFetch(`/payments/${payment.id}/pixQrCode`, { method: 'GET' });
    pixQrCode = pixData?.encodedImage ?? null;
    pixCopiaECola = pixData?.payload ?? null;
  } catch (err: any) {
    console.warn('[ASAAS AEMADEPA] Falha ao obter QR Code PIX imediato:', err.message);
  }

  return {
    paymentId: String(payment.id),
    customerId: params.customerId,
    pixQrCode,
    pixCopiaECola,
    invoiceUrl: payment.invoiceUrl ?? null,
    value: Number(payment.value || 20.0),
    status: String(payment.status || 'PENDING'),
  };
}
