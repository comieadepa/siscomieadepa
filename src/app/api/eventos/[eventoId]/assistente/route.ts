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

// ── Resposta estruturada para consulta de CPF ─────────────────
function respostaCpfConsulta(
  nomeEvento: string,
  cpfDigits: string,
  inscricao: Record<string, unknown> | null
): string {
  const cpfFormatado = formatarCpf(cpfDigits);
  if (!inscricao) {
    return `Não encontrei inscrição vinculada ao CPF *${cpfFormatado}* neste evento.\n\nVerifique se o CPF está correto ou entre em contato com a organização do evento.`;
  }
  const nome   = inscricao.nome_inscrito as string;
  const status = inscricao.status_pagamento as string;
  const statusLabel = status === 'pago'     ? '✅ Pago'
                    : status === 'isento'   ? '🎁 Isento'
                    : status === 'pendente' ? '⏳ Pendente'
                    : status;
  let msg = `✅ Encontrei sua inscrição em *${nomeEvento}*!\n\n👤 Nome: ${nome}\n💳 Pagamento: ${statusLabel}`;
  if (inscricao.hospedagem)  msg += '\n🛏️ Hospedagem: incluída';
  if (inscricao.brinde)      msg += '\n🎁 Brinde: incluído';
  if (inscricao.alimentacao) msg += '\n🍽️ Alimentação: incluída';
  return msg;
}

// ── Modo fallback (sem OpenAI) ─────────────────────────────────
function respostaFallback(
  pergunta: string,
  evento: Record<string, unknown>,
  programacao: Record<string, unknown>[],
  inscricao: Record<string, unknown> | null
): string {
  const p = pergunta.toLowerCase();

  // ── CPF puro: detecta quando a mensagem inteira é um CPF ─────
  const pTrim = p.trim();
  if (/^\d{11}$/.test(pTrim) || /^\d{3}[.\s]\d{3}[.\s]\d{3}[-\s]\d{2}$/.test(pTrim)) {
    return respostaCpfConsulta(
      evento.nome as string,
      pTrim.replace(/\D/g, ''),
      inscricao
    );
  }

  // ── Status de inscrição ──────────────────────────────────────
  if (p.includes('inscrição') || p.includes('inscri') || p.includes('status') || p.includes('inscrito')) {
    if (!inscricao) {
      return 'Para consultar sua inscrição, informe seu CPF na caixa de texto (ex: "CPF: 000.000.000-00"). Assim posso verificar sua situação no evento.';
    }
    const status = inscricao.status_pagamento as string;
    const nome   = inscricao.nome_inscrito as string;
    const statusLabel = status === 'pago' ? '✅ Pago' : status === 'isento' ? '🎁 Isento' : status === 'pendente' ? '⏳ Pendente' : status;
    let msg = `Sua inscrição está registrada!\n\n👤 Nome: ${nome}\n💳 Pagamento: ${statusLabel}`;
    if (inscricao.hospedagem) msg += '\n🛏️ Hospedagem: incluída';
    if (inscricao.brinde)     msg += '\n🎁 Brinde: incluído';
    if (inscricao.alimentacao) msg += '\n🍽️ Alimentação: incluída';
    return msg;
  }

  // ── Pagamento ────────────────────────────────────────────────
  if (p.includes('pagamento') || p.includes('pago') || p.includes('pix') || p.includes('valor')) {
    if (inscricao) {
      const status = inscricao.status_pagamento as string;
      if (status === 'pago' || status === 'isento') return '✅ Seu pagamento já está confirmado!';
      return '⏳ Seu pagamento ainda está pendente. Entre em contato com a organização do evento.';
    }
    const valor = evento.valor_inscricao as number;
    if (valor === 0) return '🎁 A inscrição neste evento é gratuita!';
    return `💳 O valor da inscrição é ${fmtMoeda(valor)}. Informe seu CPF para verificar o status do seu pagamento.`;
  }

  // ── Hospedagem ───────────────────────────────────────────────
  if (p.includes('hospedagem') || p.includes('alojamento') || p.includes('dormir') || p.includes('pernoite')) {
    if (inscricao) {
      return inscricao.hospedagem
        ? '🛏️ Sua inscrição inclui hospedagem!'
        : '❌ Sua inscrição atual não inclui hospedagem. Entre em contato com a organização para verificar disponibilidade.';
    }
    const permiteHosp = evento.permite_hospedagem as boolean;
    return permiteHosp
      ? '🛏️ Este evento oferece hospedagem. Ao se inscrever, você pode solicitar hospedagem conforme disponibilidade.'
      : '❌ Este evento não oferece hospedagem.';
  }

  // ── Brinde ───────────────────────────────────────────────────
  if (p.includes('brinde') || p.includes('kit') || p.includes('presente')) {
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
  if (p.includes('local') || p.includes('onde') || p.includes('lugar') || p.includes('endereço') || p.includes('cidade')) {
    const local  = evento.local as string | null;
    const cidade = evento.cidade as string | null;
    if (!local && !cidade) return 'O local do evento ainda não foi informado no sistema.';
    return `📍 O evento será realizado em: ${[local, cidade].filter(Boolean).join(' — ')}`;
  }

  // ── Data ─────────────────────────────────────────────────────
  if (p.includes('data') || p.includes('quando') || p.includes('dia') || p.includes('mês') || p.includes('mes')) {
    const inicio = fmtData(evento.data_inicio as string | null);
    const fim    = fmtData(evento.data_fim as string | null);
    return `📅 O evento acontece de ${inicio} a ${fim}.`;
  }

  // ── Programação ──────────────────────────────────────────────
  if (p.includes('programação') || p.includes('programacao') || p.includes('grade') || p.includes('palestra') || p.includes('atividade')) {
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
  if (p.includes('whatsapp') || p.includes('grupo') || p.includes('zap')) {
    const link = evento.link_whatsapp as string | null;
    if (!link) return 'O link do grupo de WhatsApp ainda não foi disponibilizado. Aguarde!';
    return `📲 Acesse o grupo do WhatsApp pelo link:\n${link}`;
  }

  // ── Tipos de inscrição ───────────────────────────────────────
  if (p.includes('modalidade') || p.includes('tipo') || p.includes('categoria') || p.includes('opção') || p.includes('opcao')) {
    return 'Para ver as modalidades de inscrição disponíveis, acesse a página de inscrição do evento. Lá você encontrará todas as opções com valores detalhados.';
  }

  // ── Saudação ─────────────────────────────────────────────────
  if (p.includes('olá') || p.includes('ola') || p.includes('oi') || p.includes('bom dia') || p.includes('boa') || p.includes('ajuda')) {
    return `Olá! Posso ajudar com informações sobre o evento *${evento.nome}*.\n\nPosso responder sobre:\n• Local e data\n• Sua inscrição (informe o CPF)\n• Status de pagamento\n• Hospedagem e brinde\n• Programação\n• Grupo do WhatsApp\n\nO que deseja saber?`;
  }

  // ── Fallback genérico ────────────────────────────────────────
  return `Não tenho informações detalhadas sobre isso no momento. Você pode perguntar sobre:\n• Local e data do evento\n• Sua inscrição (com CPF)\n• Pagamento\n• Hospedagem\n• Programação\n• Grupo de WhatsApp`;
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
    let cpf = cpfRaw.replace(/\D/g, '');

    // Se a pergunta em si é um CPF, extrai e usa como CPF de consulta
    const perguntaIsCpf = isCpfOnly(pergunta);
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
        .select('id,nome,slug,descricao,departamento,data_inicio,data_fim,local,cidade,valor_inscricao,permite_hospedagem,permite_alimentacao,permite_brinde,link_whatsapp,mensagem_confirmacao,publico_alvo,status')
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

    // ── Busca inscrição pelo CPF (se informado) ────────────────
    let inscricao: Record<string, unknown> | null = null;
    if (cpf.length === 11) {
      const { data: insData } = await supabase
        .from('evento_inscricoes')
        .select('id,nome_inscrito,status_pagamento,hospedagem,alimentacao,brinde,created_at,forma_pagamento')
        .eq('evento_id', eventoId)
        .eq('cpf', cpf)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      if (insData) inscricao = insData as Record<string, unknown>;
    }

    let resposta: string;
    let modo: 'ia' | 'fallback' = 'fallback';

    // ── Tenta chamar OpenAI ────────────────────────────────────
    const openaiKey = process.env.OPENAI_API_KEY;
    const openaiModel = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

    // Quando a pergunta é apenas um CPF, retorna direto sem IA nem fallback
    if (perguntaIsCpf && !openaiKey) {
      const respostaDireta = respostaCpfConsulta(evento.nome as string, cpf, inscricao);
      supabase
        .from('evento_assistente_logs')
        .insert([{ evento_id: eventoId, pergunta, resposta: respostaDireta, cpf: cpf.length === 11 ? cpf : null, modo: 'fallback' }])
        .then(() => {/* fire and forget */})
        .then(undefined, () => {/* ignora erro */});
      return NextResponse.json({ resposta: respostaDireta, modo: 'fallback' });
    }

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
          programacao.length > 0
            ? `\nProgramação:\n${programacao.map(it =>
                `- ${fmtData(it.data as string)} ${fmtHora(it.horario as string | null)} ${it.titulo}${it.palestrante ? ' — ' + it.palestrante : ''}${it.local ? ' @ ' + it.local : ''}`
              ).join('\n')}`
            : 'Programação: não cadastrada',
          inscricao
            ? `\nDados desta inscrição (CPF informado):\n- Nome: ${inscricao.nome_inscrito}\n- Status pagamento: ${inscricao.status_pagamento}\n- Hospedagem: ${inscricao.hospedagem ? 'sim' : 'não'}\n- Brinde: ${inscricao.brinde ? 'sim' : 'não'}\n- Alimentação: ${inscricao.alimentacao ? 'sim' : 'não'}`
            : cpf.length === 11
              ? `\nO CPF informado (${cpfRaw}) não possui inscrição neste evento.`
              : 'CPF não informado — não consulte dados de inscrição.',
        ].join('\n');

        const systemPrompt = `Você é o Assistente do Evento, um chatbot de suporte ao participante. Responda de forma curta, clara e amigável.

REGRAS OBRIGATÓRIAS:
1. Responda APENAS com base nas informações do contexto abaixo.
2. Se a informação não estiver no contexto, diga: "Essa informação ainda não foi cadastrada no sistema."
3. Não invente palestrantes, horários, locais ou programação.
4. Para consultar inscrição individual, o CPF deve ter sido fornecido pelo usuário.
5. Nunca exponha dados de outros inscritos.
6. Use emojis com moderação para deixar a resposta mais amigável.
7. Máximo 200 palavras por resposta.

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
      resposta = respostaFallback(pergunta, evento, programacao, inscricao);
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
      { resposta: 'Desculpe, ocorreu um erro. Tente novamente em instantes.' },
      { status: 200 } // retorna 200 para não quebrar o widget
    );
  }
}
