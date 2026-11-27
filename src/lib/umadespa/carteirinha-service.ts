import { cleanCpf, isValidCpf } from '@/lib/cpf';
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
 * Cria ou localiza cliente ASAAS para o Associado UMADESPA
 * Valida rigorosamente o CPF e reutiliza createOrFindAsaasCustomer.
 */
export async function getOrCreateAsaasCustomerForUmadespa(params: {
  nome: string;
  cpf: string;
  email?: string | null;
  fone?: string | null;
}): Promise<string> {
  const digits = cleanCpf(params.cpf);
  if (!digits || digits.length !== 11 || !isValidCpf(digits)) {
    throw new Error('CPF do associado ausente ou inválido. Corrija o documento antes de gerar cobrança ASAAS.');
  }

  try {
    return await createOrFindAsaasCustomer({
      nome: params.nome.trim(),
      email: params.email?.trim() || null,
      cpf: digits,
      whatsapp: params.fone || null,
    });
  } catch (err: any) {
    console.error('[ASAAS UMADESPA] Erro ao cadastrar pagador:', err.message);
    throw new Error(`Erro ASAAS ao cadastrar pagador: ${err.message}`);
  }
}

/**
 * Reconcilia cobrança existente no ASAAS pelo externalReference exclusivo da UMADESPA
 */
export async function findAsaasPaymentByExternalReferenceUmadespa(
  solicitacaoId: string
): Promise<AsaasPixResponse | null> {
  const externalRef = `umadespa_carteirinha:${solicitacaoId}`;
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
      value: Number(item.value || 0),
      status: String(item.status || 'PENDING'),
    };
  } catch (err: any) {
    console.warn('[ASAAS UMADESPA] Falha ao consultar externalReference:', err.message);
    return null;
  }
}

/**
 * Cria cobrança PIX oficial no ASAAS com externalReference exclusiva 'umadespa_carteirinha:<solicitacaoId>'
 * e valor congelado conforme configuração.
 */
export async function createUmadespaPixCharge(params: {
  customerId: string;
  solicitacaoId: string;
  valor: number;
  via: number;
  nomeAssociado: string;
  descricao?: string;
}): Promise<AsaasPixResponse> {
  if (!params.valor || params.valor <= 0) {
    throw new Error('Não há taxa configurada ou o valor é inválido. A cobrança não pode ser criada.');
  }

  const externalReference = `umadespa_carteirinha:${params.solicitacaoId}`;
  const dueDate = formatPixDueDate(3);
  const description =
    params.descricao ||
    `UMADESPA — Carteirinha da Juventude (${params.via}ª Via) - ${params.nomeAssociado}`;

  const payment = await asaasFetch('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: params.customerId,
      billingType: 'PIX',
      value: Number(params.valor.toFixed(2)),
      dueDate,
      description,
      externalReference,
    }),
  });

  if (!payment?.id) {
    throw new Error(payment?.errors?.[0]?.description || 'Erro ao gerar cobrança no ASAAS');
  }

  let pixQrCode: string | null = null;
  let pixCopiaECola: string | null = null;
  try {
    const pix = await asaasFetch(`/payments/${payment.id}/pixQrCode`, { method: 'GET' });
    pixQrCode = pix?.encodedImage ?? null;
    pixCopiaECola = pix?.payload ?? null;
  } catch (err: any) {
    console.warn('[ASAAS UMADESPA] Não foi possível obter QR Code PIX imediato:', err.message);
  }

  return {
    paymentId: String(payment.id),
    customerId: params.customerId,
    pixQrCode,
    pixCopiaECola,
    invoiceUrl: payment.invoiceUrl ?? null,
    value: Number(payment.value || params.valor),
    status: String(payment.status || 'PENDING'),
  };
}
