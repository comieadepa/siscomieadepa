'use client';

import { useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import {
  Printer,
  Download,
  X,
  CreditCard,
  AlertTriangle,
} from 'lucide-react';

export interface CartaoUmadespaProps {
  associado: {
    id: string;
    nome: string;
    numero_umadespa?: string | null;
    matricula?: string | null;
    foto_url?: string | null;
    funcao: string;
    is_lideranca: boolean;
    cargo_detalhe?: string | null;
    supervisao?: { nome: string; codigo?: number } | null;
    campo?: { nome: string } | null;
    congregacao?: { nome: string } | null;
    carteirinha_atual?: {
      id: string;
      via: number;
      valor: number;
      validade_data?: string | null;
      status: string;
    } | null;
  };
  onClose: () => void;
  onAtualizarStatus?: (pedidoId: string, status: string) => void;
}

export function CartaoUmadespa({
  associado,
  onClose,
  onAtualizarStatus,
}: CartaoUmadespaProps) {
  const [gerandoPDF, setGerandoPDF] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  const numeroRegistro =
    associado.numero_umadespa ||
    associado.matricula ||
    associado.id.slice(0, 8).toUpperCase();

  const validadeFormatada = associado.carteirinha_atual?.validade_data
    ? new Date(`${associado.carteirinha_atual.validade_data}T12:00:00`).toLocaleDateString('pt-BR')
    : new Date(Date.now() + 2 * 365 * 24 * 60 * 60 * 1000).toLocaleDateString('pt-BR');

  const viaAtual = associado.carteirinha_atual?.via || 1;
  const statusPagamento = associado.carteirinha_atual?.status || 'aguardando_pagamento';
  const podeImprimir = ['pago', 'em_impressao', 'impressa', 'entregue'].includes(statusPagamento);

  // URL para autenticação pública via QR Code
  const qrCodeUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/validar-credencial/umadespa/${associado.id}`
      : `https://www.siscomieadepa.org/validar-credencial/umadespa/${associado.id}`;

  const handleImprimir = () => {
    if (!podeImprimir) {
      alert('Bloqueio Operacional: Esta credencial não possui confirmação de pagamento ou isenção administrativa. Impressão bloqueada.');
      return;
    }
    if (!printRef.current) return;
    const printWin = window.open('', '_blank', 'height=850,width=800');
    if (!printWin) {
      window.print();
      return;
    }

    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Credencial UMADESPA — ${associado.nome}</title>
  <style>
    @page {
      size: 85.6mm 53.98mm landscape;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      background: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
    }
    .page-card {
      width: 85.6mm;
      height: 53.98mm;
      page-break-after: always;
      position: relative;
      overflow: hidden;
    }
  </style>
</head>
<body>
  ${printRef.current.innerHTML}
  <script>
    window.onload = function() {
      setTimeout(function() { window.print(); window.close(); }, 350);
    };
  </script>
</body>
</html>`);
    printWin.document.close();

    // Se possui pedido e operador confirmou, atualiza para 'impressa'
    if (associado.carteirinha_atual?.id && onAtualizarStatus) {
      onAtualizarStatus(associado.carteirinha_atual.id, 'impressa');
    }
  };

  const handleDownloadPDF = async () => {
    if (!podeImprimir) {
      alert('Bloqueio Operacional: Esta credencial não possui confirmação de pagamento ou isenção administrativa. Download bloqueado.');
      return;
    }
    setGerandoPDF(true);
    try {
      // Import dinâmico das bibliotecas pesadas sob demanda
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);

      const frenteEl = printRef.current?.querySelector('#print-card-frente') as HTMLElement;
      const versoEl = printRef.current?.querySelector('#print-card-verso') as HTMLElement;

      if (!frenteEl || !versoEl) {
        throw new Error('Elementos do cartão não encontrados.');
      }

      const canvasFrente = await html2canvas(frenteEl, {
        scale: 4,
        useCORS: true,
        backgroundColor: null,
      });

      const canvasVerso = await html2canvas(versoEl, {
        scale: 4,
        useCORS: true,
        backgroundColor: null,
      });

      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: [85.6, 53.98],
      });

      pdf.addImage(canvasFrente.toDataURL('image/png'), 'PNG', 0, 0, 85.6, 53.98);
      pdf.addPage([85.6, 53.98], 'landscape');
      pdf.addImage(canvasVerso.toDataURL('image/png'), 'PNG', 0, 0, 85.6, 53.98);

      const nomeLimpo = associado.nome.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      pdf.save(`credencial_umadespa_${nomeLimpo}.pdf`);

      if (associado.carteirinha_atual?.id && onAtualizarStatus) {
        onAtualizarStatus(associado.carteirinha_atual.id, 'impressa');
      }
    } catch (err) {
      console.error('Erro ao gerar PDF:', err);
      alert('Não foi possível gerar o arquivo PDF.');
    } finally {
      setGerandoPDF(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-4xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl relative animate-in fade-in zoom-in-95 duration-150 max-h-[95vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-700 dark:text-slate-300 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Cabeçalho */}
        <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200 dark:border-slate-800">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
            <CreditCard className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Credencial Oficial UMADESPA (PVC 85.6 x 53.98 mm)
            </h3>
            <p className="text-xs text-slate-700 dark:text-slate-300">
              {associado.nome} • {associado.funcao} • {viaAtual}ª Via
            </p>
          </div>
        </div>

        {/* Pré-visualização Frente e Verso na Tela */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 justify-items-center mb-6">
          {/* Card Frente - Preview */}
          <div className="space-y-2 text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Frente da Credencial
            </span>
            <div className="w-[380px] h-[240px] rounded-2xl overflow-hidden shadow-lg border border-emerald-900/30 relative bg-gradient-to-br from-emerald-900 via-emerald-800 to-teal-950 text-white p-3.5 flex flex-col justify-between">
              {/* Faixas e Detalhes Dourados */}
              <div className="absolute top-0 right-0 w-36 h-36 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />
              <div className="absolute bottom-0 left-0 w-full h-1.5 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500" />

              {/* Topo: Logos e Cabeçalho */}
              <div className="flex items-center justify-between border-b border-emerald-700/60 pb-2 relative z-10">
                <div className="flex items-center gap-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/img/logo_comieadepa.png" alt="COMIEADEPA" className="h-8 object-contain" />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/img/umadespa.png" alt="UMADESPA" className="h-8 object-contain" />
                </div>
                <div className="text-right">
                  <span className="block text-[8px] font-extrabold uppercase tracking-wider text-amber-300">
                    COMIEADEPA
                  </span>
                  <span className="block text-[11px] font-black uppercase tracking-tight text-white">
                    UMADESPA
                  </span>
                </div>
              </div>

              {/* Meio: Foto 3x4 e Dados Pessoais */}
              <div className="flex items-center gap-3 relative z-10 my-auto">
                <div className="w-20 h-26 rounded-lg overflow-hidden border-2 border-amber-400/80 bg-emerald-950 shrink-0 shadow-sm">
                  {associado.foto_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={associado.foto_url} alt={associado.nome} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-black text-xl text-emerald-300">
                      {associado.nome.charAt(0)}
                    </div>
                  )}
                </div>

                <div className="flex-1 min-w-0 text-left space-y-1">
                  <div>
                    <span className="text-[7.5px] font-bold uppercase tracking-wider text-emerald-200/90 block">
                      Nome do Associado
                    </span>
                    <h4 className="text-[12px] font-black uppercase text-white leading-tight truncate">
                      {associado.nome}
                    </h4>
                  </div>

                  <div className="flex items-center gap-2">
                    <div>
                      <span className="text-[7px] font-bold uppercase tracking-wider text-emerald-200/90 block">
                        Função Eclesiástica
                      </span>
                      <span className="inline-block px-2 py-0.5 rounded text-[9.5px] font-extrabold uppercase bg-amber-400 text-slate-950">
                        {associado.funcao}
                      </span>
                    </div>
                    <div>
                      <span className="text-[7px] font-bold uppercase tracking-wider text-emerald-200/90 block">
                        Registro
                      </span>
                      <span className="text-[10px] font-mono font-bold text-white">
                        {numeroRegistro}
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[7px] font-bold uppercase tracking-wider text-emerald-200/90 block">
                      Campo / Congregação
                    </span>
                    <p className="text-[9.5px] font-semibold text-emerald-100 truncate">
                      {associado.campo?.nome || 'COMIEADEPA'}
                      {associado.congregacao?.nome ? ` • ${associado.congregacao.nome}` : ''}
                    </p>
                  </div>
                </div>
              </div>

              {/* Rodapé do Cartão */}
              <div className="flex items-center justify-between text-[7.5px] text-emerald-200/80 pt-1 border-t border-emerald-700/60 relative z-10">
                <span>UNIÃO DE MOCIDADE DAS AD NO ESTADO DO PARÁ</span>
                <span className="font-bold text-amber-300">VIA {viaAtual}</span>
              </div>
            </div>
          </div>

          {/* Card Verso - Preview */}
          <div className="space-y-2 text-center">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Verso da Credencial
            </span>
            <div className="w-[380px] h-[240px] rounded-2xl overflow-hidden shadow-lg border border-emerald-900/30 relative bg-gradient-to-br from-emerald-950 via-emerald-900 to-teal-950 text-white p-3.5 flex flex-col justify-between">
              <div className="absolute bottom-0 right-0 w-36 h-36 bg-amber-500/10 rounded-full blur-xl pointer-events-none" />
              <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-amber-400 via-yellow-300 to-amber-500" />

              {/* Topo do Verso */}
              <div className="text-center border-b border-emerald-700/60 pb-1.5">
                <span className="block text-[8px] font-bold uppercase tracking-wider text-amber-300">
                  CONVENÇÃO ESTADUAL DE MINISTROS E IGREJAS
                </span>
                <span className="block text-[9.5px] font-extrabold uppercase text-white">
                  AUTENTICAÇÃO DIGITAL & DISPOSIÇÕES ESTATUTÁRIAS
                </span>
              </div>

              {/* Centro do Verso: Dados e QR Code */}
              <div className="flex items-center justify-between gap-3 my-auto">
                <div className="flex-1 space-y-1.5 text-left text-[8.5px]">
                  <div>
                    <span className="text-[7px] font-bold uppercase text-emerald-200 block">Supervisão</span>
                    <span className="font-bold text-white">{associado.supervisao?.nome || 'COMIEADEPA — SEDE'}</span>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <span className="text-[7px] font-bold uppercase text-emerald-200 block">Validade</span>
                      <span className="font-extrabold text-amber-300 text-[10px]">{validadeFormatada}</span>
                    </div>
                    <div>
                      <span className="text-[7px] font-bold uppercase text-emerald-200 block">Emissão</span>
                      <span className="font-medium text-white">{new Date().toLocaleDateString('pt-BR')}</span>
                    </div>
                  </div>

                  <p className="text-[7px] text-emerald-100/70 leading-tight">
                    O titular desta credencial é membro oficial reconhecido pela liderança estadual da UMADESPA e COMIEADEPA.
                  </p>
                </div>

                {/* QR Code de Autenticidade */}
                <div className="p-2 rounded-xl bg-white text-slate-900 shrink-0 shadow-sm text-center">
                  <QRCodeSVG value={qrCodeUrl} size={68} level="M" />
                  <span className="block text-[6.5px] font-bold uppercase text-slate-700 mt-1">
                    Validar QR Code
                  </span>
                </div>
              </div>

              {/* Rodapé do Verso com Assinatura da Presidência */}
              <div className="border-t border-emerald-700/60 pt-1 text-center">
                <span className="block text-[7.5px] font-bold text-white uppercase">
                  Pr. Océlio Nauar — Presidente COMIEADEPA
                </span>
                <span className="block text-[6.5px] text-emerald-200/80">
                  Validação pública em siscomieadepa.org
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Área Oculta para Renderização Exata e Impressão PVC (85.6mm x 53.98mm) */}
        <div className="hidden">
          <div ref={printRef}>
            {/* Página 1: Frente */}
            <div id="print-card-frente" className="page-card" style={{ width: '85.6mm', height: '53.98mm', background: '#064e3b', color: '#fff', padding: '3.5mm', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative' }}>
              <div style={{ position: 'absolute', bottom: 0, left: 0, width: '100%', height: '1.5mm', background: '#f59e0b' }} />
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '0.3mm solid #047857', paddingBottom: '1.5mm' }}>
                <div style={{ display: 'flex', gap: '2mm', alignItems: 'center' }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/img/logo_comieadepa.png" alt="COMIEADEPA" style={{ height: '7mm', objectFit: 'contain' }} />
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/img/umadespa.png" alt="UMADESPA" style={{ height: '7mm', objectFit: 'contain' }} />
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '7pt', fontWeight: 'bold', color: '#fde047' }}>COMIEADEPA</div>
                  <div style={{ fontSize: '9pt', fontWeight: '900', color: '#fff' }}>UMADESPA</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '3mm', alignItems: 'center', margin: 'auto 0' }}>
                <div style={{ width: '20mm', height: '26mm', border: '0.4mm solid #f59e0b', borderRadius: '1.5mm', overflow: 'hidden', background: '#022c22', flexShrink: 0 }}>
                  {associado.foto_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={associado.foto_url} alt={associado.nome} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '5.5pt', color: '#a7f3d0', textTransform: 'uppercase', fontWeight: 'bold' }}>Nome do Titular</div>
                  <div style={{ fontSize: '9.5pt', fontWeight: '900', color: '#fff', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{associado.nome}</div>
                  
                  <div style={{ display: 'flex', gap: '2mm', marginTop: '1mm' }}>
                    <div style={{ background: '#f59e0b', color: '#000', fontSize: '7pt', fontWeight: 'bold', padding: '0.5mm 1.5mm', borderRadius: '1mm', textTransform: 'uppercase' }}>
                      {associado.funcao}
                    </div>
                    <div style={{ fontSize: '7pt', color: '#fff', fontWeight: 'bold', alignSelf: 'center' }}>
                      REG.: {numeroRegistro}
                    </div>
                  </div>

                  <div style={{ marginTop: '1mm' }}>
                    <div style={{ fontSize: '5.5pt', color: '#a7f3d0', textTransform: 'uppercase', fontWeight: 'bold' }}>Campo Eclesiástico</div>
                    <div style={{ fontSize: '7.5pt', color: '#ecfdf5', fontWeight: '600', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {associado.campo?.nome || 'COMIEADEPA'}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '6pt', color: '#a7f3d0', borderTop: '0.3mm solid #047857', paddingTop: '1mm' }}>
                <span>UNIÃO DE MOCIDADE DAS AD NO ESTADO DO PARÁ</span>
                <span style={{ color: '#fde047', fontWeight: 'bold' }}>VIA {viaAtual}</span>
              </div>
            </div>

            {/* Página 2: Verso */}
            <div id="print-card-verso" className="page-card" style={{ width: '85.6mm', height: '53.98mm', background: '#022c22', color: '#fff', padding: '3.5mm', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', position: 'relative' }}>
              <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '1.5mm', background: '#f59e0b' }} />

              <div style={{ textAlign: 'center', borderBottom: '0.3mm solid #047857', paddingBottom: '1mm' }}>
                <div style={{ fontSize: '6pt', fontWeight: 'bold', color: '#fde047', textTransform: 'uppercase' }}>CONVENÇÃO ESTADUAL DE MINISTROS E IGREJAS</div>
                <div style={{ fontSize: '7.5pt', fontWeight: '900', textTransform: 'uppercase' }}>AUTENTICAÇÃO DIGITAL DA JUVENTUDE</div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '2mm', margin: 'auto 0' }}>
                <div style={{ flex: 1, fontSize: '6.5pt' }}>
                  <div style={{ color: '#a7f3d0', fontWeight: 'bold' }}>SUPERVISÃO: <span style={{ color: '#fff' }}>{associado.supervisao?.nome || 'COMIEADEPA'}</span></div>
                  <div style={{ color: '#a7f3d0', fontWeight: 'bold', marginTop: '1mm' }}>VALIDADE: <span style={{ color: '#fde047', fontSize: '8pt' }}>{validadeFormatada}</span></div>
                  <div style={{ color: '#a7f3d0', fontWeight: 'bold' }}>EMISSÃO: <span style={{ color: '#fff' }}>{new Date().toLocaleDateString('pt-BR')}</span></div>
                  <p style={{ fontSize: '5.5pt', color: '#d1fae5', marginTop: '1.5mm', lineHeight: '1.2' }}>
                    Documento de porte obrigatório para convenções e congressos da mocidade no Estado do Pará.
                  </p>
                </div>

                <div style={{ background: '#fff', padding: '1.5mm', borderRadius: '1.5mm', textAlign: 'center' }}>
                  <QRCodeSVG value={qrCodeUrl} size={65} level="M" />
                  <div style={{ fontSize: '5pt', color: '#000', fontWeight: 'bold', marginTop: '0.5mm' }}>VERIFICAR</div>
                </div>
              </div>

              <div style={{ textAlign: 'center', borderTop: '0.3mm solid #047857', paddingTop: '1mm', fontSize: '6pt' }}>
                <div style={{ fontWeight: 'bold', color: '#fff' }}>PR. OCÉLIO NAUAR — PRESIDENTE COMIEADEPA</div>
                <div style={{ color: '#a7f3d0', fontSize: '5pt' }}>siscomieadepa.org</div>
              </div>
            </div>
          </div>
        </div>

        {/* Banner de Aviso de Pagamento Pendente se aplicável */}
        {!podeImprimir && (
          <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs">
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
            <span>
              <strong>Pagamento Pendente:</strong> Esta credencial ({statusPagamento.replace(/_/g, ' ')}) ainda não possui quitação confirmada ou isenção administrativa. As ações de impressão física e download em PDF estão bloqueadas por segurança.
            </span>
          </div>
        )}

        {/* Botões de Ação */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <div className="text-xs text-slate-700 dark:text-slate-300">
            Padrão Térmico: <strong>CR-80 (85.60 × 53.98 mm)</strong> • 300 DPI
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!podeImprimir}
              onClick={handleImprimir}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-slate-800 hover:bg-slate-700 text-white shadow-xs transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer className="w-4 h-4" />
              Imprimir Direto
            </button>

            <button
              type="button"
              disabled={gerandoPDF || !podeImprimir}
              onClick={handleDownloadPDF}
              className="inline-flex items-center gap-1.5 px-5 py-2 text-xs font-bold uppercase tracking-wider rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download className="w-4 h-4" />
              {gerandoPDF ? 'Gerando PDF...' : 'Baixar PDF em Alta'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
