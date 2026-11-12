import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_AEMADEPA_BASE64 } from './logo-base64';

export interface RelatorioPedidoItem {
  id: string;
  associadaNome: string;
  associadaMatricula?: string | null;
  ministroNome: string;
  ministroMatricula?: string | null;
  campo?: string | null;
  via: number;
  valor: number;
  status: string;
  pagoEm?: string | null;
  solicitadoEm: string;
  impressoEm?: string | null;
  entregueEm?: string | null;
  entreguePara?: string | null;
}

export interface FiltrosRelatorioPedidos {
  busca?: string;
  status?: string;
}

const STATUS_LABELS: Record<string, string> = {
  aguardando_pagamento: 'Aguardando PIX',
  pago: 'Pago (Fila)',
  em_impressao: 'Em Impressão',
  impressa: 'Impressa (Pronta)',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
};

export function gerarRelatorioPedidosCarteirinhaPDF(
  pedidos: RelatorioPedidoItem[],
  filtros: FiltrosRelatorioPedidos
): void {
  // Cria documento A4 Paisagem (Landscape) para visualização confortável de relatórios operacionais com colunas
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 297mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 210mm
  const margem = 14;

  // Cabeçalho Oficial AEMADEPA
  const headerStartY = 12;

  // Logomarca Oficial AEMADEPA (lado esquerdo)
  try {
    doc.addImage(LOGO_AEMADEPA_BASE64, 'PNG', margem, headerStartY, 20, 20);
  } catch (err) {
    console.warn('Não foi possível carregar logo AEMADEPA:', err);
  }

  // Nome Oficial Obrigatório
  doc.setTextColor(136, 19, 55); // #881337 - Vinho Institucional
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(
    'AEMADEPA — Associação de Esposas de Ministros das Assembleias de Deus do Estado do Pará',
    margem + 24,
    headerStartY + 6
  );

  // Título do Relatório
  doc.setTextColor(31, 41, 55); // #1F2937 - Cinza escuro
  doc.setFontSize(13);
  doc.text('RELATÓRIO DE SOLICITAÇÕES DE CARTEIRINHAS', margem + 24, headerStartY + 13);

  // Subtítulo e Metadados
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);

  const agora = new Date();
  const dataFormatada = agora.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'America/Belem',
  });
  const horaFormatada = agora.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Belem',
  });

  doc.text(
    `Emissão: ${dataFormatada} às ${horaFormatada} (Horário de Belém/PA) • Total de Registros: ${pedidos.length}`,
    margem + 24,
    headerStartY + 18
  );

  // Linha separadora institucional
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(margem, headerStartY + 23, pageWidth - margem, headerStartY + 23);

  // Bloco de Filtros Aplicados
  let filtroDesc = [];
  if (filtros.busca) filtroDesc.push(`Busca: "${filtros.busca}"`);
  if (filtros.status && filtros.status !== 'todos') {
    const labelStatus = STATUS_LABELS[filtros.status] || filtros.status;
    filtroDesc.push(`Status: ${labelStatus}`);
  }
  const strFiltros = filtroDesc.length > 0 ? filtroDesc.join(' | ') : 'Nenhum filtro restritivo aplicado (Todos os registros)';

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('Filtros Aplicados:', margem, headerStartY + 28);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(100, 116, 139);
  doc.text(strFiltros, margem + 25, headerStartY + 28);

  // Mapeamento dos Dados da Tabela Operacional
  const tableData = pedidos.map((p, index) => {
    const dataPag = p.pagoEm
      ? new Date(p.pagoEm).toLocaleDateString('pt-BR', { timeZone: 'America/Belem' })
      : 'Pendente';
    const statusFormatado = STATUS_LABELS[p.status] || p.status.toUpperCase();
    const valorFormatado = p.valor > 0 ? `R$ ${p.valor.toFixed(2)}` : 'Isento';

    return [
      String(index + 1),
      p.associadaNome || '—',
      p.associadaMatricula || '—',
      p.ministroNome || '—',
      p.ministroMatricula || '—',
      p.campo || '—',
      `${p.via}ª Via`,
      valorFormatado,
      statusFormatado,
      dataPag,
    ];
  });

  // Geração da Tabela com jspdf-autotable
  autoTable(doc, {
    startY: headerStartY + 32,
    margin: { left: margem, right: margem, bottom: 15 },
    head: [
      [
        '#',
        'Associada (Esposa)',
        'Nº AEMADEPA',
        'Pastor Vinculado',
        'Matrícula Pastor',
        'Campo / Cidade',
        'Via',
        'Valor',
        'Status',
        'Data Pagamento',
      ],
    ],
    body: tableData,
    theme: 'grid',
    headStyles: {
      fillColor: [159, 18, 57], // #9f1239 Rose 800 institucional
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: [30, 41, 59],
      valign: 'middle',
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 8, halign: 'center' },
      1: { cellWidth: 50 },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 50 },
      4: { cellWidth: 22, halign: 'center' },
      5: { cellWidth: 38 },
      6: { cellWidth: 15, halign: 'center' },
      7: { cellWidth: 18, halign: 'right' },
      8: { cellWidth: 26, halign: 'center' },
      9: { cellWidth: 20, halign: 'center' },
    },
    didDrawPage: (data) => {
      // Rodapé Institucional
      const totalPagesExp = '{total_pages_count_string}';
      const strPagina = `Página ${data.pageNumber} de ${totalPagesExp}`;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(140, 140, 140);

      // Linha do rodapé
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(margem, pageHeight - 10, pageWidth - margem, pageHeight - 10);

      doc.text(
        'SISCOMIEADEPA — Sistema de Gestão COMIEADEPA & AEMADEPA • Relatório Operacional de Carteirinhas',
        margem,
        pageHeight - 6
      );
      doc.text(strPagina, pageWidth - margem, pageHeight - 6, { align: 'right' });
    },
  });

  // Atualiza a numeração de páginas real ("Página X de Y") em todas as páginas
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(140, 140, 140);
    doc.text(
      `Página ${i} de ${totalPages}`,
      pageWidth - margem,
      pageHeight - 6,
      { align: 'right' }
    );
  }

  // Download do arquivo PDF diretamente
  const timestamp = new Date().toISOString().slice(0, 10);
  doc.save(`AEMADEPA_Solicitacoes_Carteirinhas_${timestamp}.pdf`);
}
