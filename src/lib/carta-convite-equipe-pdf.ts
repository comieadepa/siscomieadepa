import { jsPDF } from 'jspdf';
import { LOGO_COMIEADEPA_BASE64 } from '@/lib/logos-base64';

export interface DadosCartaConviteEquipe {
  nomeTrabalhador: string;
  funcaoLabel: string;
  eventoNome: string;
  dataInicio?: string | null;
  dataFim?: string | null;
  local?: string | null;
  cidade?: string | null;
  emissaoData?: string | Date;
}

// Cores institucionais COMIEADEPA
const NAVY_COLOR: [number, number, number] = [13, 43, 78];     // #0D2B4E
const GOLD_COLOR: [number, number, number] = [212, 175, 55];   // #D4AF37
const TEXT_DARK: [number, number, number] = [31, 41, 55];      // #1F2937
const TEXT_MUTED: [number, number, number] = [100, 116, 139];  // #64748B
const BORDER_COLOR: [number, number, number] = [226, 232, 240];

function formatarDataIso(dataIso?: string | null): string {
  if (!dataIso) return '';
  try {
    const [y, m, d] = dataIso.slice(0, 10).split('-');
    return `${d}/${m}/${y}`;
  } catch {
    return dataIso;
  }
}

function formatarPeriodo(dataInicio?: string | null, dataFim?: string | null): string {
  const ini = formatarDataIso(dataInicio);
  const fim = formatarDataIso(dataFim);
  if (ini && fim) {
    return ini === fim ? ini : `${ini} a ${fim}`;
  }
  return ini || fim || 'A definir';
}

function formatarDataExtenso(data: Date): string {
  const meses = [
    'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
  ];
  const dia = data.getDate();
  const mes = meses[data.getMonth()];
  const ano = data.getFullYear();
  return `${dia} de ${mes} de ${ano}`;
}

/**
 * Gera o documento PDF oficial da Carta-Convite para a Equipe de Trabalho.
 * Retorna o Buffer / Base64 do documento.
 */
export async function gerarCartaConviteEquipePdf(dados: DadosCartaConviteEquipe): Promise<{
  base64: string;
  filename: string;
}> {
  // Inicializa documento A4 (210 x 297 mm)
  const DocConstructor = typeof jsPDF === 'function' ? jsPDF : (jsPDF as any).default || (jsPDF as any).jsPDF;
  const doc = new DocConstructor({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const marginX = 20;
  const contentWidth = 210 - marginX * 2; // 170 mm
  let currentY = 16;

  // ── 1. CABEÇALHO OFICIAL COMIEADEPA ──────────────────────────────────────
  // Brasão oficial COMIEADEPA à esquerda (proporção ~0.87)
  if (LOGO_COMIEADEPA_BASE64) {
    try {
      doc.addImage(LOGO_COMIEADEPA_BASE64, 'PNG', marginX + 2, currentY, 17, 20);
    } catch (e) {
      console.warn('[CARTA-CONVITE] Falha ao adicionar brasão COMIEADEPA:', e);
    }
  }

  // Textos Institucionais (alinhados com compensação visual do brasão à esquerda)
  const headerCenterX = 112;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...NAVY_COLOR);
  doc.text('COMIEADEPA', headerCenterX, currentY + 3.5, { align: 'center' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.setTextColor(...NAVY_COLOR);
  doc.text('Convenção Interestadual de Ministros e Igrejas Evangélicas', headerCenterX, currentY + 8.5, { align: 'center' });
  doc.text('Assembleias de Deus no Estado do Pará', headerCenterX, currentY + 12.5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('Sede Administrativa: Rodovia Mário Covas, 2500 - Coqueiro, Ananindeua - PA · CEP 66650-000', headerCenterX, currentY + 17, { align: 'center' });
  doc.text('CNPJ: 04.760.047/0001-04 · Telefone: (91) 99223-4022 · contato@comieadepa.org', headerCenterX, currentY + 20.5, { align: 'center' });

  currentY += 25;

  // Linha dourada divisória elegante
  doc.setDrawColor(...GOLD_COLOR);
  doc.setLineWidth(0.8);
  doc.line(marginX, currentY, 210 - marginX, currentY);

  currentY += 10;

  // ── 2. DATA E LOCAL DE EMISSÃO ───────────────────────────────────────────
  const dataRef = dados.emissaoData instanceof Date
    ? dados.emissaoData
    : (dados.emissaoData ? new Date(dados.emissaoData) : new Date());
  const dataExtenso = formatarDataExtenso(Number.isNaN(dataRef.getTime()) ? new Date() : dataRef);
  const cidadeEmissao = dados.cidade || 'Ananindeua - PA';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...TEXT_MUTED);
  doc.text(`${cidadeEmissao}, ${dataExtenso}.`, 210 - marginX, currentY, { align: 'right' });

  currentY += 10;

  // ── 3. TÍTULO DO DOCUMENTO ───────────────────────────────────────────────
  doc.setFillColor(...NAVY_COLOR);
  doc.roundedRect(marginX, currentY, contentWidth, 11, 1.5, 1.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.setTextColor(255, 255, 255);
  doc.text('CARTA-CONVITE OFICIAL — EQUIPE DE TRABALHO', 105, currentY + 7.2, { align: 'center' });

  currentY += 20;

  // ── 4. VOCATIVO NOMINAL ──────────────────────────────────────────────────
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(...NAVY_COLOR);
  doc.text(`Prezado(a) irmão(ã) ${dados.nomeTrabalhador.trim().toUpperCase()},`, marginX, currentY);

  currentY += 10;

  // ── 5. CORPO DA CARTA (CONVITE INSTITUCIONAL PARA COLABORAÇÃO VOLUNTÁRIA) ─
  const periodoFormatado = formatarPeriodo(dados.dataInicio, dados.dataFim);
  const localFormatado = [dados.local, dados.cidade].filter(Boolean).join(' - ') || 'Centro de Eventos COMIEADEPA';

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(...TEXT_DARK);
  doc.setLineHeightFactor(1.4);

  const p1 = `A Convenção Interestadual de Ministros e Igrejas Evangélicas Assembleias de Deus no Estado do Pará (COMIEADEPA), por meio de sua Diretoria e da Coordenação Geral de Eventos, tem a grata honra de convidar Vossa Senhoria para compor a equipe oficial de trabalho e apoio ao evento ${dados.eventoNome}.`;
  const splitP1 = doc.splitTextToSize(p1, contentWidth);
  doc.text(splitP1, marginX, currentY);
  currentY += splitP1.length * 5.6 + 4;

  const p2 = `Reconhecendo sua dedicação e testemunho cristão, expressamos nossa profunda gratidão pela disposição em servir voluntariamente ao Reino de Deus neste importante conclave comemorativo e deliberativo, auxiliando na edificação e no acolhimento de todos os convencionais, delegados e visitantes.`;
  const splitP2 = doc.splitTextToSize(p2, contentWidth);
  doc.text(splitP2, marginX, currentY);
  currentY += splitP2.length * 5.6 + 6;

  // ── 6. QUADRO RESUMO DA DESIGNAÇÃO DO EVENTO ─────────────────────────────
  const boxY = currentY;
  const boxHeight = 32;

  doc.setFillColor(248, 250, 252); // #F8FAFC
  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.4);
  doc.roundedRect(marginX, boxY, contentWidth, boxHeight, 2, 2, 'FD');

  // Barra lateral esquerda em azul marinho
  doc.setFillColor(...NAVY_COLOR);
  doc.rect(marginX, boxY, 2.5, boxHeight, 'F');

  let textInBoxY = boxY + 6.5;
  const labelX = marginX + 6;

  // Linha 1: Evento
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...NAVY_COLOR);
  doc.text('Evento:', labelX, textInBoxY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_DARK);
  doc.text(dados.eventoNome, labelX + 20, textInBoxY);

  // Linha 2: Função Designada
  textInBoxY += 6.5;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...NAVY_COLOR);
  doc.text('Função:', labelX, textInBoxY);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(180, 83, 9); // tom âmbar/destaque elegante
  doc.text(dados.funcaoLabel, labelX + 20, textInBoxY);

  // Linha 3: Período
  textInBoxY += 6.5;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...NAVY_COLOR);
  doc.text('Período:', labelX, textInBoxY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_DARK);
  doc.text(periodoFormatado, labelX + 20, textInBoxY);

  // Linha 4: Local
  textInBoxY += 6.5;
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(...NAVY_COLOR);
  doc.text('Local:', labelX, textInBoxY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...TEXT_DARK);
  doc.text(localFormatado, labelX + 20, textInBoxY);

  currentY = boxY + boxHeight + 8;

  // ── 7. FECHAMENTO E VERSÍCULO ────────────────────────────────────────────
  const p3 = `Rogamos as mais ricas bênçãos do Senhor sobre sua vida e ministério, com a certeza de que a vossa cooperação será de grande valia para o pleno êxito desta magna reunião da nossa convenção.`;
  const splitP3 = doc.splitTextToSize(p3, contentWidth);
  doc.text(splitP3, marginX, currentY);
  currentY += splitP3.length * 5.6 + 6;

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(...TEXT_MUTED);
  const versiculo = `"Portanto, meus amados irmãos, sede firmes e constantes, sempre abundantes na obra do Senhor, sabendo que o vosso trabalho não é vão no Senhor." (1 Coríntios 15:58)`;
  const splitVersiculo = doc.splitTextToSize(versiculo, contentWidth);
  doc.text(splitVersiculo, 105, currentY, { align: 'center' });
  currentY += splitVersiculo.length * 4.8 + 8;

  // ── 8. IDENTIFICAÇÃO INSTITUCIONAL CENTRALIZADA ─────────────────────────
  currentY += 14;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(...NAVY_COLOR);
  doc.text('CONSELHO DE TECNOLOGIA DA INFORMAÇÃO', 105, currentY, { align: 'center' });

  currentY += 4.5;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...NAVY_COLOR);
  doc.text('PR ASSIS ALCANTARA (REG. 4267)', 105, currentY, { align: 'center' });

  currentY += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('SISTEMA & SUPORTE', 105, currentY, { align: 'center' });

  // ── 9. RODAPÉ INSTITUCIONAL ──────────────────────────────────────────────
  doc.setDrawColor(...BORDER_COLOR);
  doc.setLineWidth(0.3);
  doc.line(marginX, 284, 210 - marginX, 284);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(...TEXT_MUTED);
  doc.text('COMIEADEPA · Sistema Integrado SISCOMIEADEPA — Carta-Convite Oficial', marginX, 288);
  doc.text('Documento gerado eletronicamente', 210 - marginX, 288, { align: 'right' });

  // ── 10. EXTRAÇÃO DO BUFFER E BASE64 ──────────────────────────────────────
  const arrayBuffer = doc.output('arraybuffer');
  const buffer = Buffer.from(arrayBuffer);
  const base64 = buffer.toString('base64');

  const safeNome = dados.nomeTrabalhador
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '_')
    .slice(0, 30);

  const filename = `carta_convite_${safeNome || 'equipe'}.pdf`;

  return {
    base64,
    filename,
  };
}
