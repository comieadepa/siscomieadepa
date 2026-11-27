import { jsPDF } from 'jspdf';
import { LOGO_UMADESPA_BASE64 } from './logo-base64';
import { LOGO_COMIEADEPA_BASE64 } from '@/lib/logos-base64';

export interface DadosReciboUmadespa {
  numeroRecibo: string;
  solicitacaoId: string;
  dataPagamento: string;
  valorPago: number;
  formaPagamento: string; // 'pix_asaas' | 'a_vista' | 'cortesia'
  transacaoId?: string | null;
  viaCredencial: number;
  associado: {
    nome: string;
    cpf: string;
    rg?: string | null;
    numeroUmadespa?: string | null;
    fone?: string | null;
    email?: string | null;
    funcao: string;
    supervisao?: string | null;
    campo?: string | null;
    congregacao?: string | null;
    menorIdade?: boolean;
    responsavelNome?: string | null;
  };
  operador?: {
    nome?: string | null;
    email?: string | null;
  };
}

// Cores Institucionais UMADESPA
const COR_EMERALD: [number, number, number] = [4, 120, 87];     // #047857 (Verde Esmeralda)
const COR_DARK_GREEN: [number, number, number] = [6, 78, 59];    // #064E3B (Verde Escuro)
const COR_TEXTO: [number, number, number] = [31, 41, 55];        // #1F2937 (Cinza Escuro)
const COR_MUTED: [number, number, number] = [100, 116, 139];     // #64748B (Slate muted)
const COR_BG_BOX: [number, number, number] = [240, 253, 244];    // #F0FDF4 (Verde ultra claro)
const COR_BORDA: [number, number, number] = [167, 243, 208];     // #A7F3D0 (Borda verde suave)

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
 * Gera recibo institucional da UMADESPA em formato PDF (A4 vertical)
 * Retorna base64 e filename determinístico.
 */
export async function gerarReciboUmadespaPdf(dados: DadosReciboUmadespa): Promise<{
  base64: string;
  filename: string;
}> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const marginX = 14;
  const contentWidth = pageWidth - marginX * 2; // 182mm
  let currentY = 14;

  // 1. CABEÇALHO INSTITUCIONAL
  doc.setFillColor(...COR_DARK_GREEN);
  doc.rect(marginX, currentY, contentWidth, 32, 'F');

  // Adiciona logos se disponíveis
  try {
    if (LOGO_COMIEADEPA_BASE64) {
      doc.addImage(LOGO_COMIEADEPA_BASE64, 'PNG', marginX + 3, currentY + 3, 20, 26);
    }
  } catch (err) {
    console.warn('[PDF UMADESPA] Não foi possível carregar logo COMIEADEPA:', err);
  }

  try {
    if (LOGO_UMADESPA_BASE64) {
      doc.addImage(LOGO_UMADESPA_BASE64, 'PNG', marginX + contentWidth - 25, currentY + 4, 22, 24);
    }
  } catch (err) {
    console.warn('[PDF UMADESPA] Não foi possível carregar logo UMADESPA:', err);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('CONVENÇÃO ESTADUAL DE MINISTROS E IGREJAS', pageWidth / 2, currentY + 9, { align: 'center' });
  doc.text('ASSEMBLEIAS DE DEUS NO ESTADO DO PARÁ — COMIEADEPA', pageWidth / 2, currentY + 14.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(209, 250, 229);
  doc.text('UMADESPA — UNIÃO DE MOCIDADE DAS AD NO ESTADO DO PARÁ', pageWidth / 2, currentY + 20, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(251, 191, 36); // Dourado suave
  doc.text('COMPROVANTE OFICIAL DE PAGAMENTO DE CREDENCIAL', pageWidth / 2, currentY + 27, { align: 'center' });

  currentY += 36;

  // 2. FAIXA DE IDENTIFICAÇÃO DO RECIBO
  doc.setFillColor(...COR_BG_BOX);
  doc.setDrawColor(...COR_BORDA);
  doc.setLineWidth(0.4);
  doc.roundedRect(marginX, currentY, contentWidth, 16, 2, 2, 'FD');

  doc.setTextColor(...COR_DARK_GREEN);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(`Nº DO RECIBO: ${dados.numeroRecibo}`, marginX + 4, currentY + 6.5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...COR_TEXTO);
  doc.text(`Data da Quitação: ${formatarDataHoraIso(dados.dataPagamento)}`, marginX + 4, currentY + 12);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...COR_EMERALD);
  doc.text(`VALOR PAGO: ${formatarValorMoeda(dados.valorPago)}`, marginX + contentWidth - 4, currentY + 10, { align: 'right' });

  currentY += 21;

  // 3. SEÇÃO: DADOS DO JOVEM / ASSOCIADO
  doc.setFillColor(...COR_EMERALD);
  doc.rect(marginX, currentY, contentWidth, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('1. DADOS DO JOVEM / ASSOCIADO(A)', marginX + 3, currentY + 4.2);

  currentY += 8;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...COR_BORDA);
  doc.roundedRect(marginX, currentY, contentWidth, 38, 1.5, 1.5, 'FD');

  doc.setFontSize(8.5);
  doc.setTextColor(...COR_MUTED);
  doc.setFont('helvetica', 'bold');
  doc.text('Nome do Jovem:', marginX + 4, currentY + 6);
  doc.text('CPF:', marginX + 4, currentY + 13);
  doc.text('Função:', marginX + 4, currentY + 20);
  doc.text('Supervisão:', marginX + 4, currentY + 27);
  doc.text('Campo Eclesiástico:', marginX + 4, currentY + 34);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_TEXTO);
  doc.text(dados.associado.nome || '—', marginX + 38, currentY + 6);
  doc.text(dados.associado.cpf || '—', marginX + 38, currentY + 13);
  doc.text(dados.associado.funcao || 'Membro', marginX + 38, currentY + 20);
  doc.text(dados.associado.supervisao || 'COMIEADEPA', marginX + 38, currentY + 27);
  doc.text(dados.associado.campo || '—', marginX + 38, currentY + 34);

  // Coluna direita do associado
  const colDirX = marginX + contentWidth / 2 + 10;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COR_MUTED);
  doc.text('Registro UMADESPA:', colDirX, currentY + 6);
  doc.text('Telefone / WhatsApp:', colDirX, currentY + 13);
  doc.text('E-mail:', colDirX, currentY + 20);
  doc.text('Congregação:', colDirX, currentY + 27);
  if (dados.associado.menorIdade) {
    doc.text('Responsável Legal:', colDirX, currentY + 34);
  }

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_TEXTO);
  doc.text(dados.associado.numeroUmadespa || 'Pendente de emissão', colDirX + 36, currentY + 6);
  doc.text(dados.associado.fone || '—', colDirX + 36, currentY + 13);
  doc.text(dados.associado.email || '—', colDirX + 36, currentY + 20);
  doc.text(dados.associado.congregacao || 'Sede / Não informada', colDirX + 36, currentY + 27);
  if (dados.associado.menorIdade) {
    doc.text(dados.associado.responsavelNome || 'Autorizado', colDirX + 36, currentY + 34);
  }

  currentY += 43;

  // 4. SEÇÃO: DISCRIMINAÇÃO FINANCEIRA E SERVIÇO
  doc.setFillColor(...COR_EMERALD);
  doc.rect(marginX, currentY, contentWidth, 6, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('2. DISCRIMINAÇÃO DO SERVIÇO E QUITAÇÃO', marginX + 3, currentY + 4.2);

  currentY += 8;
  doc.setFillColor(255, 255, 255);
  doc.setDrawColor(...COR_BORDA);
  doc.roundedRect(marginX, currentY, contentWidth, 34, 1.5, 1.5, 'FD');

  doc.setFontSize(8.5);
  doc.setTextColor(...COR_MUTED);
  doc.setFont('helvetica', 'bold');
  doc.text('Item / Serviço:', marginX + 4, currentY + 6);
  doc.text('Modalidade / Via:', marginX + 4, currentY + 13);
  doc.text('Forma de Pagamento:', marginX + 4, currentY + 20);
  doc.text('ID Transação / ASAAS:', marginX + 4, currentY + 27);

  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...COR_TEXTO);
  doc.text('Emissão de Credencial Oficial da Juventude (Cartão PVC CR-80)', marginX + 42, currentY + 6);
  doc.text(`${dados.viaCredencial}ª Via Oficial da Carteirinha UMADESPA`, marginX + 42, currentY + 13);
  doc.text(rotuloFormaPagamento(dados.formaPagamento, dados.valorPago), marginX + 42, currentY + 20);
  doc.text(dados.transacaoId || 'Quitação interna autorizada pela Secretaria', marginX + 42, currentY + 27);

  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...COR_MUTED);
  doc.text('Situação Financeira:', colDirX, currentY + 13);
  doc.setTextColor(...COR_EMERALD);
  doc.text('PAGO / QUITADO', colDirX + 36, currentY + 13);

  currentY += 39;

  // 5. SEÇÃO: DECLARAÇÃO INSTITUCIONAL DE QUITAÇÃO
  doc.setFillColor(...COR_BG_BOX);
  doc.setDrawColor(...COR_BORDA);
  doc.roundedRect(marginX, currentY, contentWidth, 24, 2, 2, 'FD');

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...COR_DARK_GREEN);
  const textoDeclaracao =
    `Declaramos para os devidos fins de direito e comprovação institucional que a taxa de emissão da ${dados.viaCredencial}ª via ` +
    `da Credencial Oficial da UMADESPA em favor de ${dados.associado.nome} foi devidamente quitada e processada ` +
    `nos termos das diretrizes administrativas da COMIEADEPA. O presente comprovante autoriza a impressão, ` +
    `confecção e entrega do documento oficial de identificação da juventude.`;
  const linhasDeclaracao = doc.splitTextToSize(textoDeclaracao, contentWidth - 8);
  doc.text(linhasDeclaracao, marginX + 4, currentY + 6);

  currentY += 28;

  // 6. ASSINATURAS E VALIDAÇÃO
  const blocoAssinaturaY = currentY + 18;
  doc.setDrawColor(...COR_MUTED);
  doc.setLineWidth(0.3);

  // Linha Tesouraria / Secretaria
  doc.line(marginX + 15, blocoAssinaturaY, marginX + 75, blocoAssinaturaY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COR_TEXTO);
  doc.text('SECRETARIA GERAL / TESOURARIA', marginX + 45, blocoAssinaturaY + 4, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COR_MUTED);
  doc.text('COMIEADEPA — Belém/PA', marginX + 45, blocoAssinaturaY + 8, { align: 'center' });

  // Linha Presidência
  doc.line(marginX + contentWidth - 75, blocoAssinaturaY, marginX + contentWidth - 15, blocoAssinaturaY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...COR_TEXTO);
  doc.text('PR. OCÉLIO NAUAR', marginX + contentWidth - 45, blocoAssinaturaY + 4, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...COR_MUTED);
  doc.text('Presidente COMIEADEPA', marginX + contentWidth - 45, blocoAssinaturaY + 8, { align: 'center' });

  // 7. RODAPÉ INSTITUCIONAL
  doc.setFontSize(7);
  doc.setTextColor(...COR_MUTED);
  doc.text(
    `Documento emitido eletronicamente pelo SISCOMIEADEPA em ${formatarDataHoraIso(new Date().toISOString())} • Protocolo: ${dados.solicitacaoId}`,
    pageWidth / 2,
    285,
    { align: 'center' }
  );
  doc.text(
    'Convenção Estadual de Ministros e Igrejas Assembleias de Deus no Estado do Pará — CNPJ 05.020.250/0001-44',
    pageWidth / 2,
    289,
    { align: 'center' }
  );

  const pdfOutput = doc.output('arraybuffer');
  const base64 = Buffer.from(pdfOutput).toString('base64');
  const filename = `Recibo_UMADESPA_${dados.numeroRecibo}.pdf`;

  return { base64, filename };
}
