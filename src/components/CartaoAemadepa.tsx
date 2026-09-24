'use client';

import { useState, useRef, useEffect } from 'react';
import { QRCodeSVG as QRCode } from 'qrcode.react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  HeartHandshake,
  Printer,
  Download,
  X,
  AlertTriangle,
  User,
  CreditCard,
} from 'lucide-react';
import { buildUrl, getAppBaseUrl } from '@/lib/urls';

export interface CartaoAemadepaProps {
  associada: {
    id: string; // id do ministro
    uniqueId?: string;
    nomeEsposa: string;
    cpfEsposa: string;
    rgEsposa: string;
    dataNascimentoEsposa: string;
    tipoSanguineoEsposa: string;
    fotoEsposaUrl: string | null;
    numeroAemadepa: string;
    ministroNome: string;
    ministroMatricula: string;
    cargoMinisterial: string;
    campo: string;
    supervisao: string;
  };
  onClose: () => void;
}

export default function CartaoAemadepa({ associada, onClose }: CartaoAemadepaProps) {
  const [gerandoPDF, setGerandoPDF] = useState(false);
  const [erroValidacao, setErroValidacao] = useState<string | null>(null);
  const frenteRef = useRef<HTMLDivElement>(null);
  const versoRef = useRef<HTMLDivElement>(null);

  // Validação de dados essenciais
  useEffect(() => {
    if (!associada.nomeEsposa || associada.nomeEsposa === 'Não cadastrada') {
      setErroValidacao('Nome da associada não cadastrado.');
    } else if (!associada.ministroNome) {
      setErroValidacao('Ministro vinculado não identificado.');
    } else {
      setErroValidacao(null);
    }
  }, [associada]);

  // Formatação de data
  const fmtDate = (v?: string | null) => {
    if (!v) return '—';
    const d = new Date(v + (v.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString('pt-BR');
  };

  // QR Code URL seguro para autenticação pública de associada
  const qrCodeUrl = buildUrl(
    getAppBaseUrl(),
    `/autentica_qrcode-05985642/${associada.uniqueId || associada.id}`
  );

  // Geração de PDF e Impressão de alta resolução
  const handleGerarPDF = async () => {
    if (!frenteRef.current || !versoRef.current) return;
    setGerandoPDF(true);

    try {
      // 1. Renderiza Frente com escala 3x para qualidade gráfica de impressão
      const canvasFrente = await html2canvas(frenteRef.current, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#FFFFFF',
      });

      // 2. Renderiza Verso
      const canvasVerso = await html2canvas(versoRef.current, {
        scale: 3,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#FFFFFF',
      });

      // Dimensões padrão Cartão CR80 (85.6mm x 53.98mm)
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'mm',
        format: [85.6, 54],
      });

      const imgFrente = canvasFrente.toDataURL('image/jpeg', 0.98);
      pdf.addImage(imgFrente, 'JPEG', 0, 0, 85.6, 54);

      pdf.addPage([85.6, 54], 'landscape');
      const imgVerso = canvasVerso.toDataURL('image/jpeg', 0.98);
      pdf.addImage(imgVerso, 'JPEG', 0, 0, 85.6, 54);

      const nomeArquivo = `carteirinha_aemadepa_${associada.nomeEsposa.replace(/\s+/g, '_').toLowerCase()}.pdf`;
      pdf.save(nomeArquivo);
    } catch (err) {
      console.error('Erro ao gerar PDF da carteirinha AEMADEPA:', err);
      alert('Erro ao gerar PDF da carteirinha. Tente novamente.');
    } finally {
      setGerandoPDF(false);
    }
  };

  // Impressão direta via janela do navegador
  const handleImprimir = async () => {
    if (!frenteRef.current || !versoRef.current) return;
    setGerandoPDF(true);

    try {
      const canvasFrente = await html2canvas(frenteRef.current, { scale: 3, useCORS: true, allowTaint: true });
      const canvasVerso = await html2canvas(versoRef.current, { scale: 3, useCORS: true, allowTaint: true });

      const win = window.open('', '_blank', 'width=900,height=650');
      if (!win) {
        setGerandoPDF(false);
        return;
      }

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8"/>
          <title>Carteirinha AEMADEPA — ${associada.nomeEsposa}</title>
          <style>
            @page { size: auto; margin: 10mm; }
            body { margin: 0; padding: 20px; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 20px; }
            .card-print { width: 85.6mm; height: 54mm; border: 1px dashed #ccc; box-sizing: border-box; page-break-inside: avoid; }
            .card-print img { width: 100%; height: 100%; object-fit: contain; }
          </style>
        </head>
        <body>
          <div class="card-print">
            <img src="${canvasFrente.toDataURL('image/png')}" />
          </div>
          <div class="card-print">
            <img src="${canvasVerso.toDataURL('image/png')}" />
          </div>
        </body>
        </html>
      `;
      win.document.write(html);
      win.document.close();
      win.focus();
      setTimeout(() => {
        win.print();
        setGerandoPDF(false);
      }, 500);
    } catch (err) {
      console.error('Erro ao imprimir carteirinha:', err);
      setGerandoPDF(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-6 flex flex-col max-h-[94vh] border border-rose-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 bg-gradient-to-r from-rose-700 via-pink-700 to-purple-800 text-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center shadow-inner">
              <CreditCard className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight">
                Carteirinha da Associada AEMADEPA
              </h2>
              <p className="text-xs text-rose-100">
                Visualização e Emissão Oficial (Padrão 85.6mm x 54mm)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo com Scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-50">
          {/* Mensagem de Erro se houver */}
          {erroValidacao && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-3 text-amber-900 text-sm">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>{erroValidacao}</span>
            </div>
          )}

          {/* Avisos Informativos */}
          {!associada.fotoEsposaUrl && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-800 text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Esta associada ainda não possui foto cadastrada. A carteirinha será emitida sem fotografia.</span>
            </div>
          )}

          {/* Área de Visualização dos Cartões (Frente e Verso) */}
          <div className="flex flex-col lg:flex-row items-center justify-center gap-8 py-2">
            {/* ── CARTÃO FRENTE ── */}
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Frente do Cartão</span>
              <div
                ref={frenteRef}
                style={{ width: '428px', height: '270px' }}
                className="relative rounded-2xl overflow-hidden shadow-2xl bg-gradient-to-br from-rose-700 via-pink-700 to-purple-900 text-white border-2 border-rose-300 select-none flex flex-col justify-between p-4 box-border"
              >
                {/* Elementos Decorativos de Fundo */}
                <div className="absolute top-0 right-0 w-44 h-44 bg-white/10 rounded-full blur-2xl pointer-events-none -mr-10 -mt-10" />
                <div className="absolute bottom-0 left-0 w-36 h-36 bg-purple-500/20 rounded-full blur-xl pointer-events-none -ml-8 -mb-8" />

                {/* Topo do Cartão: Logo / Header */}
                <div className="relative z-10 flex items-center justify-between border-b border-white/20 pb-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 bg-white/20 backdrop-blur-md rounded-lg flex items-center justify-center border border-white/30">
                      <HeartHandshake className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <h3 className="font-extrabold text-sm tracking-tight leading-tight">
                        AEMADEPA
                      </h3>
                      <p className="text-[8.5px] text-rose-100 font-medium tracking-wider uppercase leading-none">
                        Associação das Esposas dos Ministros
                      </p>
                      <p className="text-[7.5px] text-rose-200/90 tracking-widest font-semibold uppercase leading-tight mt-0.5">
                        COMIEADEPA • PARÁ
                      </p>
                    </div>
                  </div>

                  {/* Número AEMADEPA em destaque */}
                  <div className="text-right">
                    <span className="text-[8px] uppercase tracking-widest text-rose-200 block font-bold">
                      No AEMADEPA
                    </span>
                    <span className="font-mono font-extrabold text-xs px-2 py-0.5 bg-white/20 rounded border border-white/30 tracking-wider">
                      {associada.numeroAemadepa || 'PENDENTE'}
                    </span>
                  </div>
                </div>

                {/* Meio: Foto + Dados da Associada */}
                <div className="relative z-10 flex items-center gap-3.5 my-auto">
                  {/* Foto 3:4 */}
                  <div className="w-20 h-26 rounded-xl bg-white/20 border-2 border-white/40 overflow-hidden shrink-0 shadow-md flex items-center justify-center">
                    {associada.fotoEsposaUrl ? (
                      <img
                        src={associada.fotoEsposaUrl}
                        alt="Foto da Associada"
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <User className="w-10 h-10 text-white/50" />
                    )}
                  </div>

                  {/* Informações */}
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div>
                      <p className="text-[8px] uppercase tracking-wider text-rose-200 font-semibold">
                        Associada
                      </p>
                      <p className="text-xs font-black uppercase text-white truncate leading-tight drop-shadow-xs">
                        {associada.nomeEsposa}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[8.5px]">
                      <div>
                        <p className="text-rose-200 font-medium uppercase text-[7.5px]">CPF</p>
                        <p className="font-bold font-mono">{associada.cpfEsposa || '—'}</p>
                      </div>
                      <div>
                        <p className="text-rose-200 font-medium uppercase text-[7.5px]">Nascimento</p>
                        <p className="font-bold">{fmtDate(associada.dataNascimentoEsposa)}</p>
                      </div>
                    </div>

                    <div>
                      <p className="text-rose-200 font-medium uppercase text-[7.5px]">
                        Esposo / Ministro Vinculado
                      </p>
                      <p className="font-bold text-[9px] uppercase truncate text-white/95">
                        {associada.ministroNome}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Rodapé do Cartão Frente */}
                <div className="relative z-10 flex items-center justify-between border-t border-white/20 pt-2 text-[8px] text-rose-100 font-semibold">
                  <span>CAMPO: {associada.campo ? associada.campo.toUpperCase() : '—'}</span>
                  <span>SUPERVISÃO: {associada.supervisao ? associada.supervisao.toUpperCase() : '—'}</span>
                </div>
              </div>
            </div>

            {/* ── CARTÃO VERSO ── */}
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">Verso do Cartão</span>
              <div
                ref={versoRef}
                style={{ width: '428px', height: '270px' }}
                className="relative rounded-2xl overflow-hidden shadow-2xl bg-gradient-to-br from-purple-950 via-slate-900 to-rose-950 text-white border-2 border-purple-300/40 select-none flex flex-col justify-between p-4 box-border"
              >
                {/* Elementos de Fundo */}
                <div className="absolute inset-0 bg-white/5 backdrop-blur-3xl pointer-events-none" />

                {/* Topo do Verso */}
                <div className="relative z-10 flex items-center justify-between border-b border-white/10 pb-2">
                  <p className="text-[8.5px] font-bold tracking-wider text-rose-200 uppercase">
                    Assembleia de Deus no Estado do Pará
                  </p>
                  <p className="text-[8px] font-mono text-gray-300">
                    MATR. MINISTRO: {associada.ministroMatricula || '—'}
                  </p>
                </div>

                {/* Meio: Informações + QR Code */}
                <div className="relative z-10 flex items-center justify-between gap-3 my-auto">
                  <div className="space-y-1.5 text-[8.5px] flex-1">
                    <div>
                      <p className="text-gray-400 uppercase text-[7.5px]">Identidade (RG)</p>
                      <p className="font-bold">{associada.rgEsposa || '—'}</p>
                    </div>

                    <div>
                      <p className="text-gray-400 uppercase text-[7.5px]">Tipo Sanguíneo</p>
                      <p className="font-bold text-rose-400">{associada.tipoSanguineoEsposa || '—'}</p>
                    </div>

                    <div>
                      <p className="text-gray-400 uppercase text-[7.5px]">Cargo do Esposo</p>
                      <p className="font-semibold text-white/90">{associada.cargoMinisterial || 'MINISTRO DO EVANGELHO'}</p>
                    </div>
                  </div>

                  {/* QR Code com fundo branco para contraste */}
                  <div className="flex flex-col items-center gap-1 bg-white p-2 rounded-xl shadow-lg shrink-0">
                    <QRCode
                      value={qrCodeUrl}
                      size={70}
                      level="H"
                      includeMargin={false}
                    />
                    <span className="text-[6.5px] font-mono font-bold text-gray-800 tracking-tighter">
                      AUTENTICIDADE
                    </span>
                  </div>
                </div>

                {/* Rodapé do Verso */}
                <div className="relative z-10 border-t border-white/10 pt-2 text-center text-[7.5px] text-gray-400 leading-tight">
                  <p className="font-semibold text-rose-200">
                    AEMADEPA — COMIEADEPA • Av. Governador Magalhães Barata, Belém - PA
                  </p>
                  <p className="text-[6.5px] text-gray-500 mt-0.5">
                    Este documento é pessoal e intransferível. Válido em todo território nacional.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer com Ações */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-white flex-shrink-0">
          <button
            onClick={onClose}
            disabled={gerandoPDF}
            className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold text-sm transition cursor-pointer disabled:opacity-50"
          >
            Fechar
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={handleImprimir}
              disabled={gerandoPDF || Boolean(erroValidacao)}
              className="px-5 py-2.5 bg-slate-800 hover:bg-slate-900 text-white font-bold text-sm rounded-xl shadow transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Printer className="w-4 h-4" />
              {gerandoPDF ? 'Processando...' : 'Imprimir Direto'}
            </button>

            <button
              onClick={handleGerarPDF}
              disabled={gerandoPDF || Boolean(erroValidacao)}
              className="px-6 py-2.5 bg-gradient-to-r from-rose-700 to-purple-800 hover:from-rose-800 hover:to-purple-900 text-white font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {gerandoPDF ? 'Gerando...' : 'Baixar PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
