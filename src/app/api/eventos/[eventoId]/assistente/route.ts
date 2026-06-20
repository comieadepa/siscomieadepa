import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// ── Helpers ────────────────────────────────────────────────────
const fmtData = (d: string | null) => {
  if (!d) return 'não informado';
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};
const fmtMoeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtHora = (h: string | null) => {
  if (!h) return '';
  return h.slice(0, 5); // HH:MM
};

// ── Formata CPF (11 dígitos → ###.###.###-##) ─────────────────
function formatarCpf(digits: string): string {
  return digits.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
}

// ── Verifica se toda a string é um CPF (puro ou mascarado) ────
function isCpfOnly(s: string): boolean {
  const t = s.trim();
  return /^\d{11}$/.test(t) || /^\d{3}[.\s]\d{3}[.\s]\d{3}[-\s]\d{2}$/.test(t);
}

// ── Extrai CPF de uma frase (puro, pontuado, com espaços) ────
function extractCpfDigits(text: string): string | null {
  const match = text.match(/(\d{3}\D*\d{3}\D*\d{3}\D*\d{2}|\d{11})/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

// ── Suporte do evento ─────────────────────────────────────────
function suporteMsg(evento: Record<string, unknown>): string {
  const nome = (evento.suporte_nome as string | null) || '';
  const telRaw = evento.suporte_whatsapp as string | number | null;
  const telDigits = String(telRaw ?? '').replace(/\D/g, '');
  if (!telDigits) return '';
  const nomeLinha = nome ? `${nome}\n` : '';
  return `\n\nNossa equipe pode te ajudar rapidamente 🙏\n📱 Suporte do evento:\n${nomeLinha}https://wa.me/55${telDigits}`;
}

function appendSuporte(msg: string, evento: Record<string, unknown>): string {
  const s = suporteMsg(evento);
  return s ? msg + s : msg;
}

function appendAssinatura(msg: string): string {
  return `${msg}\n\n— Maia 💙`;
}

type Intent = 'segunda_via' | 'consulta_inscricao' | 'hospedagem' | 'certificado' | null;
type SocialKind = 'saudacao' | 'agradecimento' | 'confirmacao' | 'despedida' | null;

function normalizeTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(texto: string, termos: string[]): boolean {
  return termos.some(termo => texto.includes(termo));
}

function detectarMensagemSocial(texto: string): SocialKind {
  const t = normalizeTexto(texto);
  if (!t) return null;
  const tokens = t.split(' ').filter(Boolean);
  const tokenSet = new Set(tokens);
  const hasPhrase = (frase: string) => t.includes(frase);

  const despedida = tokenSet.has('tchau') || tokenSet.has('fui') || hasPhrase('ate mais');
  if (despedida) return 'despedida';

  const agradecimento = tokenSet.has('obrigado') || tokenSet.has('obrigada') || tokenSet.has('valeu')
    || tokenSet.has('tmj') || tokenSet.has('gratidao') || tokenSet.has('show') || tokenSet.has('perfeito');
  if (agradecimento) return 'agradecimento';

  const saudacao = tokenSet.has('oi') || tokenSet.has('ola') || tokenSet.has('eae') || tokenSet.has('opa')
    || hasPhrase('bom dia') || hasPhrase('boa tarde') || hasPhrase('boa noite');
  if (saudacao) return 'saudacao';

  const confirmacao = tokenSet.has('ok') || tokenSet.has('certo') || tokenSet.has('entendi')
    || tokenSet.has('blz') || tokenSet.has('beleza') || tokenSet.has('joia') || texto.includes('👍');
  if (confirmacao) return 'confirmacao';

  return null;
}

function normalizeIntent(value: unknown): Intent {
  if (value === 'segunda_via' || value === 'consulta_inscricao' || value === 'hospedagem' || value === 'certificado') {
    return value;
  }
  return null;
}

function inferIntent(pergunta: string): Intent {
  const p = normalizeTexto(pergunta);
  const pNoSpace = p.replace(/\s+/g, '');

  const isSegundaVia = hasAny(p, [
    'segunda via',
    'segundo via',
    'segunda bia',
    'boleto',
    'pix',
    'link de pagamento',
    'link do pagamento',
    'pagamento',
    'pagar inscricao',
    'perdi o pagamento',
    'gerar cobranca',
  ])
    || hasAny(pNoSpace, ['2via', '2avia'])
    || /\b2\s+via\b/.test(p)
    || /\bsegund[ao]\s+vi?a\b/.test(p)
    || /\bsegunda\s+bi?a\b/.test(p);

  if (isSegundaVia) return 'segunda_via';

  const isInscricao = hasAny(p, [
    'minha inscricao',
    'inscricao',
    'status',
    'confirmado',
    'confirmada',
    'estou inscrito',
    'consultar inscricao',
  ]);
  if (isInscricao) return 'consulta_inscricao';

  const isHospedagem = hasAny(p, ['hospedagem', 'alojamento', 'dormir', 'cama', 'leito']);
  if (isHospedagem) return 'hospedagem';

  if (p.includes('certificado')) return 'certificado';
  return null;
}

// ── Monta resposta de segunda via de pagamento ───────────────
function respostaSegundaVia(
  inscricao: Record<string, unknown>,
  evento: Record<string, unknown>
): string {
  const nomeEvento = evento.nome as string;
  const status = inscricao.status_pagamento as string;
  if (status === 'pago' || status === 'isento') {
    return `✅ Sua inscrição no evento *${nomeEvento}* já está paga! Não é necessário realizar nenhum pagamento.`;
  }
  if (status !== 'pendente') {
    return appendSuporte(`Sua inscrição está com status *${status}*. Entre em contato com a organização do evento para regularizar.`, evento);
  }

  const invoiceUrl   = inscricao.invoice_url    as string | null;
  const pixCopia     = inscricao.pix_copia_cola  as string | null;
  const valorFinal   = inscricao.valor_final     as number | null;
  const vencimento   = inscricao.asaas_due_date  as string | null;

  if (!pixCopia && !invoiceUrl) {
    return appendSuporte('Os dados de pagamento não foram encontrados.', evento);
  }

  const statusLabel = '⏳ Pendente';
  let msg = `💳 Segunda via — *${nomeEvento}*`;
  msg += `\n💳 Status: ${statusLabel}`;
  if (valorFinal && valorFinal > 0) {
    msg += `\n💰 Valor: ${fmtMoeda(valorFinal)}`;
  }
  if (vencimento) {
    msg += `\n📅 Vencimento: ${fmtData(vencimento)}`;
  }
  if (pixCopia) {
    msg += `\n\n📋 *PIX Copia e Cola:*\n${pixCopia}`;
  }
  if (invoiceUrl) {
    msg += `\n\n🔗 *Link de pagamento (PIX, boleto, cartão):*\n${invoiceUrl}`;
  }
  return msg;
}

function formatarHospedagemMsg(
  inscricao: Record<string, unknown>,
  hospedagemInfo: Record<string, unknown> | null
): string {
  const status = (hospedagemInfo?.status as string) || (inscricao.status_pagamento === 'pendente' ? 'aguardando_pagamento' : 'aguardando_alocacao');
  const temHospedagem = Boolean(inscricao.hospedagem) || (hospedagemInfo !== null && status !== 'recusada');

  if (!temHospedagem) {
    return `Hospedagem: Não solicitada`;
  }

  const alojamento = (hospedagemInfo?.evento_alojamentos as any)?.nome || 'não definido';
  const leitoNum = hospedagemInfo?.leito_numero || hospedagemInfo?.numero_cama || 'não definido';
  const leitoTipo = hospedagemInfo?.leito_tipo || hospedagemInfo?.tipo_cama || 'não definido';
  const leitoPosicao = hospedagemInfo?.leito_posicao || hospedagemInfo?.tipo_cama || 'não definido';
  const grupo = (hospedagemInfo?.grupo_hospedagem as string) || 'não definido';

  if (status === 'alocada' || status === 'confirmada' || status === 'checkin_realizado') {
    let sitLabel = 'Alocada';
    if (status === 'confirmada') sitLabel = 'Confirmada';
    if (status === 'checkin_realizado') sitLabel = 'Check-in realizado';

    return `Hospedagem: Incluída
Status: ${sitLabel}
Alojamento: ${alojamento}
Leito: ${leitoNum}
Tipo de leito: ${leitoTipo}
Posição: ${leitoPosicao}
Grupo: ${grupo}`;
  }

  if (status === 'lista_espera') {
    return `Hospedagem: Solicitada
Status: Lista de espera`;
  }

  // Default / aguardando_pagamento / aguardando_alocacao
  return `Hospedagem: Solicitada
Status: Aguardando alocação`;
}

function formatarAlimentacaoMsg(
  inscricao: Record<string, unknown>,
  evento: Record<string, unknown>
): string {
  const ativa = !!(inscricao.alimentacao || evento.departamento === 'AGO');
  const statusText = ativa ? 'Ativa' : 'Inativa';

  const totalRef = Number(inscricao.quantidade_refeicoes_total ?? inscricao.refeicoes_total ?? (evento.departamento === 'AGO' ? 12 : 0));
  const usadasRef = Number(inscricao.quantidade_refeicoes_usadas ?? inscricao.refeicoes_utilizadas ?? 0);
  const saldoRef = Number(inscricao.quantidade_refeicoes_saldo ?? Math.max(0, totalRef - usadasRef));

  return `🍽 **Alimentação**

Status: ${statusText}

Total de refeições: ${totalRef}

Utilizadas: ${usadasRef}

Saldo disponível: ${saldoRef}`;
}

// ── Resposta estruturada para consulta de CPF ─────────────────
function respostaCpfConsulta(
  nomeEvento: string,
  cpfDigits: string,
  inscricao: Record<string, unknown> | null,
  evento: Record<string, unknown>,
  hospedagemInfo: Record<string, unknown> | null = null
): string {
  const cpfFormatado = formatarCpf(cpfDigits);
  if (!inscricao) {
    const msg = appendSuporte(
      `Não encontrei inscrição vinculada ao CPF *${cpfFormatado}* neste evento.\n\nVerifique se o CPF está correto ou entre em contato com a organização do evento.`,
      evento
    );
    return appendAssinatura(msg);
  }
  const nome   = inscricao.nome_inscrito as string;
  const status = inscricao.status_pagamento as string;
  const statusLabel = status === 'pago'     ? '✅ Pago'
                    : status === 'isento'   ? '🎁 Isento'
                    : status === 'pendente' ? '⏳ Pendente'
                    : status;
  let msg = `✅ Encontrei sua inscrição em *${nomeEvento}*!\n\n👤 Nome: ${nome}\n💳 Pagamento: ${statusLabel}`;
  if (inscricao.brinde) msg += '\n🎁 Brinde: incluído';

  msg += `\n\n${formatarHospedagemMsg(inscricao, hospedagemInfo)}`;

  if (inscricao.alimentacao || evento.departamento === 'AGO') {
    msg += `\n\n${formatarAlimentacaoMsg(inscricao, evento)}`;
  } else {
    msg += `\n\n🍽 **Alimentação**\nStatus: Inativa`;
  }

  if (status === 'pendente')  msg += '\n\n⏳ Seu pagamento ainda não foi confirmado. O código de check-in será disponibilizado após a confirmação.';
  return msg;
}

// ── Modo fallback (sem OpenAI) ─────────────────────────────────
function respostaFallback(
  pergunta: string,
  evento: Record<string, unknown>,
  programacao: Record<string, unknown>[],
  inscricao: Record<string, unknown> | null,
  hospedagemInfo: Record<string, unknown> | null = null
): string {
  const p = normalizeTexto(pergunta);
  const pNoSpace = p.replace(/\s+/g, '');

  const social = detectarMensagemSocial(pergunta);
  if (social === 'saudacao') {
    return 'Olá 😊\nSou a Maia. Como posso te ajudar?';
  }
  if (social === 'agradecimento') {
    return 'Por nada 😊\nFico feliz em ajudar.';
  }
  if (social === 'confirmacao') {
    return 'Perfeito 😊';
  }
  if (social === 'despedida') {
    return 'Até mais 😊\nQualquer dúvida estarei por aqui.';
  }

  const cpfDetectado = extractCpfDigits(pergunta);
  if (cpfDetectado) {
    return respostaCpfConsulta(
      evento.nome as string,
      cpfDetectado,
      inscricao,
      evento,
      hospedagemInfo
    );
  }

  // ── CPF puro: detecta quando a mensagem inteira é um CPF ─────
  const pTrim = p.trim();
  if (/^\d{11}$/.test(pTrim) || /^\d{3}[.\s]\d{3}[.\s]\d{3}[-\s]\d{2}$/.test(pTrim)) {
    return respostaCpfConsulta(
      evento.nome as string,
      pTrim.replace(/\D/g, ''),
      inscricao,
      evento,
      hospedagemInfo
    );
  }

  // ── Segunda via / boleto / link de pagamento ─────────────────
  const isSegundaVia = hasAny(p, [
    'segunda via',
    'segundo via',
    'segunda bia',
    'boleto',
    'pix',
    'link de pagamento',
    'link do pagamento',
    'pagamento',
    'pagar inscricao',
    'perdi o pagamento',
    'gerar cobranca',
  ])
    || hasAny(pNoSpace, ['2via', '2avia'])
    || /\b2\s+via\b/.test(p)
    || /\bsegund[ao]\s+vi?a\b/.test(p)
    || /\bsegunda\s+bi?a\b/.test(p);

  if (isSegundaVia) {
    if (!inscricao) {
      return 'Claro 😊\nMe informe seu CPF para localizar sua inscrição.';
    }
    return respostaSegundaVia(inscricao, evento);
  }

  // ── Status de inscrição ──────────────────────────────────────
  if (hasAny(p, ['minha inscricao', 'inscricao', 'status', 'confirmado', 'confirmada', 'estou inscrito', 'consultar inscricao'])) {
    if (!inscricao) {
      return 'Para consultar sua inscrição, informe seu CPF na caixa de texto (ex: "CPF: 000.000.000-00"). Assim posso verificar sua situação no evento.';
    }
    return respostaCpfConsulta(evento.nome as string, String(inscricao.cpf || '').replace(/\D/g, ''), inscricao, evento, hospedagemInfo);
  }

  // ── Pagamento ────────────────────────────────────────────────
  if (hasAny(p, ['pagamento', 'pago', 'pix', 'valor'])) {
    if (inscricao) {
      const status = inscricao.status_pagamento as string;
      if (status === 'pago' || status === 'isento') return '✅ Seu pagamento já está confirmado!';
      return respostaSegundaVia(inscricao, evento);
    }
    const valor = evento.valor_inscricao as number;
    if (valor === 0) return '🎁 A inscrição neste evento é gratuita!';
    return `💳 O valor da inscrição é ${fmtMoeda(valor)}. Informe seu CPF para verificar o status do seu pagamento.`;
  }

  // ── Hospedagem ───────────────────────────────────────────────
  if (hasAny(p, ['hospedagem', 'alojamento', 'dormir', 'pernoite', 'cama', 'leito'])) {
    if (inscricao) {
      return formatarHospedagemMsg(inscricao, hospedagemInfo);
    }
    const permiteHosp = evento.permite_hospedagem as boolean;
    return permiteHosp
      ? '🛏️ Este evento oferece hospedagem. Ao se inscrever, você pode solicitar hospedagem conforme disponibilidade.'
      : '❌ Este evento não oferece hospedagem.';
  }

  // ── Alimentação ──────────────────────────────────────────────
  if (hasAny(p, ['alimentacao', 'refeicao', 'refeicoes', 'almoco', 'jantar', 'saldo', 'saldo de refeicoes'])) {
    if (inscricao) {
      return formatarAlimentacaoMsg(inscricao, evento);
    }
    const permiteAlim = (evento.permite_alimentacao || evento.departamento === 'AGO') as boolean;
    return permiteAlim
      ? '🍽️ Este evento oferece alimentação. Nos eventos AGO, todos os inscritos possuem alimentação incluída (12 refeições).'
      : '❌ Este evento não oferece alimentação.';
  }

  // ── Brinde ───────────────────────────────────────────────────
  if (hasAny(p, ['brinde', 'kit', 'presente'])) {
    if (inscricao) {
      return inscricao.brinde
        ? '🎁 Sua inscrição inclui brinde!'
        : '❌ Sua inscrição não inclui brinde.';
    }
    const permiteBrinde = evento.permite_brinde as boolean;
    return permiteBrinde
      ? '🎁 Este evento oferece brinde para inscrições que incluem essa opção.'
      : '❌ Este evento não oferece brinde.';
  }

  // ── Local ────────────────────────────────────────────────────
  if (hasAny(p, ['local', 'onde', 'lugar', 'endereco', 'cidade'])) {
    const local  = evento.local as string | null;
    const cidade = evento.cidade as string | null;
    if (!local && !cidade) return 'O local do evento ainda não foi informado no sistema.';
    return `📍 O evento será realizado em: ${[local, cidade].filter(Boolean).join(' — ')}`;
  }

  // ── Data ─────────────────────────────────────────────────────
  if (hasAny(p, ['data', 'quando', 'dia', 'mes'])) {
    const inicio = fmtData(evento.data_inicio as string | null);
    const fim    = fmtData(evento.data_fim as string | null);
    return `📅 O evento acontece de ${inicio} a ${fim}.`;
  }

  // ── Programação ──────────────────────────────────────────────
  if (hasAny(p, ['programacao', 'agenda', 'horario', 'palestra', 'palestrante', 'culto', 'abertura', 'atividade', 'grade'])) {
    if (programacao.length === 0) {
      return 'A programação detalhada ainda não foi cadastrada. Fique atento às novidades!';
    }
    // Agrupa por data
    const porDia = new Map<string, Record<string, unknown>[]>();
    for (const item of programacao) {
      const dia = item.data as string;
      if (!porDia.has(dia)) porDia.set(dia, []);
      porDia.get(dia)!.push(item);
    }
    let txt = '📋 *Programação do evento:*\n\n';
    for (const [dia, itens] of porDia) {
      txt += `*${fmtData(dia)}*\n`;
      for (const it of itens) {
        const hora = fmtHora(it.horario as string | null);
        txt += `  ${hora ? hora + 'h — ' : ''}${it.titulo}`;
        if (it.palestrante) txt += ` (${it.palestrante})`;
        txt += '\n';
      }
      txt += '\n';
    }
    return txt.trim();
  }

  // ── WhatsApp ─────────────────────────────────────────────────
  if (hasAny(p, ['whatsapp', 'grupo', 'zap', 'link do grupo'])) {
    const link = evento.link_whatsapp as string | null;
    if (!link) return 'O link do grupo de WhatsApp ainda não foi disponibilizado. Aguarde!';
    return `📲 Acesse o grupo do WhatsApp pelo link:\n${link}`;
  }

  // ── Tipos de inscrição ───────────────────────────────────────
  if (hasAny(p, ['modalidade', 'tipo', 'categoria', 'opcao'])) {
    return 'Para ver as modalidades de inscrição disponíveis, acesse a página de inscrição do evento. Lá você encontrará todas as opções com valores detalhados.';
  }

  // ── Saudação ─────────────────────────────────────────────────
  if (hasAny(p, ['ola', 'oi', 'bom dia', 'boa', 'ajuda'])) {
    return `Oi 😊\nSou a Maia e estou aqui para te ajudar com informações do evento *${evento.nome}*.\n\nPosso responder sobre:\n• Local e data\n• Sua inscrição (informe o CPF)\n• Segunda via de pagamento / link PIX\n• Hospedagem e brinde\n• Programação\n• Grupo do WhatsApp\n\nO que deseja saber?`;
  }

  // ── Fallback genérico ────────────────────────────────────────
  const fallbackMsg = appendSuporte(
    'Não tenho informações detalhadas sobre isso no momento. Você pode perguntar sobre:\n• Local e data do evento\n• Sua inscrição (com CPF)\n• Pagamento\n• Hospedagem\n• Programação\n• Grupo de WhatsApp',
    evento
  );
  return appendAssinatura(fallbackMsg);
}

// ── POST /api/eventos/[eventoId]/assistente ────────────────────
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  try {
    const body = await req.json();
    const pergunta: string = String(body.pergunta || '').trim();
    const cpfRaw: string   = String(body.cpf || '').trim();
    const intentFromContext = normalizeIntent(body?.contexto?.intent);
    let cpf = cpfRaw.replace(/\D/g, '');

    // Se a pergunta em si é um CPF, extrai e usa como CPF de consulta
    const perguntaIsCpf = isCpfOnly(pergunta);
    const cpfFromPergunta = extractCpfDigits(pergunta);
    const cpfEncontradoNaPergunta = !!cpfFromPergunta;
    if (cpfFromPergunta && cpf.length !== 11) {
      cpf = cpfFromPergunta;
    }
    if (perguntaIsCpf && cpf.length !== 11) {
      cpf = pergunta.replace(/\D/g, '');
    }

    if (!pergunta) {
      return NextResponse.json({ error: 'Pergunta é obrigatória.' }, { status: 400 });
    }

    const supabase = createServerClient();

    // ── Busca dados do evento ──────────────────────────────────
    const [evRes, progRes] = await Promise.all([
      supabase
        .from('eventos')
        .select('id,nome,slug,descricao,departamento,data_inicio,data_fim,local,cidade,valor_inscricao,permite_hospedagem,permite_alimentacao,permite_brinde,link_whatsapp,mensagem_confirmacao,publico_alvo,status,suporte_nome,suporte_whatsapp')
        .eq('id', eventoId)
        .single(),
      supabase
        .from('evento_programacao')
        .select('data,horario,titulo,descricao,palestrante,local,ordem')
        .eq('evento_id', eventoId)
        .order('data')
        .order('horario', { ascending: true, nullsFirst: true })
        .order('ordem'),
    ]);

    if (evRes.error || !evRes.data) {
      return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
    }

    const evento = evRes.data as Record<string, unknown>;
    const programacao = (progRes.data ?? []) as Record<string, unknown>[];
    const intentFinal = intentFromContext ?? inferIntent(pergunta);

    // ── Busca inscrição pelo CPF ou Nome (se informado) ────────
    let inscricao: Record<string, unknown> | null = null;
    let hospedagemInfo: Record<string, unknown> | null = null;

    const isCpf = cpf.length === 11 ? cpf : (cpfFromPergunta || null);
    let nomeBusca: string | null = null;

    if (!isCpf) {
      const cleanPergunta = normalizeTexto(pergunta);
      const isCmd = hasAny(cleanPergunta, ['ola', 'oi', 'ajuda', 'programacao', 'agenda', 'local', 'onde', 'quando', 'valor', 'preco', 'contato', 'suporte']);
      if (cpfRaw && cpfRaw.replace(/\D/g, '').length !== 11 && cpfRaw.trim().length > 3) {
        nomeBusca = cpfRaw.trim();
      } else if (!isCmd && pergunta.trim().length > 3 && pergunta.trim().split(/\s+/).length >= 2) {
        nomeBusca = pergunta.trim();
      }
    }

    if (isCpf || nomeBusca) {
      let query = supabase
        .from('evento_inscricoes')
        .select('id,nome_inscrito,cpf,status_pagamento,hospedagem,alimentacao,brinde,created_at,forma_pagamento,valor_final,invoice_url,pix_copia_cola,pix_qr_code,asaas_due_date,refeicoes_total,refeicoes_utilizadas,quantidade_refeicoes_total,quantidade_refeicoes_usadas,quantidade_refeicoes_saldo')
        .eq('evento_id', eventoId);

      if (isCpf) {
        query = query.eq('cpf', isCpf);
      } else if (nomeBusca) {
        query = query.ilike('nome_inscrito', `%${nomeBusca}%`);
      }

      const { data: insData } = await query.order('created_at', { ascending: false });

      const rows = insData ?? [];
      if (rows.length > 0) {
        // Busca status de hospedagem para ordenação precisa
        const rowIds = rows.map(r => r.id);
        const { data: hospRows } = await supabase
          .from('evento_hospedagens')
          .select('inscricao_id, status')
          .in('inscricao_id', rowIds);
        const hospMap = new Map<string, string>();
        for (const hr of hospRows ?? []) {
          hospMap.set(hr.inscricao_id, hr.status);
        }

        // Ordenação por relevância: pago/isento primeiro, depois hospedagem alocada, depois mais recente
        rows.sort((a, b) => {
          const aPago = ['pago', 'isento'].includes(String(a.status_pagamento || ''));
          const bPago = ['pago', 'isento'].includes(String(b.status_pagamento || ''));
          if (aPago !== bPago) return aPago ? -1 : 1;

          const aAloc = ['alocada', 'confirmada', 'checkin_realizado'].includes(hospMap.get(a.id) || '');
          const bAloc = ['alocada', 'confirmada', 'checkin_realizado'].includes(hospMap.get(b.id) || '');
          if (aAloc !== bAloc) return aAloc ? -1 : 1;

          const aTime = Date.parse(a.created_at || '');
          const bTime = Date.parse(b.created_at || '');
          return bTime - aTime;
        });

        // Deduplica por id
        const seenIds = new Set<string>();
        const uniqueRows = rows.filter(r => {
          if (seenIds.has(r.id)) return false;
          seenIds.add(r.id);
          return true;
        });

        inscricao = uniqueRows[0] as Record<string, unknown>;

        // Busca hospedagem/alojamento e leito individual
        const [hospRes, leitoRes] = await Promise.all([
          supabase
            .from('evento_hospedagens')
            .select(`
              id, status, tipo_cama, numero_cama, grupo_hospedagem,
              evento_alojamentos ( id, nome, publico )
            `)
            .eq('inscricao_id', inscricao.id)
            .maybeSingle(),
          supabase
            .from('evento_hospedagem_leitos')
            .select('numero, tipo_leito, posicao')
            .eq('inscricao_id', inscricao.id)
            .maybeSingle()
        ]);

        if (hospRes.data) {
          hospedagemInfo = {
            ...hospRes.data,
            leito_numero: leitoRes.data?.numero || hospRes.data.numero_cama || null,
            leito_tipo: leitoRes.data?.tipo_leito || hospRes.data.tipo_cama || null,
            leito_posicao: leitoRes.data?.posicao || hospRes.data.tipo_cama || null,
          };
        }
      }
    }

    const hasSearchAttempt = !!(isCpf || nomeBusca);

    if ((intentFinal === 'segunda_via' || intentFinal === 'consulta_inscricao') && !hasSearchAttempt) {
      const respostaDireta = 'Claro! Para localizar sua inscrição, informe seu CPF ou nome completo.';

      supabase
        .from('evento_assistente_logs')
        .insert([{ evento_id: eventoId, pergunta, resposta: respostaDireta, cpf: null, modo: 'fallback' }])
        .then(() => {/* fire and forget */})
        .then(undefined, () => {/* ignora erro */});
      return NextResponse.json({ resposta: respostaDireta, modo: 'fallback' });
    }

    if (intentFinal === 'segunda_via' && hasSearchAttempt) {
      const respostaDireta = inscricao
        ? respostaSegundaVia(inscricao, evento)
        : `Não localizei nenhuma inscrição com o ${isCpf ? 'CPF' : 'nome'} informado. Verifique os dados ou entre em contato com o suporte.`;
      supabase
        .from('evento_assistente_logs')
        .insert([{ evento_id: eventoId, pergunta, resposta: respostaDireta, cpf: isCpf || null, modo: 'fallback' }])
        .then(() => {/* fire and forget */})
        .then(undefined, () => {/* ignora erro */});
      return NextResponse.json({ resposta: respostaDireta, modo: 'fallback' });
    }

    if (intentFinal === 'consulta_inscricao' && hasSearchAttempt) {
      const respostaDireta = inscricao
        ? respostaCpfConsulta(evento.nome as string, isCpf || String(inscricao.cpf || ''), inscricao, evento, hospedagemInfo)
        : `Não localizei nenhuma inscrição com o ${isCpf ? 'CPF' : 'nome'} informado. Verifique os dados ou entre em contato com o suporte.`;
      supabase
        .from('evento_assistente_logs')
        .insert([{ evento_id: eventoId, pergunta, resposta: respostaDireta, cpf: isCpf || null, modo: 'fallback' }])
        .then(() => {/* fire and forget */})
        .then(undefined, () => {/* ignora erro */});
      return NextResponse.json({ resposta: respostaDireta, modo: 'fallback' });
    }
    if ((cpfEncontradoNaPergunta || perguntaIsCpf || nomeBusca) && hasSearchAttempt && !intentFinal) {
      const respostaDireta = inscricao
        ? respostaCpfConsulta(evento.nome as string, isCpf || String(inscricao.cpf || ''), inscricao, evento, hospedagemInfo)
        : `Não localizei nenhuma inscrição com o ${isCpf ? 'CPF' : 'nome'} informado. Verifique os dados ou entre em contato com o suporte.`;
      supabase
        .from('evento_assistente_logs')
        .insert([{ evento_id: eventoId, pergunta, resposta: respostaDireta, cpf: isCpf || null, modo: 'fallback' }])
        .then(() => {/* fire and forget */})
        .then(undefined, () => {/* ignora erro */});
      return NextResponse.json({ resposta: respostaDireta, modo: 'fallback' });
    }

    let resposta: string;
    let modo: 'ia' | 'fallback' = 'fallback';

    // ── Tenta chamar OpenAI ────────────────────────────────────
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiModel = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

    // Quando a pergunta é apenas um CPF, retorna direto sem IA nem fallback
    if (openaiKey) {
      try {
        // Monta contexto seguro
        const contexto = [
          `Evento: ${evento.nome}`,
          `Descrição: ${evento.descricao || 'não informada'}`,
          `Data: ${fmtData(evento.data_inicio as string | null)} a ${fmtData(evento.data_fim as string | null)}`,
          `Local: ${[evento.local, evento.cidade].filter(Boolean).join(' — ') || 'não informado'}`,
          `Departamento: ${evento.departamento}`,
          `Público-alvo: ${evento.publico_alvo || 'geral'}`,
          `Valor da inscrição: ${fmtMoeda(evento.valor_inscricao as number)}`,
          `Hospedagem disponível: ${evento.permite_hospedagem ? 'sim' : 'não'}`,
          `Brinde disponível: ${evento.permite_brinde ? 'sim' : 'não'}`,
          `Alimentação disponível: ${evento.permite_alimentacao ? 'sim' : 'não'}`,
          `Link WhatsApp: ${evento.link_whatsapp || 'não disponível'}`,
          evento.suporte_whatsapp
            ? `Suporte: ${evento.suporte_nome ? evento.suporte_nome + ' — ' : ''}https://wa.me/55${String(evento.suporte_whatsapp).replace(/\D/g, '')}`
            : null,
          programacao.length > 0
            ? `\nProgramação:\n${programacao.map(it =>
                `- ${fmtData(it.data as string)} ${fmtHora(it.horario as string | null)} ${it.titulo}${it.palestrante ? ' — ' + it.palestrante : ''}${it.local ? ' @ ' + it.local : ''}`
              ).join('\n')}`
            : 'Programação: não cadastrada',
          inscricao
            ? `\nDados desta inscrição (CPF informado):
- Nome: ${inscricao.nome_inscrito}
- Status pagamento: ${inscricao.status_pagamento}
- Hospedagem contratada: ${inscricao.hospedagem ? 'sim' : 'não'}
- Brinde contratado: ${inscricao.brinde ? 'sim' : 'não'}
- Alimentação contratada: ${inscricao.alimentacao ? 'sim' : 'não'}
${hospedagemInfo ? `\nDados de Hospedagem:
- Status da hospedagem: ${hospedagemInfo.status}
- Alojamento: ${(hospedagemInfo.evento_alojamentos as any)?.nome || 'não definido'}
- Tipo de leito: ${hospedagemInfo.leito_tipo || 'não definido'}
- Posição: ${hospedagemInfo.leito_posicao || 'não definido'}
- Número do leito: ${hospedagemInfo.leito_numero || 'não definido'}
- Grupo de hospedagem: ${hospedagemInfo.grupo_hospedagem || 'não definido'}` : ''}
${inscricao.alimentacao || evento.departamento === 'AGO' ? `\nDados de Alimentação:
- Disponível: sim
- Total refeições: ${Number(inscricao.quantidade_refeicoes_total ?? inscricao.refeicoes_total ?? (evento.departamento === 'AGO' ? 12 : 0))}
- Utilizadas: ${Number(inscricao.quantidade_refeicoes_usadas ?? inscricao.refeicoes_utilizadas ?? 0)}
- Saldo disponível: ${Number(inscricao.quantidade_refeicoes_saldo ?? Math.max(0, Number(inscricao.quantidade_refeicoes_total ?? inscricao.refeicoes_total ?? (evento.departamento === 'AGO' ? 12 : 0)) - Number(inscricao.quantidade_refeicoes_usadas ?? inscricao.refeicoes_utilizadas ?? 0)))}` : ''}`
            : cpf.length === 11
              ? `\nO CPF informado (${cpfRaw || cpf}) não possui inscrição neste evento.`
              : 'CPF não informado — não consulte dados de inscrição.',
        ].filter(Boolean).join('\n');

        const systemPrompt = `Você é a Maia, assistente virtual do evento e parte da equipe de suporte da Comissão de Tecnologia. Responda de forma curta, humana, cordial e acolhedora.

REGRAS OBRIGATÓRIAS:
1. Responda APENAS com base nas informações do contexto abaixo.
2. Se a informação não estiver no contexto, diga: "Essa informação ainda não foi cadastrada no sistema."
3. Não invente palestrantes, horários, locais ou programação.
4. Para consultar inscrição individual, o CPF deve ter sido fornecido pelo usuário.
5. Nunca exponha dados de outros inscritos.
6. Use emojis com moderação para deixar a resposta mais amigável.
7. Máximo 200 palavras por resposta e evite tom corporativo ou robótico.
8. Se o status_pagamento for 'pendente', informe que o pagamento aguarda confirmação e NÃO mencione código de check-in.
9. Para pedidos de segunda via / boleto / link PIX / "perdi o pagamento": use os campos invoice_url, pix_copia_cola, valor_final e asaas_due_date da inscrição para responder. NUNCA consulte a API ASAAS.
10. Quando encaminhar ao suporte, use a frase: "Nossa equipe pode te ajudar rapidamente 🙏".
11. Evite repetir o nome "Maia" em toda resposta; use apenas quando fizer sentido.
12. A assinatura "— Maia 💙" pode aparecer apenas em algumas respostas importantes.
13. Sempre que a consulta envolver hospedagem (alojamento, leito), utilize estritamente estes formatos/regras:
    - Se a hospedagem estiver alocada (status 'alocada'):
      👋 Encontrei sua hospedagem!
      🏨 **Alojamento:** {nome do alojamento}
      🛏 **Leito:** {número} ({posição/tipo})
      👥 **Grupo:** {grupo}
      ✅ **Situação:** Alocada (leito reservado)
    - Se a hospedagem estiver confirmada (status 'confirmada'):
      👋 Sua hospedagem está confirmada.
      🏨 Alojamento: {nome do alojamento}
      🛏 Leito: {número}
      Desejamos uma excelente participação no evento!
    - Se check-in realizado (status 'checkin_realizado'):
      👋 Seu check-in de hospedagem já foi registrado com sucesso.
      🏨 Alojamento: {nome do alojamento}
      🛏 Leito: {número}
      Tenha um excelente evento!
    - Se em lista de espera (status 'lista_espera'):
      👋 Localizei sua solicitação de hospedagem.
      No momento seu grupo está em lista de espera.
      Assim que surgirem novas vagas compatíveis, o sistema poderá realizar automaticamente uma nova alocação.
      Sua inscrição permanece válida.
      *ATENÇÃO:* Nunca informe previsão de vagas e nunca prometa hospedagem.
    - Se aguardando pagamento (status 'aguardando_pagamento' ou inscrição pendente):
      👋 Sua solicitação de hospedagem já foi registrada.
      A distribuição do leito acontece automaticamente após a confirmação do pagamento da inscrição, respeitando a disponibilidade do grupo correspondente.
    - Se não solicitou hospedagem:
      Sua inscrição foi localizada.
      Consta em nosso sistema que não foi solicitada hospedagem para esta inscrição.
      Se precisar de outras informações sobre o evento, estou à disposição.
14. Sempre que perguntarem sobre alimentação, responda no formato:
    🍽 **Alimentação**
    Status: {Ativa/Inativa}
    Total de refeições: {total}
    Utilizadas: {utilizadas}
    Saldo disponível: {saldo}
    *ATENÇÃO:* Considere 12 refeições por padrão para eventos AGO se o sistema não indicar outro valor.
15. TOM DAS RESPOSTAS: responder em linguagem natural, utilizar poucas informações por bloco, poucos emojis (👋🏨🛏🍽✅), ser acolhedora, objetiva e facilitar a leitura no WhatsApp.
16. RESTRIÇÕES: Nunca informe ocupantes de um alojamento, dados pessoais de terceiros, prometa troca de leito/alojamento, prometa prioridade, reserve vagas ou altere hospedagem ou saldo de refeições.

CONTEXTO DO EVENTO:
${contexto}`;

        // Quando a pergunta é só um CPF, reformula para o modelo entender
        const perguntaParaIA = perguntaIsCpf
          ? `Quero consultar minha inscrição. Meu CPF é ${pergunta.trim()}.`
          : pergunta;

        const aiRes = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiKey}`,
          },
          body: JSON.stringify({
            model: openaiModel,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: perguntaParaIA },
            ],
            max_tokens: 400,
            temperature: 0.4,
          }),
        });

        if (aiRes.ok) {
          const aiJson = await aiRes.json();
          resposta = aiJson.choices?.[0]?.message?.content?.trim() ?? '';
          if (resposta) modo = 'ia';
        }
      } catch {
        // Falha silenciosa: usa fallback
      }
    }

    // ── Fallback local ─────────────────────────────────────────
    if (!resposta!) {
      resposta = respostaFallback(pergunta, evento, programacao, inscricao, hospedagemInfo);
      modo = 'fallback';
    }

    // ── Salva log (sem bloquear resposta) ─────────────────────
    supabase
      .from('evento_assistente_logs')
      .insert([{
        evento_id: eventoId,
        pergunta,
        resposta,
        cpf: cpf.length === 11 ? cpf : null,
        modo,
      }])
      .then(() => {/* fire and forget */})
      .then(undefined, () => {/* ignora erro de log */});

    return NextResponse.json({ resposta, modo });
  } catch {
    return NextResponse.json(
      { resposta: 'Desculpe, ocorreu um erro. Tente novamente em instantes.\n\nNossa equipe pode te ajudar rapidamente 🙏' },
      { status: 200 } // retorna 200 para não quebrar o widget
    );
  }
}
