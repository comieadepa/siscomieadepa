'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  Calendar,
  QrCode,
  Bed,
  Utensils,
  MapPin,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Maximize2,
  X,
  Copy,
  ExternalLink,
  Sparkles,
  Ticket,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface EventoData {
  id: string;
  nome: string;
  slug: string;
  departamento: string;
  dataInicio: string | null;
  dataFim: string | null;
  local: string;
  cidade: string;
  bannerUrl: string | null;
  status: string;
}

interface PagamentoData {
  status: 'pago' | 'pendente' | 'isento' | 'cancelado' | string;
  valor: number;
  forma: string | null;
  invoiceUrl: string | null;
  pixCopiaCola: string | null;
  pixQrCode: string | null;
  vencimento: string | null;
}

interface CrachaData {
  qrCode: string | null;
  checkinRealizado: boolean;
  checkinAt: string | null;
}

interface HospedagemData {
  solicitada: boolean;
  alojamentoNome: string | null;
  setor: string | null;
  endereco: string | null;
  numeroLeito: string | null;
  tipoLeito: string | null;
  posicao: string | null;
  statusHospedagem: string;
  checkinRealizado: boolean;
  checkinAt: string | null;
  necessidadeEspecial: boolean;
  camaInferior: boolean;
}

interface RefeicoesData {
  contratada: boolean;
  total: number;
  usadas: number;
  saldo: number;
}

interface InscricaoItem {
  id: string;
  nomeInscrito: string;
  cpf: string;
  tipoInscricao: string;
  statusPagamento: string;
  valorFinal: number;
  formaPagamento: string | null;
  createdAt: string;
  evento: EventoData;
  pagamento: PagamentoData;
  cracha: CrachaData;
  hospedagem: HospedagemData;
  refeicoes: RefeicoesData;
}

interface EventoAberto {
  id: string;
  nome: string;
  slug: string;
  departamento: string;
  data_inicio: string | null;
  data_fim: string | null;
  local: string;
  cidade: string;
  banner_url: string | null;
  valor_inscricao: number;
  permite_hospedagem: boolean;
  permite_alimentacao: boolean;
  inscricoes_abertas: boolean;
  status: string;
}

interface ApiResponse {
  ministro: {
    id: string;
    nome: string;
  };
  totalInscricoes: number;
  inscricoes: InscricaoItem[];
  eventosAbertos: EventoAberto[];
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
  if (!inicio && !fim) return 'Data a definir';
  if (inicio && !fim) return fmtData(inicio);
  if (inicio === fim) return fmtData(inicio);
  return `${fmtData(inicio)} a ${fmtData(fim)}`;
}

export default function MeusEventosPage() {
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [fullscreenCracha, setFullscreenCracha] = useState<InscricaoItem | null>(null);
  const [expandedInscricaoId, setExpandedInscricaoId] = useState<string | null>(null);
  const [copiadoPix, setCopiadoPix] = useState(false);

  useEffect(() => {
    carregarEventos();
  }, []);

  const carregarEventos = () => {
    setLoading(true);
    setErro('');
    fetch('/api/portal-ministro/eventos')
      .then(async (res) => {
        if (!res.ok) {
          throw new Error('Falha ao carregar eventos.');
        }
        return res.json();
      })
      .then((json: ApiResponse) => {
        setData(json);
        setLoading(false);
      })
      .catch(() => {
        setErro('Não foi possível carregar os dados dos seus eventos. Verifique sua conexão.');
        setLoading(false);
      });
  };

  const handleCopiarPix = (codigo: string) => {
    if (!codigo) return;
    navigator.clipboard.writeText(codigo);
    setCopiadoPix(true);
    setTimeout(() => setCopiadoPix(false), 2500);
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meus Eventos</h1>
          <p className="text-sm text-gray-500 mt-1">Carregando suas inscrições e credenciais...</p>
        </div>
        <div className="bg-white rounded-2xl p-12 text-center border border-gray-100 shadow-sm">
          <div className="w-10 h-10 border-3 border-[#0D2B4E]/20 border-t-[#0D2B4E] rounded-full animate-spin mx-auto mb-4" />
          <p className="text-sm font-semibold text-gray-600">Buscando inscrições ministeriais...</p>
        </div>
      </div>
    );
  }

  if (erro || !data) {
    return (
      <div className="max-w-4xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Meus Eventos</h1>
          <p className="text-sm text-gray-500 mt-1">Suas inscrições, credenciais, hospedagem e refeições.</p>
        </div>
        <div className="bg-white rounded-2xl p-8 text-center border border-red-100 shadow-sm">
          <div className="w-12 h-12 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <AlertCircle size={24} />
          </div>
          <p className="text-sm font-bold text-gray-800 mb-1">Ops! Ocorreu um problema</p>
          <p className="text-xs text-gray-500 max-w-md mx-auto mb-5">{erro || 'Erro ao consultar seus eventos.'}</p>
          <button
            onClick={carregarEventos}
            className="px-5 py-2.5 bg-[#0D2B4E] hover:bg-[#163f6d] text-white rounded-xl text-xs font-bold transition-colors shadow-sm"
          >
            Tentar Novamente
          </button>
        </div>
      </div>
    );
  }

  const inscricoes = data.inscricoes || [];
  const eventoDestaque = inscricoes.length > 0 ? inscricoes[0] : null;
  const historicoInscricoes = inscricoes.length > 1 ? inscricoes.slice(1) : [];
  const eventosAbertos = data.eventosAbertos || [];

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      
      {/* ── CABEÇALHO ── */}
      <div>
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-[#0D2B4E] text-xs font-semibold mb-2 border border-blue-100">
          <Ticket size={14} className="text-[#0D2B4E]" />
          Participação em Convenções e Congressos
        </div>
        <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">
          Meus Eventos
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Suas inscrições, credenciais, hospedagem e refeições.
        </p>
      </div>

      {/* ── SEÇÃO 1: EVENTO EM DESTAQUE (PRÓXIMO / ATIVO) ── */}
      {eventoDestaque ? (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-xl shadow-slate-100/80 overflow-hidden">
          
          {/* Banner do Evento */}
          {eventoDestaque.evento.bannerUrl ? (
            <div className="w-full h-44 sm:h-56 relative bg-slate-900">
              <img
                src={eventoDestaque.evento.bannerUrl}
                alt={eventoDestaque.evento.nome}
                className="w-full h-full object-cover opacity-90"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-black/20" />
              <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between">
                <span className="px-3 py-1 bg-white/90 backdrop-blur-md rounded-full text-[11px] font-extrabold text-[#0D2B4E] uppercase tracking-wider shadow-sm">
                  {eventoDestaque.evento.departamento || 'AGO'}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold shadow-sm ${
                    eventoDestaque.statusPagamento === 'pago' || eventoDestaque.statusPagamento === 'isento'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-amber-500 text-white'
                  }`}
                >
                  {eventoDestaque.statusPagamento === 'pago'
                    ? 'Inscrição Confirmada'
                    : eventoDestaque.statusPagamento === 'isento'
                    ? 'Inscrição Isenta'
                    : 'Aguardando Pagamento'}
                </span>
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-br from-[#0D2B4E] to-[#1a4a7a] p-6 text-white relative overflow-hidden">
              <div className="flex items-center justify-between gap-2">
                <span className="px-3 py-1 bg-white/10 backdrop-blur-md rounded-full text-[11px] font-extrabold text-blue-200 uppercase tracking-wider border border-white/10">
                  {eventoDestaque.evento.departamento || 'AGO'}
                </span>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold ${
                    eventoDestaque.statusPagamento === 'pago' || eventoDestaque.statusPagamento === 'isento'
                      ? 'bg-emerald-500 text-white'
                      : 'bg-amber-400 text-slate-900'
                  }`}
                >
                  {eventoDestaque.statusPagamento === 'pago'
                    ? 'Inscrição Confirmada'
                    : eventoDestaque.statusPagamento === 'isento'
                    ? 'Inscrição Isenta'
                    : 'Aguardando Pagamento'}
                </span>
              </div>
              <h2 className="text-xl sm:text-2xl font-black mt-3 leading-snug">
                {eventoDestaque.evento.nome}
              </h2>
            </div>
          )}

          <div className="p-6 sm:p-7 space-y-6">
            
            {/* Informações Básicas do Evento */}
            <div>
              {!eventoDestaque.evento.bannerUrl && (
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-1">
                  Evento em Destaque
                </p>
              )}
              {eventoDestaque.evento.bannerUrl && (
                <h2 className="text-xl font-extrabold text-gray-900 mb-2">
                  {eventoDestaque.evento.nome}
                </h2>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs text-gray-600 mt-2">
                <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-2.5 border border-gray-100">
                  <Calendar size={15} className="text-[#0D2B4E] flex-shrink-0" />
                  <span className="font-semibold text-gray-800">
                    {fmtPeriodo(eventoDestaque.evento.dataInicio, eventoDestaque.evento.dataFim)}
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-gray-50 rounded-xl p-2.5 border border-gray-100">
                  <MapPin size={15} className="text-[#0D2B4E] flex-shrink-0" />
                  <span className="font-semibold text-gray-800 truncate">
                    {eventoDestaque.evento.local ? `${eventoDestaque.evento.local} · ` : ''}
                    {eventoDestaque.evento.cidade || 'Pará'}
                  </span>
                </div>
              </div>
            </div>

            {/* Alerta de Pagamento Pendente com PIX */}
            {eventoDestaque.statusPagamento === 'pendente' && (
              <div className="bg-amber-50/90 border border-amber-200 rounded-2xl p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[11px] font-extrabold uppercase tracking-wider text-amber-800 bg-amber-100 px-2 py-0.5 rounded-md">
                      Pagamento Pendente
                    </span>
                    <p className="text-base font-extrabold text-amber-950 mt-1">
                      Valor: R$ {Number(eventoDestaque.valorFinal).toFixed(2).replace('.', ',')}
                    </p>
                    <p className="text-xs text-amber-800 mt-0.5">
                      Efetue o pagamento para garantir a confirmação e liberação do seu crachá.
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap gap-2.5">
                  {eventoDestaque.pagamento.pixCopiaCola && (
                    <button
                      onClick={() => handleCopiarPix(eventoDestaque.pagamento.pixCopiaCola!)}
                      className="inline-flex items-center gap-2 px-4 py-2 bg-[#0D2B4E] hover:bg-[#163f6d] text-white text-xs font-bold rounded-xl transition-all shadow-sm"
                    >
                      <Copy size={14} />
                      {copiadoPix ? 'PIX Copiado!' : 'Copiar Chave PIX'}
                    </button>
                  )}

                  {eventoDestaque.pagamento.invoiceUrl && (
                    <a
                      href={eventoDestaque.pagamento.invoiceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2 bg-white hover:bg-amber-100/50 text-amber-900 border border-amber-300 text-xs font-bold rounded-xl transition-all"
                    >
                      <ExternalLink size={14} />
                      Ver Fatura / Pagar
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* ── GRID DOS MÓDULOS (CRACHÁ, HOSPEDAGEM, REFEIÇÕES) ── */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              
              {/* 1. CRACHÁ VIRTUAL */}
              <div className="bg-gradient-to-br from-blue-50/70 to-indigo-50/40 rounded-2xl p-5 border border-blue-100 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#0D2B4E]">
                      <QrCode size={16} /> Crachá Virtual
                    </span>
                    {eventoDestaque.cracha.checkinRealizado ? (
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                        <CheckCircle2 size={11} /> Check-in OK
                      </span>
                    ) : (
                      <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        Portaria
                      </span>
                    )}
                  </div>

                  {eventoDestaque.cracha.qrCode ? (
                    <div className="flex flex-col items-center py-2">
                      <div className="bg-white p-3 rounded-xl shadow-sm border border-blue-100/80">
                        <QRCodeSVG
                          value={eventoDestaque.cracha.qrCode}
                          size={110}
                          level="M"
                        />
                      </div>
                      <p className="text-[10px] font-mono text-gray-500 mt-2 font-medium truncate max-w-[150px]">
                        {eventoDestaque.cracha.qrCode}
                      </p>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-gray-400">
                      Crachá em processamento
                    </div>
                  )}
                </div>

                {eventoDestaque.cracha.qrCode && (
                  <button
                    onClick={() => setFullscreenCracha(eventoDestaque)}
                    className="w-full mt-3 inline-flex items-center justify-center gap-1.5 py-2.5 bg-white hover:bg-blue-50 text-[#0D2B4E] border border-blue-200 text-xs font-bold rounded-xl transition-all shadow-sm"
                  >
                    <Maximize2 size={13} />
                    Ver em Tela Cheia
                  </button>
                )}
              </div>

              {/* 2. HOSPEDAGEM & LEITO */}
              <div className="bg-gray-50/80 rounded-2xl p-5 border border-gray-100 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-800">
                      <Bed size={16} className="text-[#0D2B4E]" /> Hospedagem
                    </span>
                    {eventoDestaque.hospedagem.solicitada ? (
                      <span className="bg-blue-100 text-[#0D2B4E] text-[10px] font-bold px-2 py-0.5 rounded-full">
                        Contratada
                      </span>
                    ) : (
                      <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        Não Solicitada
                      </span>
                    )}
                  </div>

                  {eventoDestaque.hospedagem.solicitada ? (
                    <div className="space-y-2 text-xs">
                      <div>
                        <p className="text-[11px] text-gray-400 font-medium">Alojamento / Setor</p>
                        <p className="font-bold text-gray-900 truncate">
                          {eventoDestaque.hospedagem.alojamentoNome || 'Alojamento a definir'}
                        </p>
                        {eventoDestaque.hospedagem.setor && (
                          <p className="text-[11px] text-gray-500 font-medium">
                            {eventoDestaque.hospedagem.setor}
                          </p>
                        )}
                      </div>

                      <div className="pt-2 border-t border-gray-200/60 grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[11px] text-gray-400 font-medium">Leito</p>
                          <p className="font-bold text-[#0D2B4E] text-sm">
                            {eventoDestaque.hospedagem.numeroLeito || 'Em alocação'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[11px] text-gray-400 font-medium">Posição</p>
                          <p className="font-bold text-gray-800 capitalize">
                            {eventoDestaque.hospedagem.posicao || 'Padrão'}
                          </p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-gray-400">
                      Hospedagem individual ou externa não vinculada.
                    </div>
                  )}
                </div>

                {eventoDestaque.hospedagem.checkinRealizado && (
                  <div className="mt-3 text-[11px] bg-emerald-50 text-emerald-800 rounded-lg p-2 flex items-center gap-1.5 font-medium">
                    <CheckCircle2 size={13} className="text-emerald-600" />
                    Check-in no leito confirmado
                  </div>
                )}
              </div>

              {/* 3. REFEIÇÕES & SALDO */}
              <div className="bg-gray-50/80 rounded-2xl p-5 border border-gray-100 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-gray-800">
                      <Utensils size={16} className="text-[#0D2B4E]" /> Refeições
                    </span>
                    {eventoDestaque.refeicoes.contratada ? (
                      <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        Ativo
                      </span>
                    ) : (
                      <span className="bg-gray-200 text-gray-600 text-[10px] font-bold px-2 py-0.5 rounded-full">
                        Não Incluso
                      </span>
                    )}
                  </div>

                  {eventoDestaque.refeicoes.contratada ? (
                    <div className="space-y-3">
                      <div className="flex items-baseline justify-between">
                        <span className="text-2xl font-black text-[#0D2B4E]">
                          {eventoDestaque.refeicoes.saldo}
                        </span>
                        <span className="text-xs text-gray-500 font-medium">
                          de {eventoDestaque.refeicoes.total} disponíveis
                        </span>
                      </div>

                      {/* Barra de Progresso do Saldo */}
                      <div>
                        <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-blue-500 to-[#0D2B4E] rounded-full transition-all duration-500"
                            style={{
                              width: `${
                                eventoDestaque.refeicoes.total > 0
                                  ? Math.min(
                                      100,
                                      Math.max(
                                        0,
                                        (eventoDestaque.refeicoes.saldo / eventoDestaque.refeicoes.total) * 100,
                                      ),
                                    )
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                        <div className="flex justify-between text-[10px] text-gray-400 mt-1 font-medium">
                          <span>{eventoDestaque.refeicoes.usadas} utilizadas</span>
                          <span>{eventoDestaque.refeicoes.saldo} restantes</span>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="py-6 text-center text-xs text-gray-400">
                      Alimentação não inclusa nesta inscrição.
                    </div>
                  )}
                </div>

                <div className="mt-3 text-[10px] text-gray-400 text-center leading-tight">
                  Apresente seu crachá no refeitório
                </div>
              </div>

            </div>

          </div>
        </div>
      ) : (
        /* Caso sem inscrições */
        <div className="bg-white rounded-3xl p-8 sm:p-10 text-center border border-gray-100 shadow-sm">
          <div className="w-14 h-14 bg-blue-50 text-[#0D2B4E] rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-inner">
            <Ticket size={28} />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Nenhuma inscrição ativa</h2>
          <p className="text-xs text-gray-500 max-w-sm mx-auto mb-6">
            Você ainda não possui inscrições confirmadas para os próximos eventos da convenção.
          </p>
          {eventosAbertos.length > 0 && (
            <p className="text-xs font-semibold text-[#0D2B4E]">
              Confira abaixo os eventos com inscrições abertas.
            </p>
          )}
        </div>
      )}

      {/* ── SEÇÃO 2: HISTÓRICO DE DEMAIS INSCRIÇÕES ── */}
      {historicoInscricoes.length > 0 && (
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-gray-900 tracking-tight flex items-center gap-2">
            <Clock size={18} className="text-[#0D2B4E]" />
            Outras Inscrições e Histórico
          </h2>

          <div className="space-y-3">
            {historicoInscricoes.map((item) => {
              const expanded = expandedInscricaoId === item.id;
              return (
                <div
                  key={item.id}
                  className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden transition-all"
                >
                  <div
                    onClick={() => setExpandedInscricaoId(expanded ? null : item.id)}
                    className="p-4 sm:p-5 flex items-center justify-between cursor-pointer hover:bg-gray-50/70 transition-colors"
                  >
                    <div className="min-w-0 flex-1 pr-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="px-2 py-0.5 bg-blue-50 text-[#0D2B4E] text-[10px] font-extrabold rounded-md uppercase">
                          {item.evento.departamento || 'AGO'}
                        </span>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-bold rounded-md ${
                            item.statusPagamento === 'pago' || item.statusPagamento === 'isento'
                              ? 'bg-emerald-50 text-emerald-700'
                              : 'bg-amber-50 text-amber-700'
                          }`}
                        >
                          {item.statusPagamento === 'pago'
                            ? 'Pago'
                            : item.statusPagamento === 'isento'
                            ? 'Isento'
                            : 'Pendente'}
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-gray-900 truncate">
                        {item.evento.nome}
                      </h3>
                      <p className="text-xs text-gray-500 mt-0.5">
                        {fmtPeriodo(item.evento.dataInicio, item.evento.dataFim)} · {item.evento.cidade || 'Pará'}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs font-bold text-gray-700 hidden sm:inline">
                        R$ {Number(item.valorFinal).toFixed(2).replace('.', ',')}
                      </span>
                      {expanded ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
                    </div>
                  </div>

                  {/* Conteúdo Expandido */}
                  {expanded && (
                    <div className="p-4 sm:p-5 bg-gray-50 border-t border-gray-100 text-xs space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        <div className="bg-white p-3 rounded-xl border border-gray-100">
                          <p className="text-[10px] text-gray-400 font-bold uppercase">Pagamento</p>
                          <p className="font-bold text-gray-800 mt-0.5 capitalize">
                            {item.statusPagamento} ({item.formaPagamento || 'PIX'})
                          </p>
                        </div>
                        <div className="bg-white p-3 rounded-xl border border-gray-100">
                          <p className="text-[10px] text-gray-400 font-bold uppercase">Hospedagem</p>
                          <p className="font-bold text-gray-800 mt-0.5 truncate">
                            {item.hospedagem.alojamentoNome ? `${item.hospedagem.alojamentoNome} (Leito ${item.hospedagem.numeroLeito || '—'})` : 'Não inclusa'}
                          </p>
                        </div>
                        <div className="bg-white p-3 rounded-xl border border-gray-100">
                          <p className="text-[10px] text-gray-400 font-bold uppercase">Refeições</p>
                          <p className="font-bold text-gray-800 mt-0.5">
                            {item.refeicoes.contratada ? `${item.refeicoes.saldo} de ${item.refeicoes.total} refeições` : 'Não inclusa'}
                          </p>
                        </div>
                      </div>

                      {item.cracha.qrCode && (
                        <button
                          onClick={() => setFullscreenCracha(item)}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-white text-[#0D2B4E] border border-blue-200 rounded-xl font-bold hover:bg-blue-50 transition-colors shadow-sm"
                        >
                          <QrCode size={14} />
                          Visualizar Crachá Virtual
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SEÇÃO 3: EVENTOS DISPONÍVEIS PARA INSCRIÇÃO ── */}
      {eventosAbertos.length > 0 && (
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-gray-900 tracking-tight flex items-center gap-2">
              <Sparkles size={18} className="text-[#0D2B4E]" />
              Eventos Disponíveis
            </h2>
            <span className="text-xs text-gray-500 font-medium">
              Inscrições Abertas
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {eventosAbertos.map((ev) => (
              <div
                key={ev.id}
                className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden flex flex-col justify-between hover:shadow-md transition-shadow group"
              >
                {ev.banner_url ? (
                  <div className="w-full h-32 relative bg-slate-900 overflow-hidden">
                    <img
                      src={ev.banner_url}
                      alt={ev.nome}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                    <div className="absolute top-3 left-3">
                      <span className="px-2.5 py-0.5 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold rounded-md uppercase">
                        {ev.departamento || 'AGO'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 bg-gradient-to-r from-blue-900 to-[#0D2B4E] text-white">
                    <span className="px-2 py-0.5 bg-white/20 text-[10px] font-bold rounded-md uppercase">
                      {ev.departamento || 'AGO'}
                    </span>
                    <h3 className="font-bold text-sm mt-2 line-clamp-1">{ev.nome}</h3>
                  </div>
                )}

                <div className="p-4 sm:p-5 flex-1 flex flex-col justify-between">
                  <div>
                    {ev.banner_url && (
                      <h3 className="font-bold text-sm text-gray-900 mb-1.5 line-clamp-2">
                        {ev.nome}
                      </h3>
                    )}
                    <div className="space-y-1 text-xs text-gray-500">
                      <div className="flex items-center gap-1.5">
                        <Calendar size={13} className="text-gray-400 flex-shrink-0" />
                        <span>{fmtPeriodo(ev.data_inicio, ev.data_fim)}</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <MapPin size={13} className="text-gray-400 flex-shrink-0" />
                        <span className="truncate">{ev.cidade || 'Pará'}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-gray-400 font-bold uppercase">Investimento</p>
                      <p className="text-sm font-extrabold text-[#0D2B4E]">
                        {ev.valor_inscricao > 0
                          ? `R$ ${Number(ev.valor_inscricao).toFixed(2).replace('.', ',')}`
                          : 'Gratuito'}
                      </p>
                    </div>

                    <a
                      href={`/inscricao/${ev.slug}`}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-[#0D2B4E] hover:bg-[#163f6d] text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
                    >
                      <span>Inscrever-se</span>
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── MODAL EM TELA CHEIA: CRACHÁ VIRTUAL PARA PORTARIA ── */}
      {fullscreenCracha && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl flex flex-col relative border border-white/20">
            
            {/* Header do Crachá */}
            <div className="bg-[#0D2B4E] p-5 text-white text-center relative">
              <button
                onClick={() => setFullscreenCracha(null)}
                className="absolute top-4 right-4 p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
              
              <Image
                src="/img/logo_comieadepa.png"
                alt="COMIEADEPA"
                width={48}
                height={48}
                className="mx-auto mb-2 drop-shadow-md"
                style={{ width: '48px', height: 'auto' }}
              />
              <p className="text-[10px] font-bold uppercase tracking-widest text-blue-200">
                COMIEADEPA · CRACHÁ OFICIAL
              </p>
              <h3 className="text-base font-extrabold leading-tight mt-0.5">
                {fullscreenCracha.evento.nome}
              </h3>
            </div>

            {/* Conteúdo Central com QR Code Grande */}
            <div className="p-6 text-center space-y-4">
              <div className="bg-gray-50 p-4 rounded-2xl border-2 border-dashed border-gray-200 inline-block shadow-inner">
                {fullscreenCracha.cracha.qrCode ? (
                  <QRCodeSVG
                    value={fullscreenCracha.cracha.qrCode}
                    size={200}
                    level="H"
                  />
                ) : (
                  <div className="w-[200px] h-[200px] flex items-center justify-center text-xs text-gray-400">
                    QR Code não disponível
                  </div>
                )}
              </div>

              <div>
                <p className="text-xs text-gray-400 font-bold uppercase">Ministro / Participante</p>
                <p className="text-base font-black text-gray-900 mt-0.5">
                  {fullscreenCracha.nomeInscrito}
                </p>
                <p className="text-xs text-gray-500 font-mono mt-0.5">
                  CPF: {fullscreenCracha.cpf}
                </p>
              </div>

              {/* Status de Check-in */}
              <div className="pt-2">
                {fullscreenCracha.cracha.checkinRealizado ? (
                  <div className="bg-emerald-50 text-emerald-800 rounded-xl p-2.5 text-xs font-bold flex items-center justify-center gap-1.5 border border-emerald-200">
                    <CheckCircle2 size={16} className="text-emerald-600" />
                    Check-in confirmado na portaria
                  </div>
                ) : (
                  <div className="bg-blue-50 text-[#0D2B4E] rounded-xl p-2.5 text-xs font-bold border border-blue-200">
                    Apresente este código no leitor da portaria
                  </div>
                )}
              </div>
            </div>

            {/* Rodapé do Modal */}
            <div className="p-4 bg-gray-50 border-t border-gray-100 text-center">
              <button
                onClick={() => setFullscreenCracha(null)}
                className="w-full py-3 bg-[#0D2B4E] hover:bg-[#163f6d] text-white font-bold rounded-xl text-xs transition-colors"
              >
                Fechar Crachá
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}
