import { jsPDF } from 'jspdf';
import { LOGO_AGO26_BASE64 } from './logo-ago26-base64';

export interface DadosReciboAgo {
  inscricaoId: string;
  eventoId: string;
  eventoNome?: string;
  protocoloAutenticacao: string; // AGO126-XXXX-XXXX-XXXX-XXXX
  dataEmissao: string; // ISO ou formatada
  dataPagamento?: string | null;
  valorNumerico: number;
  valorExtenso: string;
  formaPagamento: string;
  transacaoId?: string | null;
  loteId?: string | null;
  inscrito: {
    nome: string;
    cpf: string;
    email?: string | null;
    telefone?: string | null;
    categoria: string; // Ex: Pastor Presidente ou Campo Missionário
    matricula?: string | null;
    cargo?: string | null;
    supervisao?: string | null;
    campo?: string | null;
    isCampoMissionario?: boolean;
  };
}

// ── Cores Oficiais Extraídas do Modelo Aprovado ──────────────────────────────
const COR_AZUL_COMIEADEPA: [number, number, number] = [0, 32, 96];      // #002060 (Azul escuro institucional)
const COR_DOURADO_DIVISOR: [number, number, number] = [184, 134, 11];   // #B8860B (Linha divisória dourada)
const COR_BG_BOX: [number, number, number] = [240, 244, 250];           // #F0F4FA (Fundo azul acinzentado muito suave)
const COR_TEXTO_PADRAO: [number, number, number] = [30, 41, 59];        // #1E293B (Texto slate)
const COR_CINZA_LABEL: [number, number, number] = [100, 116, 139];       // #64748B (Labels)
const COR_CINZA_RODAPE: [number, number, number] = [100, 116, 139];     // #64748B (Rodapé legível)

function formatarDataBrasileira(dataStr?: string | null): string {
  if (!dataStr) return new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Belem' });
  try {
    const d = new Date(dataStr);
    if (isNaN(d.getTime())) return dataStr;
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Belem' });
  } catch {
    return dataStr;
  }
}

function formatarDataHoraCompleta(dataStr?: string | null): string {
  if (!dataStr) return new Date().toLocaleString('pt-BR', { timeZone: 'America/Belem' });
  try {
    const d = new Date(dataStr);
    if (isNaN(d.getTime())) return dataStr;
    return d.toLocaleString('pt-BR', { timeZone: 'America/Belem' });
  } catch {
    return dataStr;
  }
}

function formatarDataExtensa(dataStr?: string | null): string {
  const d = dataStr ? new Date(dataStr) : new Date();
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'
  ];
  const dia = d.getDate();
  const mes = meses[d.getMonth()];
  const ano = d.getFullYear();
  return `${dia} de ${mes} de ${ano}`;
}

function formatarMoeda(v: number): string {
  return Number(v || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatarCpf(cpfRaw: string): string {
  const num = (cpfRaw || '').replace(/\D/g, '');
  if (num.length === 11) {
    return `${num.substring(0, 3)}.${num.substring(3, 6)}.${num.substring(6, 9)}-${num.substring(9, 11)}`;
  }
  return cpfRaw;
}

function normalizarFormaPagamento(forma?: string | null): string {
  const f = (forma || '').toLowerCase().trim();
  if (f === 'pix') return 'PIX';
  if (f === 'credit_card' || f === 'cartao' || f === 'cartão' || f.includes('cartao')) return 'Cartão de Crédito';
  if (f === 'boleto') return 'Boleto Bancário';
  if (f === 'especie' || f === 'dinheiro') return 'Espécie (Dinheiro)';
  return forma ? forma.toUpperCase() : 'PIX';
}

/**
 * Gera o PDF do Recibo de Inscrição da 126ª AGO reproduzindo
 * com exatidão matemática o layout visual aprovado.
 */
export async function gerarReciboAgoPdf(dados: DadosReciboAgo): Promise<{ base64: string; filename: string }> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4', // 210mm x 297mm
  });

  const pageWidth = 210;
  const marginX = 22;
  const contentWidth = pageWidth - (marginX * 2); // 166mm

  // ── 1. CABEÇALHO INSTITUCIONAL ──────────────────────────────────────────────
  // Logomarca oficial ago26.png à esquerda
  const logoW = 34;
  const logoH = 34;
  const headerTopY = 18;

  try {
    doc.addImage(LOGO_AGO26_BASE64, 'PNG', marginX, headerTopY, logoW, logoH, undefined, 'FAST');
  } catch (err) {
    console.warn('[RECIBO AGO] Não foi possível carregar LOGO_AGO26:', err);
  }

  // Texto Institucional da COMIEADEPA à direita do logo
  const textLeftX = marginX + logoW + 8; // 64mm
  let textY = headerTopY + 4;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...COR_AZUL_COMIEADEPA);
  doc.text('COMIEADEPA', textLeftX, textY);

  textY += 5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COR_AZUL_COMIEADEPA);
  doc.text('CONVENÇÃO INTERESTADUAL DE MINISTROS E IGREJAS EVANGÉLICAS', textLeftX, textY);

  textY += 4;
  doc.text('ASSEMBLEIAS DE DEUS NO ESTADO DO PARÁ', textLeftX, textY);

  textY += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(70, 70, 70);
  doc.text('Presidente: Pr. Océlio Nauar de Araújo', textLeftX, textY);

  textY += 4;
  doc.text('Rodovia Mário Covas, 2500 – Coqueiro, Belém – PA', textLeftX, textY);

  textY += 4;
  doc.text('CEP 66650-000', textLeftX, textY);

  // ── 2. LINHA DIVISÓRIA DOURADA ─────────────────────────────────────────────
  const lineY = headerTopY + logoH + 5; // ~57mm
  doc.setDrawColor(...COR_DOURADO_DIVISOR);
  doc.setLineWidth(1.0);
  doc.line(marginX, lineY, marginX + contentWidth, lineY);

  // ── 3. TÍTULO E SUBTÍTULO DO DOCUMENTO ─────────────────────────────────────
  let curY = lineY + 16;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.setTextColor(...COR_AZUL_COMIEADEPA);
  doc.text('RECIBO DE INSCRIÇÃO', pageWidth / 2, curY, { align: 'center' });

  curY += 7;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(...COR_AZUL_COMIEADEPA);
  doc.text('126ª Assembleia Geral Ordinária', pageWidth / 2, curY, { align: 'center' });

  // ── 4. BOX DE VALOR RECEBIDO ───────────────────────────────────────────────
  // No modelo aprovado sem numeração sequencial: box limpo centralizado com o valor recebido
  curY += 12;
  const boxH = 22;
  doc.setFillColor(...COR_BG_BOX);
  doc.roundedRect(marginX, curY, contentWidth, boxH, 2, 2, 'F');

  // Label "VALOR RECEBIDO"
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...COR_CINZA_LABEL);
  doc.text('VALOR RECEBIDO', marginX + 12, curY + 7.5);

  // Valor numérico em destaque azul
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(19);
  doc.setTextColor(...COR_AZUL_COMIEADEPA);
  doc.text(`R$ ${formatarMoeda(dados.valorNumerico)}`, marginX + 12, curY + 16.5);

  // ── 5. DECLARAÇÃO DE QUITAÇÃO FORMAL ───────────────────────────────────────
  curY += boxH + 12;

  const nomeFormatado = dados.inscrito.nome.toUpperCase();
  const valorNumStr = formatarMoeda(dados.valorNumerico);
  const textoDeclaracao =
    `A COMIEADEPA declara ter recebido de ${nomeFormatado}, a importância de R$ ${valorNumStr} ` +
    `(${dados.valorExtenso}), referente ao pagamento da inscrição na 126ª Assembleia Geral Ordinária (AGO).`;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10.5);
  doc.setTextColor(...COR_TEXTO_PADRAO);
  
  const linhasDeclaracao = doc.splitTextToSize(textoDeclaracao, contentWidth);
  doc.text(linhasDeclaracao, marginX, curY, { lineHeightFactor: 1.4 });

  // ── 6. CAMPOS DETALHADOS ───────────────────────────────────────────────────
  // Categoria, CPF, Inscrição, Data do pagamento, Forma de pagamento
  curY += (linhasDeclaracao.length * 6) + 8;

  // Determinar rótulo da Categoria
  let catDesc = dados.inscrito.categoria;
  if (dados.inscrito.isCampoMissionario || catDesc.toUpperCase().includes('MISSIONÁRIO') || catDesc.toUpperCase().includes('MISSIONARIO')) {
    catDesc = 'Pastor Presidente (Campo Missionário)';
  } else {
    catDesc = 'Pastor Presidente';
  }

  const itens = [
    { label: 'Categoria:', valor: catDesc },
    { label: 'CPF:', valor: formatarCpf(dados.inscrito.cpf) },
    { label: 'Inscrição:', valor: dados.inscricaoId.substring(0, 8).toUpperCase() },
    { label: 'Data do pagamento:', valor: formatarDataBrasileira(dados.dataPagamento || dados.dataEmissao) },
    { label: 'Forma de pagamento:', valor: normalizarFormaPagamento(dados.formaPagamento) },
  ];

  doc.setFontSize(10);
  for (const item of itens) {
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...COR_TEXTO_PADRAO);
    doc.text(item.label, marginX, curY);

    const labelWidth = doc.getTextWidth(item.label);
    doc.setFont('helvetica', 'normal');
    doc.text(item.valor, marginX + labelWidth + 3, curY);

    curY += 6.5;
  }

  // ── 7. DATAÇÃO E ASSINATURA INSTITUCIONAL ──────────────────────────────────
  curY += 12;
  const dataExtensa = formatarDataExtensa(dados.dataEmissao);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...COR_TEXTO_PADRAO);
  doc.text(`Belém – PA, ${dataExtensa}.`, pageWidth / 2, curY, { align: 'center' });

  curY += 14;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12.5);
  doc.setTextColor(...COR_AZUL_COMIEADEPA);
  doc.text('COMIEADEPA', pageWidth / 2, curY, { align: 'center' });

  curY += 5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...COR_CINZA_LABEL);
  doc.text('Tesouraria • Recibo eletrônico', pageWidth / 2, curY, { align: 'center' });

  // ── 8. LINHA DIVISÓRIA DOURADA INFERIOR E RODAPÉ ───────────────────────────
  const footerLineY = 270;
  doc.setDrawColor(...COR_DOURADO_DIVISOR);
  doc.setLineWidth(1.0);
  doc.line(marginX, footerLineY, marginX + contentWidth, footerLineY);

  const dataHoraEmissao = formatarDataHoraCompleta(dados.dataEmissao);
  const rodapeTexto =
    `Documento emitido eletronicamente em ${dataHoraEmissao}. Autenticação: ${dados.protocoloAutenticacao}`;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COR_CINZA_RODAPE);
  doc.text(rodapeTexto, pageWidth / 2, footerLineY + 5.5, { align: 'center' });

  const pdfOutput = doc.output('datauristring');
  const base64 = pdfOutput.split(',')[1];
  const filename = `Recibo_126AGO_${(dados.inscrito.cpf || dados.inscricaoId.substring(0, 8)).replace(/\D/g, '')}.pdf`;

  return { base64, filename };
}
