'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { gerarCertificadoPDF, CertConfig, CertDados } from '@/lib/certificado-pdf';

interface CertificadoData {
  valido:  boolean;
  motivo?: string;
  config?: CertConfig;
  dados?:  CertDados;
}

export default function CertificadoPublicoPage() {
  const params = useParams();
  const codigo = (params?.codigo as string ?? '').toUpperCase();

  const [certData,   setCertData]   = useState<CertificadoData | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [gerando,    setGerando]    = useState(false);

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

  async function baixarPDF() {
    if (!certData?.valido || !certData.config || !certData.dados) return;
    setGerando(true);
    try {
      await gerarCertificadoPDF(certData.config, certData.dados, 'save');
    } catch (err) {
      alert('Erro ao gerar PDF: ' + String(err));
    } finally {
      setGerando(false);
    }
  }

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
    return (
      <PaginaBase>
        <div className="max-w-md mx-auto text-center py-16">
          <div className="w-20 h-20 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <span className="text-4xl">❌</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-800 mb-3">Certificado não disponível</h1>
          <p className="text-gray-500 text-sm leading-relaxed">
            {certData?.motivo ?? 'Código de certificado não encontrado.'}
          </p>
          <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl px-5 py-4 text-left">
            <p className="text-xs font-bold text-amber-700 mb-2">Código verificado:</p>
            <p className="font-mono text-sm text-amber-900 font-bold">{codigo}</p>
          </div>
        </div>
      </PaginaBase>
    );
  }

  // ── Válido ───────────────────────────────────────────────────
  const { dados } = certData;
  if (!dados) return null;

  return (
    <PaginaBase>
      <div className="max-w-xl mx-auto py-10 px-4">

        {/* Ícone de sucesso */}
        <div className="text-center mb-8">
          <div className="w-24 h-24 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 shadow-sm">
            <span className="text-5xl">🎓</span>
          </div>
          <h1 className="text-2xl font-black text-gray-800">Certificado Válido!</h1>
          <p className="text-gray-500 text-sm mt-1">Este certificado é autêntico e foi emitido pelo sistema GestãoServus.</p>
        </div>

        {/* Card com dados */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden mb-6">
          <div className="bg-[#0D2B4E] px-5 py-4">
            <p className="text-white/60 text-xs uppercase tracking-widest font-bold">Evento</p>
            <p className="text-white font-bold text-lg leading-tight mt-0.5">{dados.evento}</p>
            <p className="text-white/60 text-sm mt-1">📅 {dados.data_evento}</p>
          </div>

          <div className="px-5 py-5 space-y-3">
            <InfoRow label="Participante"   value={dados.nome}              bold />
            {dados.cargo       && <InfoRow label="Modalidade"    value={dados.cargo}           />}
            {dados.supervisao  && <InfoRow label="Supervisão"    value={dados.supervisao}      />}
            {dados.campo       && <InfoRow label="Campo"         value={dados.campo}           />}
            <InfoRow label="Código" value={dados.codigo} mono />
          </div>
        </div>

        {/* Botão download */}
        <button
          onClick={baixarPDF}
          disabled={gerando}
          className="w-full bg-[#123b63] hover:bg-[#0f2a45] active:scale-[0.98] text-white font-black py-4 rounded-2xl text-base transition shadow-lg shadow-[#123b63]/20 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {gerando ? (
            <>
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Gerando PDF...
            </>
          ) : (
            '📄 Baixar Certificado em PDF'
          )}
        </button>

        <p className="text-center text-xs text-gray-400 mt-3">
          Documento gerado localmente no seu dispositivo. Nenhum dado é enviado para servidores externos.
        </p>
      </div>
    </PaginaBase>
  );
}

// ─── Subcomponentes ───────────────────────────────────────────
function PaginaBase({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#0D2B4E] text-white shadow-md">
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
      <main className="max-w-3xl mx-auto px-4">{children}</main>
      <footer className="text-center py-8 text-xs text-gray-400 border-t border-gray-200 mt-8">
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
