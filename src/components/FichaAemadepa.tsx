'use client';

import { useRef } from 'react';
import {
  HeartHandshake,
  Printer,
  X,
  User,
} from 'lucide-react';

export interface FichaAemadepaProps {
  associada: {
    id: string; // id do ministro
    uniqueId?: string;
    nomeEsposa: string;
    cpfEsposa: string;
    rgEsposa: string;
    orgaoEmissorEsposa: string;
    dataNascimentoEsposa: string;
    nacionalidadeEsposa: string;
    naturalidadeEsposa: string;
    nomePaiEsposa: string;
    nomeMaeEsposa: string;
    tituloEleitoralEsposa: string;
    foneEsposa: string;
    emailEsposa: string;
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

export default function FichaAemadepa({ associada, onClose }: FichaAemadepaProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const fmt = (v?: string | null) => v || '—';

  const fmtDate = (v?: string | null) => {
    if (!v) return '—';
    const d = new Date(v + (v.length === 10 ? 'T12:00:00' : ''));
    if (isNaN(d.getTime())) return v;
    return d.toLocaleDateString('pt-BR');
  };

  const handlePrint = () => {
    if (!printRef.current) {
      window.print();
      return;
    }
    const printWin = window.open('', '_blank', 'height=1100,width=850');
    if (!printWin) {
      window.print();
      return;
    }
    
    // Pega todo o CSS computado e estilos necessários em CSS puro inline para independência total de CDN/Tailwind assíncrono
    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Ficha Cadastral AEMADEPA — ${associada.nomeEsposa}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    body {
      font-family: Arial, Helvetica, sans-serif;
      background-color: #ffffff;
      color: #1f2937;
      font-size: 11px;
      line-height: 1.35;
      padding: 0;
      margin: 0 auto;
    }
    .print-sheet {
      width: 100%;
      max-width: 100%;
      background: #ffffff;
    }
    .header-box {
      border-bottom: 2px solid #9f1239;
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .header-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .brand-group {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .brand-icon {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #be123c, #6b21a8);
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ffffff;
      font-weight: 900;
      font-size: 18px;
    }
    .brand-title {
      font-size: 18px;
      font-weight: 900;
      color: #881337;
      line-height: 1.1;
      letter-spacing: 0.5px;
    }
    .brand-sub {
      font-size: 9.5px;
      font-weight: bold;
      color: #374151;
      text-transform: uppercase;
      margin-top: 2px;
    }
    .brand-affil {
      font-size: 8.5px;
      color: #6b7280;
      text-transform: uppercase;
    }
    .matricula-badge {
      text-align: right;
      border: 1px solid #fecdd3;
      background: #fff1f2;
      padding: 6px 10px;
      border-radius: 8px;
    }
    .matricula-lbl {
      font-size: 7.5px;
      text-transform: uppercase;
      font-weight: bold;
      color: #9f1239;
      display: block;
    }
    .matricula-val {
      font-family: monospace;
      font-size: 13px;
      font-weight: 900;
      color: #581c87;
    }
    .doc-banner {
      margin-top: 8px;
      text-align: center;
      padding: 4px;
      background-color: #be123c;
      color: #ffffff;
      font-weight: bold;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      border-radius: 4px;
    }
    .section-block {
      margin-bottom: 12px;
      page-break-inside: avoid;
    }
    .section-title {
      background-color: #9f1239;
      color: #ffffff;
      padding: 4px 8px;
      font-size: 10px;
      font-weight: bold;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-top-left-radius: 4px;
      border-top-right-radius: 4px;
    }
    .section-body {
      border: 1px solid #d1d5db;
      border-top: none;
      padding: 10px;
      border-bottom-left-radius: 4px;
      border-bottom-right-radius: 4px;
    }
    .ident-wrapper {
      display: flex;
      gap: 14px;
      align-items: flex-start;
    }
    .photo-box {
      width: 90px;
      height: 120px;
      background-color: #f9fafb;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      overflow: hidden;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .photo-box img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .photo-placeholder {
      color: #9ca3af;
      font-size: 8px;
      font-weight: bold;
      text-align: center;
    }
    .grid-fields {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px 12px;
      flex: 1;
    }
    .col-span-2 {
      grid-column: span 2;
    }
    .col-span-3 {
      grid-column: span 3;
    }
    .f-label {
      font-size: 8px;
      color: #6b7280;
      font-weight: bold;
      text-transform: uppercase;
      display: block;
      margin-bottom: 1px;
    }
    .f-val {
      font-size: 10.5px;
      color: #111827;
      font-weight: 600;
    }
    .f-val-bold {
      font-size: 11.5px;
      font-weight: 800;
      color: #111827;
      text-transform: uppercase;
    }
    .f-val-rose {
      color: #be123c;
      font-weight: 800;
    }
    .f-val-mono {
      font-family: monospace;
      font-weight: bold;
    }
    .grid-2col {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px 12px;
    }
    .footer-proto {
      border-top: 1.5px solid #9f1239;
      padding-top: 8px;
      margin-top: 14px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-family: monospace;
      font-size: 8.5px;
      color: #4b5563;
    }
    .proto-bold {
      font-weight: bold;
      color: #111827;
    }
  </style>
</head>
<body>
  <div class="print-sheet">
    <!-- CABEÇALHO -->
    <div class="header-box">
      <div class="header-top">
        <div class="brand-group">
          <div class="brand-icon">AD</div>
          <div>
            <div class="brand-title">AEMADEPA</div>
            <div class="brand-sub">Associação das Esposas dos Ministros da Assembleia de Deus no Estado do Pará</div>
            <div class="brand-affil">COMIEADEPA • Convenção Interestadual de Ministros da Assembleia de Deus</div>
          </div>
        </div>
        ${associada.numeroAemadepa ? `
          <div class="matricula-badge">
            <span class="matricula-lbl">No AEMADEPA</span>
            <span class="matricula-val">${associada.numeroAemadepa}</span>
          </div>
        ` : ''}
      </div>
      <div class="doc-banner">FICHA CADASTRAL DE ESPOSA DE MINISTRO</div>
    </div>

    <!-- SEÇÃO 1: DADOS DA ESPOSA + FOTO -->
    <div class="section-block">
      <div class="section-title">1. IDENTIFICAÇÃO DA ESPOSA</div>
      <div class="section-body">
        <div class="ident-wrapper">
          <div class="photo-box">
            ${associada.fotoEsposaUrl 
              ? `<img src="${associada.fotoEsposaUrl}" alt="Foto da Esposa" />` 
              : `<div class="photo-placeholder">SEM FOTO</div>`
            }
          </div>
          <div class="grid-fields">
            <div class="col-span-2">
              <span class="f-label">Nome Completo:</span>
              <span class="f-val-bold">${fmt(associada.nomeEsposa)}</span>
            </div>
            <div>
              <span class="f-label">Data de Nascimento:</span>
              <span class="f-val">${fmtDate(associada.dataNascimentoEsposa)}</span>
            </div>
            <div>
              <span class="f-label">CPF:</span>
              <span class="f-val f-val-mono">${fmt(associada.cpfEsposa)}</span>
            </div>
            <div>
              <span class="f-label">RG / Órgão Emissor:</span>
              <span class="f-val">${fmt(associada.rgEsposa)} ${associada.orgaoEmissorEsposa ? `(${associada.orgaoEmissorEsposa})` : ''}</span>
            </div>
            <div>
              <span class="f-label">Tipo Sanguíneo:</span>
              <span class="f-val f-val-rose">${fmt(associada.tipoSanguineoEsposa)}</span>
            </div>
            <div>
              <span class="f-label">Nacionalidade:</span>
              <span class="f-val">${fmt(associada.nacionalidadeEsposa)}</span>
            </div>
            <div>
              <span class="f-label">Naturalidade:</span>
              <span class="f-val">${fmt(associada.naturalidadeEsposa)}</span>
            </div>
            <div>
              <span class="f-label">Título de Eleitor:</span>
              <span class="f-val">${fmt(associada.tituloEleitoralEsposa)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- SEÇÃO 2: FILIAÇÃO E CONTATOS -->
    <div class="section-block">
      <div class="section-title">2. FILIAÇÃO E CONTATOS</div>
      <div class="section-body">
        <div class="grid-2col">
          <div>
            <span class="f-label">Nome do Pai:</span>
            <span class="f-val f-val-bold">${fmt(associada.nomePaiEsposa)}</span>
          </div>
          <div>
            <span class="f-label">Nome da Mãe:</span>
            <span class="f-val f-val-bold">${fmt(associada.nomeMaeEsposa)}</span>
          </div>
          <div>
            <span class="f-label">Telefone / WhatsApp:</span>
            <span class="f-val">${fmt(associada.foneEsposa)}</span>
          </div>
          <div>
            <span class="f-label">E-mail:</span>
            <span class="f-val">${fmt(associada.emailEsposa)}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- SEÇÃO 3: VÍNCULO MINISTERIAL -->
    <div class="section-block">
      <div class="section-title">3. DADOS DO MINISTRO VINCULADO (ESPOSO) E JURISDIÇÃO</div>
      <div class="section-body">
        <div class="grid-fields">
          <div class="col-span-2">
            <span class="f-label">Nome do Ministro:</span>
            <span class="f-val-bold">${fmt(associada.ministroNome)}</span>
          </div>
          <div>
            <span class="f-label">Matrícula COMIEADEPA:</span>
            <span class="f-val f-val-mono">${fmt(associada.ministroMatricula)}</span>
          </div>
          <div>
            <span class="f-label">Cargo Ministerial:</span>
            <span class="f-val">${fmt(associada.cargoMinisterial)}</span>
          </div>
          <div>
            <span class="f-label">Campo / Cidade:</span>
            <span class="f-val">${fmt(associada.campo)}</span>
          </div>
          <div>
            <span class="f-label">Supervisão:</span>
            <span class="f-val">${fmt(associada.supervisao)}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- RODAPÉ COM PROTOCOLO -->
    <div class="footer-proto">
      <span>Secretaria Geral da COMIEADEPA • AEMADEPA</span>
      <span class="proto-bold">
        PROTOCOLO: AEMADEPA-${(associada.uniqueId || associada.id || 'DOC00000').toString().replace(/[^a-zA-Z0-9]/g, '').slice(-8).padStart(8, '0').toUpperCase()}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}
      </span>
      <span>
        Emitido em: ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}
      </span>
    </div>
  </div>
</body>
</html>`);
    printWin.document.close();
    
    // Dispara a impressão após fechamento e renderização do DOM da nova janela
    setTimeout(() => {
      printWin.focus();
      printWin.print();
    }, 250);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full my-4 flex flex-col max-h-[96vh] border border-rose-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header do Modal (Ocultado na impressão) */}
        <div className="flex justify-between items-center px-6 py-4 bg-gradient-to-r from-rose-700 via-pink-700 to-purple-800 text-white flex-shrink-0 print:hidden">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center shadow-inner">
              <HeartHandshake className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight">
                Ficha Cadastral da Esposa — AEMADEPA
              </h2>
              <p className="text-xs text-rose-100">
                Visualização formatada para impressão A4
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
              title="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Documento A4 com Scroll */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-8 bg-slate-100 print:bg-white print:p-0">
          <div
            ref={printRef}
            className="max-w-[780px] mx-auto bg-white p-8 sm:p-10 shadow-lg border border-gray-200 print:shadow-none print:border-none print:p-0 print:max-w-none text-gray-800 font-sans"
            style={{ minHeight: '1050px' }}
          >
            {/* ── CABEÇALHO INSTITUCIONAL DO DOCUMENTO ── */}
            <div className="border-b-2 border-rose-700 pb-4 mb-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-14 h-14 bg-gradient-to-br from-rose-700 to-purple-800 rounded-2xl flex items-center justify-center text-white shadow-md">
                    <HeartHandshake className="w-8 h-8" />
                  </div>
                  <div>
                    <h1 className="text-lg font-black tracking-tight text-rose-900 leading-tight">
                      AEMADEPA
                    </h1>
                    <p className="text-[11px] font-bold text-gray-700 uppercase tracking-wide">
                      Associação das Esposas dos Ministros da Assembleia de Deus no Estado do Pará
                    </p>
                    <p className="text-[9.5px] text-gray-500 font-medium uppercase">
                      COMIEADEPA • Convenção Interestadual de Ministros da Assembleia de Deus
                    </p>
                  </div>
                </div>

                {/* Caixa Número AEMADEPA (apenas quando preenchida) */}
                {associada.numeroAemadepa ? (
                  <div className="text-right border border-rose-200 bg-rose-50/60 p-2.5 rounded-xl shrink-0">
                    <span className="text-[8.5px] uppercase tracking-wider text-rose-800 font-bold block">
                      No AEMADEPA
                    </span>
                    <span className="font-mono text-base font-extrabold text-purple-900">
                      {associada.numeroAemadepa}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="mt-3 text-center py-1 bg-rose-700 text-white font-bold text-xs uppercase tracking-widest rounded-md">
                FICHA CADASTRAL DE ESPOSA DE MINISTRO
              </div>
            </div>

            {/* ── SEÇÃO 1: DADOS DA ESPOSA + FOTO ── */}
            <div className="mb-6">
              <div className="bg-rose-800 text-white px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-t-md flex items-center justify-between">
                <span>1. IDENTIFICAÇÃO DA ESPOSA</span>
              </div>

              <div className="border border-gray-300 border-t-0 p-4 rounded-b-md flex flex-col sm:flex-row gap-5 items-start">
                {/* Foto */}
                <div className="w-24 h-32 rounded-lg bg-gray-50 border border-gray-300 overflow-hidden flex items-center justify-center shrink-0 mx-auto sm:mx-0">
                  {associada.fotoEsposaUrl ? (
                    <img
                      src={associada.fotoEsposaUrl}
                      alt={associada.nomeEsposa}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="text-center text-gray-400 p-2">
                      <User className="w-8 h-8 mx-auto mb-1 opacity-50" />
                      <span className="text-[8.5px] block font-semibold">SEM FOTO</span>
                    </div>
                  )}
                </div>

                {/* Grade de Dados */}
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs w-full">
                  <div className="sm:col-span-2">
                    <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Nome Completo:</span>
                    <span className="font-extrabold text-gray-900 text-sm uppercase">{fmt(associada.nomeEsposa)}</span>
                  </div>
                  <div>
                    <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Data de Nascimento:</span>
                    <span className="font-bold text-gray-800">{fmtDate(associada.dataNascimentoEsposa)}</span>
                  </div>

                  <div>
                    <span className="text-[9.5px] text-gray-500 font-bold uppercase block">CPF:</span>
                    <span className="font-bold text-gray-800 font-mono">{fmt(associada.cpfEsposa)}</span>
                  </div>
                  <div>
                    <span className="text-[9.5px] text-gray-500 font-bold uppercase block">RG / Órgão Emissor:</span>
                    <span className="font-bold text-gray-800">
                      {fmt(associada.rgEsposa)} {associada.orgaoEmissorEsposa && `(${associada.orgaoEmissorEsposa})`}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Tipo Sanguíneo:</span>
                    <span className="font-bold text-rose-700">{fmt(associada.tipoSanguineoEsposa)}</span>
                  </div>

                  <div>
                    <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Nacionalidade:</span>
                    <span className="font-medium text-gray-800">{fmt(associada.nacionalidadeEsposa)}</span>
                  </div>
                  <div>
                    <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Naturalidade:</span>
                    <span className="font-medium text-gray-800">{fmt(associada.naturalidadeEsposa)}</span>
                  </div>
                  <div>
                    <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Título de Eleitor:</span>
                    <span className="font-medium text-gray-800">{fmt(associada.tituloEleitoralEsposa)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* ── SEÇÃO 2: FILIAÇÃO & CONTATOS ── */}
            <div className="mb-6">
              <div className="bg-rose-800 text-white px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-t-md">
                2. FILIAÇÃO E CONTATOS
              </div>

              <div className="border border-gray-300 border-t-0 p-4 rounded-b-md grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Nome do Pai:</span>
                  <span className="font-bold text-gray-800 uppercase">{fmt(associada.nomePaiEsposa)}</span>
                </div>
                <div>
                  <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Nome da Mãe:</span>
                  <span className="font-bold text-gray-800 uppercase">{fmt(associada.nomeMaeEsposa)}</span>
                </div>

                <div>
                  <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Telefone / WhatsApp:</span>
                  <span className="font-bold text-gray-800">{fmt(associada.foneEsposa)}</span>
                </div>
                <div>
                  <span className="text-[9.5px] text-gray-500 font-bold uppercase block">E-mail:</span>
                  <span className="font-bold text-gray-800">{fmt(associada.emailEsposa)}</span>
                </div>
              </div>
            </div>

            {/* ── SEÇÃO 3: DADOS DO MINISTRO VINCULADO & CAMPO ── */}
            <div className="mb-8">
              <div className="bg-rose-800 text-white px-3 py-1 text-xs font-bold uppercase tracking-wider rounded-t-md">
                3. DADOS DO MINISTRO VINCULADO (ESPOSO) E JURISDIÇÃO
              </div>

              <div className="border border-gray-300 border-t-0 p-4 rounded-b-md grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="sm:col-span-2">
                  <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Nome do Ministro:</span>
                  <span className="font-extrabold text-gray-900 text-sm uppercase">{fmt(associada.ministroNome)}</span>
                </div>
                <div>
                  <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Matrícula COMIEADEPA:</span>
                  <span className="font-bold text-gray-800 font-mono">{fmt(associada.ministroMatricula)}</span>
                </div>

                <div>
                  <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Cargo Ministerial:</span>
                  <span className="font-bold text-gray-800 uppercase">{fmt(associada.cargoMinisterial)}</span>
                </div>
                <div>
                  <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Campo / Cidade:</span>
                  <span className="font-bold text-gray-800 uppercase">{fmt(associada.campo)}</span>
                </div>
                <div>
                  <span className="text-[9.5px] text-gray-500 font-bold uppercase block">Supervisão:</span>
                  <span className="font-bold text-gray-800 uppercase">{fmt(associada.supervisao)}</span>
                </div>
              </div>
            </div>

            {/* ── RODAPÉ COM PROTOCOLO DE IMPRESSÃO ── */}
            <div className="pt-4 border-t-2 border-rose-800 text-xs mt-10">
              <div className="flex flex-col sm:flex-row justify-between items-center text-[9.5px] text-gray-600 gap-1 font-mono">
                <span>Secretaria Geral da COMIEADEPA • AEMADEPA</span>
                <span className="font-bold text-gray-800">
                  PROTOCOLO: AEMADEPA-{(associada.uniqueId || associada.id || 'DOC00000').toString().replace(/[^a-zA-Z0-9]/g, '').slice(-8).padStart(8, '0').toUpperCase()}-{new Date().toISOString().slice(0, 10).replace(/-/g, '')}
                </span>
                <span>
                  Emitido em: {new Date().toLocaleDateString('pt-BR')} às {new Date().toLocaleTimeString('pt-BR')}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer (Ocultado na impressão) */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-white flex-shrink-0 print:hidden">
          <button
            onClick={onClose}
            className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold text-sm transition cursor-pointer"
          >
            Fechar
          </button>
          <button
            onClick={handlePrint}
            className="px-6 py-2.5 bg-gradient-to-r from-rose-700 to-purple-800 hover:from-rose-800 hover:to-purple-900 text-white font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition flex items-center gap-2 cursor-pointer"
          >
            <Printer className="w-4 h-4" />
            Imprimir Ficha (A4)
          </button>
        </div>
      </div>
    </div>
  );
}
