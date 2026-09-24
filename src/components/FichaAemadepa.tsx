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
    const printWin = window.open('', '', 'height=1100,width=850');
    if (!printWin) {
      window.print();
      return;
    }
    printWin.document.write(`<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Ficha Cadastral AEMADEPA — ${associada.nomeEsposa}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    @page {
      size: A4 portrait;
      margin: 8mm 10mm;
    }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }
    .print-document {
      width: 100%;
      max-width: 100%;
      margin: 0;
      padding: 0 !important;
      box-shadow: none !important;
      border: none !important;
    }
    * {
      box-sizing: border-box;
    }
  </style>
</head>
<body>
  <div class="print-document">
    ${printRef.current.innerHTML}
  </div>
</body>
</html>`);
    printWin.document.close();
    setTimeout(() => {
      printWin.focus();
      printWin.print();
    }, 450);
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
              onClick={handlePrint}
              className="px-4 py-2 bg-white text-rose-800 hover:bg-rose-50 font-bold text-xs uppercase tracking-wider rounded-lg shadow transition flex items-center gap-1.5 cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              Imprimir Ficha
            </button>
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
