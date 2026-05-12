import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { buildUrl, getPublicBaseUrl } from '@/lib/urls';
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

function buildEventoLine(ev: EventoPublico, baseUrl: string) {
  const data = formatDateRange(ev.data_inicio, ev.data_fim);
  const local = [ev.local, ev.cidade].filter(Boolean).join(' - ');
  const valor = ev.usar_tipos_inscricao
    ? 'Ver modalidades'
    : ev.valor_inscricao === 0
      ? 'Gratuito'
      : fmtMoeda(ev.valor_inscricao);
  const vagas = ev.vagas_disponiveis !== null ? ` | ${ev.vagas_disponiveis} vagas` : '';
  const link = buildUrl(baseUrl, `/inscricao/${ev.slug}`);
  return `• ${ev.nome}\n  ${data}${local ? ` | ${local}` : ''}\n  ${valor}${vagas}\n  ${link}`;
}

async function responderEventosAbertos(
  baseUrl: string,
  departamento: DepartamentoConfig | null
) {
  const eventos = await fetchOpenEvents({ departamento: departamento?.key });
  if (eventos.length === 0) {
    if (departamento) {
      return `No momento nao ha eventos com inscricoes abertas para ${departamento.nome}.`;
    }
    return 'No momento nao ha eventos com inscricoes abertas. Volte em breve!';
  }

  const titulo = departamento
    ? `Eventos abertos de ${departamento.nome}:`
    : 'Eventos com inscricoes abertas:';

  const linhas = eventos.map(ev => buildEventoLine(ev, baseUrl));
  return `${titulo}\n\n${linhas.join('\n\n')}`;
}

function statusPagamentoLabel(status: string) {
  if (status === 'pago') return 'Pago';
  if (status === 'isento') return 'Isento';
  if (status === 'pendente') return 'Pendente';
  return status;
}

async function responderCpfConsulta(
  baseUrl: string,
  cpf: string,
  departamento: DepartamentoConfig | null
) {
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
      return `Nao encontrei inscricoes para este CPF em ${departamento.nome}.`;
    }
    return 'Nao encontrei inscricoes para este CPF.';
  }

  const blocos = lista.map(item => {
    const ev = item.eventos as Record<string, unknown> | null;
    const nome = String(ev?.nome || 'Evento');
    const slug = String(ev?.slug || '');
    const statusRaw = String(item.status_pagamento || '');
    const status = statusPagamentoLabel(statusRaw);
    const valor = typeof item.valor_final === 'number' ? fmtMoeda(item.valor_final as number) : null;
    const link = slug ? buildUrl(baseUrl, `/inscricao/${slug}`) : '';
    const invoiceUrl = typeof item.invoice_url === 'string' ? item.invoice_url : '';
    const pixCopia = typeof item.pix_copia_cola === 'string' ? item.pix_copia_cola : '';
    let bloco = `• ${nome}\n  Status: ${status}`;
    if (valor) bloco += ` | Valor: ${valor}`;
    if (link) bloco += `\n  ${link}`;

    if (statusRaw === 'pendente' && invoiceUrl) {
      bloco += `\n  Segunda via: ${invoiceUrl}`;
    }

    if (statusRaw === 'pendente' && pixCopia) {
      bloco += `\n  PIX copia e cola: ${pixCopia}`;
    }

    return bloco;
  });

  const header = lista.length > 1
    ? 'Encontrei mais de uma inscricao para este CPF:'
    : 'Encontrei sua inscricao:';

  return `${header}\n\n${blocos.join('\n\n')}`;
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
    const baseUrl = getPublicBaseUrl({ request: req });

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
      'pagamento',
      'boleto',
      'pix',
      'link de pagamento',
      'link do pagamento',
    ]);

    if (isSegundaVia) {
      if (!cpfDetectado) {
        return NextResponse.json({ resposta: 'Claro! Me informe seu CPF para localizar sua inscricao.' });
      }
      const resposta = await responderCpfConsulta(baseUrl, cpfDetectado, departamento);
      return NextResponse.json({ resposta });
    }

    if (hasAny(pergunta, ['inscricao', 'inscricoes', 'me inscrever', 'como faco', 'como fazer'])) {
      const resposta = await responderEventosAbertos(baseUrl, departamento);
      return NextResponse.json({ resposta });
    }

    if (hasAny(pergunta, ['eventos abertos', 'eventos com inscricao', 'inscricoes abertas', 'eventos disponiveis', 'quais eventos'])) {
      const resposta = await responderEventosAbertos(baseUrl, departamento);
      return NextResponse.json({ resposta });
    }

    if (hasAny(pergunta, ['vagas', 'disponibilidade', 'lotado'])) {
      const resposta = await responderEventosAbertos(baseUrl, departamento);
      return NextResponse.json({ resposta });
    }

    if (hasAny(pergunta, ['hospedagem', 'alojamento', 'brinde', 'alimentacao', 'programacao', 'certificado'])) {
      const resposta = departamento
        ? `Esses detalhes variam por evento em ${departamento.nome}. Veja os eventos abertos para escolher o seu.`
        : 'Esses detalhes variam por evento. Veja os eventos com inscricoes abertas para escolher o seu.';
      const lista = await responderEventosAbertos(baseUrl, departamento);
      return NextResponse.json({ resposta: `${resposta}\n\n${lista}` });
    }

    if (cpfDetectado) {
      const resposta = await responderCpfConsulta(baseUrl, cpfDetectado, departamento);
      return NextResponse.json({ resposta });
    }

    const fallback = departamento
      ? `Posso ajudar com eventos de ${departamento.nome}. Pergunte sobre inscricoes abertas ou pagamentos.`
      : 'Posso ajudar com inscricoes abertas, pagamentos e duvidas gerais dos eventos.';
    return NextResponse.json({ resposta: fallback });
  } catch {
    return NextResponse.json({ resposta: 'Tive um problema para responder agora. Tente novamente em instantes.' }, { status: 500 });
  }
}
