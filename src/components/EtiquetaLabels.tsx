'use client';

import { useRef, useEffect } from 'react';
import { buildUrl, getPublicBaseUrl } from '@/lib/urls';

// ─── Constantes ───────────────────────────────────────────────
const DEPT_COLOR: Record<string, string> = {
  AGO: '#0D2B4E', UMADESPA: '#7D6608', COADESPA: '#1A5632',
  SEIADEPA: '#6C1B3C', AVULSO: '#2C3E50',
};

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  pago:      { label: 'PAGO',      color: '#059669' },
  pendente:  { label: 'PENDENTE',  color: '#d97706' },
  isento:    { label: 'ISENTO',    color: '#2563eb' },
  cancelado: { label: 'CANCELADO', color: '#dc2626' },
};

// ─── Interfaces públicas ──────────────────────────────────────
export interface EtiquetaInscricao {
  id: string;
  nome_inscrito: string;
  status_pagamento: string;
  tipo_inscricao?: string | null;
  hospedagem?: boolean;
  alimentacao?: boolean;
  brinde?: boolean;
  qr_code?: string | null;
  numero_cama?: string | null;
  tipo_cama?: string | null;
  hosp_status?: string | null;
  nome_alojamento?: string | null;
  /** Identifica fluxos especiais, ex: 'equipe_rapida' */
  origem?: string | null;
  /** Nome da equipe extraído de observacoes quando origem='equipe_rapida' */
  equipe_label?: string | null;
}

export interface EtiquetaEvento {
  nome: string;
  departamento: string;
}

// ─── QR Code canvas ───────────────────────────────────────────
export function QRCodeCanvas({ value, sizePx }: { value: string; sizePx: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!value || !ref.current) return;
    import('qrcode').then(QRCode => {
      QRCode.toCanvas(ref.current!, value, {
        width: sizePx, margin: 0,
        color: { dark: '#000000', light: '#ffffff' },
      });
    });
  }, [value, sizePx]);
  return <canvas ref={ref} width={sizePx} height={sizePx} style={{ display: 'block' }} />;
}

function resolveQrValue(raw: string): string {
  if (!raw) return '';
  if (raw.startsWith('http://') || raw.startsWith('https://')) return raw;
  return buildUrl(getPublicBaseUrl(), `/qr/${raw}`);
}

// ─── Etiqueta A4 — 99,1 × 34 mm (CA4362 / Colacril) ─────────
export function EtiquetaLabelA4({
  inscricao, evento, nomeSup, nomeCampo,
}: {
  inscricao: EtiquetaInscricao; evento: EtiquetaEvento; nomeSup: string; nomeCampo: string;
}) {
  const deptColor = DEPT_COLOR[evento.departamento] ?? DEPT_COLOR.AVULSO;
  const statusCfg = STATUS_CFG[inscricao.status_pagamento] ?? { label: inscricao.status_pagamento.toUpperCase(), color: '#6b7280' };
  const qr = resolveQrValue(inscricao.qr_code ?? inscricao.id);

  return (
    <div style={{
      width: '99.1mm', height: '34mm',
      border: '0.3mm solid #d1d5db',
      overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif',
      backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box', breakInside: 'avoid', pageBreakInside: 'avoid',
    }}>
      {/* ── Cabeçalho ── */}
      <div style={{
        backgroundColor: deptColor, height: '8mm',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 2mm', flexShrink: 0, gap: '2mm',
      }}>
        <div style={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: '1.5mm', overflow: 'hidden' }}>
          <span style={{ color: '#F39C12', fontSize: '5pt', fontWeight: 800, letterSpacing: '0.5px', whiteSpace: 'nowrap', textTransform: 'uppercase', flexShrink: 0 }}>
            {evento.departamento}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: '5pt', flexShrink: 0 }}>|</span>
          <span style={{ color: '#ffffff', fontSize: '5.5pt', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {evento.nome}
          </span>
        </div>
        <div style={{
          backgroundColor: '#ffffff', color: statusCfg.color,
          fontSize: '4.5pt', fontWeight: 800, padding: '0.4mm 1.5mm',
          borderRadius: '1mm', flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          {statusCfg.label}
        </div>
      </div>

      {/* ── Corpo ── */}
      <div style={{ flex: 1, display: 'flex', padding: '1.5mm 2mm', gap: '2mm', overflow: 'hidden', alignItems: 'center' }}>
        {/* Texto */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{
            fontSize: '9pt', fontWeight: 900, color: '#111827',
            margin: '0 0 0.8mm', lineHeight: 1.1,
            overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
          }}>
            {inscricao.nome_inscrito}
          </p>
          <p style={{ fontSize: '6pt', fontWeight: 600, color: '#374151', margin: '0 0 0.3mm', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {nomeSup}
          </p>
          <p style={{ fontSize: '5.5pt', color: '#6b7280', margin: '0 0 1.2mm', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
            {nomeCampo}
          </p>
          <div style={{ display: 'flex', gap: '1mm', overflow: 'hidden' }}>
            {inscricao.tipo_inscricao && (
              <span style={{ fontSize: '4.5pt', color: deptColor, fontWeight: 700, backgroundColor: '#f3f4f6', padding: '0.3mm 1mm', borderRadius: '0.8mm', whiteSpace: 'nowrap' }}>
                {inscricao.tipo_inscricao}
              </span>
            )}
            {inscricao.hospedagem   && <span style={{ fontSize: '4.5pt', color: '#1e40af', backgroundColor: '#eff6ff', padding: '0.3mm 1mm', borderRadius: '0.8mm', whiteSpace: 'nowrap' }}>Hosp.</span>}
            {inscricao.alimentacao  && <span style={{ fontSize: '4.5pt', color: '#065f46', backgroundColor: '#ecfdf5', padding: '0.3mm 1mm', borderRadius: '0.8mm', whiteSpace: 'nowrap' }}>Alim.</span>}
            {inscricao.brinde       && <span style={{ fontSize: '4.5pt', color: '#7c3aed', backgroundColor: '#ede9fe', padding: '0.3mm 1mm', borderRadius: '0.8mm', whiteSpace: 'nowrap' }}>Brin.</span>}
          </div>
        </div>

        {/* QR Code */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <QRCodeCanvas value={qr} sizePx={56} />
          <p style={{ fontSize: '3.5pt', color: '#9ca3af', margin: '0.5mm 0 0', textAlign: 'center', letterSpacing: '0.2px' }}>
            {qr.slice(-6).toUpperCase()}
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Etiqueta Térmica — 85 × 30 mm ─────────────────────────
export function EtiquetaLabelThermal({
  inscricao, evento, nomeSup, nomeCampo,
}: {
  inscricao: EtiquetaInscricao; evento: EtiquetaEvento; nomeSup: string; nomeCampo: string;
}) {
  const deptColor = DEPT_COLOR[evento.departamento] ?? DEPT_COLOR.AVULSO;
  const statusCfg = STATUS_CFG[inscricao.status_pagamento] ?? { label: inscricao.status_pagamento.toUpperCase(), color: '#6b7280' };
  const qr = resolveQrValue(inscricao.qr_code ?? inscricao.id);
  const temBadge = inscricao.hospedagem || inscricao.alimentacao || inscricao.brinde;

  return (
    <div style={{
      width: '85mm', height: '30mm',
      border: 'none',
      overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif',
      backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box', breakInside: 'avoid', pageBreakInside: 'avoid',
    }}>
      {/* ── Cabeçalho ── */}
      <div style={{
        backgroundColor: deptColor, height: '9mm',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 2.5mm', flexShrink: 0, gap: '2mm',
      }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{
            color: '#F39C12', fontSize: '4.5pt', fontWeight: 800,
            letterSpacing: '0.8px', margin: 0, textTransform: 'uppercase', lineHeight: 1.3,
          }}>
            {evento.departamento}
          </p>
          <p style={{
            color: '#ffffff', fontSize: '5pt', fontWeight: 600,
            margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', lineHeight: 1.3,
          }}>
            {evento.nome}
          </p>
        </div>
        <div style={{
          backgroundColor: '#ffffff', color: statusCfg.color,
          fontSize: '4pt', fontWeight: 800, padding: '0.5mm 1.5mm',
          borderRadius: '1mm', flexShrink: 0, whiteSpace: 'nowrap',
        }}>
          {statusCfg.label}
        </div>
      </div>

      {/* ── Corpo ── */}
      <div style={{
        flex: 1, display: 'flex',
        padding: `1.5mm 2mm ${temBadge ? '1mm' : '1.5mm'}`,
        gap: '2mm', overflow: 'hidden', minHeight: 0,
      }}>
        {/* Texto */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          <p style={{
            fontSize: '10pt', fontWeight: 900, color: '#111827',
            margin: '0 0 1mm', lineHeight: 1.15,
            maxHeight: '2.3em', overflow: 'hidden', wordBreak: 'break-word',
          }}>
            {inscricao.nome_inscrito}
          </p>
          <p style={{
            fontSize: '6pt', fontWeight: 700, color: '#374151',
            margin: '0 0 0.4mm', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {nomeSup}
          </p>
          <p style={{
            fontSize: '5.5pt', color: '#6b7280',
            margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>
            {nomeCampo}
          </p>
          {inscricao.tipo_inscricao && (
            <span style={{
              display: 'inline-block', marginTop: '1.2mm',
              fontSize: '5pt', color: deptColor, fontWeight: 700,
              backgroundColor: '#f3f4f6', padding: '0.4mm 1.5mm', borderRadius: '1mm',
              alignSelf: 'flex-start',
            }}>
              {inscricao.tipo_inscricao}
            </span>
          )}
        </div>

        {/* QR Code */}
        <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <QRCodeCanvas value={qr} sizePx={84} />
          <p style={{ fontSize: '4pt', color: '#9ca3af', margin: '0.5mm 0 0', letterSpacing: '0.3px', textAlign: 'center' }}>
            {qr.slice(-6).toUpperCase()}
          </p>
        </div>
      </div>

      {/* ── Rodapé de badges ── */}
      {temBadge && (
        <div style={{
          borderTop: '0.3mm solid #e5e7eb',
          padding: '1mm 2.5mm',
          display: 'flex', gap: '1.5mm', alignItems: 'center',
          flexShrink: 0, backgroundColor: '#f9fafb',
        }}>
          {inscricao.hospedagem  && (
            <span style={{ fontSize: '5pt', color: '#1e40af', backgroundColor: '#eff6ff', padding: '0.3mm 1.5mm', borderRadius: '1mm', fontWeight: 600 }}>
              🛏 Hospedagem
            </span>
          )}
          {inscricao.alimentacao && (
            <span style={{ fontSize: '5pt', color: '#065f46', backgroundColor: '#ecfdf5', padding: '0.3mm 1.5mm', borderRadius: '1mm', fontWeight: 600 }}>
              🍽 Alimentação
            </span>
          )}
          {inscricao.brinde      && (
            <span style={{ fontSize: '5pt', color: '#7c3aed', backgroundColor: '#ede9fe', padding: '0.3mm 1.5mm', borderRadius: '1mm', fontWeight: 600 }}>
              🎁 Brinde
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Previews escalados para tela ─────────────────────────────
// Usa transform:scale para manter proporção exata sem distorção.
const PX_PER_MM = 3.7795275591; // 96 dpi

export function EtiquetaPreviewA4({
  inscricao, evento, nomeSup, nomeCampo, scale = 0.68,
}: {
  inscricao: EtiquetaInscricao; evento: EtiquetaEvento;
  nomeSup: string; nomeCampo: string; scale?: number;
}) {
  const naturalW = 99.1 * PX_PER_MM;
  const naturalH = 34  * PX_PER_MM;
  return (
    <div style={{
      width: naturalW * scale, height: naturalH * scale,
      overflow: 'hidden', position: 'relative', flexShrink: 0,
    }}>
      <div style={{ transformOrigin: 'top left', transform: `scale(${scale})`, position: 'absolute', top: 0, left: 0 }}>
        <EtiquetaLabelA4 inscricao={inscricao} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} />
      </div>
    </div>
  );
}

export function EtiquetaPreviewThermal({
  inscricao, evento, nomeSup, nomeCampo, scale = 0.68,
}: {
  inscricao: EtiquetaInscricao; evento: EtiquetaEvento;
  nomeSup: string; nomeCampo: string; scale?: number;
}) {
  const naturalW = 100 * PX_PER_MM;
  const naturalH = 30  * PX_PER_MM;
  return (
    <div style={{
      width: naturalW * scale, height: naturalH * scale,
      overflow: 'hidden', position: 'relative', flexShrink: 0,
    }}>
      <div style={{ transformOrigin: 'top left', transform: `scale(${scale})`, position: 'absolute', top: 0, left: 0 }}>
        <EtiquetaLabelThermal inscricao={inscricao} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} />
      </div>
    </div>
  );
}

// ─── Etiqueta AGO — departamento específico ───────────────────
export interface EtiquetaInscricaoAGO extends EtiquetaInscricao {
  matricula?: string | null;
  numero_cama?: string | null;
  tipo_cama?: string | null;
  hosp_status?: string | null;
  nome_alojamento?: string | null;
}

export function EtiquetaAGO({
  inscricao, evento, nomeSup, nomeCampo, variant,
}: {
  inscricao: EtiquetaInscricaoAGO;
  evento: EtiquetaEvento;
  nomeSup: string;
  nomeCampo: string;
  variant: 'thermal' | 'a4';
}) {
  const isThermal = variant === 'thermal';
  const qr        = resolveQrValue(inscricao.qr_code ?? inscricao.id);
  const temHosp   = !!(inscricao.numero_cama && (inscricao.hosp_status === 'confirmada' || inscricao.hosp_status === 'alocada' || inscricao.hosp_status === 'checkin_realizado'));
  const statusCfg = STATUS_CFG[inscricao.status_pagamento] ?? { label: inscricao.status_pagamento.toUpperCase(), color: '#6b7280' };
  const matricula = inscricao.matricula || '—';

  const W        = isThermal ? '85mm'  : '99.1mm';
  const H        = isThermal ? '30mm'  : '34mm';
  const HEADER_H = '7mm';
  const QR_PX    = isThermal ? 84       : 56;
  const QR_W     = isThermal ? '26mm'   : '20mm';
  const FOOTER_H = '5mm';

  // ── Equipe Rápida: delega para o layout dedicado ─────────────
  if (inscricao.origem === 'equipe_rapida') {
    return (
      <EtiquetaDepartamento
        inscricao={inscricao}
        nomeSup=""
        nomeCampo=""
        variant={variant}
      />
    );
  }

  if (isThermal) {
    return (
      <div style={{
        width: W, height: H,
        border: 'none',
        overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif',
        backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column',
        boxSizing: 'border-box', breakInside: 'avoid', pageBreakInside: 'avoid',
      }}>
        {/* Corpo principal */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, overflow: 'hidden' }}>
          {/* Coluna QR */}
          <div style={{
            width: QR_W, flexShrink: 0,
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '0.5mm 0.4mm', gap: '0.3mm',
          }}>
            <QRCodeCanvas value={qr} sizePx={QR_PX} />
            <p style={{ fontSize: '3.4pt', color: '#9ca3af', margin: 0, textAlign: 'center', letterSpacing: '0.5px' }}>
              {qr.slice(-6).toUpperCase()}
            </p>
          </div>

          {/* Coluna informações */}
          <div style={{
            flex: 1, minWidth: 0,
            padding: '0.5mm 1.5mm',
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center', gap: '0.8mm',
          }}>
            {/* Nome */}
            <div style={{ marginBottom: '0.4mm' }}>
              <p style={{
                fontSize: '11.6pt', fontWeight: 950, color: '#111827',
                margin: 0, lineHeight: 1.05,
                overflow: 'hidden', textOverflow: 'ellipsis',
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
              }}>
                {inscricao.nome_inscrito}
              </p>
            </div>

            {/* Matrícula, Supervisão e Campo em fonte maior e na mesma linha */}
            <p style={{ fontSize: '7.5pt', color: '#111827', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.1 }}>
              <span style={{ fontWeight: 800, color: '#6b7280' }}>MATRÍCULA:</span>{' '}
              <strong style={{ fontWeight: 900, color: '#0D2B4E' }}>{matricula}</strong>
            </p>

            <p style={{ fontSize: '7.5pt', color: '#111827', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.1 }}>
              <span style={{ fontWeight: 800, color: '#6b7280' }}>SUPERVISÃO:</span>{' '}
              <strong style={{ fontWeight: 800 }}>{nomeSup}</strong>
            </p>

            <p style={{ fontSize: '7.5pt', color: '#111827', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.1 }}>
              <span style={{ fontWeight: 800, color: '#6b7280' }}>CAMPO:</span>{' '}
              <strong style={{ fontWeight: 800 }}>{nomeCampo}</strong>
            </p>
          </div>
        </div>

        {/* Rodapé Hospedagem */}
        {temHosp && (
          <div style={{
            backgroundColor: '#111827', height: '4.5mm',
            display: 'flex', alignItems: 'center',
            padding: '0 2.5mm', gap: '3mm', flexShrink: 0,
          }}>
            <span style={{
              color: '#F39C12', fontSize: '4.2pt',
              fontWeight: 900, whiteSpace: 'nowrap', textTransform: 'uppercase',
            }}>HOSP: {inscricao.numero_cama}</span>
            {inscricao.nome_alojamento && (
              <>
                <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '5pt' }}>|</span>
                <span style={{
                  color: '#ffffff', fontSize: '4.2pt',
                  fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>{inscricao.nome_alojamento}</span>
              </>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{
      width: W, height: H,
      border: '0.4mm solid #1e293b',
      overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif',
      backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box', breakInside: 'avoid', pageBreakInside: 'avoid',
    }}>

      {/* ── Cabeçalho ── */}
      <div style={{
        backgroundColor: '#0D2B4E', height: HEADER_H,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 2.5mm', flexShrink: 0, gap: '1.5mm',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5mm', flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <span style={{
            color: '#F39C12', fontSize: '5pt',
            fontWeight: 900, letterSpacing: '1px', flexShrink: 0, textTransform: 'uppercase',
          }}>AGO</span>
          <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '5pt', flexShrink: 0 }}>|</span>
          <span style={{
            color: '#ffffff', fontSize: '5pt',
            fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{evento.nome}</span>
        </div>
        <span style={{
          backgroundColor: '#ffffff', color: statusCfg.color,
          fontSize: '3.8pt', fontWeight: 800,
          padding: '0.5mm 1.5mm', borderRadius: '1mm', flexShrink: 0, whiteSpace: 'nowrap',
        }}>{statusCfg.label}</span>
      </div>

      {/* ── Corpo ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Coluna QR */}
        <div style={{
          width: QR_W, flexShrink: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          borderRight: '0.3mm solid #e5e7eb', padding: '1.5mm',
        }}>
          <QRCodeCanvas value={qr} sizePx={QR_PX} />
          <p style={{ fontSize: '3.5pt', color: '#9ca3af', margin: '0.5mm 0 0', textAlign: 'center', letterSpacing: '0.5px' }}>
            {qr.slice(-6).toUpperCase()}
          </p>
        </div>

        {/* Coluna informações */}
        <div style={{
          flex: 1, minWidth: 0,
          padding: '1mm 2mm',
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center', gap: '0.8mm',
        }}>
          {/* Nome */}
          <div>
            <p style={{ fontSize: '3.8pt', color: '#9ca3af', margin: '0 0 0.3mm', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              NOME
            </p>
            <p style={{
              fontSize: '7.5pt',
              fontWeight: 900, color: '#111827', margin: 0, lineHeight: 1.1,
              overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
            }}>{inscricao.nome_inscrito}</p>
          </div>

          {/* Matrícula + Supervisão */}
          <div style={{ display: 'flex', gap: '2.5mm', overflow: 'hidden' }}>
            <div style={{ flexShrink: 0 }}>
              <p style={{ fontSize: '3.8pt', color: '#9ca3af', margin: '0 0 0.2mm', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                MATRÍCULA
              </p>
              <p style={{ fontSize: '5.5pt', fontWeight: 800, color: '#0D2B4E', margin: 0 }}>
                {matricula}
              </p>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: '3.8pt', color: '#9ca3af', margin: '0 0 0.2mm', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                SUPERVISÃO
              </p>
              <p style={{
                fontSize: '4.5pt', fontWeight: 700, color: '#374151', margin: 0,
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{nomeSup}</p>
            </div>
          </div>

          {/* Campo */}
          <div>
            <p style={{ fontSize: '3.8pt', color: '#9ca3af', margin: '0 0 0.2mm', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
              CAMPO
            </p>
            <p style={{
              fontSize: '4.5pt', fontWeight: 700, color: '#374151', margin: 0,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>{nomeCampo}</p>
          </div>
        </div>
      </div>

      {/* ── Rodapé hospedagem (somente se status=confirmada) ── */}
      {temHosp && (
        <div style={{
          backgroundColor: '#111827', height: FOOTER_H,
          display: 'flex', alignItems: 'center',
          padding: '0 2.5mm', gap: '3mm', flexShrink: 0,
        }}>
          <span style={{
            color: '#F39C12', fontSize: '4pt',
            fontWeight: 900, whiteSpace: 'nowrap', textTransform: 'uppercase',
          }}>HOSP: {inscricao.numero_cama}</span>
          {inscricao.nome_alojamento && (
            <>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '5pt' }}>|</span>
              <span style={{
                color: '#ffffff', fontSize: '4pt',
                fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{inscricao.nome_alojamento}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function EtiquetaPreviewAGO({
  inscricao, evento, nomeSup, nomeCampo, variant, scale = 0.68,
}: {
  inscricao: EtiquetaInscricaoAGO;
  evento: EtiquetaEvento;
  nomeSup: string; nomeCampo: string;
  variant: 'thermal' | 'a4';
  scale?: number;
}) {
  const [natW, natH] = variant === 'thermal'
    ? [85 * PX_PER_MM, 30 * PX_PER_MM]
    : [99.1 * PX_PER_MM, 34  * PX_PER_MM];
  return (
    <div style={{ width: natW * scale, height: natH * scale, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
      <div style={{ transformOrigin: 'top left', transform: `scale(${scale})`, position: 'absolute', top: 0, left: 0 }}>
        <EtiquetaAGO inscricao={inscricao} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} variant={variant} />
      </div>
    </div>
  );
}

// ─── Etiqueta Departamento — modelo visual simples (não-AGO) ──
// Layout: QR grande à esquerda | NOME / SUPERVISÃO / CAMPO à direita
// Variantes: 'a4' (99,1×34 mm, CA4362) e 'thermal' (100×30 mm)
export function EtiquetaDepartamento({
  inscricao, nomeSup, nomeCampo, variant,
}: {
  inscricao: EtiquetaInscricao;
  evento?: EtiquetaEvento;
  nomeSup: string;
  nomeCampo: string;
  variant: 'thermal' | 'a4';
}) {
  const isThermal = variant === 'thermal';
  const qr        = resolveQrValue(inscricao.qr_code ?? inscricao.id);

  const W      = isThermal ? '85mm'  : '99.1mm';
  const H      = isThermal ? '30mm'  : '34mm';
  const QR_PX  = isThermal ? 84      : 60;
  const QR_W   = isThermal ? '26mm'  : '24mm';

  const NOME_FS   = isThermal ? '11.4pt'  : '8.5pt';
  const FIELD_FS  = isThermal ? '6.2pt'   : '5pt';
  const LABEL_FS  = '3.6pt';
  const GAP       = isThermal ? '0.5mm'   : '1.2mm';
  const PAD_BODY  = isThermal ? '0.9mm 1.4mm' : '1.5mm 2.5mm';
  const FIELD_LINES = isThermal ? 2 : 1;

  const temHosp = !!(inscricao.numero_cama && (inscricao.hosp_status === 'confirmada' || inscricao.hosp_status === 'alocada' || inscricao.hosp_status === 'checkin_realizado'));
  const isEquipeRapida = inscricao.origem === 'equipe_rapida';

  // ── Layout alternativo: Equipe Rápida ──────────────────────────
  if (isEquipeRapida) {
    const equipeNome = inscricao.equipe_label ?? inscricao.tipo_inscricao ?? 'EQUIPE';
    return (
      <div style={{
        width: W, height: H,
        border: isThermal ? 'none' : '0.35mm solid #d1d5db',
        overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif',
        backgroundColor: '#ffffff', display: 'flex', flexDirection: 'row',
        boxSizing: 'border-box', breakInside: 'avoid', pageBreakInside: 'avoid',
      }}>
        {/* QR Code */}
        <div style={{
          width: QR_W, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          borderRight: isThermal ? 'none' : '0.3mm solid #e5e7eb',
          padding: isThermal ? '0.5mm 0.4mm' : '2mm',
          gap: '0.4mm',
        }}>
          <QRCodeCanvas value={qr} sizePx={QR_PX} />
          <p style={{
            fontSize: '3.2pt', color: '#adb5bd', margin: 0,
            letterSpacing: '0.5px', textAlign: 'center', lineHeight: 1,
          }}>
            {qr.slice(-6).toUpperCase()}
          </p>
        </div>
        {/* Texto centralizado */}
        <div style={{
          flex: 1, minWidth: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          padding: isThermal ? '1mm 2mm' : '1.5mm 2.5mm',
          gap: isThermal ? '1mm' : '1.5mm',
          textAlign: 'center',
        }}>
          {/* Badge da equipe */}
          <div style={{
            backgroundColor: '#7c3aed',
            borderRadius: isThermal ? '1mm' : '1.2mm',
            padding: isThermal ? '0.5mm 2mm' : '0.6mm 2.5mm',
            display: 'inline-block',
          }}>
            <p style={{
              fontSize: isThermal ? '8pt' : '6.5pt',
              fontWeight: 900,
              color: '#ffffff',
              margin: 0,
              letterSpacing: '0.5px',
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}>
              {equipeNome}
            </p>
          </div>
          {/* Nome do colaborador */}
          <p style={{
            fontSize: isThermal ? '10.5pt' : '8pt',
            fontWeight: 900,
            color: '#111827',
            margin: 0,
            lineHeight: 1.1,
            overflow: 'hidden',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            textAlign: 'center',
          }}>
            {inscricao.nome_inscrito}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      width: W, height: H,
      border: isThermal ? 'none' : '0.35mm solid #d1d5db',
      overflow: 'hidden', fontFamily: 'Arial, Helvetica, sans-serif',
      backgroundColor: '#ffffff', display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box', breakInside: 'avoid', pageBreakInside: 'avoid',
    }}>
      {/* ── Corpo ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'row', minHeight: 0, overflow: 'hidden' }}>
        {/* ── Coluna QR ── */}
        <div style={{
          width: QR_W, flexShrink: 0,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          borderRight: isThermal ? 'none' : '0.3mm solid #e5e7eb',
          padding: isThermal ? '0.5mm 0.4mm' : '2mm',
          gap: '0.4mm',
        }}>
          <QRCodeCanvas value={qr} sizePx={QR_PX} />
          <p style={{
            fontSize: '3.2pt', color: '#adb5bd', margin: 0,
            letterSpacing: '0.5px', textAlign: 'center', lineHeight: 1,
          }}>
            {qr.slice(-6).toUpperCase()}
          </p>
        </div>

        {/* ── Coluna informações ── */}
        <div style={{
          flex: 1, minWidth: 0,
          padding: PAD_BODY,
          display: 'flex', flexDirection: 'column',
          justifyContent: 'center', gap: isThermal ? '0.8mm' : GAP,
        }}>

          {/* NOME */}
          <div style={{ marginBottom: isThermal ? '0.4mm' : 0 }}>
            {!isThermal && (
              <p style={{
                fontSize: LABEL_FS, color: '#9ca3af', margin: '0 0 0.4mm',
                fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
              }}>
                NOME
              </p>
            )}
            <p style={{
              fontSize: NOME_FS, fontWeight: 900, color: '#111827',
              margin: 0, lineHeight: 1.1,
              overflow: 'hidden', textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}>
              {inscricao.nome_inscrito}
            </p>
          </div>

          {isThermal ? (
            <>
              {/* SUPERVISÃO */}
              <p style={{ fontSize: '7.5pt', color: '#111827', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.1 }}>
                <span style={{ fontWeight: 800, color: '#6b7280' }}>SUPERVISÃO:</span>{' '}
                <strong style={{ fontWeight: 800 }}>{nomeSup}</strong>
              </p>

              {/* CAMPO */}
              <p style={{ fontSize: '7.5pt', color: '#111827', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.1 }}>
                <span style={{ fontWeight: 800, color: '#6b7280' }}>CAMPO:</span>{' '}
                <strong style={{ fontWeight: 800 }}>{nomeCampo}</strong>
              </p>
            </>
          ) : (
            <>
              {/* SUPERVISÃO */}
              <div>
                <p style={{
                  fontSize: LABEL_FS, color: '#9ca3af', margin: '0 0 0.3mm',
                  fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  SUPERVISÃO
                </p>
                <p style={{
                  fontSize: FIELD_FS, fontWeight: 700, color: '#111827',
                  margin: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: FIELD_LINES, WebkitBoxOrient: 'vertical',
                }}>
                  {nomeSup}
                </p>
              </div>

              {/* CAMPO */}
              <div>
                <p style={{
                  fontSize: LABEL_FS, color: '#9ca3af', margin: '0 0 0.3mm',
                  fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px',
                }}>
                  CAMPO
                </p>
                <p style={{
                  fontSize: FIELD_FS, fontWeight: 700, color: '#111827',
                  margin: 0, overflow: 'hidden', textOverflow: 'ellipsis',
                  display: '-webkit-box', WebkitLineClamp: FIELD_LINES, WebkitBoxOrient: 'vertical',
                }}>
                  {nomeCampo}
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Rodapé Hospedagem */}
      {temHosp && (
        <div style={{
          backgroundColor: '#111827', height: isThermal ? '4.5mm' : '5mm',
          display: 'flex', alignItems: 'center',
          padding: '0 2.5mm', gap: '3mm', flexShrink: 0,
        }}>
          <span style={{
            color: '#F39C12', fontSize: isThermal ? '4.2pt' : '4pt',
            fontWeight: 900, whiteSpace: 'nowrap', textTransform: 'uppercase',
          }}>HOSP: {inscricao.numero_cama}</span>
          {inscricao.nome_alojamento && (
            <>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '5pt' }}>|</span>
              <span style={{
                color: '#ffffff', fontSize: isThermal ? '4.2pt' : '4pt',
                fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
              }}>{inscricao.nome_alojamento}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function EtiquetaPreviewDepartamento({
  inscricao, evento, nomeSup, nomeCampo, variant, scale = 0.68,
}: {
  inscricao: EtiquetaInscricao; evento: EtiquetaEvento;
  nomeSup: string; nomeCampo: string;
  variant: 'thermal' | 'a4'; scale?: number;
}) {
  const [natW, natH] = variant === 'thermal'
    ? [85 * PX_PER_MM, 30 * PX_PER_MM]
    : [99.1 * PX_PER_MM, 34  * PX_PER_MM];
  return (
    <div style={{ width: natW * scale, height: natH * scale, overflow: 'hidden', position: 'relative', flexShrink: 0 }}>
      <div style={{ transformOrigin: 'top left', transform: `scale(${scale})`, position: 'absolute', top: 0, left: 0 }}>
        <EtiquetaDepartamento inscricao={inscricao} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} variant={variant} />
      </div>
    </div>
  );
}
