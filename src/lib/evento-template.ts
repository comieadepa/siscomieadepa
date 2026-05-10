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

/**
 * Substitui variáveis {CHAVE} no template pelo valor correspondente.
 * Variáveis desconhecidas são mantidas como estão.
 */
export function parseEventoTemplate(
  template: string,
  vars: EventoTemplateVars
): string {
  const resolved: Record<string, string> = {
    NOME:             vars.NOME             ?? '',
    EVENTO:           vars.EVENTO           ?? '',
    LINK_GRUPO:       vars.LINK_GRUPO       ?? '',
    QR_CODE:          vars.QR_CODE          ?? '',
    STATUS_PAGAMENTO: STATUS_LABELS[vars.STATUS_PAGAMENTO ?? ''] ?? (vars.STATUS_PAGAMENTO ?? ''),
    LOCAL:            vars.LOCAL            ?? '',
    DATA_EVENTO:      vars.DATA_EVENTO      ?? '',
  };

  return template.replace(/\{([A-Z_]+)\}/g, (match, key) =>
    key in resolved ? resolved[key] : match
  );
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
