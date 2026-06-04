import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import { substituirPlaceholdersCertificado } from './certificados-utils';

// Dimensões do canvas do editor (px)
const CANVAS_W = 840;
const CANVAS_H = 595;

// A4 landscape em mm
const PAGE_W = 297;
const PAGE_H = 210;

function loadImgBase64(url: string): Promise<{ data: string; format: string } | null> {
  return new Promise((resolve) => {
    try {
      if (!url) { resolve(null); return; }

      // Já é base64 data URL
      if (url.startsWith('data:')) {
        const match = url.match(/^data:image\/(\w+);base64,/);
        const fmt = match ? match[1].toUpperCase().replace('JPG', 'JPEG') : 'JPEG';
        resolve({ data: url, format: fmt });
        return;
      }

      // URL externa: carrega via canvas
      const img = new window.Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d');
        if (!ctx) { resolve(null); return; }
        ctx.drawImage(img, 0, 0);
        resolve({ data: c.toDataURL('image/jpeg', 0.95), format: 'JPEG' });
      };
      img.onerror = () => resolve(null);
      img.src = url;
    } catch {
      resolve(null);
    }
  });
}

export interface DadosCertificadoMembro {
  ministro_nome: string;
  matricula: string;
  cargo_ministerial: string;
  congregacao: string;
  data_consagracao?: string;
  presidente_nome?: string;
  nome_igreja?: string;
  data_emissao?: string;
  uniqueId?: string;  // unique_id do membro (para QR code)
  memberId?: string;  // id UUID do membro (fallback para QR code)
}

export interface TemplateCertificado {
  nome: string;
  backgroundUrl?: string;
  orientacao?: 'landscape' | 'portrait';
  elementos: Array<{
    id: string;
    tipo: 'texto' | 'logo' | 'imagem' | 'chapa' | 'foto-membro' | 'qrcode';
    x: number;
    y: number;
    largura: number;
    altura: number;
    visivel: boolean;
    texto?: string;
    fontSize?: number;
    cor?: string;
    fonte?: string;
    alinhamento?: 'left' | 'center' | 'right';
    negrito?: boolean;
    italico?: boolean;
    imagemUrl?: string;
    transparencia?: number;
  }>;
}

export async function gerarCertificadoMembroPDF(
  template: TemplateCertificado,
  dados: DadosCertificadoMembro
): Promise<void> {
  const orient = template.orientacao === 'portrait' ? 'portrait' : 'landscape';
  const pageW = orient === 'landscape' ? PAGE_W : PAGE_H;
  const pageH = orient === 'landscape' ? PAGE_H : PAGE_W;
  const scaleX = pageW / CANVAS_W;
  const scaleY = pageH / CANVAS_H;

  const pdf = new jsPDF({
    orientation: orient,
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  // Fundo
  if (template.backgroundUrl) {
    const bg = await loadImgBase64(template.backgroundUrl);
    if (bg) {
      pdf.addImage(bg.data, bg.format, 0, 0, pageW, pageH);
    }
  }

  // Elementos
  for (const el of template.elementos) {
    if (el.visivel === false) continue;

    const x = el.x * scaleX;
    const y = el.y * scaleY;
    const w = el.largura * scaleX;
    const h = el.altura * scaleY;

    if (el.tipo === 'texto' && el.texto) {
      const texto = substituirPlaceholdersCertificado(el.texto, dados as Record<string, any>);
      if (!texto) continue;

      // Cor
      let r = 0, g = 0, b = 0;
      if (el.cor && /^#[0-9a-fA-F]{6}$/.test(el.cor)) {
        r = parseInt(el.cor.slice(1, 3), 16);
        g = parseInt(el.cor.slice(3, 5), 16);
        b = parseInt(el.cor.slice(5, 7), 16);
      }
      pdf.setTextColor(r, g, b);

      // Fonte: px canvas ≈ pt PDF (escala 840px → 297mm ≈ 1px → 1pt)
      // 1px canvas ~ 0.3536mm; 1pt = 0.3528mm → conversão quase 1:1
      const fontSize = (el.fontSize || 12);
      pdf.setFontSize(fontSize);

      const style = el.negrito && el.italico ? 'bolditalic'
        : el.negrito ? 'bold'
        : el.italico ? 'italic'
        : 'normal';
      pdf.setFont('helvetica', style);

      const align = (el.alinhamento || 'left') as 'left' | 'center' | 'right';
      const textX = align === 'center' ? x + w / 2 : align === 'right' ? x + w : x;

      // Altura de linha em mm: fontSize pt * 0.3528 mm/pt * fator
      const lineH = fontSize * 0.3528 * 1.3;
      const lines = pdf.splitTextToSize(texto, w);
      lines.forEach((line: string, i: number) => {
        pdf.text(line, textX, y + lineH * (i + 1), { align });
      });

    } else if (['logo', 'imagem', 'foto-membro', 'chapa'].includes(el.tipo) && el.imagemUrl) {
      const img = await loadImgBase64(el.imagemUrl);
      if (img) {
        pdf.addImage(img.data, img.format, x, y, w, h);
      }
    } else if (el.tipo === 'qrcode') {
      // Gera QR code com a URL de autenticação do membro
      const uid = dados.uniqueId || dados.memberId;
      if (uid) {
        const appUrl = typeof window !== 'undefined' ? window.location.origin : 'https://siscomieadepa.org';
        const qrUrl = `${appUrl}/autentica_qrcode-05985642/${uid}`;
        try {
          const qrDataUrl = await QRCode.toDataURL(qrUrl, { errorCorrectionLevel: 'H', margin: 1, width: 256 });
          pdf.addImage(qrDataUrl, 'PNG', x, y, w, h);
        } catch {
          // QR falhou silenciosamente
        }
      }
    }
  }

  // Abre em nova aba
  const blob = pdf.output('blob');
  const objectUrl = URL.createObjectURL(blob);
  window.open(objectUrl, '_blank', 'noopener,noreferrer');
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

/** Busca o template cujo nome coincide com o cargo (case-insensitive, ignora acentos) */
export function encontrarTemplatePorCargo(
  templates: TemplateCertificado[],
  cargo: string
): TemplateCertificado | undefined {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const cargoNorm = norm(cargo);
  return templates.find((t) => norm(t.nome) === cargoNorm);
}
