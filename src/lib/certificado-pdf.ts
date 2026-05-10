// ─── Geração de Certificado PDF (client-side) ─────────────────
// Usa: jsPDF (já instalado) + qrcode (já instalado)
// Deve ser importado apenas em componentes 'use client'

import jsPDF from 'jspdf';

// ─── Tipos ────────────────────────────────────────────────────
export interface CertConfig {
  arte_url:         string | null;
  texto_corpo:      string;
  rodape_texto:     string | null;
  assinatura_nome:  string | null;
  assinatura_cargo: string | null;
  orientacao:       'landscape' | 'portrait';
  fonte_tamanho:    number;
}

export interface CertDados {
  nome:        string;
  evento:      string;
  data_evento: string;
  cargo:       string | null;
  campo:       string | null;
  supervisao:  string | null;
  codigo:      string;
  validacao_url: string;
}

// ─── Carrega imagem de URL como base64 ────────────────────────
async function loadImageBase64(
  url: string
): Promise<{ data: string; format: 'JPEG' | 'PNG' } | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(null); return; }
      ctx.drawImage(img, 0, 0);
      try {
        const isPng  = url.toLowerCase().includes('.png');
        const format = isPng ? 'PNG' : 'JPEG';
        const data   = canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', 0.92);
        resolve({ data, format });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// ─── Gera QR code como base64 ─────────────────────────────────
async function gerarQRBase64(text: string): Promise<string | null> {
  try {
    const QRCode = (await import('qrcode')).default;
    return await QRCode.toDataURL(text, { width: 120, margin: 1 });
  } catch {
    return null;
  }
}

// ─── Resolve placeholders no texto ────────────────────────────
function resolveText(template: string, dados: CertDados, dataEmissao: string): string {
  return template
    .replace(/{NOME}/g,         dados.nome)
    .replace(/{EVENTO}/g,       dados.evento)
    .replace(/{DATA_EVENTO}/g,  dados.data_evento)
    .replace(/{CARGO}/g,        dados.cargo ?? '')
    .replace(/{CAMPO}/g,        dados.campo ?? '')
    .replace(/{SUPERVISAO}/g,   dados.supervisao ?? '')
    .replace(/{CODIGO}/g,       dados.codigo)
    .replace(/{DATA_EMISSAO}/g, dataEmissao);
}

// ─── Gera certificado PDF ─────────────────────────────────────
export async function gerarCertificadoPDF(
  config: CertConfig,
  dados:  CertDados,
  action: 'save' | 'blob' | 'open' = 'save'
): Promise<Blob | void> {

  const isLandscape = config.orientacao !== 'portrait';
  const doc = new jsPDF({
    orientation: config.orientacao,
    unit:        'mm',
    format:      'a4',
    compress:    true,
  });

  const pageW     = isLandscape ? 297 : 210;
  const pageH     = isLandscape ? 210 : 297;
  const cx        = pageW / 2;
  const margin    = 20;
  const textW     = pageW - margin * 2;
  const fontSize  = Math.max(10, Math.min(config.fonte_tamanho, 28));

  const hoje        = new Date();
  const dataEmissao = hoje.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });

  // ── 1. Background ──────────────────────────────────────────
  const hasArte = !!config.arte_url;
  if (hasArte) {
    const bg = await loadImageBase64(config.arte_url!);
    if (bg) {
      doc.addImage(bg.data, bg.format, 0, 0, pageW, pageH);
    } else {
      // Arte não carregou — fundo padrão
      desenharFundoPadrao(doc, pageW, pageH);
    }
  } else {
    desenharFundoPadrao(doc, pageW, pageH);
  }

  // ── 2. Cor do texto (branco com arte, escuro sem) ──────────
  // Cor principal (nome, cabeçalho)
  const [mr, mg, mb]: [number, number, number] = hasArte ? [255, 255, 255] : [26, 26, 26];
  // Cor secundária (texto, detalhes)
  const [sr, sg, sb]: [number, number, number] = hasArte ? [230, 230, 230] : [60, 60, 60];
  // Cor tênue (rodapé)
  const [tr2, tg2, tb2]: [number, number, number] = hasArte ? [200, 200, 200] : [120, 120, 120];

  // ── 3. Texto principal com split de {NOME} ─────────────────
  const NOME_MARK = '\x00NOME\x00';
  const textoComMark = config.texto_corpo
    .replace(/{NOME}/g, NOME_MARK)
    .replace(/{EVENTO}/g,       dados.evento)
    .replace(/{DATA_EVENTO}/g,  dados.data_evento)
    .replace(/{CARGO}/g,        dados.cargo ?? '')
    .replace(/{CAMPO}/g,        dados.campo ?? '')
    .replace(/{SUPERVISAO}/g,   dados.supervisao ?? '')
    .replace(/{CODIGO}/g,       dados.codigo)
    .replace(/{DATA_EMISSAO}/g, dataEmissao);

  const partes       = textoComMark.split(NOME_MARK);
  const textoAntes   = partes[0]?.trim() ?? '';
  const textoDepois  = partes[1]?.trim() ?? '';

  // Ponto de partida vertical
  let currentY = pageH * 0.28;

  // Texto antes do nome
  if (textoAntes) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(sr, sg, sb);
    const linhas = doc.splitTextToSize(textoAntes, textW);
    doc.text(linhas, cx, currentY, { align: 'center' });
    currentY += linhas.length * fontSize * 0.45 + 5;
  }

  // Nome — destaque
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize + 10);
  doc.setTextColor(mr, mg, mb);
  const nomeLinhas = doc.splitTextToSize(dados.nome.toUpperCase(), textW);
  doc.text(nomeLinhas, cx, currentY, { align: 'center' });
  currentY += nomeLinhas.length * (fontSize + 10) * 0.45 + 6;

  // Texto depois do nome
  if (textoDepois) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fontSize);
    doc.setTextColor(sr, sg, sb);
    const linhas = doc.splitTextToSize(textoDepois, textW);
    doc.text(linhas, cx, currentY, { align: 'center' });
    currentY += linhas.length * fontSize * 0.45 + 6;
  }

  // ── 4. Detalhes (cargo, supervisão, campo) ─────────────────
  const detalhes = [dados.cargo, dados.supervisao, dados.campo].filter(Boolean).join(' • ');
  if (detalhes) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(11);
    doc.setTextColor(sr, sg, sb);
    doc.text(detalhes, cx, currentY, { align: 'center' });
    currentY += 12;
  }

  // ── 5. QR Code — canto inferior direito ───────────────────
  const qrSize = 22;
  const qrX    = pageW - qrSize - 8;
  const qrY    = pageH - qrSize - 12;

  const qrBase64 = await gerarQRBase64(dados.validacao_url);
  if (qrBase64) {
    doc.addImage(qrBase64, 'PNG', qrX, qrY, qrSize, qrSize);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(tr2, tg2, tb2);
    doc.text('Validar certificado', qrX + qrSize / 2, qrY - 2, { align: 'center' });
    doc.text(dados.codigo, qrX + qrSize / 2, qrY + qrSize + 3.5, { align: 'center' });
  } else {
    // Fallback: código como texto
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(tr2, tg2, tb2);
    doc.text(`Código: ${dados.codigo}`, pageW - margin, pageH - 8, { align: 'right' });
  }

  // ── 6. Assinatura / rodapé ─────────────────────────────────
  const assinaturaX   = pageW * 0.35; // centro-esquerdo
  const assinaturaMaxW = pageW * 0.45;
  const rodapeBaseY   = pageH - 18;

  if (config.assinatura_nome) {
    // Linha de assinatura (traço)
    doc.setDrawColor(sr, sg, sb);
    doc.setLineWidth(0.3);
    doc.line(assinaturaX - assinaturaMaxW / 2, rodapeBaseY - 8,
             assinaturaX + assinaturaMaxW / 2, rodapeBaseY - 8);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(mr, mg, mb);
    doc.text(config.assinatura_nome, assinaturaX, rodapeBaseY - 3, { align: 'center' });

    if (config.assinatura_cargo) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9);
      doc.setTextColor(sr, sg, sb);
      doc.text(config.assinatura_cargo, assinaturaX, rodapeBaseY + 3, { align: 'center' });
    }
  }

  if (config.rodape_texto) {
    const rodapeResolvido = resolveText(config.rodape_texto, dados, dataEmissao);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(tr2, tg2, tb2);
    doc.text(rodapeResolvido, cx, pageH - 5, { align: 'center' });
  }

  // ── 7. Output ─────────────────────────────────────────────
  const nomeArquivo = `certificado-${dados.codigo}.pdf`;
  if (action === 'blob') {
    return doc.output('blob');
  } else if (action === 'open') {
    const blob = doc.output('blob');
    const url  = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } else {
    doc.save(nomeArquivo);
  }
}

// ─── Fundo padrão (sem arte) ──────────────────────────────────
function desenharFundoPadrao(doc: jsPDF, pageW: number, pageH: number) {
  // Fundo creme
  doc.setFillColor(252, 248, 240);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Bordas decorativas
  doc.setDrawColor(180, 145, 60);
  doc.setLineWidth(1.5);
  doc.rect(5, 5, pageW - 10, pageH - 10, 'S');

  doc.setLineWidth(0.4);
  doc.rect(8, 8, pageW - 16, pageH - 16, 'S');

  // Cantos decorativos
  const corner = 8;
  const cs = 6;
  [[corner, corner], [pageW - corner, corner], [corner, pageH - corner], [pageW - corner, pageH - corner]].forEach(([x, y]) => {
    doc.setFillColor(180, 145, 60);
    doc.circle(x, y, cs / 4, 'F');
  });
}
