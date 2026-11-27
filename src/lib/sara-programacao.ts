export interface ProgramacaoOficialItem {
  plenaria_key: string;
  plenaria_nome: string;
  arquivo_url?: string | null;
  texto_extraido?: string | null;
}

/**
 * Normaliza texto para busca semântica simples (minúsculas, sem acento, pontuação limpa).
 */
export function normalizarParaBusca(txt: string): string {
  return (txt || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mapeia dias da semana em português para normalização.
 */
const DIAS_SEMANA_MAP: Record<string, string> = {
  domingo: 'domingo',
  segunda: 'segunda',
  'segunda feira': 'segunda',
  terca: 'terca',
  'terca feira': 'terca',
  quarta: 'quarta',
  'quarta feira': 'quarta',
  quinta: 'quinta',
  'quinta feira': 'quinta',
  sexta: 'sexta',
  'sexta feira': 'sexta',
  sabado: 'sabado',
};

/**
 * Obtém a data e dia da semana atual no horário oficial de Belém (America/Belem).
 */
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

/**
 * Obtém o dia seguinte no horário de Belém.
 */
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
 * Detecta termos temporais ou dias da semana na pergunta.
 */
function extrairReferenciaTemporal(perguntaNorm: string): { termo: string; chaveBusca: string[] } | null {
  if (perguntaNorm.includes('hoje')) {
    const hoje = getHojeBelem();
    return { termo: 'hoje', chaveBusca: [hoje.dataBr.slice(0, 5), hoje.diaSemana] };
  }
  if (perguntaNorm.includes('amanha')) {
    const amanha = getAmanhaBelem();
    return { termo: 'amanhã', chaveBusca: [amanha.dataBr.slice(0, 5), amanha.diaSemana] };
  }

  for (const [termo, chave] of Object.entries(DIAS_SEMANA_MAP)) {
    if (new RegExp(`\\b${termo}\\b`).test(perguntaNorm)) {
      return { termo, chaveBusca: [chave] };
    }
  }

  // Datas específicas no formato DD/MM
  const matchData = perguntaNorm.match(/\b(\d{1,2})[\/\-](\d{1,2})\b/);
  if (matchData) {
    const d = matchData[1].padStart(2, '0');
    const m = matchData[2].padStart(2, '0');
    return { termo: `${d}/${m}`, chaveBusca: [`${d}/${m}`] };
  }

  return null;
}

/**
 * Busca inteligente e objetiva no texto extraído das programações oficiais dos PDFs.
 */
export function buscarNaProgramacaoOficial(
  pergunta: string,
  programacoes: ProgramacaoOficialItem[],
  nomeEvento: string
): string | null {
  if (!programacoes || programacoes.length === 0) {
    return null;
  }

  const pNorm = normalizarParaBusca(pergunta);
  if (!pNorm) return null;

  // Filtra por plenária específica se mencionada
  let progsAlvo = programacoes;
  if (pNorm.includes('aemadepa') || pNorm.includes('esposa') || pNorm.includes('mulher') || pNorm.includes('irma')) {
    const aemadepa = programacoes.filter(p => p.plenaria_key === 'aemadepa');
    if (aemadepa.length > 0) progsAlvo = aemadepa;
  } else if (pNorm.includes('juventude') || pNorm.includes('umadespa') || pNorm.includes('jovens') || pNorm.includes('hds') || pNorm.includes('filhos de pastores')) {
    const umad = programacoes.filter(p => p.plenaria_key === 'umadespa');
    if (umad.length > 0) progsAlvo = umad;
  } else if (pNorm.includes('ministro') || pNorm.includes('pastor') || pNorm.includes('evangelista')) {
    const min = programacoes.filter(p => p.plenaria_key === 'ministros');
    if (min.length > 0) progsAlvo = min;
  }

  // Verifica se é pergunta sobre pregador / preletor / culto
  const querPregador = pNorm.includes('pregador') || pNorm.includes('preletor') || pNorm.includes('pregar') || pNorm.includes('palestrante') || pNorm.includes('ministrante');
  const querAbertura = pNorm.includes('abertura') || pNorm.includes('inicio') || pNorm.includes('primeira noite');
  const querHorario = pNorm.includes('horario') || pNorm.includes('que horas') || pNorm.includes('comeca') || pNorm.includes('inicio');
  const querCulto = pNorm.includes('culto') || pNorm.includes('plenaria') || pNorm.includes('reuniao');

  const refTemporal = extrairReferenciaTemporal(pNorm);

  // 1. Caso específico: Pregador / Horário / Abertura
  if (querAbertura) {
    for (const prog of progsAlvo) {
      const texto = prog.texto_extraido || '';
      const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const linhaAbertura = linhas.find(l => normalizarParaBusca(l).includes('abertura'));
      if (linhaAbertura) {
        // Pega linhas adjacentes (até 3 linhas seguintes)
        const idx = linhas.indexOf(linhaAbertura);
        const trecho = linhas.slice(Math.max(0, idx), Math.min(linhas.length, idx + 4)).join('\n');
        return `📋 *${prog.plenaria_nome} — Abertura Oficial:*\n\n${trecho}`;
      }
    }
  }

  // 2. Se houver referência temporal (hoje, amanhã, segunda-feira, 30/11 etc.)
  if (refTemporal) {
    const resultadosPorPlenaria: string[] = [];

    for (const prog of progsAlvo) {
      const texto = prog.texto_extraido || '';
      if (!texto) continue;

      const linhas = texto.split(/\r?\n/);
      let capturando = false;
      const blocoDia: string[] = [];

      for (let i = 0; i < linhas.length; i++) {
        const linha = linhas[i].trim();
        const lNorm = normalizarParaBusca(linha);

        const bateReferencia = refTemporal.chaveBusca.some(ch => lNorm.includes(ch));
        const ehSeparadorDia = (lNorm.includes('segunda') || lNorm.includes('terca') || lNorm.includes('quarta') || lNorm.includes('quinta') || lNorm.includes('sexta') || lNorm.includes('domingo') || /\d{2}\/\d{2}/.test(lNorm)) && (lNorm.includes('feira') || lNorm.includes('ago') || lNorm.includes('2026') || lNorm.length < 35);

        if (bateReferencia && ehSeparadorDia) {
          capturando = true;
          blocoDia.push(linha);
          continue;
        }

        if (capturando) {
          // Se encontrou o próximo dia, para de capturar
          if (ehSeparadorDia && !bateReferencia) {
            break;
          }
          if (linha) {
            blocoDia.push(linha);
          }
        }
      }

      if (blocoDia.length > 0) {
        // Se a pergunta era especificamente sobre pregador/horário/culto dentro desse dia, filtra as linhas mais relevantes
        if (querPregador || querHorario || querCulto) {
          const termosRelevantes = querPregador
            ? ['pregador', 'preletor', 'pr.', 'pastor', 'miss.', 'dr', 'palestra', 'plenaria']
            : querCulto
              ? ['culto', 'plenaria', 'abertura', 'ceia', 'noite', 'manha', 'tarde']
              : ['h', '00', '30', 'manha', 'tarde', 'noite', 'abertura', 'culto'];
          const linhasRelevantes = blocoDia.filter((l, idx) => {
            if (idx === 0) return true; // Mantém cabeçalho do dia
            const ln = normalizarParaBusca(l);
            return termosRelevantes.some(t => ln.includes(t));
          });
          if (linhasRelevantes.length > 1) {
            resultadosPorPlenaria.push(`*${prog.plenaria_nome}:*\n${linhasRelevantes.join('\n')}`);
            continue;
          }
        }

        resultadosPorPlenaria.push(`*${prog.plenaria_nome}:*\n${blocoDia.slice(0, 15).join('\n')}`);
      }
    }

    if (resultadosPorPlenaria.length > 0) {
      return `📅 *Programação para ${refTemporal.termo} (${nomeEvento}):*\n\n${resultadosPorPlenaria.join('\n\n')}`;
    } else {
      return `Não encontrei atividades programadas para ${refTemporal.termo} na programação oficial publicada.`;
    }
  }

  // 3. Busca por termos específicos de preletores / palavras-chave
  const palavras = pNorm
    .split(' ')
    .filter(w => w.length >= 4 && !['qual', 'quem', 'como', 'onde', 'quando', 'sobre', 'evento', 'para', 'pela', 'pelo', 'esta', 'estao', 'programacao', 'oficial'].includes(w));

  if (palavras.length > 0) {
    const correspondencias: string[] = [];

    for (const prog of progsAlvo) {
      const texto = prog.texto_extraido || '';
      if (!texto) continue;

      const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      for (let i = 0; i < linhas.length; i++) {
        const lNorm = normalizarParaBusca(linhas[i]);
        const contemPalavra = palavras.some(pal => lNorm.includes(pal));

        if (contemPalavra) {
          // Pega a linha e o contexto imediato
          const contextoLinhas = linhas.slice(Math.max(0, i - 1), Math.min(linhas.length, i + 3));
          correspondencias.push(`*${prog.plenaria_nome}:*\n${contextoLinhas.join('\n')}`);
          if (correspondencias.length >= 2) break;
        }
      }
    }

    if (correspondencias.length > 0) {
      return `📋 *Informações encontradas na programação oficial:*\n\n${correspondencias.join('\n\n')}`;
    }
  }

  // 4. Se a pergunta for ampla sobre programação geral
  if (pNorm.includes('programacao') || pNorm.includes('agenda') || pNorm.includes('cronograma')) {
    let resumo = `📋 *Programações Oficiais Publicadas — ${nomeEvento}:*\n`;
    for (const p of programacoes) {
      resumo += `\n• *${p.plenaria_nome}*`;
      if (p.texto_extraido) {
        const primeirasLinhas = p.texto_extraido
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean)
          .slice(0, 3)
          .join(' | ');
        if (primeirasLinhas) {
          resumo += `\n  _${primeirasLinhas}_`;
        }
      }
    }
    resumo += '\n\nQual dia, plenária ou atividade você gostaria de consultar?';
    return resumo;
  }

  return null;
}
