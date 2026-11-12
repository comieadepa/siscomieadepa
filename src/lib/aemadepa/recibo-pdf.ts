import { jsPDF } from 'jspdf';
import { LOGO_AEMADEPA_BASE64 } from '@/lib/aemadepa/logo-base64';

export interface DadosReciboAemadepa {
  numeroRecibo: string;
  solicitacaoId: string;
  dataPagamento: string;
  valorPago: number;
  formaPagamento: string; // 'pix_asaas' | 'a_vista' | 'cortesia' | etc.
  transacaoId?: string | null;
  viaCredencial: number;
  associada: {
    nome: string;
    cpf: string;
    rg?: string | null;
    numeroAemadepa?: string | null;
    fone?: string | null;
    email?: string | null;
  };
  ministro: {
    nome: string;
    matricula?: string | null;
    campo?: string | null;
    supervisao?: string | null;
    cargo?: string | null;
  };
}

// Cores Institucionais
const COR_ROSE: [number, number, number] = [190, 24, 93];      // #BE185D (Rose escuro)
const COR_VINHO: [number, number, number] = [136, 19, 55];     // #881337 (Vinho institucional)
const COR_DOURADO: [number, number, number] = [180, 130, 40];  // #B48228 (Dourado medalha/fita)
const COR_TEXTO: [number, number, number] = [31, 41, 55];      // #1F2937 (Cinza escuro)
const COR_MUTED: [number, number, number] = [100, 116, 139];   // #64748B (Slate muted)
const COR_BG_BOX: [number, number, number] = [253, 242, 248];  // #FDF2F8 (Rose ultra claro)
const COR_BORDA: [number, number, number] = [244, 114, 182];   // #F472B6 (Borda suave)

function formatarDataIso(dataIso?: string | null): string {
  if (!dataIso) return new Date().toLocaleDateString('pt-BR');
  try {
    const d = new Date(dataIso);
    if (isNaN(d.getTime())) return dataIso;
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Belem' });
  } catch {
    return dataIso;
  }
}

function formatarDataHoraIso(dataIso?: string | null): string {
  if (!dataIso) return new Date().toLocaleString('pt-BR');
  try {
    const d = new Date(dataIso);
    if (isNaN(d.getTime())) return dataIso;
    return d.toLocaleString('pt-BR', { timeZone: 'America/Belem' });
  } catch {
    return dataIso;
  }
}

function formatarValorMoeda(valor: number): string {
  return Number(valor || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function rotuloFormaPagamento(forma: string, valor: number): string {
  if (forma === 'cortesia' || valor === 0) return 'ISENÇÃO INSTITUCIONAL / CORTESIA';
  if (forma === 'a_vista') return 'PAGAMENTO EM DINHEIRO / BALCÃO (À VISTA)';
  if (forma === 'pix_asaas' || forma === 'pix') return 'PIX — SISTEMA ASAAS';
  return forma.toUpperCase();
}

/**
 * Gera recibo institucional da AEMADEPA em formato PDF (A4 vertical)
 * Retorna base64 e filename determinístico.
 */
export async function gerarReciboAemadepaPdf(dados: DadosReciboAemadepa): Promise<{
  base64: string;
  filename: string;
}> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth(); // 210
  const margin = 16;
  const contentWidth = pageWidth - margin * 2; // 178

  // 1. Moldura Institucional Elegante
  doc.setDrawColor(...COR_BORDA);
  doc.setLineWidth(0.8);
  doc.roundedRect(margin, margin, contentWidth, 265, 4, 4, 'S');

  doc.setDrawColor(...COR_VINHO);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin + 1.5, margin + 1.5, contentWidth - 3, 262, 3, 3, 'S');

  // 2. Faixa Superior de Destaque
  doc.setFillColor(...COR_VINHO);
  doc.roundedRect(margin + 2, margin + 2, contentWidth - 4, 18, 3, 3, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('COMIEADEPA — CONVENÇÃO INTERESTADUAL DE MINISTROS E IGREJAS', pageWidth / 2, margin + 9, { align: 'center' });
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.text('ASSEMBLEIAS DE DEUS NO ESTADO DO PARÁ', pageWidth / 2, margin + 15, { align: 'center' });

  // 3. Logomarca e Cabeçalho Oficial AEMADEPA
  const logoTop = margin + 24;
  const logoWidth = 28;
  const logoHeight = 24;
  try {
    doc.addImage(LOGO_AEMADEPA_BASE64, 'PNG', margin + 6, logoTop, logoWidth, logoHeight);
  } catch (err) {
    console.warn('[RECIBO AEMADEPA] Logomarca não renderizada:', err);
  }

  const headerTextLeft = margin + 38;
  doc.setTextColor(...COR_ROSE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('AEMADEPA', headerTextLeft, logoTop + 7);

  doc.setTextColor(...COR_TEXTO);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Associação de Esposas de Ministros das Assembleias de Deus do Estado do Pará', headerTextLeft, logoTop + 13);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COR_MUTED);
  doc.text('Departamento Feminino Ministerial Oficial da COMIEADEPA • Fundada em 1991', headerTextLeft, logoTop + 18);

  // Linha separadora do cabeçalho
  doc.setDrawColor(...COR_BORDA);
  doc.setLineWidth(0.4);
  doc.line(margin + 6, logoTop + 27, pageWidth - margin - 6, logoTop + 27);

  // 4. Título do Documento e Caixa de Numeração
  const docTitleY = logoTop + 35;

  doc.setTextColor(...COR_VINHO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('RECIBO INSTITUCIONAL', margin + 6, docTitleY);

  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_MUTED);
  doc.text('Comprovante de Quitação da Taxa de Emissão da Credencial Oficial', margin + 6, docTitleY + 6);

  // Caixa do Número do Recibo e Data à Direita
  const boxNumWidth = 65;
  const boxNumHeight = 16;
  const boxNumX = pageWidth - margin - 6 - boxNumWidth;
  const boxNumY = docTitleY - 8;

  doc.setFillColor(...COR_BG_BOX);
  doc.setDrawColor(...COR_BORDA);
  doc.setLineWidth(0.3);
  doc.roundedRect(boxNumX, boxNumY, boxNumWidth, boxNumHeight, 2, 2, 'FD');

  doc.setTextColor(...COR_VINHO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.text('RECIBO Nº', boxNumX + boxNumWidth / 2, boxNumY + 5, { align: 'center' });

  doc.setFontSize(11);
  doc.text(dados.numeroRecibo, boxNumX + boxNumWidth / 2, boxNumY + 10.5, { align: 'center' });

  doc.setFontSize(6.5);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_MUTED);
  doc.text(`Emitido em: ${formatarDataHoraIso(dados.dataPagamento)}`, boxNumX + boxNumWidth / 2, boxNumY + 14.5, { align: 'center' });

  // 5. Bloco de Destaque Financeiro (Valor Quitado ou Isenção Regulamentar)
  const ehCortesia = dados.formaPagamento === 'cortesia' || Number(dados.valorPago || 0) === 0;
  const financeBoxY = docTitleY + 16;
  doc.setFillColor(...COR_BG_BOX);
  doc.setDrawColor(...COR_BORDA);
  doc.roundedRect(margin + 6, financeBoxY, contentWidth - 12, 22, 2.5, 2.5, 'FD');

  doc.setTextColor(...COR_VINHO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text(
    ehCortesia ? 'NATUREZA DA OPERAÇÃO / REGULARIZAÇÃO:' : 'VALOR TOTAL EFETIVAMENTE PAGO / QUITADO:',
    margin + 12,
    financeBoxY + 8
  );

  doc.setFontSize(15);
  doc.text(
    ehCortesia ? 'ISENÇÃO CONCEDIDA (R$ 0,00)' : formatarValorMoeda(dados.valorPago),
    margin + 12,
    financeBoxY + 16
  );

  doc.setFontSize(7.5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COR_DOURADO);
  doc.text(`FORMA DE PAGAMENTO: ${rotuloFormaPagamento(dados.formaPagamento, dados.valorPago)}`, pageWidth - margin - 12, financeBoxY + 10, { align: 'right' });

  doc.setFontSize(7);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_MUTED);
  doc.text(
    ehCortesia
      ? `BAIXA ADMINISTRATIVA / ISENÇÃO • ${dados.viaCredencial}ª VIA DA CARTEIRINHA`
      : `PAGAMENTO CONFIRMADO • ${dados.viaCredencial}ª VIA DA CARTEIRINHA`,
    pageWidth - margin - 12,
    financeBoxY + 16,
    { align: 'right' }
  );

  // 6. Dados da Associada (Esposa de Ministro)
  let curY = financeBoxY + 28;

  doc.setFillColor(...COR_VINHO);
  doc.rect(margin + 6, curY, 3, 9, 'F');

  doc.setTextColor(...COR_VINHO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('DADOS DA ASSOCIADA TITULAR', margin + 12, curY + 6.5);

  curY += 12;
  const boxAssocHeight = 16;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin + 6, curY, contentWidth - 12, boxAssocHeight, 2, 2, 'S');

  // Linhas internas de dados essenciais da Associada (apenas nome e identificação institucional)
  doc.setFontSize(8);
  doc.setTextColor(...COR_MUTED);
  doc.text('Nome da Associada:', margin + 10, curY + 6.5);
  doc.setTextColor(...COR_TEXTO);
  doc.setFont('helvetica', 'bold');
  doc.text(dados.associada.nome || '—', margin + 42, curY + 6.5);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_MUTED);
  doc.text('Matrícula AEMADEPA:', margin + 10, curY + 12);
  doc.setTextColor(...COR_TEXTO);
  doc.setFont('helvetica', 'bold');
  doc.text(dados.associada.numeroAemadepa || 'Emissão Inicial', margin + 45, curY + 12);

  if (dados.associada.cpf && dados.associada.cpf.length >= 11) {
    const limpo = dados.associada.cpf.replace(/\D/g, '');
    const cpfMascarado = limpo.length === 11 ? `***.${limpo.slice(3, 6)}.***-${limpo.slice(9)}` : '***.***.***-**';
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...COR_MUTED);
    doc.text('CPF:', margin + 100, curY + 12);
    doc.setTextColor(...COR_TEXTO);
    doc.text(cpfMascarado, margin + 110, curY + 12);
  }

  // 7. Dados do Vínculo Ministerial (Pastor Esposo)
  curY += boxAssocHeight + 7;

  doc.setFillColor(...COR_ROSE);
  doc.rect(margin + 6, curY, 3, 9, 'F');

  doc.setTextColor(...COR_ROSE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('VÍNCULO MINISTERIAL (MINISTRO CONVENCIONADO)', margin + 12, curY + 6.5);

  curY += 12;
  const boxMinHeight = 24;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin + 6, curY, contentWidth - 12, boxMinHeight, 2, 2, 'S');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_MUTED);
  doc.text('Pastor Vinculado:', margin + 10, curY + 6);
  doc.setTextColor(...COR_TEXTO);
  doc.setFont('helvetica', 'bold');
  doc.text(dados.ministro.nome || '—', margin + 35, curY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_MUTED);
  doc.text('Matrícula COMIEADEPA:', margin + 100, curY + 6);
  doc.setTextColor(...COR_TEXTO);
  doc.setFont('helvetica', 'bold');
  doc.text(dados.ministro.matricula || '—', margin + 140, curY + 6);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_MUTED);
  doc.text('Campo Ministerial:', margin + 10, curY + 13);
  doc.setTextColor(...COR_TEXTO);
  doc.text(dados.ministro.campo || '—', margin + 38, curY + 13);

  doc.setTextColor(...COR_MUTED);
  doc.text('Supervisão:', margin + 100, curY + 13);
  doc.setTextColor(...COR_TEXTO);
  doc.text(dados.ministro.supervisao || '—', margin + 120, curY + 13);

  doc.setTextColor(...COR_MUTED);
  doc.text('Cargo Ministerial:', margin + 10, curY + 20);
  doc.setTextColor(...COR_TEXTO);
  doc.text(dados.ministro.cargo || 'Pastor', margin + 38, curY + 20);

  // 8. Discriminação dos Serviços e Autenticação
  curY += boxMinHeight + 7;

  doc.setFillColor(...COR_VINHO);
  doc.rect(margin + 6, curY, 3, 9, 'F');

  doc.setTextColor(...COR_VINHO);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('DISCRIMINAÇÃO DO SERVIÇO CONVENCIONAL', margin + 12, curY + 6.5);

  curY += 12;
  const boxDiscHeight = 36;
  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin + 6, curY, contentWidth - 12, boxDiscHeight, 2, 2, 'S');

  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_TEXTO);
  doc.text(`• Emissão da Credencial Institucional Oficial AEMADEPA — ${dados.viaCredencial}ª Via`, margin + 10, curY + 6);
  doc.setTextColor(...COR_MUTED);
  doc.setFontSize(7.5);
  doc.text('Confecção de cartão físico em policarbonato/PVC especial com identificação fotográfica, QR Code de validação e chip.', margin + 13, curY + 11);

  doc.setTextColor(...COR_TEXTO);
  doc.setFontSize(8);
  doc.text('• Protocolo da Solicitação:', margin + 10, curY + 18);
  doc.setFont('helvetica', 'bold');
  doc.text(dados.solicitacaoId, margin + 45, curY + 18);

  doc.setFont('helvetica', 'normal');
  doc.text('• Identificador da Transação (Gateway ASAAS):', margin + 10, curY + 25);
  doc.setFont('helvetica', 'bold');
  doc.text(dados.transacaoId || 'Quitação Manual / Baixa Administrativa', margin + 74, curY + 25);

  doc.setFont('helvetica', 'normal');
  doc.text('• Data da Efetivação Financeira:', margin + 10, curY + 31.5);
  doc.setFont('helvetica', 'bold');
  doc.text(formatarDataIso(dados.dataPagamento), margin + 55, curY + 31.5);

  // 9. Informações Legais e Institucionais
  curY += boxDiscHeight + 6;
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin + 6, curY, contentWidth - 12, 17, 2, 2, 'F');

  doc.setTextColor(...COR_MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  const infoText = [
    'Este documento constitui recibo formal de quitação financeira de taxa operacional interna da AEMADEPA / COMIEADEPA.',
    'A credencial física confeccionada segue automaticamente para a fila de impressão da Secretaria Geral da COMIEADEPA.',
    'Para retiradas ou esclarecimentos adicionais, procure a Secretaria da Convenção no Templo Central ou nos eventos oficiais.',
  ];
  doc.text(infoText[0], margin + 8, curY + 4.5);
  doc.text(infoText[1], margin + 8, curY + 8.5);
  doc.text(infoText[2], margin + 8, curY + 12.5);

  // 10. Rodapé Institucional
  const footerY = margin + 265 - 10;
  doc.setDrawColor(...COR_BORDA);
  doc.setLineWidth(0.3);
  doc.line(margin + 6, footerY, pageWidth - margin - 6, footerY);

  doc.setFontSize(6.5);
  doc.setTextColor(...COR_MUTED);
  doc.text('SISCOMIEADEPA — Sistema Integrado de Gestão da COMIEADEPA e AEMADEPA', margin + 6, footerY + 4.5);
  doc.text(`Autenticação: ${dados.numeroRecibo}`, pageWidth - margin - 6, footerY + 4.5, { align: 'right' });

  // Gera o PDF em Base64
  const pdfOutput = doc.output('datauristring');
  const base64Data = pdfOutput.split(',')[1] || pdfOutput;
  const filename = `Recibo_AEMADEPA_${dados.numeroRecibo}.pdf`;

  return {
    base64: base64Data,
    filename,
  };
}
