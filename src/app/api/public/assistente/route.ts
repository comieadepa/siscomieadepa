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
const SEM_EVENTOS_MSG = 'No momento nao ha eventos com inscricoes abertas 😊\nAssim que novas inscricoes forem liberadas, elas aparecerao aqui no portal.';

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
  _ctx?: { cpf?: string; inscricao_id?: string; pending_intent?: string; evento_id?: string; evento_nome?: string; ultima_intencao?: string };
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

function buildSemEventosMensagem(departamento: DepartamentoConfig | null) {
  if (departamento) {
    return `No momento nao ha eventos com inscricoes abertas para ${departamento.nome} 😊\nAssim que novas inscricoes forem liberadas, elas aparecerao aqui no portal.`;
  }
  return SEM_EVENTOS_MSG;
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

async function responderEventosComIntro(
  departamento: DepartamentoConfig | null,
  intro: string
): Promise<AssistenteResposta> {
  const { eventos, cards } = await fetchEventosComCards(departamento);
  if (eventos.length === 0) {
    return { resposta: buildSemEventosMensagem(departamento) };
  }
  return { resposta: intro, cards };
}

function buildWhatsAppLink(raw: unknown, message?: string) {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  const base = digits.startsWith('55') ? `https://wa.me/${digits}` : `https://wa.me/55${digits}`;
  if (!message) return base;
  return `${base}?text=${encodeURIComponent(message)}`;
}

async function responderCpfConsulta(
  cpf: string,
  departamento: DepartamentoConfig | null
): Promise<AssistenteResposta> {
  const supabase = createServerClient();
  let query = supabase
    .from('evento_inscricoes')
    .select('id, nome_inscrito, status_pagamento, invoice_url, pix_copia_cola, valor_final, created_at, updated_at, asaas_due_date, eventos!inner(id,nome,slug,departamento,data_inicio,data_fim,suporte_whatsapp)')
    .eq('cpf', cpf)
    .order('created_at', { ascending: false });

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

  const eventosMap = new Map<string, { evento: Record<string, unknown>; items: Array<Record<string, unknown>> }>();
  for (const item of lista) {
    const ev = item.eventos as Record<string, unknown> | null;
    const evId = String(ev?.id || '');
    if (!evId) continue;
    const entry = eventosMap.get(evId);
    if (entry) {
      entry.items.push(item);
    } else {
      eventosMap.set(evId, { evento: ev ?? {}, items: [item] });
    }
  }

  const invoiceCards: AssistenteCard[] = [];
  const supportCards: AssistenteCard[] = [];
  let hasConfirmada = false;
  let hasPendenteSemCobranca = false;
  let hasPendenteSemSuporte = false;

  const toTimestamp = (value: unknown) => {
    if (typeof value !== 'string' || !value) return 0;
    const time = Date.parse(value);
    return Number.isNaN(time) ? 0 : time;
  };

  for (const { evento, items } of eventosMap.values()) {
    const nomeEvento = String(evento?.nome || 'Evento');
    const suporteLink = buildWhatsAppLink(
      (evento as Record<string, unknown>)?.suporte_whatsapp ??
      (evento as Record<string, unknown>)?.whatsapp_suporte,
      'Ola, preciso de suporte sobre pagamento da minha inscricao!'
    );
    const quitado = items.some(item => ['pago', 'isento'].includes(String(item.status_pagamento || '')));
    if (quitado) {
      hasConfirmada = true;
      continue;
    }

    const pendentes = items.filter(item => String(item.status_pagamento || '') === 'pendente');
    const elegiveis = pendentes.filter(item => {
      const invoiceUrl = typeof item.invoice_url === 'string' ? item.invoice_url : '';
      const pixCopia = typeof item.pix_copia_cola === 'string' ? item.pix_copia_cola : '';
      return Boolean(invoiceUrl || pixCopia);
    });

    if (elegiveis.length === 0) {
      if (pendentes.length > 0) {
        hasPendenteSemCobranca = true;
        if (suporteLink) {
          supportCards.push({
            id: `suporte-${String(evento?.id || nomeEvento)}`,
            title: '💬 Falar com suporte',
            meta: [`Evento: ${nomeEvento}`],
            actions: [{ label: '💬 Falar com suporte', href: suporteLink, variant: 'primary' }],
          });
        } else {
          hasPendenteSemSuporte = true;
        }
      }
      continue;
    }

    elegiveis.sort((a, b) => {
      const createdDiff = toTimestamp(b.created_at) - toTimestamp(a.created_at);
      if (createdDiff !== 0) return createdDiff;
      const dueDiff = toTimestamp(b.asaas_due_date) - toTimestamp(a.asaas_due_date);
      if (dueDiff !== 0) return dueDiff;
      return toTimestamp(b.updated_at) - toTimestamp(a.updated_at);
    });

    const latest = elegiveis[0];
    const invoiceUrl = typeof latest.invoice_url === 'string' ? latest.invoice_url : '';
    const pixCopia = typeof latest.pix_copia_cola === 'string' ? latest.pix_copia_cola : '';
    const valorFinal = typeof latest.valor_final === 'number' ? latest.valor_final : null;
    const vencimentoRaw = typeof latest.asaas_due_date === 'string' ? latest.asaas_due_date : '';
    const vencimento = vencimentoRaw ? formatDate(vencimentoRaw) : '-';

    const meta: string[] = [
      `Evento: ${nomeEvento}`,
      `Valor: ${valorFinal !== null ? fmtMoeda(valorFinal) : 'Nao informado'}`,
      `Vencimento: ${vencimento}`,
    ];

    const actions: AssistenteAction[] = [];
    if (invoiceUrl) {
      actions.push({ label: '💳 Abrir pagamento', href: invoiceUrl, variant: 'primary' });
    }
    if (pixCopia) {
      actions.push({ label: 'Copiar PIX', copyText: pixCopia, variant: 'ghost' });
    }

    invoiceCards.push({
      id: String(latest.id || `${nomeEvento}-${Date.now()}`),
      title: '💳 Segunda via disponivel',
      meta,
      actions,
    });
  }

  if (invoiceCards.length > 0 && supportCards.length > 0) {
    return {
      resposta: 'Segunda via disponivel. Para eventos sem link, fale com o suporte:',
      cards: [...invoiceCards, ...supportCards],
    };
  }

  if (invoiceCards.length > 0) {
    return { resposta: 'Segunda via disponivel:', cards: invoiceCards };
  }

  if (supportCards.length > 0) {
    return {
      resposta: 'Encontrei uma inscricao pendente 😊\nMas os dados de pagamento nao estao disponiveis no sistema no momento.\n\nNossa equipe pode te ajudar rapidamente pelo WhatsApp.',
      cards: supportCards,
    };
  }

  if (hasPendenteSemCobranca || hasPendenteSemSuporte) {
    return {
      resposta: 'Encontrei uma inscricao pendente 😊\nMas os dados de pagamento nao estao disponiveis no sistema no momento.\n\nEntre em contato com a organizacao do evento.',
    };
  }

  if (hasConfirmada) {
    return { resposta: 'Sua inscricao ja consta como confirmada.' };
  }

  return { resposta: 'Nao encontrei pagamentos pendentes para este CPF 😊' };
}

async function responderConfirmarInscricao(
  cpf: string,
  departamento: DepartamentoConfig | null
): Promise<AssistenteResposta> {
  const supabase = createServerClient();
  let query = supabase
    .from('evento_inscricoes')
    .select(
      'id,nome_inscrito,status_pagamento,hospedagem,alimentacao,tipo_inscricao,valor_final,eventos!inner(id,nome,departamento,data_inicio,data_fim,permite_hospedagem,permite_alimentacao,suporte_whatsapp)'
    )
    .eq('cpf', cpf)
    .order('created_at', { ascending: false })
    .limit(3);

  if (departamento) {
    query = query.eq('eventos.departamento', departamento.key);
  }

  const { data } = await query;
  const lista = (data ?? []) as Array<Record<string, unknown>>;

  if (lista.length === 0) {
    return {
      resposta: departamento
        ? `Nao encontrei inscricoes para este CPF em ${departamento.nome}.\nVerifique o CPF e tente novamente ou entre em contato com a organizacao.`
        : 'Nao encontrei inscricoes para este CPF.\nVerifique o CPF e tente novamente ou entre em contato com a organizacao.',
    };
  }

  const cards: AssistenteCard[] = lista.map(insc => {
    const ev = insc.eventos as Record<string, unknown>;
    const nomeInscrito = String(insc.nome_inscrito || 'Inscrito');
    const nomeEvento = String(ev?.nome || 'Evento');
    const statusPag = String(insc.status_pagamento || '');
    const temHospedagem = Boolean(insc.hospedagem);
    const temAlimentacao = Boolean(insc.alimentacao);
    const permiteHospedagem = Boolean(ev?.permite_hospedagem);
    const permiteAlimentacao = Boolean(ev?.permite_alimentacao);
    const tipoInscricao = insc.tipo_inscricao ? String(insc.tipo_inscricao) : null;
    const valorFinal = typeof insc.valor_final === 'number' ? insc.valor_final : null;

    const statusLabel =
      statusPag === 'pago' ? '✅ Pago' :
      statusPag === 'isento' ? '✅ Isento' :
      statusPag === 'pendente' ? '⚠️ Pendente' :
      statusPag === 'cancelado' ? '❌ Cancelado' :
      statusPag || 'Sem status';

    const hospLabel = temHospedagem
      ? '✅ Incluida'
      : permiteHospedagem
        ? '❌ Nao incluida (evento oferece hospedagem)'
        : '➖ Evento nao oferece hospedagem';

    const alimLabel = temAlimentacao
      ? '✅ Incluida'
      : permiteAlimentacao
        ? '❌ Nao incluida (evento oferece alimentacao)'
        : '➖ Evento nao oferece alimentacao';

    const meta: string[] = [`Evento: ${nomeEvento}`, `Pagamento: ${statusLabel}`];
    if (tipoInscricao) meta.push(`Modalidade: ${tipoInscricao}`);
    if (valorFinal !== null) meta.push(`Valor: ${fmtMoeda(valorFinal)}`);
    meta.push(`Hospedagem: ${hospLabel}`);
    meta.push(`Alimentacao: ${alimLabel}`);

    return {
      id: String(insc.id || `insc-${Date.now()}`),
      title: `📋 ${nomeInscrito}`,
      subtitle: 'Inscricao localizada',
      meta,
    };
  });

  const primeiro = lista[0];
  return {
    resposta: lista.length === 1
      ? 'Encontrei sua inscricao 😊'
      : `Encontrei ${lista.length} inscricoes para este CPF 😊`,
    cards,
    _ctx: { cpf, inscricao_id: String(primeiro.id || '') },
  };
}

async function responderHospedagemInscricao(inscricaoId: string): Promise<AssistenteResposta> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('evento_inscricoes')
    .select('id,hospedagem,tipo_inscricao,eventos!inner(nome,permite_hospedagem,departamento)')
    .eq('id', inscricaoId)
    .maybeSingle();

  if (error || !data) {
    return { resposta: 'Nao consegui confirmar essa informacao automaticamente. Fale com a organizacao.' };
  }

  const insc = data as Record<string, unknown>;
  const ev = insc.eventos as Record<string, unknown>;
  const nomeEvento = String(ev?.nome || 'Evento');
  const temHospedagem = Boolean(insc.hospedagem);
  const permiteHospedagem = Boolean(ev?.permite_hospedagem);

  if (temHospedagem) {
    if (String(ev?.departamento) === 'AGO') {
      const { data: hospData } = await supabase
        .from('evento_hospedagens')
        .select('status')
        .eq('inscricao_id', inscricaoId)
        .maybeSingle();
      if (hospData) {
        const status = String((hospData as Record<string, unknown>).status || '');
        if (status === 'confirmada') {
          return { resposta: `Sim! Sua inscricao em *${nomeEvento}* inclui hospedagem e ja esta confirmada ✅` };
        }
        if (status === 'solicitada') {
          return { resposta: `Sua inscricao em *${nomeEvento}* inclui hospedagem. Aguardando alocacao de alojamento 🛏️` };
        }
        if (status === 'lista_espera') {
          return { resposta: `Sua inscricao inclui hospedagem, porem voce esta na lista de espera por alojamento.` };
        }
      }
    }
    return { resposta: `Sim! Sua inscricao em *${nomeEvento}* inclui hospedagem 🛏️` };
  }

  if (permiteHospedagem) {
    return {
      resposta: `O evento *${nomeEvento}* oferece hospedagem, mas sua inscricao atual nao inclui essa opcao.\n\nPara mais informacoes, entre em contato com a organizacao.`,
    };
  }

  return { resposta: `O evento *${nomeEvento}* nao oferece hospedagem.` };
}

async function responderAlimentacaoInscricao(inscricaoId: string): Promise<AssistenteResposta> {
  const supabase = createServerClient();
  const { data, error } = await supabase
    .from('evento_inscricoes')
    .select('id,alimentacao,tipo_inscricao,evento_id,eventos!inner(nome,permite_alimentacao)')
    .eq('id', inscricaoId)
    .maybeSingle();

  if (error || !data) {
    return { resposta: 'Nao consegui confirmar essa informacao automaticamente. Fale com a organizacao.' };
  }

  const insc = data as Record<string, unknown>;
  const ev = insc.eventos as Record<string, unknown>;
  const nomeEvento = String(ev?.nome || 'Evento');
  const temAlimentacao = Boolean(insc.alimentacao);
  const permiteAlimentacao = Boolean(ev?.permite_alimentacao);

  if (temAlimentacao) {
    const tipoNome = insc.tipo_inscricao ? String(insc.tipo_inscricao) : null;
    const eventoId = insc.evento_id ? String(insc.evento_id) : null;
    if (tipoNome && eventoId) {
      const { data: tipoData } = await supabase
        .from('evento_tipos_inscricao')
        .select('quantidade_refeicoes')
        .eq('evento_id', eventoId)
        .ilike('nome', tipoNome)
        .maybeSingle();
      const qtd = (tipoData as Record<string, unknown> | null)?.quantidade_refeicoes;
      if (typeof qtd === 'number' && qtd > 0) {
        return { resposta: `Sim! Sua inscricao em *${nomeEvento}* inclui alimentacao 🍽️\nQuantidade de refeicoes: ${qtd}` };
      }
    }
    return { resposta: `Sim! Sua inscricao em *${nomeEvento}* inclui alimentacao 🍽️` };
  }

  if (permiteAlimentacao) {
    return { resposta: `O evento *${nomeEvento}* oferece alimentacao, mas sua inscricao atual nao inclui essa opcao.` };
  }

  return { resposta: `O evento *${nomeEvento}* nao oferece alimentacao.` };
}

async function responderDetalhesEvento(
  eventoId: string,
  tipo: 'programacao' | 'descricao' | 'local' | 'geral'
): Promise<AssistenteResposta> {
  const supabase = createServerClient();

  const { data: eventoData } = await supabase
    .from('eventos')
    .select('id,nome,data_inicio,data_fim,local,cidade,descricao,publico_alvo')
    .eq('id', eventoId)
    .maybeSingle();

  if (!eventoData) {
    return { resposta: 'Nao consegui encontrar informacoes sobre esse evento.' };
  }

  const ev = eventoData as Record<string, unknown>;
  const nomeEvento = String(ev.nome || 'Evento');
  const dataRange = formatDateRange(String(ev.data_inicio || ''), ev.data_fim ? String(ev.data_fim) : null);
  const localStr = [ev.local, ev.cidade].filter(Boolean).join(' - ');
  const descricao = ev.descricao ? String(ev.descricao).trim() : null;
  const publicoAlvo = ev.publico_alvo ? String(ev.publico_alvo).trim() : null;
  const ctx = { evento_id: eventoId, evento_nome: nomeEvento, ultima_intencao: `consultar_${tipo}` };

  if (tipo === 'local') {
    if (localStr) {
      return {
        resposta: `O evento *${nomeEvento}* acontecera em *${localStr}* 📍\n📅 ${dataRange}`,
        _ctx: ctx,
      };
    }
    return {
      resposta: `O local do evento *${nomeEvento}* ainda nao foi divulgado pela organizacao.`,
      _ctx: ctx,
    };
  }

  if (tipo === 'descricao') {
    let resposta = `*${nomeEvento}*\n📅 ${dataRange}`;
    if (localStr) resposta += `\n📍 ${localStr}`;
    if (descricao) {
      resposta += `\n\n${descricao}`;
    } else {
      resposta += '\n\nA descricao detalhada ainda nao foi cadastrada pela organizacao.';
    }
    if (publicoAlvo) resposta += `\n\n👥 Publico-alvo: ${publicoAlvo}`;
    return { resposta, _ctx: ctx };
  }

  if (tipo === 'programacao') {
    const { data: progData } = await supabase
      .from('evento_programacao')
      .select('data,horario,titulo,descricao,palestrante,local,ordem')
      .eq('evento_id', eventoId)
      .order('data', { ascending: true })
      .order('ordem', { ascending: true });

    const prog = (progData ?? []) as Array<Record<string, unknown>>;
    let resposta = `Programacao de *${nomeEvento}*\n📅 ${dataRange}`;
    if (localStr) resposta += `\n📍 ${localStr}`;

    if (prog.length === 0) {
      resposta += '\n\nA programacao detalhada ainda nao foi cadastrada pela organizacao. Posso te mostrar as informacoes disponiveis do evento.';
      return { resposta, _ctx: { ...ctx, ultima_intencao: 'consultar_geral' } };
    }

    const byDate = new Map<string, Array<Record<string, unknown>>>();
    for (const item of prog) {
      const key = String(item.data || '');
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key)!.push(item);
    }

    for (const [date, items] of byDate) {
      resposta += `\n\n📅 *${formatDate(date)}*`;
      for (const item of items) {
        const horario = item.horario ? String(item.horario).slice(0, 5) : null;
        const titulo = String(item.titulo || '');
        const palestrante = item.palestrante ? String(item.palestrante) : null;
        const itemDescricao = item.descricao ? String(item.descricao) : null;
        let linha = horario ? `• ${horario} – ${titulo}` : `• ${titulo}`;
        if (palestrante) linha += ` (${palestrante})`;
        if (itemDescricao) linha += `\n  ${itemDescricao}`;
        resposta += `\n${linha}`;
      }
    }

    return { resposta, _ctx: ctx };
  }

  // geral
  let resposta = `Aqui estao as informacoes de *${nomeEvento}*:\n📅 ${dataRange}`;
  if (localStr) resposta += `\n📍 ${localStr}`;
  if (descricao) resposta += `\n\n${descricao}`;
  if (publicoAlvo) resposta += `\n\n👥 Publico-alvo: ${publicoAlvo}`;
  if (!descricao) resposta += '\n\nAs informacoes detalhadas ainda nao foram cadastradas pela organizacao.';
  return { resposta, _ctx: ctx };
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
    const ctxCpf = typeof contexto?.cpf === 'string' && contexto.cpf ? String(contexto.cpf) : null;
    const ctxInscricaoId = typeof contexto?.inscricao_id === 'string' && contexto.inscricao_id ? String(contexto.inscricao_id) : null;
    const ctxPendingIntent = typeof contexto?.pending_intent === 'string' && contexto.pending_intent ? String(contexto.pending_intent) : null;
    const ctxEventoId = typeof contexto?.evento_id === 'string' && contexto.evento_id ? String(contexto.evento_id) : null;
    const ctxEventoNome = typeof contexto?.evento_nome === 'string' && contexto.evento_nome ? String(contexto.evento_nome) : null;
    const ctxUltimaIntencao = typeof contexto?.ultima_intencao === 'string' && contexto.ultima_intencao ? String(contexto.ultima_intencao) : null;

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
      'quais eventos', 'qual eventos',
      'eventos abertos', 'eventos em aberto',
      'estao em aberto', 'estao abertos', 'estao abertas',
      'eventos com inscricao', 'inscricoes abertas',
      'eventos disponiveis', 'eventos disponivel',
      'quero ver os eventos', 'mostrar eventos',
      'onde posso me inscrever', 'tem eventos',
      'ha eventos', 'quais congressos',
      'eventos acontecendo', 'estao acontecendo',
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
    const NEGAR_CONFIRMAR = ['como faco', 'como fazer', 'fazer minha inscricao', 'quero fazer minha', 'quero fazer inscricao', 'quero fazer a'];
    const querConfirmarInscricao = hasAny(pergunta, [
      'confirmar minha inscricao',
      'confirmar inscricao',
      'ja me inscrevi',
      'consultar minha inscricao',
      'consultar inscricao',
      'ver minha inscricao',
      'ver inscricao',
      'status da inscricao',
      'situacao da inscricao',
      'como esta minha inscricao',
      'verificar minha inscricao',
      'ja fiz inscricao',
      'ja estou inscrito',
      'ja estou inscrita',
      'ja tenho inscricao',
    ]) || (pergunta.includes('minha inscricao') && !hasAny(pergunta, NEGAR_CONFIRMAR));
    const querHospedagem = hasAny(pergunta, ['hospedagem', 'alojamento']);
    const querAlimentacao = hasAny(pergunta, ['alimentacao', 'refeicao', 'refeicoes']);
    const querProgramacao = hasAny(pergunta, [
      'programacao', 'agenda', 'cronograma', 'horario', 'horarios',
      'atividades', 'palestrante', 'palestrantes',
    ]);
    const querDescricaoEvento = !querProgramacao && hasAny(pergunta, [
      'descricao', 'sobre o evento', 'fale sobre', 'detalhes do evento',
      'informacoes do evento', 'publico alvo', 'para quem e',
    ]);
    const querLocalEvento = !querProgramacao && !querDescricaoEvento && hasAny(pergunta, [
      'onde sera', 'onde vai ser', 'onde acontece', 'local do evento',
      'onde e o evento', 'cidade do evento', 'onde fica o evento',
    ]);
    const querDetalhesEvento = querProgramacao || querDescricaoEvento || querLocalEvento;
    const querValorInscricao = !isSegundaVia && !isPagamento && hasAny(pergunta, [
      'valor da inscricao', 'quanto custa', 'qual o valor',
      'quanto e a inscricao', 'quanto fica', 'qual o preco',
      'taxa de inscricao', 'preco da inscricao',
      'inscricao gratis', 'inscricao gratuita',
      'evento gratis', 'evento gratuito',
      'quanto custa o evento', 'quanto e o evento',
    ]);
    const querContato = hasAny(pergunta, [
      'contato', 'suporte do evento', 'whatsapp do evento',
      'como entro em contato', 'telefone do evento',
      'atendimento do evento', 'falar com a organizacao',
      'falar com o suporte',
    ]);
    const querContinuidade = !querEventosAbertos && !querDetalhesEvento && hasAny(pergunta, [
      'me mostre', 'mostrar mais', 'quero ver mais', 'ver detalhes', 'ver mais',
      'mais informacoes', 'saber mais', 'me fale mais', 'me conte mais',
      'pode mostrar', 'pode detalhar', 'me diga mais', 'quero saber mais',
    ]);

    // [TEMP] Log de intencoes para teste
    console.log(`[Maia] INTENCAO_DETECTADA | mensagem: "${perguntaRaw}" | ctx: evento(${ctxEventoId?.slice(0,8) ?? '-'}) nome(${ctxEventoNome ?? '-'}) intent(${ctxUltimaIntencao ?? '-'}) | ${[
      isSegundaVia && 'segunda_via',
      querConfirmarInscricao && 'confirmar_inscricao',
      isPagamento && 'consultar_pagamento',
      querHospedagem && 'consultar_hospedagem',
      querAlimentacao && 'consultar_alimentacao',
      querContinuidade && 'continuidade',
      querProgramacao && 'consultar_programacao',
      querDescricaoEvento && 'consultar_descricao',
      querLocalEvento && 'consultar_local',
      querDetalhesEvento && 'consultar_detalhes',
      querValorInscricao && 'consultar_valor_inscricao',
      querEventosAbertos && 'listar_eventos_abertos',
      querContato && 'consultar_contato',
      cpfDetectado && `cpf(${cpfDetectado})`,
    ].filter(Boolean).join(' | ') || 'fallback'}`);

    if (isSegundaVia) {
      if (!cpfDetectado) {
        return NextResponse.json({ resposta: 'Claro! Me informe seu CPF para localizar sua inscricao.' });
      }
      const resposta = await responderCpfConsulta(cpfDetectado, departamento);
      return NextResponse.json(resposta);
    }

    if (querConfirmarInscricao) {
      const cpfParaUsar = cpfDetectado ?? ctxCpf;
      if (!cpfParaUsar) {
        return NextResponse.json({
          resposta: 'Para confirmar sua inscricao, preciso do seu CPF. Me informe apenas os 11 numeros.',
          _ctx: { pending_intent: 'confirmar_inscricao' },
        });
      }
      const resposta = await responderConfirmarInscricao(cpfParaUsar, departamento);
      return NextResponse.json(resposta);
    }

    if (isPagamento) {
      const intro = 'Apos selecionar a modalidade da inscricao, o sistema exibira as opcoes de pagamento disponiveis 😊';
      const resposta = await responderEventosComIntro(
        departamento,
        `${intro}\n\nEscolha um dos eventos disponiveis para continuar.`
      );
      return NextResponse.json(resposta);
    }

    if (querHospedagem) {
      if (ctxInscricaoId) {
        const resposta = await responderHospedagemInscricao(ctxInscricaoId);
        return NextResponse.json({ ...resposta, _ctx: { cpf: ctxCpf ?? undefined, inscricao_id: ctxInscricaoId } });
      }
      const cpfParaUsar = cpfDetectado ?? ctxCpf;
      if (cpfParaUsar) {
        const infoInscricao = await responderConfirmarInscricao(cpfParaUsar, departamento);
        if (infoInscricao._ctx?.inscricao_id) {
          const respHosp = await responderHospedagemInscricao(infoInscricao._ctx.inscricao_id);
          return NextResponse.json({ ...respHosp, _ctx: infoInscricao._ctx });
        }
        return NextResponse.json(infoInscricao);
      }
      return NextResponse.json({ resposta: 'Para verificar a hospedagem da sua inscricao, me informe seu CPF (11 digitos).', _ctx: { pending_intent: 'hospedagem' } });
    }

    if (querAlimentacao) {
      if (ctxInscricaoId) {
        const resposta = await responderAlimentacaoInscricao(ctxInscricaoId);
        return NextResponse.json({ ...resposta, _ctx: { cpf: ctxCpf ?? undefined, inscricao_id: ctxInscricaoId } });
      }
      const cpfParaUsar = cpfDetectado ?? ctxCpf;
      if (cpfParaUsar) {
        const infoInscricao = await responderConfirmarInscricao(cpfParaUsar, departamento);
        if (infoInscricao._ctx?.inscricao_id) {
          const respAlim = await responderAlimentacaoInscricao(infoInscricao._ctx.inscricao_id);
          return NextResponse.json({ ...respAlim, _ctx: infoInscricao._ctx });
        }
        return NextResponse.json(infoInscricao);
      }
      return NextResponse.json({ resposta: 'Para verificar a alimentacao da sua inscricao, me informe seu CPF (11 digitos).', _ctx: { pending_intent: 'alimentacao' } });
    }

    if (querContinuidade) {
      if (ctxEventoId) {
        const tipoMap: Record<string, 'programacao' | 'descricao' | 'local' | 'geral'> = {
          consultar_programacao: 'programacao',
          consultar_descricao: 'descricao',
          consultar_local: 'local',
        };
        const tipo = ctxUltimaIntencao ? (tipoMap[ctxUltimaIntencao] ?? 'geral') : 'geral';
        const resposta = await responderDetalhesEvento(ctxEventoId, tipo);
        return NextResponse.json(resposta);
      }
      const { eventos, cards } = await fetchEventosComCards(departamento);
      if (eventos.length === 0) {
        return NextResponse.json({ resposta: buildSemEventosMensagem(departamento) });
      }
      if (eventos.length === 1) {
        const resposta = await responderDetalhesEvento(eventos[0].id, 'geral');
        return NextResponse.json(resposta);
      }
      return NextResponse.json({ resposta: 'Aqui estao os eventos com inscricoes abertas 😊', cards });
    }

    if (querDetalhesEvento) {
      const tipo = querProgramacao ? 'programacao' : querLocalEvento ? 'local' : querDescricaoEvento ? 'descricao' : 'geral';

      if (ctxEventoId) {
        const resposta = await responderDetalhesEvento(ctxEventoId, tipo);
        return NextResponse.json(resposta);
      }

      const { eventos, cards } = await fetchEventosComCards(departamento);
      if (eventos.length === 0) {
        return NextResponse.json({ resposta: buildSemEventosMensagem(departamento) });
      }
      if (eventos.length === 1) {
        const resposta = await responderDetalhesEvento(eventos[0].id, tipo);
        return NextResponse.json(resposta);
      }
      const perguntaQual = querProgramacao
        ? 'De qual evento voce quer saber a programacao? Escolha um dos eventos abaixo:'
        : querLocalEvento
          ? 'Sobre qual evento voce quer saber o local?'
          : 'Sobre qual evento voce quer mais informacoes?';
      return NextResponse.json({ resposta: perguntaQual, cards });
    }

    if (querValorInscricao) {
      const { eventos, cards } = await fetchEventosComCards(departamento);
      if (eventos.length === 0) {
        return NextResponse.json({ resposta: buildSemEventosMensagem(departamento) });
      }
      const intro = departamento
        ? `Valores de inscricao para eventos de ${departamento.nome} 😊`
        : 'Valores de inscricao dos eventos com inscricoes abertas 😊';
      return NextResponse.json({ resposta: intro, cards });
    }

    if (querParticiparDepto && departamento) {
      const { eventos, cards } = await fetchEventosComCards(departamento);
      if (eventos.length === 0) {
        return NextResponse.json({ resposta: buildSemEventosMensagem(departamento) });
      }
      const intro = eventos.length === 1
        ? `Perfeito 😊 ${eventos[0].nome} esta com inscricoes abertas.`
        : `Perfeito 😊 ${departamento.nome} tem eventos com inscricoes abertas.`;
      return NextResponse.json({ resposta: intro, cards });
    }

    if (querOrientacaoInscricao) {
      const intro = 'Claro 😊 Para fazer sua inscricao, escolha um dos eventos disponiveis na pagina e clique em "Ver eventos" para concluir.';
      const resposta = await responderEventosComIntro(departamento, intro);
      return NextResponse.json(resposta);
    }

    if (hasAny(pergunta, ['inscricao', 'inscricoes', 'me inscrever', 'como faco', 'como fazer'])) {
      const intro = 'Para se inscrever, escolha um dos eventos disponiveis nesta pagina 😊';
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

    if (hasAny(pergunta, ['certificado'])) {
      const supabase = createServerClient();
      const eventoIdCert = ctxEventoId;
      if (eventoIdCert) {
        const { data } = await supabase.from('eventos').select('nome,gerar_certificado').eq('id', eventoIdCert).maybeSingle();
        if (data) {
          const ev = data as Record<string, unknown>;
          return NextResponse.json({
            resposta: Boolean(ev.gerar_certificado)
              ? `Sim! O evento *${String(ev.nome)}* emite certificado de participacao 🎓`
              : `O evento *${String(ev.nome)}* nao preve emissao de certificado.`,
            _ctx: { evento_id: eventoIdCert },
          });
        }
      }
      const { eventos, cards } = await fetchEventosComCards(departamento);
      if (eventos.length === 0) return NextResponse.json({ resposta: buildSemEventosMensagem(departamento) });
      if (eventos.length === 1) {
        const { data } = await supabase.from('eventos').select('nome,gerar_certificado').eq('id', eventos[0].id).maybeSingle();
        if (data) {
          const ev = data as Record<string, unknown>;
          return NextResponse.json({
            resposta: Boolean(ev.gerar_certificado)
              ? `Sim! O evento *${String(ev.nome)}* emite certificado 🎓`
              : `O evento *${String(ev.nome)}* nao preve emissao de certificado.`,
            _ctx: { evento_id: eventos[0].id },
          });
        }
      }
      return NextResponse.json({ resposta: 'A emissao de certificado depende de cada evento. Veja os eventos abertos:', cards });
    }

    if (hasAny(pergunta, ['brinde'])) {
      const { eventos, cards } = await fetchEventosComCards(departamento);
      if (eventos.length === 0) return NextResponse.json({ resposta: buildSemEventosMensagem(departamento) });
      const resposta = departamento
        ? `Informacoes sobre brindes variam por evento em ${departamento.nome}. Veja os eventos abertos:`
        : 'Informacoes sobre brindes variam por evento. Veja os eventos abertos:';
      return NextResponse.json({ resposta, cards });
    }

    if (cpfDetectado) {
      if (ctxPendingIntent === 'confirmar_inscricao') {
        const resposta = await responderConfirmarInscricao(cpfDetectado, departamento);
        return NextResponse.json(resposta);
      }
      if (ctxPendingIntent === 'hospedagem') {
        const infoInscricao = await responderConfirmarInscricao(cpfDetectado, departamento);
        if (infoInscricao._ctx?.inscricao_id) {
          const respHosp = await responderHospedagemInscricao(infoInscricao._ctx.inscricao_id);
          return NextResponse.json({ ...respHosp, _ctx: infoInscricao._ctx });
        }
        return NextResponse.json(infoInscricao);
      }
      if (ctxPendingIntent === 'alimentacao') {
        const infoInscricao = await responderConfirmarInscricao(cpfDetectado, departamento);
        if (infoInscricao._ctx?.inscricao_id) {
          const respAlim = await responderAlimentacaoInscricao(infoInscricao._ctx.inscricao_id);
          return NextResponse.json({ ...respAlim, _ctx: infoInscricao._ctx });
        }
        return NextResponse.json(infoInscricao);
      }
      const resposta = await responderCpfConsulta(cpfDetectado, departamento);
      return NextResponse.json(resposta);
    }

    if (querContato) {
      const supabase = createServerClient();
      const evAbertos = await fetchOpenEvents({ departamento: departamento?.key });
      if (evAbertos.length === 0) {
        return NextResponse.json({ resposta: buildSemEventosMensagem(departamento) });
      }
      const ids = evAbertos.map(e => e.id);
      const { data: evData } = await supabase.from('eventos').select('id,nome,suporte_whatsapp,link_whatsapp').in('id', ids);
      const evLista = (evData ?? []) as Array<Record<string, unknown>>;
      const cards: AssistenteCard[] = evLista
        .filter(ev => ev.suporte_whatsapp || ev.link_whatsapp)
        .map(ev => {
          const nome = String(ev.nome || 'Evento');
          const suporte = buildWhatsAppLink(ev.suporte_whatsapp, 'Ola, preciso de ajuda com o evento!');
          const inscricao = buildWhatsAppLink(ev.link_whatsapp);
          const actions: AssistenteAction[] = [];
          if (suporte) actions.push({ label: '💬 Falar com suporte', href: suporte, variant: 'primary' });
          if (inscricao && inscricao !== suporte) actions.push({ label: '📞 WhatsApp', href: inscricao, variant: 'ghost' });
          return { id: String(ev.id || nome), title: `📞 ${nome}`, actions } as AssistenteCard;
        })
        .filter(c => c.actions && c.actions.length > 0);
      if (cards.length === 0) {
        return NextResponse.json({ resposta: 'Os dados de contato nao foram informados pela organizacao ainda.' });
      }
      return NextResponse.json({ resposta: 'Aqui estao os contatos dos eventos 😊', cards });
    }

    if (ctxEventoId) {
      const resposta = await responderDetalhesEvento(ctxEventoId, 'geral');
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
