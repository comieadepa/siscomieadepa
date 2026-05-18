const getAsaasBaseUrl = () =>
  process.env.ASAAS_ENV === 'sandbox'
    ? 'https://sandbox.asaas.com/api/v3'
    : 'https://api.asaas.com/v3';

const getAsaasApiKey = () => {
  // Lida a cada chamada para pegar o valor atualizado do processo
  // Remove eventual barra invertida caso a chave esteja escapada no .env (\$aact → $aact)
  return process.env.ASAAS_API_KEY?.replace(/^\\/, '');
};

export class AsaasApiError extends Error {
  status: number;
  detail: string;
  path: string;

  constructor(message: string, status: number, path: string) {
    super(message);
    this.name = 'AsaasApiError';
    this.status = status;
    this.detail = message;
    this.path = path;
  }
}

const asaasFetch = async (path: string, init: RequestInit) => {
  const ASAAS_API_KEY = getAsaasApiKey();
  if (!ASAAS_API_KEY) {
    throw new Error('ASAAS não configurado');
  }

  const response = await fetch(`${getAsaasBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      access_token: ASAAS_API_KEY,
      ...(init.headers || {}),
    },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data?.errors?.[0]?.detail || data?.message || 'Erro ASAAS';
    console.error('[ASAAS] Erro na requisição:', {
      path,
      status: response.status,
      detail,
      fullResponse: data,
    });
    throw new AsaasApiError(detail, response.status, path);
  }

  return data;
};

type AsaasCustomerInput = {
  name: string;
  email: string;
  cpfCnpj?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  address?: string | null;
  addressNumber?: string | null;
  complement?: string | null;
  province?: string | null;
  postalCode?: string | null;
};

export const createAsaasCustomer = async (payload: AsaasCustomerInput) => {
  return asaasFetch('/customers', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
};

export const deleteAsaasPayment = async (asaasPaymentId: string) => {
  return asaasFetch(`/payments/${asaasPaymentId}`, { method: 'DELETE' });
};

export const createAsaasPayment = async (payload: {
  customer: string;
  value: number;
  dueDate: string;
  description: string;
  billingType: string;
  externalReference?: string;
}) => {
  try {
    console.log('[ASAAS] Criando pagamento:', {
      customer: payload.customer,
      value: payload.value,
      dueDate: payload.dueDate,
      billingType: payload.billingType,
    });

    const result = await asaasFetch('/payments', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    console.log('[ASAAS] Pagamento criado com sucesso:', result.id);
    return result;
  } catch (err) {
    console.error('[ASAAS] Erro ao criar pagamento:', {
      customer: payload.customer,
      value: payload.value,
      error: (err as Error).message,
    });
    throw err;
  }
};

export const ensureAsaasCustomer = async (supabase: any, ministry: any) => {
  if (ministry.asaas_customer_id) {
    return ministry.asaas_customer_id as string;
  }

  // Limpar CNPJ/CPF removendo caracteres especiais
  const cleanCpfCnpj = ministry.cnpj_cpf 
    ? String(ministry.cnpj_cpf).replace(/[^\d]/g, '')
    : null;

  const customerPayload: AsaasCustomerInput = {
    name: ministry.name || 'Ministério Sem Nome',
    email: ministry.email_admin || `no-email-${ministry.id}@gestoservus.local`,
    cpfCnpj: cleanCpfCnpj || null,
    phone: ministry.phone || null,
    mobilePhone: ministry.whatsapp || null,
    address: ministry.address_street || null,
    addressNumber: ministry.address_number || null,
    complement: ministry.address_complement || null,
    province: ministry.address_city || null,
    postalCode: ministry.address_zip || null,
  };

  console.log('[ASAAS] Criando cliente com payload:', {
    name: customerPayload.name,
    email: customerPayload.email,
    cpfCnpj: customerPayload.cpfCnpj,
  });

  try {
    const customer = await createAsaasCustomer(customerPayload);

    if (customer?.id) {
      await supabase
        .from('ministries')
        .update({ asaas_customer_id: customer.id })
        .eq('id', ministry.id);
      console.log('[ASAAS] Cliente criado com sucesso:', customer.id);
    }

    return customer.id as string;
  } catch (err) {
    console.error('[ASAAS] Erro ao criar/obter cliente:', {
      ministryId: ministry.id,
      ministryName: ministry.name,
      error: (err as Error).message,
    });
    throw err;
  }
};

export const buildMonthlyInstallments = (startDate: string, count: number) => {
  const installments: string[] = [];
  const base = new Date(`${startDate}T00:00:00`);

  for (let i = 0; i < count; i += 1) {
    const date = new Date(base);
    date.setMonth(base.getMonth() + i);
    const iso = date.toISOString().slice(0, 10);
    installments.push(iso);
  }

  return installments;
};

const fmtDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Gera as datas e valores das 12 parcelas mensais com vencimento todo dia 10.
 *
 * Regras da 1ª parcela:
 *  - Dia 1–5:  vence no dia 10 do MESMO mês, valor proporcional
 *              (dias restantes até o dia 10 / dias do mês × mensalidade)
 *  - Dia 6+:   vence no dia 10 do MÊS SEGUINTE, valor cheio
 *              (os poucos dias até o dia 10 não são cobrados)
 *
 * Parcelas 2–12: sempre dia 10 dos meses subsequentes, valor cheio.
 *
 * Exemplos (mensalidade R$ 149):
 *   Ativado dia 03/04 → 1ª: 10/04, R$ (7/30×149) ≈ R$ 34,77 (proporcional)
 *   Ativado dia 06/04 → 1ª: 10/05, R$ 149,00 (cheio, próximo mês)
 *   Ativado dia 10/04 → 1ª: 10/05, R$ 149,00 (cheio, próximo mês)
 *   Ativado dia 30/04 → 1ª: 10/05, R$ 149,00 (cheio, próximo mês)
 */
export function buildBillingInstallments(
  activationDate: Date,
  monthlyPrice: number,
  count = 12
): Array<{ dueDate: string; amount: number; isProrated: boolean }> {
  const day = activationDate.getDate();
  const year = activationDate.getFullYear();
  const month = activationDate.getMonth();

  let firstDueDate: Date;
  let firstAmount: number;
  let isProrated: boolean;

  if (day <= 5) {
    // Cobra proporcional até o dia 10 do mesmo mês
    firstDueDate = new Date(year, month, 10);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysUntilDue = 10 - day; // ex.: dia 3 → 7 dias
    firstAmount = Math.round((daysUntilDue / daysInMonth) * monthlyPrice * 100) / 100;
    isProrated = true;
  } else {
    // Cobra valor cheio no dia 10 do próximo mês (dias até lá não são cobrados)
    firstDueDate = new Date(year, month + 1, 10);
    firstAmount = monthlyPrice;
    isProrated = false;
  }

  const installments: Array<{ dueDate: string; amount: number; isProrated: boolean }> = [
    { dueDate: fmtDate(firstDueDate), amount: firstAmount, isProrated },
  ];

  for (let i = 1; i < count; i++) {
    const d = new Date(firstDueDate.getFullYear(), firstDueDate.getMonth() + i, 10);
    installments.push({ dueDate: fmtDate(d), amount: monthlyPrice, isProrated: false });
  }

  return installments;
}

// ─────────────────────────────────────────────────────────────
// FUNÇÕES ESPECÍFICAS PARA EVENTOS
// ─────────────────────────────────────────────────────────────

export interface AsaasEventoPaymentResult {
  id: string;
  status: string;
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  pixQrCode: string | null;
  pixCopiaECola: string | null;
}

/**
 * Cria ou reutiliza um cliente ASAAS a partir dos dados do inscrito.
 * Não persiste na DB — só retorna o ID do cliente criado/existente.
 */
export const createOrFindAsaasCustomer = async (payload: {
  nome: string;
  email: string | null;
  cpf: string | null;
  whatsapp: string | null;
}): Promise<string> => {
  const cleanCpf = payload.cpf ? payload.cpf.replace(/\D/g, '') : null;
  if (!cleanCpf) {
    throw new Error('CPF do pagador e obrigatorio para gerar cobranca ASAAS');
  }

  // Evita erro de CPF duplicado no ASAAS reaproveitando cliente existente
  try {
    const existing = await asaasFetch(`/customers?cpfCnpj=${cleanCpf}&limit=1`, {
      method: 'GET',
    });
    const first = Array.isArray(existing?.data) ? existing.data[0] : null;
    if (first?.id) return String(first.id);
  } catch {
    // Ignora falhas de lookup e tenta criar normalmente
  }

  const customer = await asaasFetch('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name: payload.nome,
      email: payload.email || `sem-email-${Date.now()}@gestoservus.local`,
      cpfCnpj: cleanCpf || undefined,
      mobilePhone: payload.whatsapp ? payload.whatsapp.replace(/\D/g, '') : undefined,
    }),
  });

  if (!customer?.id) throw new Error('ASAAS não retornou ID do cliente');
  return customer.id as string;
};

/**
 * Cria cobrança UNDEFINED (PIX + boleto + cartão) para inscrição de evento.
 * billingType: 'UNDEFINED' = ASAAS gera link de pagamento com todas as formas.
 */
export const createEventoPayment = async (payload: {
  customerId: string;
  value: number;
  dueDate: string;
  description: string;
  externalReference: string;
}): Promise<AsaasEventoPaymentResult> => {
  const payment = await asaasFetch('/payments', {
    method: 'POST',
    body: JSON.stringify({
      customer: payload.customerId,
      billingType: 'UNDEFINED',
      value: payload.value,
      dueDate: payload.dueDate,
      description: payload.description,
      externalReference: payload.externalReference,
    }),
  });

  // Busca QR Code PIX separadamente
  let pixQrCode: string | null = null;
  let pixCopiaECola: string | null = null;
  try {
    const pix = await asaasFetch(`/payments/${payment.id}/pixQrCode`, { method: 'GET' });
    pixQrCode    = pix?.encodedImage ?? null;
    pixCopiaECola = pix?.payload ?? null;
  } catch {
    // PIX pode não estar disponível imediatamente — ignora silenciosamente
  }

  return {
    id:            payment.id,
    status:        payment.status,
    invoiceUrl:    payment.invoiceUrl    ?? null,
    bankSlipUrl:   payment.bankSlipUrl   ?? null,
    pixQrCode,
    pixCopiaECola,
  };
};

/** Consulta status + dados de pagamento de um charge ASAAS */
export const getAsaasPayment = async (paymentId: string) => {
  return asaasFetch(`/payments/${paymentId}`, { method: 'GET' });
};

/** Consulta QR Code PIX de um pagamento existente */
export const getAsaasPixQrCode = async (paymentId: string): Promise<{
  encodedImage: string | null;
  payload: string | null;
}> => {
  try {
    const pix = await asaasFetch(`/payments/${paymentId}/pixQrCode`, { method: 'GET' });
    return { encodedImage: pix?.encodedImage ?? null, payload: pix?.payload ?? null };
  } catch {
    return { encodedImage: null, payload: null };
  }
};
