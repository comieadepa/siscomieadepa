import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { LOGO_AEMADEPA_BASE64 } from './logo-base64';

export interface RelatorioAssociadaItem {
  nome: string;
  numeroAemadepa?: string | null;
  ministroNome: string;
  ministroMatricula?: string | null;
  campo?: string | null;
  supervisao?: string | null;
  situacaoCadastral: string;
}

export interface FiltrosRelatorioAssociadas {
  busca?: string;
  situacao?: string;
  supervisao?: string;
  campo?: string;
}

export function gerarRelatorioAssociadasPDF(
  associadas: RelatorioAssociadaItem[],
  filtros: FiltrosRelatorioAssociadas
): void {
  // Cria documento A4 Retrato (Portrait)
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210mm
  const pageHeight = doc.internal.pageSize.getHeight(); // 297mm
  const margem = 14;

  // Cabeçalho Oficial AEMADEPA
  const headerStartY = 12;

  // Logomarca Oficial AEMADEPA (lado esquerdo)
  try {
    doc.addImage(LOGO_AEMADEPA_BASE64, 'PNG', margem, headerStartY, 22, 22);
  } catch (err) {
    console.warn('Não foi possível carregar logo AEMADEPA:', err);
  }

  // Título e Subtítulo Institucional
  doc.setTextColor(136, 19, 55); // #881337 - Vinho Institucional
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(
    'AEMADEPA — Associação de Esposas de Ministros das Assembleias de Deus do Estado do Pará',
    margem + 26,
    headerStartY + 7
  );

  doc.setTextColor(31, 41, 55); // #1F2937 - Cinza escuro
  doc.setFontSize(13);
  doc.text('RELAÇÃO DE ASSOCIADAS — AEMADEPA', margem + 26, headerStartY + 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(100, 116, 139); // #64748B - Slate Muted
  const dataHoraEmissao = new Date().toLocaleString('pt-BR', { timeZone: 'America/Belem' });
  doc.text(`Emissão oficial em: ${dataHoraEmissao} (Horário de Belém/PA)`, margem + 26, headerStartY + 19);

  // Linha separadora elegante
  doc.setDrawColor(244, 114, 182); // Rose border
  doc.setLineWidth(0.6);
  doc.line(margem, headerStartY + 24, pageWidth - margem, headerStartY + 24);

  // Faixa de Resumo e Filtros Aplicados
  const filtroTextos: string[] = [];
  if (filtros.busca) filtroTextos.push(`Busca: "${filtros.busca}"`);
  if (filtros.situacao && filtros.situacao !== 'todos') {
    filtroTextos.push(`Situação: ${filtros.situacao === 'com_esposa' ? 'Com Esposa Cadastrada' : 'Sem Esposa Vinculada'}`);
  }
  if (filtros.supervisao && filtros.supervisao !== 'TODOS') filtroTextos.push(`Supervisão: ${filtros.supervisao}`);
  if (filtros.campo && filtros.campo !== 'TODOS') filtroTextos.push(`Campo: ${filtros.campo}`);

  const filtrosDescricao = filtroTextos.length > 0 ? filtroTextos.join('  •  ') : 'Nenhum filtro aplicado (Total Geral)';

  doc.setFillColor(253, 242, 248); // #FDF2F8 - Rose ultra claro
  doc.roundedRect(margem, headerStartY + 27, pageWidth - (margem * 2), 12, 2, 2, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(136, 19, 55);
  doc.text(`Filtros: ${filtrosDescricao}`, margem + 4, headerStartY + 33);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(31, 41, 55);
  doc.text(`Total de registros: ${associadas.length}`, pageWidth - margem - 4, headerStartY + 33, { align: 'right' });

  // Tabela com os dados
  const colunas = [
    { header: 'Nº AEMADEPA', dataKey: 'matriculaAemadepa' },
    { header: 'Nome da Associada (Esposa)', dataKey: 'nome' },
    { header: 'Ministro Vinculado', dataKey: 'ministroNome' },
    { header: 'Matrícula Pastor', dataKey: 'ministroMatricula' },
    { header: 'Campo / Região', dataKey: 'campo' },
    { header: 'Situação', dataKey: 'situacao' },
  ];

  const linhas = associadas.map((item) => ({
    matriculaAemadepa: item.numeroAemadepa || '—',
    nome: item.nome || 'Não informada',
    ministroNome: item.ministroNome || '—',
    ministroMatricula: item.ministroMatricula || '—',
    campo: item.campo ? (item.supervisao ? `${item.campo} (${item.supervisao})` : item.campo) : '—',
    situacao: item.situacaoCadastral || 'Cadastrada',
  }));

  autoTable(doc, {
    columns: colunas,
    body: linhas,
    startY: headerStartY + 42,
    margin: { left: margem, right: margem, bottom: 18 },
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      textColor: [31, 41, 55],
      cellPadding: 2,
      overflow: 'linebreak',
    },
    headStyles: {
      fillColor: [190, 24, 93], // #BE185D - Rose AEMADEPA
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 8,
      halign: 'left',
    },
    alternateRowStyles: {
      fillColor: [254, 242, 242], // Rose bem sutil
    },
    columnStyles: {
      matriculaAemadepa: { cellWidth: 26, fontStyle: 'bold' },
      nome: { cellWidth: 46, fontStyle: 'bold' },
      ministroNome: { cellWidth: 44 },
      ministroMatricula: { cellWidth: 22 },
      campo: { cellWidth: 32 },
      situacao: { cellWidth: 22 },
    },
    didDrawPage: (data) => {
      // Rodapé Oficial em todas as páginas
      const strPagina = `Página ${data.pageNumber} de ${doc.getNumberOfPages()}`;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(140, 140, 140);

      // Linha do rodapé
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(margem, pageHeight - 12, pageWidth - margem, pageHeight - 12);

      doc.text(
        'SISCOMIEADEPA — Sistema de Gestão COMIEADEPA & AEMADEPA • Documento Institucional',
        margem,
        pageHeight - 7
      );
      doc.text(strPagina, pageWidth - margem, pageHeight - 7, { align: 'right' });
    },
  });

  // Atualiza a numeração de páginas correta ("Página X de Y") em todas as páginas
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(140, 140, 140);
    doc.text(
      `Página ${i} de ${totalPages}`,
      pageWidth - margem,
      pageHeight - 7,
      { align: 'right' }
    );
  }

  // Download do arquivo PDF
  const timestamp = new Date().toISOString().slice(0, 10);
  doc.save(`AEMADEPA_Relacao_Associadas_${timestamp}.pdf`);
}
