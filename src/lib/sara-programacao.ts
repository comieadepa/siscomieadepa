/**
 * Módulo de Inteligência Conversacional da SARA
 * Base de conhecimento, interpretação em linguagem natural,
 * resolução temporal (América/Belém UTC-3) e respostas fundamentadas nos PDFs oficiais publicados.
 */

export interface ProgramacaoOficialItem {
  plenaria_key: string;
  plenaria_nome: string;
  arquivo_url?: string | null;
  texto_extraido?: string | null;
  status?: string;
}

export interface ContextoConversa {
  evento_id?: string;
  evento_nome?: string;
  ultima_intencao?: string;
  plenaria_selecionada?: string;
  dia_selecionado?: string;
  turno_selecionado?: string;
  ultima_pergunta?: string;
}

export function normalizarParaBusca(txt: string): string {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DIAS_SEMANA_MAP: Record<string, { chave: string; dataIsoAgo: string; dataBrAgo: string }> = {
  domingo: { chave: 'domingo', dataIsoAgo: '2026-11-29', dataBrAgo: '29/11' },
  segunda: { chave: 'segunda', dataIsoAgo: '2026-11-30', dataBrAgo: '30/11' },
  'segunda feira': { chave: 'segunda', dataIsoAgo: '2026-11-30', dataBrAgo: '30/11' },
  terca: { chave: 'terca', dataIsoAgo: '2026-12-01', dataBrAgo: '01/12' },
  'terca feira': { chave: 'terca', dataIsoAgo: '2026-12-01', dataBrAgo: '01/12' },
  quarta: { chave: 'quarta', dataIsoAgo: '2026-12-02', dataBrAgo: '02/12' },
  'quarta feira': { chave: 'quarta', dataIsoAgo: '2026-12-02', dataBrAgo: '02/12' },
  quinta: { chave: 'quinta', dataIsoAgo: '2026-12-03', dataBrAgo: '03/12' },
  'quinta feira': { chave: 'quinta', dataIsoAgo: '2026-12-03', dataBrAgo: '03/12' },
  sexta: { chave: 'sexta', dataIsoAgo: '2026-12-04', dataBrAgo: '04/12' },
  'sexta feira': { chave: 'sexta', dataIsoAgo: '2026-12-04', dataBrAgo: '04/12' },
  sabado: { chave: 'sabado', dataIsoAgo: '2026-12-05', dataBrAgo: '05/12' },
};

export function getHojeBelem(): { dataIso: string; diaSemana: string; dataBr: string } {
  const agora = new Date();
  const belemStr = agora.toLocaleString('en-US', { timeZone: 'America/Belem' });
  const dBelem = new Date(belemStr);

  const ano = dBelem.getFullYear();
  const mes = String(dBelem.getMonth() + 1).padStart(2, '0');
  const dia = String(dBelem.getDate()).padStart(2, '0');
  const dataIso = `${ano}-${mes}-${dia}`;
  const dataBr = `${dia}/${mes}/${ano}`;

  const diaSemanaExtenso = agora.toLocaleDateString('pt-BR', { timeZone: 'America/Belem', weekday: 'long' });
  const diaSemanaNorm = normalizarParaBusca(diaSemanaExtenso).split(' ')[0];

  return { dataIso, diaSemana: diaSemanaNorm, dataBr };
}

export function getAmanhaBelem(): { dataIso: string; diaSemana: string; dataBr: string } {
  const agora = new Date();
  const belemStr = agora.toLocaleString('en-US', { timeZone: 'America/Belem' });
  const dAmanha = new Date(belemStr);
  dAmanha.setDate(dAmanha.getDate() + 1);

  const ano = dAmanha.getFullYear();
  const mes = String(dAmanha.getMonth() + 1).padStart(2, '0');
  const dia = String(dAmanha.getDate()).padStart(2, '0');
  const dataIso = `${ano}-${mes}-${dia}`;
  const dataBr = `${dia}/${mes}/${ano}`;

  const diaSemanaExtenso = dAmanha.toLocaleDateString('pt-BR', { timeZone: 'America/Belem', weekday: 'long' });
  const diaSemanaNorm = normalizarParaBusca(diaSemanaExtenso).split(' ')[0];

  return { dataIso, diaSemana: diaSemanaNorm, dataBr };
}

/**
 * Detecta se a pergunta é sobre informações gerais ("Quais são as informações sobre o evento?").
 */
export function isPerguntaInformacoesGerais(pergunta: string): boolean {
  const p = normalizarParaBusca(pergunta);
  if (!p) return false;
  return (
    p === 'quais sao as informacoes sobre o evento' ||
    p === 'informacoes sobre o evento' ||
    p === 'quais sao as informacoes do evento' ||
    p === 'informacoes do evento' ||
    p === 'detalhes do evento' ||
    p === 'sobre o evento' ||
    p === 'quero informacoes sobre o evento' ||
    p === 'me passe as informacoes do evento'
  );
}

/**
 * Filtra estritamente as programações com status 'publicada'.
 * Nunca utiliza programações em rascunho.
 */
export function filtrarApenasPublicadas(programacoes: ProgramacaoOficialItem[]): ProgramacaoOficialItem[] {
  return (programacoes || []).filter(p => p.status === 'publicada');
}

/**
 * Extrai cantores, bandas e grupos de louvor mencionados no texto.
 */
function extrairCantoresELouvor(programacoes: ProgramacaoOficialItem[]): string {
  const itensEncontrados: { plenaria: string; texto: string }[] = [];

  for (const prog of programacoes) {
    const texto = prog.texto_extraido || '';
    const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    for (const linha of linhas) {
      const lNorm = normalizarParaBusca(linha);
      const temTermoLouvor =
        lNorm.includes('cantor') ||
        lNorm.includes('cantora') ||
        lNorm.includes('louvor') ||
        lNorm.includes('banda') ||
        lNorm.includes('coral') ||
        lNorm.includes('grupo de louvor');

      if (temTermoLouvor) {
        itensEncontrados.push({ plenaria: prog.plenaria_nome, texto: linha });
      }
    }
  }

  if (itensEncontrados.length === 0) {
    return 'Não constam cantores ou grupos de louvor cadastrados na programação oficial publicada até o momento.';
  }

  // Agrupa e remove duplicações
  const linhasUnicas = Array.from(new Set(itensEncontrados.map(i => `• ${i.texto} (${i.plenaria})`)));
  return `🎵 *Cantores e Louvores confirmados na programação oficial:*\n\n${linhasUnicas.join('\n')}`;
}

/**
 * Extrai informações específicas sobre Santa Ceia.
 */
function extrairSantaCeia(programacoes: ProgramacaoOficialItem[]): string {
  const ocorrencias: string[] = [];

  for (const prog of programacoes) {
    const texto = prog.texto_extraido || '';
    const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

    for (let i = 0; i < linhas.length; i++) {
      const lNorm = normalizarParaBusca(linhas[i]);
      if (lNorm.includes('santa ceia') || lNorm.includes('ceia do senhor')) {
        // Busca contexto do dia anterior ou linhas próximas
        const contexto = linhas.slice(Math.max(0, i - 2), Math.min(linhas.length, i + 3)).join('\n');
        ocorrencias.push(`*${prog.plenaria_nome}:*\n${contexto}`);
      }
    }
  }

  if (ocorrencias.length > 0) {
    return `🍞🍷 *Informações sobre a Santa Ceia na programação oficial:*\n\n${ocorrencias.join('\n\n')}`;
  }

  return 'Não encontrei menção à data ou horário da Santa Ceia na programação oficial publicada até o momento.';
}

/**
 * Motor central de IA / Fallback estruturado de programação oficial.
 */
export function responderComInteligenciaConversacional(
  pergunta: string,
  programacoesTodas: ProgramacaoOficialItem[],
  nomeEvento: string,
  contextoAnterior?: ContextoConversa
): { resposta: string; _ctx: ContextoConversa } {
  // Regra 6: Consultar EXCLUSIVAMENTE programações publicadas, nunca rascunhos!
  const publicadas = filtrarApenasPublicadas(programacoesTodas);
  const pNorm = normalizarParaBusca(pergunta);

  // Cria contexto acumulado
  const ctx: ContextoConversa = {
    evento_nome: nomeEvento,
    ultima_pergunta: pergunta,
    ...(contextoAnterior || {}),
  };

  // Se não há programações publicadas
  if (publicadas.length === 0) {
    return {
      resposta: 'A programação oficial deste evento ainda não foi publicada pela organização.',
      _ctx: ctx,
    };
  }

  // Identifica plenária alvo a partir da pergunta ou do contexto
  let plenariasAlvo = publicadas;
  if (pNorm.includes('aemadepa') || pNorm.includes('esposa') || pNorm.includes('mulher') || pNorm.includes('irma')) {
    ctx.plenaria_selecionada = 'aemadepa';
  } else if (pNorm.includes('juventude') || pNorm.includes('umadespa') || pNorm.includes('jovens') || pNorm.includes('hds') || pNorm.includes('filhos de pastores')) {
    ctx.plenaria_selecionada = 'umadespa';
  } else if (pNorm.includes('ministro') || pNorm.includes('pastor') || pNorm.includes('obreiro')) {
    ctx.plenaria_selecionada = 'ministros';
  }

  if (ctx.plenaria_selecionada) {
    const filtrada = publicadas.filter(p => p.plenaria_key === ctx.plenaria_selecionada);
    if (filtrada.length > 0) plenariasAlvo = filtrada;
  }

  // 1. Pergunta sobre Cantores / Louvor / Música
  if (
    pNorm.includes('cantor') ||
    pNorm.includes('cantores') ||
    pNorm.includes('cantora') ||
    pNorm.includes('cantoras') ||
    pNorm.includes('louvor') ||
    pNorm.includes('banda') ||
    pNorm.includes('musica')
  ) {
    return {
      resposta: extrairCantoresELouvor(plenariasAlvo),
      _ctx: { ...ctx, ultima_intencao: 'consultar_louvor' },
    };
  }

  // 2. Pergunta sobre Santa Ceia
  if (pNorm.includes('santa ceia') || pNorm.includes('ceia')) {
    return {
      resposta: extrairSantaCeia(plenariasAlvo),
      _ctx: { ...ctx, ultima_intencao: 'consultar_ceia' },
    };
  }

  // 3. Resolução temporal e contextual (dias da semana, hoje, amanhã, e turnos: manhã, tarde, noite)
  let diaRef: { termo: string; chaves: string[] } | null = null;

  if (pNorm.includes('hoje')) {
    const hoje = getHojeBelem();
    diaRef = { termo: 'hoje', chaves: [hoje.dataBr.slice(0, 5), hoje.diaSemana] };
    ctx.dia_selecionado = hoje.diaSemana;
  } else if (pNorm.includes('amanha')) {
    const amanha = getAmanhaBelem();
    diaRef = { termo: 'amanhã', chaves: [amanha.dataBr.slice(0, 5), amanha.diaSemana] };
    ctx.dia_selecionado = amanha.diaSemana;
  } else {
    for (const [termo, conf] of Object.entries(DIAS_SEMANA_MAP)) {
      if (new RegExp(`\\b${termo}\\b`).test(pNorm)) {
        diaRef = { termo, chaves: [conf.chave, conf.dataBrAgo] };
        ctx.dia_selecionado = conf.chave;
        break;
      }
    }
  }

  // Se a pergunta atual não cita o dia, mas é uma pergunta de acompanhamento (ex: "e à noite?", "quem vai pregar?")
  // reaproveita o dia_selecionado do contexto anterior!
  if (!diaRef && ctx.dia_selecionado) {
    const conf = DIAS_SEMANA_MAP[ctx.dia_selecionado];
    if (conf) {
      diaRef = { termo: ctx.dia_selecionado, chaves: [conf.chave, conf.dataBrAgo] };
    }
  }

  // Detecta turno (manhã, tarde, noite)
  let turnoAlvo: 'manha' | 'tarde' | 'noite' | null = null;
  if (pNorm.includes('noite') || pNorm.includes('a noite') || pNorm.includes('noturno') || pNorm.includes('culto da noite')) {
    turnoAlvo = 'noite';
    ctx.turno_selecionado = 'noite';
  } else if (pNorm.includes('manha') || pNorm.includes('de manha') || pNorm.includes('pela manha')) {
    turnoAlvo = 'manha';
    ctx.turno_selecionado = 'manha';
  } else if (pNorm.includes('tarde') || pNorm.includes('a tarde') || pNorm.includes('pela tarde')) {
    turnoAlvo = 'tarde';
    ctx.turno_selecionado = 'tarde';
  }

  const querPregador = pNorm.includes('prega') || pNorm.includes('preletor') || pNorm.includes('palestrante') || pNorm.includes('ministrante');
  const querAbertura = pNorm.includes('abertura');

  // Abertura oficial
  if (querAbertura) {
    for (const prog of plenariasAlvo) {
      const texto = prog.texto_extraido || '';
      const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const idx = linhas.findIndex(l => normalizarParaBusca(l).includes('abertura'));
      if (idx >= 0) {
        const trecho = linhas.slice(Math.max(0, idx - 1), Math.min(linhas.length, idx + 4)).join('\n');
        return {
          resposta: `📋 *${prog.plenaria_nome} — Abertura Oficial:*\n\n${trecho}`,
          _ctx: { ...ctx, ultima_intencao: 'consultar_abertura' },
        };
      }
    }
  }

  // Se temos um dia de referência (explícito ou do contexto)
  if (diaRef) {
    const blocosPorPlenaria: string[] = [];

    for (const prog of plenariasAlvo) {
      const texto = prog.texto_extraido || '';
      if (!texto) continue;

      const linhas = texto.split(/\r?\n/);
      let capturando = false;
      const linhasDoDia: string[] = [];

      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i].trim();
        const lNorm = normalizarParaBusca(linha);

        const bateDia = diaRef.chaves.some(k => lNorm.includes(k));
        const ehCabecalhoDia =
          (lNorm.includes('segunda') || lNorm.includes('terca') || lNorm.includes('quarta') || lNorm.includes('quinta') || lNorm.includes('sexta') || lNorm.includes('domingo') || /\d{2}\/\d{2}/.test(lNorm)) &&
          (lNorm.includes('feira') || lNorm.includes('ago') || lNorm.includes('2026') || lNorm.length < 35);

        if (bateDia && ehCabecalhoDia) {
          capturando = true;
          linhasDoDia.push(linha);
          continue;
        }

        if (capturando) {
          if (ehCabecalhoDia && !bateDia) {
            break;
          }
          if (linha) {
            linhasDoDia.push(linha);
          }
        }
      }

      if (linhasDoDia.length > 0) {
        // Se foi especificado um turno (ex: "e à noite?")
        if (turnoAlvo) {
          let capturandoTurno = false;
          const linhasTurno: string[] = [];
          for (const l of linhasDoDia) {
            const lNorm = normalizarParaBusca(l);
            const ehOutroTurno =
              (turnoAlvo !== 'manha' && lNorm === 'manha') ||
              (turnoAlvo !== 'tarde' && lNorm === 'tarde') ||
              (turnoAlvo !== 'noite' && lNorm === 'noite');

            if (lNorm === turnoAlvo || (turnoAlvo === 'noite' && lNorm.includes('noite'))) {
              capturandoTurno = true;
              linhasTurno.push(l);
              continue;
            }

            if (capturandoTurno) {
              if (ehOutroTurno) break;
              linhasTurno.push(l);
            }
          }

          if (linhasTurno.length > 0) {
            blocosPorPlenaria.push(`*${prog.plenaria_nome} (${diaRef.termo} — ${turnoAlvo}):*\n${linhasTurno.join('\n')}`);
            continue;
          }
        }

        // Se pergunta por pregador/preletor do dia
        if (querPregador) {
          const termosPregador = ['pregador', 'preletor', 'pr.', 'pastor', 'miss.', 'dr', 'dra', 'palestrante', 'plenaria'];
          const relevantes = linhasDoDia.filter((l, idx) => {
            if (idx === 0) return true;
            const ln = normalizarParaBusca(l);
            return termosPregador.some(t => ln.includes(t));
          });
          if (relevantes.length > 1) {
            blocosPorPlenaria.push(`*${prog.plenaria_nome}:*\n${relevantes.join('\n')}`);
            continue;
          }
        }

        blocosPorPlenaria.push(`*${prog.plenaria_nome}:*\n${linhasDoDia.slice(0, 18).join('\n')}`);
      }
    }

    if (blocosPorPlenaria.length > 0) {
      const turnoMsg = turnoAlvo ? ` — ${turnoAlvo}` : '';
      return {
        resposta: `📅 *Programação de ${diaRef.termo}${turnoMsg} (${nomeEvento}):*\n\n${blocosPorPlenaria.join('\n\n')}`,
        _ctx: { ...ctx, ultima_intencao: 'consultar_programacao' },
      };
    } else {
      return {
        resposta: `Não encontrei atividades programadas para ${diaRef.termo} na programação oficial publicada.`,
        _ctx: { ...ctx, ultima_intencao: 'consultar_programacao' },
      };
    }
  }

  // 4. Pergunta ampla sobre a programação de uma plenária (ex: "Qual a programação da AEMADEPA?")
  if (pNorm.includes('programacao') || pNorm.includes('agenda') || pNorm.includes('atividades')) {
    let resumo = `📋 *Programação Oficial — ${nomeEvento}:*\n`;
    for (const p of plenariasAlvo) {
      resumo += `\n*${p.plenaria_nome}*`;
      if (p.texto_extraido) {
        const primeirasLinhas = p.texto_extraido
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean)
          .slice(0, 6)
          .join('\n• ');
        if (primeirasLinhas) {
          resumo += `\n• ${primeirasLinhas}\n...`;
        }
      }
    }
    resumo += '\n\nQual dia, plenária ou turno você deseja consultar em detalhes?';
    return {
      resposta: resumo,
      _ctx: { ...ctx, ultima_intencao: 'consultar_programacao' },
    };
  }

  // 5. Busca semântica textual por palavras-chave com relevância
  const palavras = pNorm
    .split(' ')
    .filter(w => w.length >= 3 && !['qual', 'quem', 'como', 'onde', 'quando', 'sobre', 'evento', 'para', 'pela', 'pelo', 'esta', 'estao', 'programacao', 'oficial', 'quais'].includes(w));

  if (palavras.length > 0) {
    const correspondencias: string[] = [];

    for (const prog of plenariasAlvo) {
      const texto = prog.texto_extraido || '';
      if (!texto) continue;

      const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (let i = 0; i < linhas.length; i++) {
        const lNorm = normalizarParaBusca(linhas[i]);
        const achou = palavras.some(pal => lNorm.includes(pal));

        if (achou) {
          const contextoTrecho = linhas.slice(Math.max(0, i - 1), Math.min(linhas.length, i + 3));
          correspondencias.push(`*${prog.plenaria_nome}:*\n${contextoTrecho.join('\n')}`);
          if (correspondencias.length >= 2) break;
        }
      }
    }

    if (correspondencias.length > 0) {
      return {
        resposta: `📋 *Informações encontradas na programação oficial:*\n\n${correspondencias.join('\n\n')}`,
        _ctx: { ...ctx, ultima_intencao: 'consultar_programacao' },
      };
    }
  }

  // 6. Caso a pergunta não encontre nenhuma correspondência na programação nem no contexto
  // Regra 4 e 5: Não retornar descrição genérica! Se a informação não existir, informar sua ausência ou pedir esclarecimento.
  return {
    resposta: `Não encontrei essa informação na programação oficial publicada da *${nomeEvento}*.\n\nVocê pode me perguntar sobre datas, cultos, pregadores, cantores, plenárias de casais, reuniões da AEMADEPA ou da Juventude (UMADESPA/HDS).`,
    _ctx: { ...ctx, ultima_intencao: 'esclarecimento' },
  };
}
