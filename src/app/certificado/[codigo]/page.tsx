'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';

// ─── Tipos ────────────────────────────────────────────────────
interface Elemento {
  id:         string;
  tipo:       'texto';
  placeholder: string;
  x:          number;
  y:          number;
  fontSize:   number;
  fontWeight: 'normal' | 'bold';
  color:      string;
  align:      'left' | 'center' | 'right';
  fontFamily: string;
  maxWidth?:  number;
}

interface CertificadoData {
  valido:             boolean;
  expirado?:          boolean;
  motivo?:            string;
  prazo_expiracao?:   string;
  suporte_nome?:      string | null;
  suporte_whatsapp?:  string | null;
  config?: {
    background_url?: string | null;
    arte_url?:       string | null;
    elementos_json?: Elemento[] | null;
  } | null;
  dados?: {
    nome:        string;
    evento:      string;
    data_evento: string;
    cargo:       string | null;
    supervisao:  string | null;
    campo:       string | null;
    codigo:      string;
    cpf?:        string | null;
  };
}

// ─── Canvas dimensions (same as editor) ──────────────────────
const CANVAS_W = 1400;
const CANVAS_H = 990;

// ─── Substitui placeholders pelo valor real ───────────────────
function substituir(text: string, dados: NonNullable<CertificadoData['dados']>): string {
  const hoje = new Date().toLocaleDateString('pt-BR');
  return text
    .replace(/{NOME}/g,         dados.nome)
    .replace(/{EVENTO}/g,       dados.evento)
    .replace(/{DATA_EVENTO}/g,  dados.data_evento)
    .replace(/{SUPERVISAO}/g,   dados.supervisao ?? '')
    .replace(/{CAMPO}/g,        dados.campo ?? '')
    .replace(/{CPF}/g,          dados.cpf ?? '')
    .replace(/{CODIGO}/g,       dados.codigo)
    .replace(/{DATA_EMISSAO}/g, hoje);
}

export default function CertificadoPublicoPage() {
  const params = useParams();
  const codigo = (params?.codigo as string ?? '').toUpperCase();

  const [certData,   setCertData]   = useState<CertificadoData | null>(null);
  const [loading,    setLoading]    = useState(true);

  useEffect(() => {
    if (!codigo) { setLoading(false); return; }
    fetch(`/api/certificado/${codigo}`)
      .then(r => r.json())
      .then(data => { setCertData(data); setLoading(false); })
      .catch(() => {
        setCertData({ valido: false, motivo: 'Erro ao consultar certificado. Tente novamente.' });
        setLoading(false);
      });
  }, [codigo]);

  // ── Loading ─────────────────────────────────────────────────
  if (loading) {
    return (
      <PaginaBase>
        <div className="text-center py-20 text-gray-400">
          <div className="w-12 h-12 border-4 border-[#123b63]/30 border-t-[#123b63] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm">Verificando certificado...</p>
        </div>
      </PaginaBase>
    );
  }

  // ── Inválido / Não elegível ──────────────────────────────────
  if (!certData?.valido) {
    const isExpirado = certData?.expirado;
    return (
      <PaginaBase>
        <div className="max-w-md mx-auto text-center py-16">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-5 ${isExpirado ? 'bg-amber-100' : 'bg-red-100'}`}>
            <span className="text-4xl">{isExpirado ? '⏰' : '❌'}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-3">
            {isExpirado ? 'Prazo expirado' : 'Certificado não disponível'}
          </h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            {certData?.motivo ?? 'Código de certificado não encontrado.'}
          </p>
          {isExpirado && (certData?.suporte_nome || certData?.suporte_whatsapp) && (
            <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-left">
              <p className="text-xs font-bold text-amber-700 mb-2">Contato da organização:</p>
              {certData.suporte_nome && <p className="text-sm text-amber-900 font-semibold">{certData.suporte_nome}</p>}
              {certData.suporte_whatsapp && (
                <a href={`https://wa.me/55${certData.suporte_whatsapp.replace(/\D/g,'')}`}
                  target="_blank" rel="noopener noreferrer"
                  className="text-sm text-emerald-700 font-semibold hover:underline mt-1 block">
                  📱 {certData.suporte_whatsapp}
                </a>
              )}
            </div>
          )}
          {!isExpirado && (
            <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-left">
              <p className="text-xs font-bold text-amber-700 mb-2">Código verificado:</p>
              <p className="font-mono text-sm text-amber-900 font-bold">{codigo}</p>
            </div>
          )}
        </div>
      </PaginaBase>
    );
  }

  // ── Válido ───────────────────────────────────────────────────
  const { dados, config } = certData;
  if (!dados) return null;

  const elementos: Elemento[] = Array.isArray(config?.elementos_json) ? config!.elementos_json! : [];
  const bgUrl = config?.background_url ?? config?.arte_url ?? null;
  const hasEditor = elementos.length > 0 && bgUrl;

  const prazoFmt = certData.prazo_expiracao
    ? new Date(certData.prazo_expiracao).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  const registrarImpressao = () => {
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`/api/certificado/${codigo}`);
        return;
      }
    } catch {
      // Ignora falha de beacon
    }
    fetch(`/api/certificado/${codigo}`, { method: 'POST' }).catch(() => null);
  };

  const handlePrint = () => {
    registrarImpressao();
    window.print();
  };

  return (
    <>
      {/* Print CSS — only the certificate, A4 landscape */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #cert-canvas, #cert-canvas * { visibility: visible !important; }
          #cert-canvas {
            position: fixed !important;
            inset: 0 !important;
            width: 100vw !important;
            height: 100vh !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            border-radius: 0 !important;
          }
          @page { size: A4 landscape; margin: 0; }
        }
      `}</style>

      <PaginaBase>
        <div className="py-6">

          {/* ── Canvas do certificado ─────────────────────── */}
          {hasEditor ? (
            <div className="mb-6">
              <div
                id="cert-canvas"
                className="relative w-full overflow-hidden rounded-xl shadow-lg border border-gray-200"
                style={{ paddingBottom: `${(CANVAS_H / CANVAS_W) * 100}%`, backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }}
              >
                {elementos.map(el => {
                  const texto = substituir(el.placeholder, dados);
                  const leftPct = (el.x / CANVAS_W) * 100;
                  const topPct  = (el.y / CANVAS_H) * 100;
                  const maxWPct = el.maxWidth ? `${(el.maxWidth / CANVAS_W) * 100}%` : '80%';
                  return (
                    <div
                      key={el.id}
                      style={{
                        position:   'absolute',
                        left:       `${leftPct}%`,
                        top:        `${topPct}%`,
                        transform:  'translate(-50%, -50%)',
                        fontSize:   `${(el.fontSize / CANVAS_H) * 100}cqmin`,
                        fontWeight: el.fontWeight,
                        color:      el.color,
                        textAlign:  el.align,
                        fontFamily: el.fontFamily,
                        maxWidth:   maxWPct,
                        width:      maxWPct,
                        userSelect: 'none',
                        whiteSpace: 'nowrap',
                        overflow:   'visible',
                      }}
                    >
                      {texto}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* Fallback: layout antigo quando não há editor configurado */
            <div className="max-w-xl mx-auto">
              <div className="text-center mb-8">
                <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
                  <span className="text-5xl">🎓</span>
                </div>
                <h1 className="text-2xl font-black text-gray-800">Certificado Válido!</h1>
                <p className="text-gray-500 text-sm mt-1">Este certificado é autêntico e foi emitido pelo sistema GestãoServus.</p>
              </div>
              <div id="cert-canvas" className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-6">
                <div className="bg-[#0D2B4E] px-5 py-4">
                  <p className="text-white/60 text-xs uppercase tracking-widest font-bold">Evento</p>
                  <p className="text-white font-bold text-lg leading-tight mt-0.5">{dados.evento}</p>
                  <p className="text-white/60 text-sm mt-1">📅 {dados.data_evento}</p>
                </div>
                <div className="px-5 py-5 space-y-3">
                  <InfoRow label="Participante" value={dados.nome} bold />
                  {dados.cargo      && <InfoRow label="Modalidade"  value={dados.cargo}      />}
                  {dados.supervisao && <InfoRow label="Supervisão"  value={dados.supervisao} />}
                  {dados.campo      && <InfoRow label="Campo"       value={dados.campo}      />}
                  <InfoRow label="Código" value={dados.codigo} mono />
                </div>
              </div>
            </div>
          )}

          {/* ── Botão imprimir ───────────────────────────── */}
          <div className={`${hasEditor ? '' : 'max-w-xl mx-auto'} print:hidden`}>
            <button
              onClick={handlePrint}
              className="w-full bg-[#123b63] hover:bg-[#0f2a45] active:scale-[0.98] text-white font-black py-4 rounded-2xl text-base transition shadow-lg flex items-center justify-center gap-2"
            >
              🖨️ Imprimir / Salvar em PDF
            </button>
            <p className="text-center text-xs text-gray-400 mt-3">
              Use a opção &ldquo;Salvar como PDF&rdquo; na janela de impressão do seu navegador.
            </p>
            {prazoFmt && (
              <p className="text-center text-xs text-amber-600 mt-2">
                ⏰ Disponível para emissão até: {prazoFmt}
              </p>
            )}
          </div>
        </div>
      </PaginaBase>
    </>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────
function PaginaBase({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0D2B4E] text-white shadow-md print:hidden">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-[#F39C12] rounded-lg flex items-center justify-center flex-shrink-0">
            <span className="text-white font-black text-sm">GS</span>
          </div>
          <div>
            <p className="font-bold text-sm leading-tight">GestãoServus</p>
            <p className="text-xs text-blue-300">Validação de Certificado</p>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4">{children}</main>
      <footer className="text-center py-8 text-xs text-gray-400 border-t border-gray-200 mt-8 print:hidden">
        GestãoServus • Sistema de Gestão Ministerial
      </footer>
    </div>
  );
}

function InfoRow({ label, value, bold, mono }: { label: string; value: string; bold?: boolean; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="text-gray-400 text-xs flex-shrink-0 w-24">{label}</span>
      <span className={`text-right ${bold ? 'font-bold text-gray-800 text-base' : 'text-gray-700'} ${mono ? 'font-mono' : ''}`}>
        {value}
      </span>
    </div>
  );
}
