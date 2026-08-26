'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Award,
  Calendar,
  MapPin,
  ShieldCheck,
  Download,
  ExternalLink,
  AlertCircle,
  Clock,
  User,
  CheckCircle2,
} from 'lucide-react';
import { gerarCertificadoPDF, type CertConfig, type CertDados } from '@/lib/certificado-pdf';

interface EventoInfo {
  id: string;
  nome: string;
  slug: string;
  departamento: string;
  dataInicio: string | null;
  dataFim: string | null;
  local: string | null;
  cidade: string | null;
}

interface CertificadoConfig {
  arteUrl: string | null;
  textoCorpo: string | null;
  rodapeTexto: string | null;
  assinaturaNome: string | null;
  assinaturaCargo: string | null;
  orientacao: 'landscape' | 'portrait';
  fonteTamanho: number;
  elementosJson: any;
}

interface CertificadoItem {
  id: string;
  inscricaoId: string;
  eventoId: string;
  codigoValidacao: string;
  urlValidacao: string;
  nomeInscrito: string;
  cargo: string | null;
  campo: string | null;
  supervisao: string | null;
  evento: EventoInfo;
  config: CertificadoConfig | null;
  checkinAt: string | null;
  certificadoEnviado: boolean;
  createdAt: string;
}

interface ApiResponse {
  ministro: {
    id: string;
    nome: string;
  };
  total: number;
  certificados: CertificadoItem[];
}

function fmtData(dataStr: string | null): string {
  if (!dataStr) return '—';
  const clean = dataStr.slice(0, 10);
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dataStr;
}

function fmtPeriodo(inicio: string | null, fim: string | null): string {
  if (!inicio && !fim) return 'Data não especificada';
  if (inicio && !fim) return fmtData(inicio);
  if (inicio === fim) return fmtData(inicio);
  return `${fmtData(inicio)} a ${fmtData(fim)}`;
}

export default function MeusCertificadosPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [baixandoId, setBaixandoId] = useState<string | null>(null);
  const [msgSucessoId, setMsgSucessoId] = useState<string | null>(null);

  useEffect(() => {
    carregarCertificados();
  }, []);

  const carregarCertificados = () => {
    setLoading(true);
    setErro('');
    fetch('/api/portal-ministro/certificados')
      .then(async (res) => {
        if (!res.ok) throw new Error('Falha ao carregar certificados.');
        return res.json();
      })
      .then((json: ApiResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setErro('Não foi possível carregar seus certificados. Verifique sua conexão.');
        setLoading(false);
      });
  };

  const handleBaixarPdf = async (cert: CertificadoItem) => {
    if (!cert.config) return;

    setBaixandoId(cert.id);
    try {
      const configPDF: CertConfig = {
        arte_url: cert.config.arteUrl,
        texto_corpo: cert.config.textoCorpo || 'Certificamos que {NOME} participou do evento {EVENTO}.',
        rodape_texto: cert.config.rodapeTexto,
        assinatura_nome: cert.config.assinaturaNome,
        assinatura_cargo: cert.config.assinaturaCargo,
        orientacao: cert.config.orientacao || 'landscape',
        fonte_tamanho: cert.config.fonteTamanho || 16,
      };

      const appOrigin = typeof window !== 'undefined' ? window.location.origin : '';
      const dadosPDF: CertDados = {
        nome: cert.nomeInscrito,
        evento: cert.evento.nome,
        data_evento: fmtPeriodo(cert.evento.dataInicio, cert.evento.dataFim),
        cargo: cert.cargo,
        campo: cert.campo,
        supervisao: cert.supervisao,
        codigo: cert.codigoValidacao,
        validacao_url: `${appOrigin}${cert.urlValidacao}`,
      };

      await gerarCertificadoPDF(configPDF, dadosPDF, 'save');

      setMsgSucessoId(cert.id);
      setTimeout(() => setMsgSucessoId(null), 3000);
    } catch (e) {
      console.error('Erro ao gerar certificado:', e);
      alert('Ocorreu um erro ao gerar o PDF do certificado.');
    } finally {
      setBaixandoId(null);
    }
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meus Certificados</h1>
          <p className="text-sm text-gray-500 mt-1">Carregando seus certificados e declarações oficiais...</p>
        </div>
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100 shadow-sm">
          <div className="w-10 h-10 border-3 border-[#0D2B4E]/20 border-t-[#0D2B4E] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-semibold text-gray-600">Localizando certificados emitidos...</p>
        </div>
      </div>
    );
  }

  if (erro || !data) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meus Certificados</h1>
          <p className="text-sm text-gray-500 mt-1">Certificados oficiais de participação em convenções e eventos.</p>
        </div>
        <div className="bg-white rounded-2xl p-8 text-center border border-red-100 shadow-sm">
          <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <AlertCircle size={24} />
          </div>
          <p className="text-sm font-bold text-gray-800 mb-1">Ops! Ocorreu um problema</p>
          <p className="text-xs text-gray-500 max-w-md mx-auto mb-5">{erro || 'Erro ao consultar certificados.'}</p>
          <button
            onClick={carregarCertificados}
            className="px-5 py-2.5 bg-[#0D2B4E] hover:bg-[#163f6d] text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  const certificados = data.certificados || [];

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      
      {/* ── CABEÇALHO ── */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-[#0D2B4E] text-xs font-semibold mb-2 border border-blue-100">
          <Award size={14} className="text-[#0D2B4E]" />
          Documentos & Certificações Ministeriais
        </div>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
          Meus Certificados
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Certificados oficiais de participação em convenções e eventos da COMIEADEPA.
        </p>
      </div>

      {/* ── LISTA DE CERTIFICADOS ── */}
      {certificados.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {certificados.map((cert) => {
            const isBaixando = baixandoId === cert.id;
            const baixouComSucesso = msgSucessoId === cert.id;
            const temConfig = !!cert.config;

            return (
              <div
                key={cert.id}
                className="bg-white rounded-3xl border border-gray-100 shadow-lg shadow-slate-100/80 overflow-hidden flex flex-col justify-between hover:shadow-xl transition-all"
              >
                {/* Cabeçalho do Card */}
                <div className="bg-gradient-to-r from-[#0D2B4E] to-[#1a4a7a] p-5 text-white">
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2.5 py-0.5 bg-white/10 backdrop-blur-md rounded-md text-[10px] font-extrabold text-blue-200 uppercase tracking-wider border border-white/10">
                      {cert.evento.departamento || 'AGO'}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300 bg-emerald-950/40 px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                      <ShieldCheck size={12} className="text-emerald-400" />
                      Autenticidade Verificada
                    </span>
                  </div>

                  <h2 className="text-base font-extrabold mt-3 line-clamp-2 leading-snug">
                    {cert.evento.nome}
                  </h2>
                </div>

                {/* Corpo do Card */}
                <div className="p-5 sm:p-6 flex-1 flex flex-col justify-between space-y-4">
                  <div className="space-y-2.5 text-xs text-gray-600">
                    <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-2.5 border border-gray-100">
                      <Calendar size={14} className="text-[#0D2B4E] flex-shrink-0" />
                      <span className="font-semibold text-gray-800">
                        {fmtPeriodo(cert.evento.dataInicio, cert.evento.dataFim)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-2.5 border border-gray-100">
                      <MapPin size={14} className="text-[#0D2B4E] flex-shrink-0" />
                      <span className="font-semibold text-gray-800 truncate">
                        {cert.evento.cidade || 'Pará'} {cert.evento.local ? `· ${cert.evento.local}` : ''}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 bg-blue-50/60 rounded-xl p-2.5 border border-blue-100/60">
                      <User size={14} className="text-[#0D2B4E] flex-shrink-0" />
                      <div className="min-w-0">
                        <p className="font-bold text-[#0D2B4E] truncate leading-tight">
                          {cert.nomeInscrito}
                        </p>
                        {cert.cargo && (
                          <p className="text-[10px] text-gray-500 mt-0.5 uppercase font-medium">
                            {cert.cargo} {cert.campo ? `· ${cert.campo}` : ''}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Código de Validação */}
                  <div className="pt-2 border-t border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-gray-400 font-bold uppercase">Código do Certificado</p>
                      <p className="text-xs font-mono font-bold text-gray-800 mt-0.5">
                        {cert.codigoValidacao}
                      </p>
                    </div>

                    <span className="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-md flex items-center gap-1">
                      <CheckCircle2 size={12} />
                      Disponível
                    </span>
                  </div>

                  {/* Ações: Download PDF e Validação Pública */}
                  <div className="pt-2 flex flex-col sm:flex-row gap-2">
                    {temConfig ? (
                      <button
                        onClick={() => handleBaixarPdf(cert)}
                        disabled={isBaixando}
                        className="flex-1 inline-flex items-center justify-center gap-2 py-2.5 px-4 bg-[#0D2B4E] hover:bg-[#163f6d] text-white text-xs font-bold rounded-xl transition-all shadow-sm disabled:opacity-60"
                      >
                        <Download size={14} className={isBaixando ? 'animate-bounce' : ''} />
                        {isBaixando ? 'Gerando PDF...' : baixouComSucesso ? 'Baixado com Sucesso!' : 'Baixar Certificado em PDF'}
                      </button>
                    ) : (
                      <div className="flex-1 py-2 px-3 bg-gray-100 rounded-xl text-center text-[11px] text-gray-500 font-medium">
                        Arte em homologação pela Secretaria
                      </div>
                    )}

                    <a
                      href={cert.urlValidacao}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1.5 py-2.5 px-3 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 text-xs font-bold rounded-xl transition-all shadow-sm"
                      title="Ver autenticidade pública"
                    >
                      <span>Autenticidade</span>
                      <ExternalLink size={13} />
                    </a>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Estado Vazio */
        <div className="bg-white rounded-3xl p-10 text-center border border-gray-100 shadow-sm max-w-lg mx-auto">
          <div className="w-16 h-16 bg-blue-50 text-[#0D2B4E] rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-inner">
            <Award size={32} />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Nenhum certificado disponível no momento</h2>
          <p className="text-xs text-gray-500 leading-relaxed max-w-sm mx-auto mb-6">
            Os certificados são liberados automaticamente após a realização de eventos em que você esteve presente com check-in e inscrição confirmados.
          </p>

          <Link
            href="/portal-ministro/eventos"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#0D2B4E] hover:bg-[#163f6d] text-white rounded-xl text-xs font-bold transition-all shadow-sm"
          >
            <Clock size={14} />
            Ver Minhas Inscrições e Eventos
          </Link>
        </div>
      )}

    </div>
  );
}
