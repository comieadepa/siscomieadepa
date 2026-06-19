/**
 * Engine de templates para comunicação do módulo Eventos.
 * Processa variáveis nas mensagens configuradas pelos organizadores.
 */

export interface EventoTemplateVars {
  NOME?:             string;
  EVENTO?:           string;
  LINK_GRUPO?:       string;
  QR_CODE?:          string;
  STATUS_PAGAMENTO?: string;
  LOCAL?:            string;
  DATA_EVENTO?:      string;
}

const STATUS_LABELS: Record<string, string> = {
  pago:      'Pago ✅',
  pendente:  'Pendente ⏳',
  isento:    'Isento ✅',
  cancelado: 'Cancelado ❌',
};


function formatarDataBr(d: string | null | undefined): string {
  if (!d) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  }
  return d;
}

/**
 * Substitui variáveis/placeholders em formatos simples ou duplos.
 * Exemplo: {NOME_DO_EVENTO} ou {{NOME_DO_EVENTO}}
 */
export function renderTemplate(
  template: string,
  dados: any
): string {
  if (!template) return '';

  // Garante mapeamento de aliases de dados, suportando flat object ou nested object
  const resolvedName = String(
    dados.evento?.nome || 
    dados.EVENTO || 
    dados.NOME_DO_EVENTO || 
    dados.nomeEvento ||
    ''
  );

  let finalEvento = resolvedName;
  // Caso específico UMADESPA
  if (resolvedName.toUpperCase().includes('UMADESPA')) {
    finalEvento = 'CONGRESSO UMADESPA 2026 - BELÉM';
  }

  const resolvedStatus = String(dados.inscricao?.status_pagamento || dados.STATUS_PAGAMENTO || dados.status_pagamento || '');

  // Formatação robusta de datas
  let dataStr = '';
  if (dados.evento?.data_inicio) {
    const inicio = formatarDataBr(dados.evento.data_inicio);
    const fim = dados.evento.data_fim ? formatarDataBr(dados.evento.data_fim) : '';
    dataStr = (fim && fim !== inicio) ? `${inicio} a ${fim}` : inicio;
  } else {
    dataStr = formatarDataBr(dados.DATA_EVENTO || dados.data_evento || '');
  }

  const resolved: Record<string, string> = {
    NOME_DO_EVENTO:   finalEvento,
    EVENTO:           finalEvento,
    NOME:             String(dados.inscricao?.nome || dados.inscricao?.nome_inscrito || dados.NOME || dados.nome || ''),
    CODIGO_CHECKIN:   String(dados.inscricao?.codigo_checkin || dados.inscricao?.qr_code || dados.QR_CODE || dados.CODIGO_CHECKIN || dados.qrCode || ''),
    QR_CODE:          String(dados.inscricao?.codigo_checkin || dados.inscricao?.qr_code || dados.QR_CODE || dados.CODIGO_CHECKIN || dados.qrCode || ''),
    STATUS_PAGAMENTO: STATUS_LABELS[resolvedStatus] ?? resolvedStatus,
    LINK_WHATSAPP:    String(dados.evento?.link_whatsapp || dados.LINK_WHATSAPP || dados.LINK_GRUPO || dados.linkWhatsapp || ''),
    LINK_GRUPO:       String(dados.evento?.link_whatsapp || dados.LINK_WHATSAPP || dados.LINK_GRUPO || dados.linkWhatsapp || ''),
    DATA_EVENTO:      dataStr,
    LOCAL_EVENTO:     String(dados.evento?.local || dados.LOCAL_EVENTO || dados.LOCAL || dados.local || ''),
    LOCAL:            String(dados.evento?.local || dados.LOCAL_EVENTO || dados.LOCAL || dados.local || ''),
  };

  let output = template;

  // Substitui {{VAR}} e depois {VAR}
  output = output.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) =>
    key in resolved ? resolved[key] : match
  );
  output = output.replace(/\{([A-Z0-9_]+)\}/g, (match, key) =>
    key in resolved ? resolved[key] : match
  );

  // Validação: Não enviar placeholder cru ao inscrito
  const placeholderRegex = /\{[{]?[A-Z0-9_]+[}]?\}/g;
  const matches = output.match(placeholderRegex);
  if (matches && matches.length > 0) {
    console.warn(`[renderTemplate] Placeholders restantes limpos:`, matches);
    output = output.replace(placeholderRegex, '');
  }

  return output;
}


/**
 * Substitui variáveis {CHAVE} no template pelo valor correspondente.
 * Variáveis desconhecidas são limpas ou mantidas se não listadas.
 */
export function parseEventoTemplate(
  template: string,
  vars: EventoTemplateVars
): string {
  return renderTemplate(template, vars);
}

/**
 * Templates padrão por gatilho (usado quando o evento não tem mensagem_confirmacao).
 */
export const TEMPLATES_PADRAO: Record<string, { assunto: string; mensagem: string }> = {
  inscricao_criada: {
    assunto:  'Confirmação de Inscrição — {EVENTO}',
    mensagem: `Olá, {NOME}!

Sua inscrição no evento *{EVENTO}* foi realizada com sucesso.

📋 Código de acesso: *{QR_CODE}*
💳 Status do pagamento: {STATUS_PAGAMENTO}
📍 Local: {LOCAL}
📅 Data: {DATA_EVENTO}

{LINK_GRUPO}

Guarde este código para apresentar no check-in.`,
  },
  pagamento_confirmado: {
    assunto:  'Pagamento Confirmado — {EVENTO}',
    mensagem: `Olá, {NOME}!

Seu pagamento para o evento *{EVENTO}* foi confirmado! ✅

📋 Código de acesso: *{QR_CODE}*
📍 Local: {LOCAL}
📅 Data: {DATA_EVENTO}

Nos vemos lá!`,
  },
  checkin_realizado: {
    assunto:  'Presença Confirmada — {EVENTO}',
    mensagem: `Olá, {NOME}!

Sua presença no evento *{EVENTO}* foi registrada com sucesso! 🎉

Aproveite o evento!`,
  },
  manual: {
    assunto:  'Mensagem do evento {EVENTO}',
    mensagem: `Olá, {NOME}!\n\n{EVENTO}`,
  },
};

/**
 * Gera assunto e mensagem finais para uma notificação,
 * priorizando o template do evento quando disponível.
 */
export function buildNotificacao(opts: {
  gatilho:             string;
  vars:                EventoTemplateVars;
  templateEvento?:     string | null; // mensagem_confirmacao do evento
}): { assunto: string; mensagem: string } {
  const padrao = TEMPLATES_PADRAO[opts.gatilho] ?? TEMPLATES_PADRAO.manual;

  const assunto  = parseEventoTemplate(padrao.assunto, opts.vars);
  const mensagem = parseEventoTemplate(
    opts.gatilho === 'inscricao_criada' && opts.templateEvento
      ? opts.templateEvento
      : padrao.mensagem,
    opts.vars
  );

  return { assunto, mensagem };
}
