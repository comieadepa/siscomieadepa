import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import {
  DEPARTAMENTOS,
  fetchOpenEvents,
  getDepartamentoByKey,
  getDepartamentoBySlug,
  type DepartamentoConfig,
  type EventoPublico,
} from '@/lib/public-portal';

const SAUDACOES = ['oi', 'ola', 'bom dia', 'boa tarde', 'boa noite', 'ajuda'];
const DESPEDIDAS = ['tchau', 'ate', 'obrigado', 'obrigada', 'valeu'];

type AssistenteAction = {
  label: string;
  href?: string;
  copyText?: string;
  variant?: 'primary' | 'ghost';
};

type AssistenteCard = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string[];
  actions?: AssistenteAction[];
};

type AssistenteResposta = {
  resposta: string;
  cards?: AssistenteCard[];
};

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s./-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(haystack: string, needles: string[]) {
  return needles.some(n => haystack.includes(n));
}

function extractCpfDigits(text: string) {
  const digits = text.replace(/\D/g, '');
  if (digits.length !== 11) return null;
  return digits;
}

function isCpfOnly(text: string) {
  const clean = text.trim();
  return /^\d{11}$/.test(clean) || /^\d{3}[.\s]\d{3}[.\s]\d{3}[-\s]\d{2}$/.test(clean);
}

function formatDateRange(inicio: string, fim: string | null) {
  if (!fim || fim === inicio) return formatDate(inicio);
  return `${formatDate(inicio)} a ${formatDate(fim)}`;
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function fmtMoeda(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function departamentoFromQuestion(pergunta: string): DepartamentoConfig | null {
  const normalized = normalizeText(pergunta);
  const direct = DEPARTAMENTOS.find(d => normalized.includes(d.slug));
  if (direct) return direct;
  const byKey = DEPARTAMENTOS.find(d => normalized.includes(d.key.toLowerCase()));
  if (byKey) return byKey;
  if (normalized.includes('seia')) return getDepartamentoBySlug('seiadepa');
  return null;
}

function buildEventoCard(ev: EventoPublico): AssistenteCard {
  const data = formatDateRange(ev.data_inicio, ev.data_fim);
  const local = [ev.local, ev.cidade].filter(Boolean).join(' - ');
  const valor = ev.usar_tipos_inscricao
    ? 'Modalidades disponiveis'
    : ev.valor_inscricao === 0
      ? 'Gratuito'
      : fmtMoeda(ev.valor_inscricao);
  const vagas = ev.vagas_disponiveis !== null ? `${ev.vagas_disponiveis} vagas` : null;
  const dep = getDepartamentoByKey(ev.departamento) ?? getDepartamentoBySlug(ev.departamento.toLowerCase());
  const depSlug = dep?.slug ?? ev.departamento.toLowerCase();
  const actionLabel = 'Ver eventos';

  return {
    id: ev.id,
    title: `🎉 ${ev.nome}`,
    meta: [
      `📅 ${data}`,
      `📍 ${local || 'Local a confirmar'}`,
      `💳 ${valor}${vagas ? ` · ${vagas}` : ''}`,
    ],
    actions: [
      {
        label: `👉 ${actionLabel}`,
        href: `/eventos-publicos/${depSlug}`,
        variant: 'primary',
      },
    ],
  };
}

async function fetchEventosComCards(departamento: DepartamentoConfig | null) {
  const eventos = await fetchOpenEvents({ departamento: departamento?.key });
  const cards = eventos.map(ev => buildEventoCard(ev));
  return { eventos, cards };
}

async function responderEventosAbertos(
  departamento: DepartamentoConfig | null
): Promise<AssistenteResposta> {
  const { eventos, cards } = await fetchEventosComCards(departamento);
  if (eventos.length === 0) {
    if (departamento) {
      return { resposta: `No momento nao ha eventos com inscricoes abertas para ${departamento.nome}.` };
    }
    return { resposta: 'No momento nao ha eventos com inscricoes abertas. Volte em breve!' };
  }

  const titulo = departamento
    ? `Temos eventos com inscricoes abertas em ${departamento.nome} 😊`
    : 'Temos eventos com inscricoes abertas 😊';

  return { resposta: titulo, cards };
}

async function responderEventosComIntro(
  departamento: DepartamentoConfig | null,
  intro: string
): Promise<AssistenteResposta> {
  const { eventos, cards } = await fetchEventosComCards(departamento);
  if (eventos.length === 0) {
    const base = departamento
      ? `No momento nao ha eventos com inscricoes abertas para ${departamento.nome}.`
      : 'No momento nao ha eventos com inscricoes abertas. Volte em breve!';
    return { resposta: `${intro}\n\n${base}` };
  }
  return { resposta: intro, cards };
}

function statusPagamentoLabel(status: string) {
  if (status === 'pago') return 'Pago';
  if (status === 'isento') return 'Isento';
  if (status === 'pendente') return 'Pendente';
  return status;
}

async function responderCpfConsulta(
  cpf: string,
  departamento: DepartamentoConfig | null
): Promise<AssistenteResposta> {
  const supabase = createServerClient();
  let query = supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, status_pagamento, invoice_url, pix_copia_cola, valor_final, created_at, eventos!inner(id,nome,slug,departamento,data_inicio,data_fim)')
    .eq('cpf', cpf)
    .order('created_at', { ascending: false })
    .limit(5);

  if (departamento) {
    query = query.eq('eventos.departamento', departamento.key);
  }

  const { data } = await query;
  const lista = (data ?? []) as Array<Record<string, unknown>>;

  if (lista.length === 0) {
    if (departamento) {
      return { resposta: `Nao encontrei inscricoes para este CPF em ${departamento.nome}.` };
    }
    return { resposta: 'Nao encontrei inscricoes para este CPF.' };
  }

  const cards = lista.map(item => {
    const ev = item.eventos as Record<string, unknown> | null;
    const nome = String(ev?.nome || 'Evento');
    const slug = String(ev?.slug || '');
    const dataInicio = typeof ev?.data_inicio === 'string' ? ev?.data_inicio as string : '';
    const dataFim = typeof ev?.data_fim === 'string' ? ev?.data_fim as string : null;
    const statusRaw = String(item.status_pagamento || '');
    const status = statusPagamentoLabel(statusRaw);
    const valor = typeof item.valor_final === 'number' ? fmtMoeda(item.valor_final as number) : null;
    const link = slug ? `/inscricao/${slug}` : '';
    const invoiceUrl = typeof item.invoice_url === 'string' ? item.invoice_url : '';
    const pixCopia = typeof item.pix_copia_cola === 'string' ? item.pix_copia_cola : '';
    const meta: string[] = [`Status: ${status}${valor ? ` · Valor: ${valor}` : ''}`];
    if (dataInicio) {
      meta.push(`📅 ${formatDateRange(dataInicio, dataFim)}`);
    }

    const actions: AssistenteAction[] = [];
    if (link) {
      actions.push({ label: '🔗 Abrir inscricao', href: link, variant: 'ghost' });
    }
    if (statusRaw === 'pendente' && invoiceUrl) {
      actions.push({ label: '💳 Abrir pagamento', href: invoiceUrl, variant: 'primary' });
    }
    if (statusRaw === 'pendente' && pixCopia) {
      actions.push({ label: 'Copiar PIX', copyText: pixCopia, variant: 'ghost' });
    }

    return {
      id: String(item.id || `${nome}-${Date.now()}`),
      title: `🎫 ${nome}`,
      meta,
      actions,
    };
  });

  const header = lista.length > 1
    ? 'Encontrei mais de uma inscricao para este CPF:'
    : 'Encontrei sua inscricao:';

  return { resposta: header, cards };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const perguntaRaw = String(body?.pergunta || '').trim();
    const contexto = body?.contexto || {};
    const scope = contexto?.scope === 'departamento' ? 'departamento' : 'global';
    const departamentoFromContext = contexto?.departamento
      ? getDepartamentoByKey(String(contexto.departamento))
      : null;

    if (!perguntaRaw) {
      return NextResponse.json({ resposta: 'Me conte sua duvida para que eu possa ajudar.' });
    }

    const pergunta = normalizeText(perguntaRaw);

    const departamentoFromText = scope === 'global' ? departamentoFromQuestion(perguntaRaw) : null;
    const departamento = departamentoFromContext ?? departamentoFromText;

    if (hasAny(pergunta, SAUDACOES)) {
      const msg = departamento
        ? `Oi! Posso ajudar com eventos de ${departamento.nome}. Pergunte sobre inscricoes abertas ou pagamentos.`
        : 'Oi! Posso ajudar com inscricoes abertas, pagamentos e duvidas gerais dos eventos.';
      return NextResponse.json({ resposta: msg });
    }

    if (hasAny(pergunta, DESPEDIDAS)) {
      return NextResponse.json({ resposta: 'Sempre que precisar, estarei aqui. Ate mais!' });
    }

    const cpfDetectado = extractCpfDigits(perguntaRaw) || (isCpfOnly(perguntaRaw) ? perguntaRaw.replace(/\D/g, '') : null);
    const isSegundaVia = hasAny(pergunta, [
      'segunda via',
      '2 via',
      '2via',
      'boleto',
      'pix',
      'link de pagamento',
      'link do pagamento',
      'perdi o pagamento',
      'gerar cobranca',
      'segunda via do pagamento',
    ]);
    const isPagamento = !isSegundaVia && hasAny(pergunta, [
      'pagamento',
      'pagar',
      'como pagar',
      'formas de pagamento',
      'como faco pagamento',
      'como fazer pagamento',
    ]);
    const querOrientacaoInscricao = hasAny(pergunta, [
      'como faco minha inscricao',
      'como faco a inscricao',
      'como faco para me inscrever',
      'como me inscrevo',
      'como fazer inscricao',
      'como fazer a inscricao',
      'quero me inscrever',
      'quero fazer inscricao',
      'fazer minha inscricao',
    ]);
    const querEventosAbertos = hasAny(pergunta, [
      'eventos abertos',
      'eventos com inscricao',
      'inscricoes abertas',
      'eventos disponiveis',
      'quais eventos',
    ]);
    const querParticiparDepto = departamento && hasAny(pergunta, [
      'participar',
      'quero participar',
      'quero ir',
      'quero me inscrever',
      'inscrever',
      'inscricao',
      'evento',
    ]);

    if (isSegundaVia) {
      if (!cpfDetectado) {
        return NextResponse.json({ resposta: 'Claro! Me informe seu CPF para localizar sua inscricao.' });
      }
      const resposta = await responderCpfConsulta(cpfDetectado, departamento);
      return NextResponse.json(resposta);
    }

    if (isPagamento) {
      const intro = 'Apos selecionar a modalidade da inscricao, o sistema exibira as opcoes de pagamento disponiveis 😊';
      const resposta = await responderEventosComIntro(departamento, `${intro}\n\nEscolha um evento abaixo para continuar.`);
      return NextResponse.json(resposta);
    }

    if (querParticiparDepto && departamento) {
      const { eventos, cards } = await fetchEventosComCards(departamento);
      if (eventos.length === 0) {
        return NextResponse.json({ resposta: `No momento nao ha eventos com inscricoes abertas para ${departamento.nome}.` });
      }
      const intro = eventos.length === 1
        ? `Perfeito 😊 ${eventos[0].nome} esta com inscricoes abertas.`
        : `Perfeito 😊 ${departamento.nome} tem eventos com inscricoes abertas.`;
      return NextResponse.json({ resposta: intro, cards });
    }

    if (querOrientacaoInscricao) {
      const intro = 'Claro 😊 Para fazer sua inscricao, escolha um dos eventos disponiveis abaixo e clique em "Ver eventos" para concluir.';
      const resposta = await responderEventosComIntro(departamento, intro);
      return NextResponse.json(resposta);
    }

    if (hasAny(pergunta, ['inscricao', 'inscricoes', 'me inscrever', 'como faco', 'como fazer'])) {
      const intro = 'Para se inscrever, escolha um dos eventos disponiveis abaixo 😊';
      const resposta = await responderEventosComIntro(departamento, intro);
      return NextResponse.json(resposta);
    }

    if (querEventosAbertos) {
      const intro = 'Temos estes eventos com inscricoes abertas 😊';
      const resposta = await responderEventosComIntro(departamento, intro);
      return NextResponse.json(resposta);
    }

    if (hasAny(pergunta, ['vagas', 'disponibilidade', 'lotado'])) {
      const intro = 'Estas sao as inscricoes abertas no momento 😊';
      const resposta = await responderEventosComIntro(departamento, intro);
      return NextResponse.json(resposta);
    }

    if (hasAny(pergunta, ['hospedagem', 'alojamento', 'brinde', 'alimentacao', 'programacao', 'certificado'])) {
      const resposta = departamento
        ? `Esses detalhes variam por evento em ${departamento.nome}. Veja os eventos abertos para escolher o seu.`
        : 'Esses detalhes variam por evento. Veja os eventos com inscricoes abertas para escolher o seu.';
      const lista = await responderEventosAbertos(departamento);
      return NextResponse.json({ resposta: `${resposta}\n\n${lista.resposta}`, cards: lista.cards });
    }

    if (cpfDetectado) {
      const resposta = await responderCpfConsulta(cpfDetectado, departamento);
      return NextResponse.json(resposta);
    }

    const fallback = departamento
      ? `Posso ajudar com eventos de ${departamento.nome}. Pergunte sobre inscricoes abertas, pagamentos ou segunda via.`
      : 'Posso ajudar com inscricoes abertas, pagamentos e duvidas gerais dos eventos.';
    return NextResponse.json({ resposta: fallback });
  } catch {
    return NextResponse.json({ resposta: 'Tive um problema para responder agora. Tente novamente em instantes.' }, { status: 500 });
  }
}
