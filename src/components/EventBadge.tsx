'use client';

import { useEffect, useRef } from 'react';

// ─── Tipos ────────────────────────────────────────────────────
export interface BadgeInscricao {
  id: string;
  nome_inscrito: string;
  cpf: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
  status_pagamento: string;
  hospedagem: boolean;
  alimentacao: boolean;
  brinde: boolean;
  qr_code: string | null;
  checkin_realizado: boolean;
}

export interface BadgeEvento {
  id: string;
  nome: string;
  departamento: string;
  data_inicio: string;
  data_fim: string;
  local: string | null;
  cidade: string | null;
  banner_url: string | null;
}

export type BadgeSize = 'small' | 'medium' | 'large';

interface EventBadgeProps {
  inscricao: BadgeInscricao;
  evento: BadgeEvento;
  nomeSup: string;
  nomeCampo: string;
  size?: BadgeSize;
  printMode?: boolean;
}

// ─── Cores por departamento ───────────────────────────────────
const DEPT_CONFIG: Record<string, { bg: string; text: string; accent: string; label: string }> = {
  AGO:      { bg: '#0D2B4E', text: '#FFFFFF', accent: '#F39C12', label: 'AGO' },
  UMADESPA: { bg: '#7D6608', text: '#FFFFFF', accent: '#F4D03F', label: 'UMADESPA' },
  COADESPA: { bg: '#1A5632', text: '#FFFFFF', accent: '#52BE80', label: 'COADESPA' },
  SEIADEPA: { bg: '#6C1B3C', text: '#FFFFFF', accent: '#E91E8C', label: 'SEIADEPA' },
  AVULSO:   { bg: '#2C3E50', text: '#FFFFFF', accent: '#95A5A6', label: 'AVULSO'   },
};

function getDept(dep: string) {
  return DEPT_CONFIG[dep] ?? DEPT_CONFIG.AVULSO;
}

const STATUS_PAG: Record<string, { label: string; cls: string }> = {
  pago:      { label: 'PAGO',      cls: 'bg-emerald-100 text-emerald-800' },
  pendente:  { label: 'PENDENTE',  cls: 'bg-yellow-100 text-yellow-800'  },
  isento:    { label: 'ISENTO',    cls: 'bg-blue-100 text-blue-800'      },
  cancelado: { label: 'CANCELADO', cls: 'bg-red-100 text-red-800'        },
};

const fmtData = (d: string) => {
  const [y, m, day] = d.split('-');
  return `${day}/${m}/${y}`;
};

// ─── QR Code simples inline via canvas ───────────────────────
// Usa a lib qrcode que já está instalada (import dinâmico no lado cliente)
function QRCodeCanvas({ value, size }: { value: string; size: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!value || !canvasRef.current) return;
    import('qrcode').then((QRCode) => {
      QRCode.toCanvas(canvasRef.current!, value, {
        width: size,
        margin: 1,
        color: { dark: '#000000', light: '#ffffff' },
      });
    });
  }, [value, size]);

  return <canvas ref={canvasRef} width={size} height={size} style={{ display: 'block' }} />;
}

// ─── Crachá tamanho SMALL (etiqueta térmica ~8×5 cm) ─────────
function BadgeSmall({ inscricao, evento, nomeSup, nomeCampo, printMode }: Omit<EventBadgeProps, 'size'>) {
  const dept = getDept(evento.departamento);
  const qr = inscricao.qr_code ?? inscricao.id;
  const qrShort = qr.slice(-8).toUpperCase();

  return (
    <div
      className={printMode ? '' : 'shadow-md rounded-xl overflow-hidden'}
      style={{
        width: printMode ? '8cm' : '220px',
        minHeight: printMode ? '5cm' : '140px',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#fff',
        border: printMode ? `2px solid ${dept.bg}` : undefined,
        borderRadius: printMode ? '8px' : undefined,
        overflow: 'hidden',
        pageBreakInside: 'avoid',
      }}
    >
      {/* Header colorido */}
      <div style={{ backgroundColor: dept.bg, padding: '6px 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <p style={{ color: dept.accent, fontSize: '7px', fontWeight: 800, letterSpacing: '1px', margin: 0 }}>
            {dept.label}
          </p>
          <p style={{ color: '#fff', fontSize: '8px', margin: 0, opacity: 0.85 }}>
            {evento.nome.length > 28 ? evento.nome.slice(0, 28) + '…' : evento.nome}
          </p>
        </div>
        {inscricao.status_pagamento === 'pago' && (
          <span style={{ backgroundColor: dept.accent, color: dept.bg, fontSize: '6px', fontWeight: 800, padding: '2px 5px', borderRadius: '4px' }}>✓ PAGO</span>
        )}
      </div>

      {/* Corpo */}
      <div style={{ padding: '8px 10px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: '13px', fontWeight: 800, color: '#111', margin: '0 0 2px', lineHeight: 1.2, wordBreak: 'break-word' }}>
            {inscricao.nome_inscrito}
          </p>
          <p style={{ fontSize: '9px', color: '#555', margin: '0 0 1px' }}>{nomeSup}</p>
          <p style={{ fontSize: '8px', color: '#888', margin: 0 }}>{nomeCampo}</p>
          <div style={{ display: 'flex', gap: '3px', marginTop: '5px', flexWrap: 'wrap' }}>
            {inscricao.hospedagem  && <span style={{ fontSize: '7px', padding: '1px 4px', backgroundColor: '#EBF5FB', color: '#1A5276', borderRadius: '3px' }}>🛏 Hospedagem</span>}
            {inscricao.alimentacao && <span style={{ fontSize: '7px', padding: '1px 4px', backgroundColor: '#EAFAF1', color: '#1E8449', borderRadius: '3px' }}>🍽 Alimentação</span>}
          </div>
        </div>
        {/* QR Code */}
        <div style={{ flexShrink: 0, textAlign: 'center' }}>
          <QRCodeCanvas value={qr} size={52} />
          <p style={{ fontSize: '6px', color: '#999', marginTop: '2px', letterSpacing: '0.5px' }}>{qrShort}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Crachá tamanho MEDIUM (crachá pendurado ~9×6 cm) ────────
function BadgeMedium({ inscricao, evento, nomeSup, nomeCampo, printMode }: Omit<EventBadgeProps, 'size'>) {
  const dept = getDept(evento.departamento);
  const pagCfg = STATUS_PAG[inscricao.status_pagamento] ?? STATUS_PAG.pendente;
  const qr = inscricao.qr_code ?? inscricao.id;
  const qrShort = qr.slice(-8).toUpperCase();

  return (
    <div
      className={printMode ? '' : 'shadow-lg rounded-xl overflow-hidden'}
      style={{
        width: printMode ? '9cm' : '270px',
        minHeight: printMode ? '6cm' : '190px',
        fontFamily: 'Arial, sans-serif',
        backgroundColor: '#fff',
        border: `3px solid ${dept.bg}`,
        borderRadius: '10px',
        overflow: 'hidden',
        pageBreakInside: 'avoid',
      }}
    >
      {/* Header */}
      <div style={{ backgroundColor: dept.bg, padding: '10px 14px' }}>
        {/* Furo do cordão */}
        {!printMode && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '6px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', backgroundColor: 'rgba(255,255,255,0.3)', border: '2px solid rgba(255,255,255,0.5)' }} />
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <p style={{ color: dept.accent, fontSize: '9px', fontWeight: 800, letterSpacing: '2px', margin: '0 0 2px' }}>{dept.label}</p>
            <p style={{ color: '#fff', fontSize: '11px', fontWeight: 700, margin: 0, lineHeight: 1.2 }}>
              {evento.nome.length > 32 ? evento.nome.slice(0, 32) + '…' : evento.nome}
            </p>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: '8px', margin: '2px 0 0' }}>
              {fmtData(evento.data_inicio)} → {fmtData(evento.data_fim)}
              {evento.cidade ? ` • ${evento.cidade}` : ''}
            </p>
          </div>
          <span style={{ backgroundColor: dept.accent, color: dept.bg, fontSize: '8px', fontWeight: 800, padding: '3px 7px', borderRadius: '4px', flexShrink: 0 }}>
            {pagCfg.label}
          </span>
        </div>
      </div>

      {/* Corpo */}
      <div style={{ padding: '12px 14px', display: 'flex', gap: '10px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: '17px', fontWeight: 900, color: '#0D0D0D', margin: '0 0 4px', lineHeight: 1.2, wordBreak: 'break-word' }}>
            {inscricao.nome_inscrito}
          </p>
          <p style={{ fontSize: '11px', fontWeight: 600, color: '#333', margin: '0 0 2px' }}>{nomeSup}</p>
          <p style={{ fontSize: '10px', color: '#666', margin: 0 }}>{nomeCampo}</p>

          {/* Ícones de serviços */}
          <div style={{ display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
            {inscricao.hospedagem  && <span style={{ fontSize: '9px', padding: '2px 6px', backgroundColor: '#EBF5FB', color: '#1A5276', borderRadius: '4px', fontWeight: 600 }}>🛏 Hospedagem</span>}
            {inscricao.alimentacao && <span style={{ fontSize: '9px', padding: '2px 6px', backgroundColor: '#EAFAF1', color: '#1E8449', borderRadius: '4px', fontWeight: 600 }}>🍽 Alimentação</span>}
            {inscricao.brinde      && <span style={{ fontSize: '9px', padding: '2px 6px', backgroundColor: '#FEF9E7', color: '#7D6608', borderRadius: '4px', fontWeight: 600 }}>🎁 Brinde</span>}
          </div>
        </div>

        {/* QR Code */}
        <div style={{ flexShrink: 0, textAlign: 'center' }}>
          <QRCodeCanvas value={qr} size={72} />
          <p style={{ fontSize: '7px', color: '#aaa', marginTop: '3px', letterSpacing: '1px', fontFamily: 'monospace' }}>{qrShort}</p>
        </div>
      </div>

      {/* Rodapé colorido fino */}
      <div style={{ height: '4px', backgroundColor: dept.accent }} />
    </div>
  );
}

// ─── Crachá tamanho LARGE (folha A4, grade 2×2) ──────────────
function BadgeLarge({ inscricao, evento, nomeSup, nomeCampo, printMode }: Omit<EventBadgeProps, 'size'>) {
  return <BadgeMedium inscricao={inscricao} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} printMode={printMode} />;
}

// ─── Componente principal exportado ──────────────────────────
export function EventBadge({ inscricao, evento, nomeSup, nomeCampo, size = 'medium', printMode = false }: EventBadgeProps) {
  if (size === 'small')  return <BadgeSmall  inscricao={inscricao} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} printMode={printMode} />;
  if (size === 'large')  return <BadgeLarge  inscricao={inscricao} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} printMode={printMode} />;
  return <BadgeMedium inscricao={inscricao} evento={evento} nomeSup={nomeSup} nomeCampo={nomeCampo} printMode={printMode} />;
}
