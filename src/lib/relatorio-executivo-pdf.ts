// ─── Gerador de Relatório Executivo Oficial AGO em PDF (Client-Side) ─────────
// Emite documento com timbre oficial da COMIEADEPA para a presidência e mesas ministeriais.
// Padrão visual institucional, paginação contínua ("Página X de Y"), rodapés e critérios de cálculo.

import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_COMIEADEPA_BASE64, LOGO_AGO_BASE64 } from './logos-base64';

export type TipoRelatorioExecutivo =
  | 'completo'
  | 'resumo'
  | 'inscricoes'
  | 'presenca'
  | 'alimentacao'
  | 'hospedagem'
  | 'financeiro';

export interface DashboardExecutivoData {
  evento_id: string;
  gerado_em: string;
  evento: {
    id: string;
    nome: string;
    status: string;
    data_inicio: string | null;
    data_fim: string | null;
    plenarias_datas: string[];
    local?: string | null;
    cidade?: string | null;
  };
  cards: {
    inscritos: number;
    pagos: number;
    credenciados: number;
    hospedados: number;
    presentes_hoje: number;
    frequencia_media: number | null;
    refeicoes_consumidas: number;
    refeicoes_total: number;
    advertencias_pendentes: number;
  };
  financeiro?: {
    total_arrecadado: number;
    total_pagos: number;
    total_isentos: number;
    total_pendentes: number;
    formas_pagamento: Array<{ forma: string; count: number; total: number }>;
  };
  por_categoria: Array<{
    categoria: string;
    inscritos: number;
    credenciados: number;
    presentes: number;
    frequencia_media: number | null;
  }>;
  por_supervisao: Array<{
    id: string;
    nome: string;
    inscritos: number;
    credenciados: number;
    presentes: number;
    frequencia_media: number | null;
  }>;
  por_campo: Array<{
    id: string;
    nome: string;
    supervisao_nome: string;
    inscritos: number;
    hospedados: number;
    pastor_presidente: string | null;
    frequencia_media: number | null;
  }>;
  hospedagem: {
    capacidade_total: number;
    solicitados: number;
    confirmados: number;
    checkin_realizado: number;
    checkout_realizado: number;
    ausentes: number;
    lista_espera: number;
    por_alojamento?: Array<{
      id: string;
      nome: string;
      publico: string | null;
      grupo_permitido: string | null;
      total_vagas: number;
      ocupadas: number;
      checkins: number;
      vagas_restantes: number;
      taxa_ocupacao: number;
    }>;
  };
  refeitorio_por_dia: Array<{ data: string; total: number }>;
  frequencia_por_plenaria: Array<{ data: string; label: string; presentes: number; total: number }>;
  campo_missionario?: {
    total: number;
    subsidiados: number;
    economia_total: number;
  };
  relatorio_alimentacao?: {
    indicadores: {
      total_inscritos_com_alimentacao: number;
      refeicoes_previstas: number;
      refeicoes_consumidas: number;
      saldo_restante: number;
    };
    consumo_por_categoria?: Array<{ categoria: string; consumidas: number }>;
  };
}

// ── Cores Oficiais ───────────────────────────────────────────────────────────
const NAVY_COLOR: [number, number, number] = [13, 43, 78];     // #0D2B4E (Primária / Header)
const GOLD_COLOR: [number, number, number] = [184, 134, 11];   // Dourado Institucional
const SLATE_DARK: [number, number, number] = [30, 41, 59];     // Cinza Escuro Texto
const BG_ALT: [number, number, number] = [248, 250, 252];      // Linhas alternadas tabela
const BORDER_COLOR: [number, number, number] = [226, 232, 240];

// ── Formatadores Auxiliares ──────────────────────────────────────────────────
function fmtMoeda(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);
}

function fmtNum(val: number | null | undefined): string {
  if (val == null) return '—';
  return new Intl.NumberFormat('pt-BR').format(val);
}

function fmtDataBR(dataIso: string | null | undefined): string {
  if (!dataIso) return '—';
  try {
    const [y, m, d] = dataIso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  } catch {
    return dataIso;
  }
}

// ── Cabeçalho Oficial Unificado ──────────────────────────────────────────────
function desenharCabecalhoOficial(doc: jsPDF, data: DashboardExecutivoData, tituloRelatorio: string) {
  // Brasão COMIEADEPA à esquerda (largura 14mm, proporção ~0.87 -> altura 16mm)
  if (LOGO_COMIEADEPA_BASE64) {
    try {
      doc.addImage(LOGO_COMIEADEPA_BASE64, 'PNG', 14, 10, 14, 16);
    } catch {
      // continua sem imagem se houver falha
    }
  }

  // Logomarca AGO à direita (largura 38mm, proporção ~2.13 -> altura 17.8mm)
  if (LOGO_AGO_BASE64) {
    try {
      doc.addImage(LOGO_AGO_BASE64, 'PNG', 158, 9, 38, 17.8);
    } catch {
      // continua sem imagem
    }
  }

  // Textos Centrais
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...NAVY_COLOR);
  doc.text('COMIEADEPA', 105, 13, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  doc.text('Convenção Interestadual de Ministros e Igrejas Evangélicas Assembleia de Deus no Estado do Pará', 105, 17, { align: 'center' });
  doc.text('Sede Administrativa: Rodovia Mário Covas, 2500 - Coqueiro, Belém - PA · CNPJ: 04.760.047/0001-04', 105, 20.5, { align: 'center' });

  // Faixa de Título do Relatório
  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.4);
  doc.line(14, 28, 196, 28);

  doc.setFillColor(241, 245, 249);
  doc.rect(14, 30, 182, 13, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(...NAVY_COLOR);
  doc.text(tituloRelatorio.toUpperCase(), 105, 35, { align: 'center' });

  // Metadados do Evento
  const dataIni = fmtDataBR(data.evento.data_inicio);
  const dataFim = fmtDataBR(data.evento.data_fim);
  const periodo = dataIni === dataFim ? dataIni : `${dataIni} a ${dataFim}`;
  const local = data.evento.local || 'Centro de Eventos COMIEADEPA';
  const cidade = data.evento.cidade || 'Belém-PA';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);
  const subMeta = `Evento: ${data.evento.nome}  |  Período: ${periodo}  |  Local: ${local} (${cidade})`;
  doc.text(subMeta, 105, 40, { align: 'center' });

  doc.setLineWidth(0.4);
  doc.line(14, 45, 196, 45);
}

// ── Rodapé Oficial com Paginação X de Y ───────────────────────────────────────
function aplicarRodapesEPaginacao(doc: jsPDF, emissaoDataHora: string) {
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);

    // Linha divisória rodapé
    doc.setDrawColor(...BORDER_COLOR);
    doc.setLineWidth(0.3);
    doc.line(14, 285, 196, 285);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);

    const txtEsq = `Sistema SISCOMIEADEPA · Relatório Executivo Oficial Emitido em ${emissaoDataHora}`;
    doc.text(txtEsq, 14, 289.5);

    const txtDir = `Página ${i} de ${totalPages}`;
    doc.text(txtDir, 196, 289.5, { align: 'right' });
  }
}

// ── Título de Seção Elegante ─────────────────────────────────────────────────
function desenharTituloSecao(doc: jsPDF, y: number, titulo: string, subtitulo?: string): number {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...NAVY_COLOR);
  doc.text(titulo, 14, y);

  doc.setDrawColor(...GOLD_COLOR);
  doc.setLineWidth(0.8);
  doc.line(14, y + 1.5, 42, y + 1.5);

  let nextY = y + 5;
  if (subtitulo) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(subtitulo, 14, nextY);
    nextY += 4;
  }
  return nextY;
}

// ── Grid de Cards KPI ────────────────────────────────────────────────────────
interface KpiItem {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}

function desenharKpiGrid(doc: jsPDF, y: number, items: KpiItem[]): number {
  const numCards = items.length;
  const marginX = 14;
  const availableWidth = 182;
  const gap = 3;
  const cardW = (availableWidth - (numCards - 1) * gap) / numCards;
  const cardH = 15;

  items.forEach((item, idx) => {
    const cardX = marginX + idx * (cardW + gap);

    // Fundo card
    if (item.highlight) {
      doc.setFillColor(238, 242, 255); // destaque sutil
      doc.setDrawColor(199, 210, 254);
    } else {
      doc.setFillColor(248, 250, 252);
      doc.setDrawColor(226, 232, 240);
    }
    doc.setLineWidth(0.3);
    doc.roundedRect(cardX, y, cardW, cardH, 1.5, 1.5, 'FD');

    // Valor
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...NAVY_COLOR);
    doc.text(item.value, cardX + cardW / 2, y + 6.5, { align: 'center' });

    // Label
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text(item.label.toUpperCase(), cardX + cardW / 2, y + 10.5, { align: 'center' });

    // Sub-rótulo opcional
    if (item.sub) {
      doc.setFontSize(5.5);
      doc.setTextColor(148, 163, 184);
      doc.text(item.sub, cardX + cardW / 2, y + 13.5, { align: 'center' });
    }
  });

  return y + cardH + 4;
}

// ── Nota de Rodapé / Metodologia ─────────────────────────────────────────────
function desenharNotaMetodologica(doc: jsPDF, y: number, texto: string): number {
  doc.setFont('helvetica', 'italic');
  doc.setFontSize(6.8);
  doc.setTextColor(100, 116, 139);
  const lines = doc.splitTextToSize(texto, 182);
  doc.text(lines, 14, y);
  return y + lines.length * 3.2;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEÇÃO: RESUMO EXECUTIVO
// ═══════════════════════════════════════════════════════════════════════════════
function renderizarResumoExecutivo(doc: jsPDF, data: DashboardExecutivoData, startY: number): number {
  let y = desenharTituloSecao(doc, startY, '1. RESUMO EXECUTIVO CONSOLIDADO');

  const cardsKPI: KpiItem[] = [
    { label: 'Total Inscritos', value: fmtNum(data.cards.inscritos), sub: 'Cadastros ativos' },
    { label: 'Participantes Únicos', value: fmtNum(data.cards.credenciados), sub: 'Presença comprovada', highlight: true },
    { label: 'Presentes Plenárias', value: fmtNum(data.cards.presentes_hoje || data.por_categoria.reduce((s, c) => Math.max(s, c.presentes), 0)), sub: 'Média/Pico de sessões' },
    { label: 'Refeições Servidas', value: fmtNum(data.cards.refeicoes_consumidas), sub: 'Consumo real refeitório' },
    { label: 'Arrecadação Geral', value: fmtMoeda(data.financeiro?.total_arrecadado ?? 0), sub: 'Total homologado', highlight: true },
  ];

  y = desenharKpiGrid(doc, y, cardsKPI);

  // Tabela síntese operacional por pilar
  const totalInscritos = data.cards.inscritos || 1;
  const percPresenca = Math.round((data.cards.credenciados / totalInscritos) * 10000) / 100;
  const percPagos = Math.round((data.cards.pagos / totalInscritos) * 10000) / 100;

  const bodyResumo = [
    ['Inscrições Homologadas', `${fmtNum(data.cards.pagos)} confirmadas (${percPagos}% do total)`, `Total cadastrado: ${fmtNum(data.cards.inscritos)}`],
    ['Participação & Plenárias', `${fmtNum(data.cards.credenciados)} participantes com check-in (${percPresenca}%)`, `Frequência média geral: ${data.cards.frequencia_media != null ? data.cards.frequencia_media + '%' : '—'}`],
    ['Serviço de Alimentação', `${fmtNum(data.cards.refeicoes_consumidas)} refeições debitadas no sistema`, `Inscritos c/ direito alimentar: ${fmtNum(data.relatorio_alimentacao?.indicadores.total_inscritos_com_alimentacao || data.cards.inscritos)}`],
    ['Hospedagem & Alojamentos', `${fmtNum(data.hospedagem.confirmados + data.hospedagem.checkin_realizado)} leitos ocupados/confirmados`, `Capacidade oficial: ${fmtNum(data.hospedagem.capacidade_total)} vagas`],
    ['Arrecadação de Inscrições', `${fmtMoeda(data.financeiro?.total_arrecadado ?? 0)} recebidos`, `${fmtNum(data.financeiro?.total_pagos ?? 0)} inscrições pagas | ${fmtNum(data.financeiro?.total_isentos ?? 0)} isenções`],
  ];

  autoTable(doc, {
    startY: y,
    head: [['Pilar Operacional', 'Resultado Principal', 'Detalhamento Institucional']],
    body: bodyResumo,
    theme: 'grid',
    styles: { fontSize: 7.5, cellPadding: 2, textColor: SLATE_DARK },
    headStyles: { fillColor: NAVY_COLOR, textColor: [255, 255, 255], fontStyle: 'bold' },
    columnStyles: {
      0: { cellWidth: 50, fontStyle: 'bold', textColor: NAVY_COLOR },
      1: { cellWidth: 65 },
      2: { cellWidth: 67, textColor: [100, 116, 139] },
    },
    margin: { left: 14, right: 14 },
  });

  const lastTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
  y = lastTable.finalY + 3;

  y = desenharNotaMetodologica(
    doc,
    y,
    '* Critério Institucional: "Participantes Únicos" representa o universo auditado de inscritos que registraram ao menos 1 check-in (presencial em plenária ou refeitório), diferenciando-se rigorosamente da contagem bruta de passagens pelo scanner.'
  );

  return y + 4;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEÇÃO: INSCRIÇÕES & CATEGORIAS
// ═══════════════════════════════════════════════════════════════════════════════
function renderizarInscricoes(doc: jsPDF, data: DashboardExecutivoData, startY: number): number {
  let y = desenharTituloSecao(doc, startY, '2. INSCRIÇÕES E DISTRIBUIÇÃO MINISTERIAL', 'Estatística oficial de participantes inscritos por categoria funcional e representatividade.');

  const bodyCat = data.por_categoria.map(c => {
    const totalInsc = data.cards.inscritos || 1;
    const percTotal = ((c.inscritos / totalInsc) * 100).toFixed(1) + '%';
    const taxaPresenca = c.inscritos > 0 ? ((c.credenciados / c.inscritos) * 100).toFixed(1) + '%' : '0%';
    const freqMedia = c.frequencia_media != null ? `${c.frequencia_media}%` : '—';
    return [
      c.categoria,
      fmtNum(c.inscritos),
      percTotal,
      fmtNum(c.credenciados),
      taxaPresenca,
      freqMedia,
    ];
  });

  // Linha totalizadora
  const totalInscritos = data.por_categoria.reduce((s, c) => s + c.inscritos, 0);
  const totalCredenciados = data.por_categoria.reduce((s, c) => s + c.credenciados, 0);
  bodyCat.push([
    'TOTAL GERAL CONSOLIDADO',
    fmtNum(totalInscritos),
    '100.0%',
    fmtNum(totalCredenciados),
    totalInscritos > 0 ? ((totalCredenciados / totalInscritos) * 100).toFixed(1) + '%' : '0%',
    data.cards.frequencia_media != null ? `${data.cards.frequencia_media}%` : '—',
  ]);

  autoTable(doc, {
    startY: y,
    head: [['Categoria Funcional', 'Inscritos', '% Total', 'Confirmados', 'Presença %', 'Freq. Média']],
    body: bodyCat,
    theme: 'striped',
    styles: { fontSize: 7, cellPadding: 1.8, textColor: SLATE_DARK },
    headStyles: { fillColor: NAVY_COLOR, textColor: [255, 255, 255], fontStyle: 'bold' },
    alternateRowStyles: { fillColor: BG_ALT },
    columnStyles: {
      0: { cellWidth: 62, fontStyle: 'bold' },
      1: { cellWidth: 24, halign: 'right' },
      2: { cellWidth: 22, halign: 'right' },
      3: { cellWidth: 26, halign: 'right' },
      4: { cellWidth: 24, halign: 'right' },
      5: { cellWidth: 24, halign: 'right' },
    },
    didParseCell: (dataCell) => {
      if (dataCell.row.index === bodyCat.length - 1) {
        dataCell.cell.styles.fontStyle = 'bold';
        dataCell.cell.styles.fillColor = [224, 231, 255];
        dataCell.cell.styles.textColor = NAVY_COLOR;
      }
    },
    margin: { left: 14, right: 14 },
  });

  const lastTable = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
  y = lastTable.finalY + 3;

  if (data.campo_missionario && data.campo_missionario.total > 0) {
    y = desenharNotaMetodologica(
      doc,
      y,
      `* Campos Missionários: ${fmtNum(data.campo_missionario.total)} obreiros atendidos com subsídio convencional oficial, totalizando ${fmtMoeda(data.campo_missionario.economia_total)} em isenções e descontos regulamentares.`
    );
  }

  return y + 3;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEÇÃO: PRESENÇA, FREQUÊNCIA & SESSÕES DE PLENÁRIA
// ═══════════════════════════════════════════════════════════════════════════════
function renderizarPresencaPlenarias(doc: jsPDF, data: DashboardExecutivoData, startY: number): number {
  let y = desenharTituloSecao(doc, startY, '3. PARTICIPAÇÃO E FREQUÊNCIA EM PLENÁRIAS', 'Controle oficial de presenças por sessão plenária e por supervisão regional.');

  // Tabela 3.1: Frequência por Sessão Plenária
  if (data.frequencia_por_plenaria && data.frequencia_por_plenaria.length > 0) {
    const bodyPlen = data.frequencia_por_plenaria.map(p => {
      const perc = data.cards.inscritos > 0 ? ((p.presentes / data.cards.inscritos) * 100).toFixed(1) + '%' : '—';
      const percCred = data.cards.credenciados > 0 ? ((p.presentes / data.cards.credenciados) * 100).toFixed(1) + '%' : '—';
      return [p.label, fmtDataBR(p.data), fmtNum(p.presentes), perc, percCred];
    });

    autoTable(doc, {
      startY: y,
      head: [['Sessão Plenária', 'Data', 'Presentes Auditados', '% s/ Inscritos', '% s/ Confirmados']],
      body: bodyPlen,
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 1.8, textColor: SLATE_DARK },
      headStyles: { fillColor: NAVY_COLOR, textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 42, fontStyle: 'bold' },
        1: { cellWidth: 35, halign: 'center' },
        2: { cellWidth: 35, halign: 'right' },
        3: { cellWidth: 35, halign: 'right' },
        4: { cellWidth: 35, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });

    const t1 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
    y = t1.finalY + 4;
  }

  // Tabela 3.2: Frequência Resumida por Supervisão (Top Regiões)
  if (data.por_supervisao && data.por_supervisao.length > 0) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(...NAVY_COLOR);
    doc.text('Presença Consolidada por Supervisão Regional:', 14, y);
    y += 2.5;

    const bodySup = data.por_supervisao.map(s => {
      const percPresenca = s.inscritos > 0 ? ((s.credenciados / s.inscritos) * 100).toFixed(1) + '%' : '—';
      const freq = s.frequencia_media != null ? `${s.frequencia_media}%` : '—';
      return [s.nome, fmtNum(s.inscritos), fmtNum(s.credenciados), percPresenca, freq];
    });

    autoTable(doc, {
      startY: y,
      head: [['Supervisão Regional', 'Inscritos', 'Confirmados', '% Comparecimento', 'Freq. Média']],
      body: bodySup,
      theme: 'striped',
      styles: { fontSize: 6.8, cellPadding: 1.5, textColor: SLATE_DARK },
      headStyles: { fillColor: NAVY_COLOR, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: BG_ALT },
      columnStyles: {
        0: { cellWidth: 70, fontStyle: 'bold' },
        1: { cellWidth: 28, halign: 'right' },
        2: { cellWidth: 28, halign: 'right' },
        3: { cellWidth: 28, halign: 'right' },
        4: { cellWidth: 28, halign: 'right' },
      },
      margin: { left: 14, right: 14 },
    });

    const t2 = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
    y = t2.finalY + 3;
  }

  y = desenharNotaMetodologica(
    doc,
    y,
    '* Frequência em Plenárias: Registros capturados exclusivamente nos pontos de controle de plenária oficial do evento. Registros históricos sem indicação de setor são preservados como "Não especificado (Legado)".'
  );

  return y + 3;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEÇÃO: ALIMENTAÇÃO & REFEITÓRIO
// ═══════════════════════════════════════════════════════════════════════════════
function renderizarAlimentacao(doc: jsPDF, data: DashboardExecutivoData, startY: number): number {
  let y = desenharTituloSecao(doc, startY, '4. CONTROLE DE ALIMENTAÇÃO E REFEITÓRIO', 'Consumo oficial de refeições apurado no banco de dados operacional.');

  const kpisAlim: KpiItem[] = [
    { label: 'Refeições Servidas', value: fmtNum(data.cards.refeicoes_consumidas), highlight: true },
    { label: 'Inscritos com Direito', value: fmtNum(data.relatorio_alimentacao?.indicadores.total_inscritos_com_alimentacao || data.cards.inscritos) },
    { label: 'Previsão de Refeições', value: fmtNum(data.relatorio_alimentacao?.indicadores.refeicoes_previstas || data.cards.refeicoes_total) },
    { label: 'Saldo Restante', value: fmtNum(data.relatorio_alimentacao?.indicadores.saldo_restante || 0) },
  ];

  y = desenharKpiGrid(doc, y, kpisAlim);

  // Tabela: Consumo por Dia
  if (data.refeitorio_por_dia && data.refeitorio_por_dia.length > 0) {
    const totalConsumo = data.refeitorio_por_dia.reduce((s, d) => s + d.total, 0);
    const bodyDias = data.refeitorio_por_dia.map(d => {
      const perc = totalConsumo > 0 ? ((d.total / totalConsumo) * 100).toFixed(1) + '%' : '—';
      return [fmtDataBR(d.data), fmtNum(d.total), perc];
    });

    bodyDias.push(['TOTAL DE REFEIÇÕES DEBITADAS', fmtNum(totalConsumo), '100.0%']);

    autoTable(doc, {
      startY: y,
      head: [['Data do Serviço', 'Refeições Servidas', '% do Consumo Total']],
      body: bodyDias,
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 1.8, textColor: SLATE_DARK },
      headStyles: { fillColor: NAVY_COLOR, textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 70, fontStyle: 'bold' },
        1: { cellWidth: 56, halign: 'right' },
        2: { cellWidth: 56, halign: 'right' },
      },
      didParseCell: (dataCell) => {
        if (dataCell.row.index === bodyDias.length - 1) {
          dataCell.cell.styles.fontStyle = 'bold';
          dataCell.cell.styles.fillColor = [254, 243, 199];
          dataCell.cell.styles.textColor = [146, 64, 14];
        }
      },
      margin: { left: 14, right: 14 },
    });

    const tDia = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
    y = tDia.finalY + 3;
  }

  y = desenharNotaMetodologica(
    doc,
    y,
    '* Fonte Oficial: Registros apurados a partir dos débitos em evento_refeicoes_consumo. Restaurantes/pontos legados sem local_id são classificados estritamente como "Não especificado (Legado)", garantindo soma exata sem duplicidade.'
  );

  return y + 3;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEÇÃO: HOSPEDAGEM & ALOJAMENTOS
// ═══════════════════════════════════════════════════════════════════════════════
function renderizarHospedagem(doc: jsPDF, data: DashboardExecutivoData, startY: number): number {
  let y = desenharTituloSecao(doc, startY, '5. HOSPEDAGEM E OCUPAÇÃO DE ALOJAMENTOS', 'Mapa de ocupação de leitos nos pavilhões da Convenção.');

  const totalOcupadas = data.hospedagem.confirmados + data.hospedagem.checkin_realizado;
  const taxaGeral = data.hospedagem.capacidade_total > 0
    ? ((totalOcupadas / data.hospedagem.capacidade_total) * 100).toFixed(1) + '%'
    : '—';

  const kpisHosp: KpiItem[] = [
    { label: 'Capacidade Total', value: fmtNum(data.hospedagem.capacidade_total), sub: 'Leitos homologados' },
    { label: 'Leitos Alocados', value: fmtNum(totalOcupadas), sub: 'Confirmados + Check-in', highlight: true },
    { label: 'Check-in Alojamento', value: fmtNum(data.hospedagem.checkin_realizado), sub: 'Entrada registrada' },
    { label: 'Vagas Livres', value: fmtNum(Math.max(0, data.hospedagem.capacidade_total - totalOcupadas)), sub: 'Saldo disponível' },
    { label: 'Taxa Ocupação', value: taxaGeral, sub: 'Percentual global', highlight: true },
  ];

  y = desenharKpiGrid(doc, y, kpisHosp);

  if (data.hospedagem.por_alojamento && data.hospedagem.por_alojamento.length > 0) {
    const bodyAloj = data.hospedagem.por_alojamento.map(a => [
      a.nome,
      a.grupo_permitido || a.publico || 'Geral',
      fmtNum(a.total_vagas),
      fmtNum(a.ocupadas),
      fmtNum(a.checkins),
      fmtNum(a.vagas_restantes),
      `${a.taxa_ocupacao}%`,
    ]);

    // Totalizador
    const somas = data.hospedagem.por_alojamento.reduce(
      (acc, cur) => {
        acc.vagas += cur.total_vagas;
        acc.ocup += cur.ocupadas;
        acc.ck += cur.checkins;
        acc.livres += cur.vagas_restantes;
        return acc;
      },
      { vagas: 0, ocup: 0, ck: 0, livres: 0 }
    );
    const taxaTotal = somas.vagas > 0 ? ((somas.ocup / somas.vagas) * 100).toFixed(1) + '%' : '—';

    bodyAloj.push([
      'TOTAL CONSOLIDADO',
      'Todos os pavilhões',
      fmtNum(somas.vagas),
      fmtNum(somas.ocup),
      fmtNum(somas.ck),
      fmtNum(somas.livres),
      taxaTotal,
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Pavilhão / Alojamento', 'Público Destinado', 'Vagas', 'Alocados', 'Check-ins', 'Livres', 'Ocupação']],
      body: bodyAloj,
      theme: 'striped',
      styles: { fontSize: 6.8, cellPadding: 1.8, textColor: SLATE_DARK },
      headStyles: { fillColor: NAVY_COLOR, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: BG_ALT },
      columnStyles: {
        0: { cellWidth: 44, fontStyle: 'bold' },
        1: { cellWidth: 44 },
        2: { cellWidth: 18, halign: 'right' },
        3: { cellWidth: 18, halign: 'right' },
        4: { cellWidth: 18, halign: 'right' },
        5: { cellWidth: 18, halign: 'right' },
        6: { cellWidth: 22, halign: 'right', fontStyle: 'bold' },
      },
      didParseCell: (dataCell) => {
        if (dataCell.row.index === bodyAloj.length - 1) {
          dataCell.cell.styles.fontStyle = 'bold';
          dataCell.cell.styles.fillColor = [224, 231, 255];
          dataCell.cell.styles.textColor = NAVY_COLOR;
        }
      },
      margin: { left: 14, right: 14 },
    });

    const tHosp = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
    y = tHosp.finalY + 3;
  }

  return y + 3;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEÇÃO: FINANCEIRO & ARRECADAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════
function renderizarFinanceiro(doc: jsPDF, data: DashboardExecutivoData, startY: number): number {
  let y = desenharTituloSecao(doc, startY, '6. DEMONSTRATIVO FINANCEIRO E ARRECADAÇÃO', 'Consolidação de receitas de inscrições e meios de liquidação homologados.');

  const totalArrecadado = data.financeiro?.total_arrecadado ?? 0;
  const totalPagos = data.financeiro?.total_pagos ?? data.cards.pagos;
  const totalIsentos = data.financeiro?.total_isentos ?? 0;
  const ticketMedio = totalPagos > 0 ? totalArrecadado / totalPagos : 0;

  const kpisFin: KpiItem[] = [
    { label: 'Receita Total', value: fmtMoeda(totalArrecadado), sub: 'Inscrições pagas', highlight: true },
    { label: 'Inscrições Pagas', value: fmtNum(totalPagos), sub: 'Liquidadas' },
    { label: 'Isenções Oficiais', value: fmtNum(totalIsentos), sub: 'Jubilados / Viúvas / Apoio' },
    { label: 'Ticket Médio', value: fmtMoeda(ticketMedio), sub: 'Média por pagante' },
  ];

  y = desenharKpiGrid(doc, y, kpisFin);

  if (data.financeiro?.formas_pagamento && data.financeiro.formas_pagamento.length > 0) {
    const bodyFormas = data.financeiro.formas_pagamento.map(f => {
      const perc = totalArrecadado > 0 ? ((f.total / totalArrecadado) * 100).toFixed(1) + '%' : '—';
      const labelForma = {
        pix: 'PIX (Instantâneo)',
        dinheiro: 'Dinheiro em Espécie (Caixas Balcão)',
        cartao: 'Cartão de Débito / Crédito',
        credito: 'Cartão de Crédito',
        debito: 'Cartão de Débito',
        isento: 'Isenção Regulamentar (R$ 0,00)',
        nao_informado: 'Lote / Balcão Convencional',
      }[f.forma.toLowerCase()] || f.forma.toUpperCase();

      return [labelForma, fmtNum(f.count), fmtMoeda(f.total), perc];
    });

    bodyFormas.push(['TOTAL GERAL ARRECADADO', fmtNum(totalPagos), fmtMoeda(totalArrecadado), '100.0%']);

    autoTable(doc, {
      startY: y,
      head: [['Meio de Pagamento / Modalidade', 'Quantidade', 'Valor Total Arrecadado', '% da Receita']],
      body: bodyFormas,
      theme: 'grid',
      styles: { fontSize: 7, cellPadding: 1.8, textColor: SLATE_DARK },
      headStyles: { fillColor: NAVY_COLOR, textColor: [255, 255, 255], fontStyle: 'bold' },
      columnStyles: {
        0: { cellWidth: 70, fontStyle: 'bold' },
        1: { cellWidth: 32, halign: 'right' },
        2: { cellWidth: 44, halign: 'right' },
        3: { cellWidth: 36, halign: 'right' },
      },
      didParseCell: (dataCell) => {
        if (dataCell.row.index === bodyFormas.length - 1) {
          dataCell.cell.styles.fontStyle = 'bold';
          dataCell.cell.styles.fillColor = [220, 252, 231];
          dataCell.cell.styles.textColor = [22, 101, 52];
        }
      },
      margin: { left: 14, right: 14 },
    });

    const tFin = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable;
    y = tFin.finalY + 3;
  }

  y = desenharNotaMetodologica(
    doc,
    y,
    '* Conformidade Financeira: Demonstrativo apurado a partir dos valores efetivamente pagos e comprovados nas contas oficiais e sessões de caixa do evento. Inscrições isentas de pastores jubilados, viúvas e equipes de apoio estão computadas com custo R$ 0,00.'
  );

  return y + 3;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FUNÇÃO PRINCIPAL: GERADOR DO RELATÓRIO EXECUTIVO OFICIAL (PDF)
// ═══════════════════════════════════════════════════════════════════════════════
export async function gerarRelatorioExecutivoPDF(
  data: DashboardExecutivoData,
  tipo: TipoRelatorioExecutivo = 'completo'
): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const emissaoDataHora = new Date().toLocaleString('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  });

  // Título do Documento com base no Tipo
  const titulosPorTipo: Record<TipoRelatorioExecutivo, string> = {
    completo: 'Relatório Executivo Oficial Consolidado',
    resumo: 'Relatório Executivo — Síntese e Indicadores Gerais',
    inscricoes: 'Relatório Temático — Inscrições e Categorias Ministeriais',
    presenca: 'Relatório Temático — Participação e Frequência em Plenárias',
    alimentacao: 'Relatório Temático — Controle de Alimentação e Refeitório',
    hospedagem: 'Relatório Temático — Hospedagem e Pavilhões de Alojamento',
    financeiro: 'Relatório Temático — Demonstrativo Financeiro e Arrecadação',
  };

  const tituloPrincipal = titulosPorTipo[tipo] || 'Relatório Executivo Oficial';

  // Página 1: Cabeçalho
  desenharCabecalhoOficial(doc, data, tituloPrincipal);
  let y = 49;

  if (tipo === 'completo') {
    // 1. Resumo Executivo
    y = renderizarResumoExecutivo(doc, data, y);

    // 2. Inscrições (cabe na página 1 ou quebra de forma graciosa)
    if (y > 185) {
      doc.addPage();
      desenharCabecalhoOficial(doc, data, tituloPrincipal);
      y = 49;
    }
    y = renderizarInscricoes(doc, data, y);

    // 3. Presença em Plenárias (Página nova para garantir legibilidade dos mapas)
    doc.addPage();
    desenharCabecalhoOficial(doc, data, tituloPrincipal);
    y = 49;
    y = renderizarPresencaPlenarias(doc, data, y);

    // 4. Alimentação
    if (y > 180) {
      doc.addPage();
      desenharCabecalhoOficial(doc, data, tituloPrincipal);
      y = 49;
    }
    y = renderizarAlimentacao(doc, data, y);

    // 5. Hospedagem & 6. Financeiro
    doc.addPage();
    desenharCabecalhoOficial(doc, data, tituloPrincipal);
    y = 49;
    y = renderizarHospedagem(doc, data, y);

    if (y > 180) {
      doc.addPage();
      desenharCabecalhoOficial(doc, data, tituloPrincipal);
      y = 49;
    }
    y = renderizarFinanceiro(doc, data, y);

  } else if (tipo === 'resumo') {
    y = renderizarResumoExecutivo(doc, data, y);
    y = renderizarInscricoes(doc, data, y);
  } else if (tipo === 'inscricoes') {
    y = renderizarInscricoes(doc, data, y);
  } else if (tipo === 'presenca') {
    y = renderizarPresencaPlenarias(doc, data, y);
  } else if (tipo === 'alimentacao') {
    y = renderizarAlimentacao(doc, data, y);
  } else if (tipo === 'hospedagem') {
    y = renderizarHospedagem(doc, data, y);
  } else if (tipo === 'financeiro') {
    y = renderizarFinanceiro(doc, data, y);
  }

  // Aplica rodapés e numeração contínua "Página X de Y"
  aplicarRodapesEPaginacao(doc, emissaoDataHora);

  return doc;
}
