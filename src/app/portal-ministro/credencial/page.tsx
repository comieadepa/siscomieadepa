'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  IdCard,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  QrCode,
  Printer,
  ShieldCheck,
  UserCheck,
  Package,
  Check,
  MapPin,
  Calendar,
  AlertTriangle,
  ArrowRight,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

interface MinistroInfo {
  id: string;
  nome: string;
  matricula: string | null;
  cargo: string | null;
  campo: string | null;
  supervisao: string | null;
  fotoUrl: string | null;
}

interface PedidoCredencial {
  id: string;
  status: 'aguardando_pagamento' | 'pago_pendente_impressao' | 'em_impressao' | 'disponivel_retirada' | 'entregue' | 'cancelado';
  statusLabel: string;
  valor: number;
  asaasPaymentId: string | null;
  solicitadoEm: string;
  pagoEm: string | null;
  emImpressaoEm: string | null;
  disponivelRetiradaEm: string | null;
  impressoEm: string | null;
  entregueEm: string | null;
  canceladoEm: string | null;
}

interface CredencialData {
  ministro: MinistroInfo;
  statusMinisterial: 'ATIVO' | 'INATIVO';
  statusCredencial: 'NAO_EMITIDA' | 'VALIDA' | 'VENCIDA';
  statusCredencialLegacy?: string;
  dataValidade: string | null;
  dataEmissao: string | null;
  uniqueId: string | null;
  credencialUrl: string | null;
  pedidoAtual: PedidoCredencial | null;
  historicoPedidos: PedidoCredencial[];
}

const fmtDate = (v: string | null) => {
  if (!v) return '—';
  const d = new Date(v.includes('T') ? v : v + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};

const fmtDateTime = (v: string | null) => {
  if (!v) return '—';
  const d = new Date(v);
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

export default function CentralCredencialPage() {
  const [data, setData] = useState<CredencialData | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');
  const [qrToken, setQrToken] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/portal-ministro/credencial')
      .then(async (r) => {
        if (!r.ok) {
          const err = await r.json().catch(() => ({}));
          throw new Error(err.error || 'Erro ao carregar dados da credencial.');
        }
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setErro(e.message || 'Não foi possível carregar a Central de Credencial.');
        setLoading(false);
      });

    fetch('/api/portal-ministro/credencial/qr-token')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.token) setQrToken(d.token);
      })
      .catch(() => {});
  }, []);

  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';
  const qrUrl = qrToken ? `${appUrl}/validar-credencial/${qrToken}` : '';

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-6 animate-pulse p-4">
        <div className="h-8 bg-gray-200 rounded-lg w-64 mb-6" />
        <div className="h-44 bg-gray-200 rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="h-64 bg-gray-200 rounded-2xl" />
          <div className="h-64 bg-gray-200 rounded-2xl" />
        </div>
      </div>
    );
  }

  if (erro || !data) {
    return (
      <div className="max-w-xl mx-auto my-12 p-8 bg-red-50 border border-red-200 rounded-2xl text-center">
        <AlertCircle size={40} className="text-red-500 mx-auto mb-3" />
        <h2 className="text-lg font-bold text-red-900 mb-1">Erro ao carregar credencial</h2>
        <p className="text-sm text-red-700 mb-5">{erro || 'Dados não disponíveis.'}</p>
        <button
          onClick={() => window.location.reload()}
          className="bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white text-xs font-bold px-5 py-2.5 rounded-xl transition-all"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  const { ministro, statusMinisterial, statusCredencial, dataValidade, dataEmissao, credencialUrl, pedidoAtual, historicoPedidos } = data;

  const isAtivoMinisterial = statusMinisterial === 'ATIVO';
  const isCredencialValida = statusCredencial === 'VALIDA';
  const isCredencialVencida = statusCredencial === 'VENCIDA';
  const isCredencialNaoEmitida = statusCredencial === 'NAO_EMITIDA';

  // Etapas da Timeline de Impressão
  const getTimelineStep = (status?: string) => {
    switch (status) {
      case 'aguardando_pagamento':
        return 1;
      case 'pago_pendente_impressao':
        return 2;
      case 'em_impressao':
        return 3;
      case 'disponivel_retirada':
        return 4;
      case 'entregue':
        return 5;
      case 'cancelado':
        return -1;
      default:
        return 0;
    }
  };

  const currentStep = getTimelineStep(pedidoAtual?.status);

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">

      {/* ── TÍTULO DA PÁGINA ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#0D2B4E] text-white flex items-center justify-center shadow-md">
            <IdCard size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-black text-gray-900 tracking-tight">
              Central de Credencial
            </h1>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
              Documento Oficial de Identificação Ministerial · COMIEADEPA
            </p>
          </div>
        </div>

        {/* Badge de Status Ministerial Principal */}
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-gray-200 shadow-sm self-start sm:self-auto">
          <div className={`w-2.5 h-2.5 rounded-full ${isAtivoMinisterial ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
          <span className="text-xs font-bold text-gray-700">
            Ministro {statusMinisterial}
          </span>
        </div>
      </div>

      {/* ── 1. IDENTIFICAÇÃO DO MINISTRO & STATUS DA CREDENCIAL ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

        {/* Card do Ministro */}
        <div className="md:col-span-2 bg-gradient-to-br from-[#0D2B4E] via-[#123863] to-[#1a4a7a] text-white rounded-3xl p-6 sm:p-7 shadow-xl relative overflow-hidden flex flex-col justify-between">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-400/10 rounded-full blur-2xl pointer-events-none" />

          <div>
            <div className="flex items-start gap-4 mb-4">
              {/* Foto do Ministro */}
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-white/10 border-2 border-white/30 overflow-hidden flex-shrink-0 flex items-center justify-center shadow-md">
                {ministro.fotoUrl ? (
                  <img
                    src={ministro.fotoUrl}
                    alt={ministro.nome}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <UserCheck size={32} className="text-blue-200" />
                )}
              </div>

              {/* Dados Principais */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-[11px] font-black uppercase tracking-wider bg-white/20 px-2.5 py-0.5 rounded-md border border-white/20">
                    {ministro.cargo || 'MINISTRO'}
                  </span>
                  {ministro.matricula && (
                    <span className="text-[11px] font-mono font-bold bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded-md border border-amber-400/30">
                      REG. {ministro.matricula}
                    </span>
                  )}
                </div>

                <h2 className="text-lg sm:text-xl font-extrabold tracking-tight leading-snug truncate">
                  {ministro.nome}
                </h2>

                <p className="text-xs text-blue-200/90 mt-1 flex items-center gap-1.5 truncate">
                  <MapPin size={13} className="text-blue-300 flex-shrink-0" />
                  <span>{ministro.campo || 'COMIEADEPA'} {ministro.supervisao ? `· ${ministro.supervisao}` : ''}</span>
                </p>
              </div>
            </div>
          </div>

          {/* Rodapé do Card com Acesso Rápido ao Cartão */}
          <div className="pt-4 border-t border-white/15 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="text-xs text-blue-200/80">
              {dataEmissao && <span>Emissão: <strong>{fmtDate(dataEmissao)}</strong></span>}
            </div>

            {credencialUrl && isCredencialValida && (
              <a
                href={credencialUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-md active:scale-95"
              >
                <ExternalLink size={14} />
                Visualizar Credencial Oficial
              </a>
            )}
          </div>
        </div>

        {/* Card de Status do Documento */}
        <div className={`rounded-3xl p-6 border shadow-md flex flex-col justify-between ${
          isCredencialValida
            ? 'bg-emerald-50/80 border-emerald-200'
            : isCredencialVencida
            ? 'bg-red-50/80 border-red-200'
            : 'bg-amber-50/80 border-amber-200'
        }`}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                Status do Documento
              </span>
              {isCredencialValida && <CheckCircle2 size={20} className="text-emerald-600" />}
              {isCredencialVencida && <AlertCircle size={20} className="text-red-600" />}
              {isCredencialNaoEmitida && <Clock size={20} className="text-amber-600" />}
            </div>

            <div className="mb-2">
              <span className={`text-xl font-black tracking-tight px-3 py-1 rounded-xl inline-block ${
                isCredencialValida
                  ? 'bg-emerald-600 text-white'
                  : isCredencialVencida
                  ? 'bg-red-600 text-white'
                  : 'bg-amber-500 text-white'
              }`}>
                {isCredencialValida && 'CREDENCIAL VÁLIDA'}
                {isCredencialVencida && 'CREDENCIAL VENCIDA'}
                {isCredencialNaoEmitida && 'NÃO EMITIDA'}
              </span>
            </div>

            <p className="text-xs text-gray-600 leading-relaxed mt-2">
              {isCredencialValida && 'Sua credencial digital está em dia e habilitada para validação pública.'}
              {isCredencialVencida && 'Sua credencial expirou. Solicite a renovação para manter a regularidade.'}
              {isCredencialNaoEmitida && 'Nenhum registro de credencial ativa foi localizado.'}
            </p>
          </div>

          <div className="pt-4 border-t border-gray-200/60 mt-4">
            <p className="text-xs text-gray-500">Validade do documento:</p>
            <p className={`text-base font-black ${isCredencialValida ? 'text-emerald-900' : 'text-red-900'}`}>
              {dataValidade ? fmtDate(dataValidade) : 'Sem data cadastrada'}
            </p>
          </div>
        </div>

      </div>

      {/* ── 2. PEDIDO DE CREDENCIAL FÍSICA & TIMELINE ── */}
      <div className="bg-white rounded-3xl border border-gray-200 shadow-lg p-6 sm:p-7">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#0D2B4E] flex items-center justify-center">
              <Printer size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base leading-tight">
                Credencial Física em Cartão
              </h3>
              <p className="text-xs text-gray-500">Acompanhamento da solicitação e impressão</p>
            </div>
          </div>

          {/* Destaque contextual de status */}
          {pedidoAtual && (
            <span className={`text-xs font-extrabold px-3 py-1 rounded-full border self-start sm:self-auto ${
              pedidoAtual.status === 'disponivel_retirada'
                ? 'bg-emerald-100 text-emerald-800 border-emerald-300 animate-pulse'
                : pedidoAtual.status === 'aguardando_pagamento'
                ? 'bg-amber-100 text-amber-800 border-amber-300'
                : 'bg-blue-100 text-[#0D2B4E] border-blue-200'
            }`}>
              {pedidoAtual.statusLabel}
            </span>
          )}
        </div>

        {/* Se houver pedido ativo, exibe Timeline */}
        {pedidoAtual ? (
          <div className="space-y-6">

            {/* Alerta especial se DISPONÍVEL PARA RETIRADA */}
            {pedidoAtual.status === 'disponivel_retirada' && (
              <div className="bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-2xl p-5 shadow-lg flex items-start gap-3.5 animate-fadeIn">
                <Package size={26} className="flex-shrink-0 mt-0.5 text-emerald-100" />
                <div>
                  <h4 className="font-black text-base leading-tight">
                    Sua Credencial está Pronta para Retirada!
                  </h4>
                  <p className="text-xs text-emerald-100 mt-1 leading-relaxed">
                    Apresente seu documento de identificação na <strong>Secretaria Geral da COMIEADEPA</strong> para retirar seu cartão físico.
                  </p>
                </div>
              </div>
            )}

            {/* Alerta se AGUARDANDO PAGAMENTO */}
            {pedidoAtual.status === 'aguardando_pagamento' && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <AlertTriangle size={22} className="text-amber-600 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-bold text-amber-900">Aguardando Pagamento da Taxa</p>
                    <p className="text-xs text-amber-700">Taxa de impressão de R$ 20,00 emitida via ASAAS.</p>
                  </div>
                </div>
                <Link
                  href="/portal-ministro/impressao"
                  className="inline-flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold px-4 py-2 rounded-xl transition-all shadow-sm"
                >
                  Pagar Credencial <ArrowRight size={14} />
                </Link>
              </div>
            )}

            {/* Linha do Tempo Visual */}
            <div className="pt-2">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-4">
                Progresso do Pedido
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                {[
                  { step: 1, label: 'Solicitado', desc: fmtDateTime(pedidoAtual.solicitadoEm) },
                  { step: 2, label: 'Pago', desc: pedidoAtual.pagoEm ? fmtDateTime(pedidoAtual.pagoEm) : 'Aguardando' },
                  { step: 3, label: 'Em Produção', desc: pedidoAtual.emImpressaoEm ? fmtDateTime(pedidoAtual.emImpressaoEm) : 'Fila' },
                  { step: 4, label: 'Disponível', desc: pedidoAtual.disponivelRetiradaEm || pedidoAtual.impressoEm ? fmtDateTime(pedidoAtual.disponivelRetiradaEm || pedidoAtual.impressoEm) : 'Secretaria' },
                  { step: 5, label: 'Entregue', desc: pedidoAtual.entregueEm ? fmtDateTime(pedidoAtual.entregueEm) : 'Pendente' },
                ].map((item) => {
                  const isDone = currentStep >= item.step;
                  const isCurrent = currentStep === item.step;

                  return (
                    <div
                      key={item.step}
                      className={`p-3.5 rounded-2xl border transition-all ${
                        isCurrent
                          ? 'bg-blue-50/80 border-[#0D2B4E] shadow-sm'
                          : isDone
                          ? 'bg-gray-50/60 border-gray-200'
                          : 'bg-white border-gray-100 opacity-60'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${
                          isDone ? 'bg-[#0D2B4E] text-white' : 'bg-gray-200 text-gray-600'
                        }`}>
                          {isDone ? <Check size={12} /> : item.step}
                        </span>
                        {isCurrent && (
                          <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
                        )}
                      </div>
                      <p className="text-xs font-bold text-gray-900 leading-tight">{item.label}</p>
                      <p className="text-[10px] text-gray-500 mt-0.5 truncate">{item.desc}</p>
                    </div>
                  );
                })}
              </div>
            </div>

          </div>
        ) : (
          /* Estado Vazio — Sem Pedido Ativo */
          <div className="bg-gray-50 rounded-2xl p-6 text-center border border-dashed border-gray-300">
            <div className="w-12 h-12 bg-white rounded-2xl shadow-sm border border-gray-200 flex items-center justify-center mx-auto mb-3 text-gray-400">
              <Printer size={24} />
            </div>

            <h4 className="text-base font-bold text-gray-900 mb-1">
              Deseja receber seu Cartão Físico?
            </h4>
            <p className="text-xs text-gray-500 max-w-md mx-auto mb-5 leading-relaxed">
              Você pode solicitar a emissão física da sua credencial em cartão PVC de alta durabilidade com taxa de conveniência de <strong>R$ 20,00</strong>.
            </p>

            <Link
              href="/portal-ministro/impressao"
              className="inline-flex items-center gap-2 bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white text-xs font-bold px-6 py-3 rounded-xl transition-all shadow-md active:scale-95"
            >
              <Printer size={15} />
              {isCredencialVencida ? 'Solicitar Renovação e Cartão' : 'Solicitar Credencial Impressa'}
            </Link>
          </div>
        )}
      </div>

      {/* ── 3. VALIDAÇÃO PÚBLICA & QR CODE ── */}
      {qrToken && (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-lg p-6 sm:p-7">
          <div className="flex items-center gap-2.5 mb-4 pb-3 border-b border-gray-100">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-800 flex items-center justify-center">
              <QrCode size={18} />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-base leading-tight">
                QR Code de Validação Pública
              </h3>
              <p className="text-xs text-gray-500">Comprovação instantânea de regularidade ministerial</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="p-3.5 bg-white border border-gray-200 rounded-2xl shadow-sm inline-block flex-shrink-0">
              <QRCodeSVG value={qrUrl} size={150} level="M" includeMargin />
            </div>

            <div className="space-y-3 text-center sm:text-left">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-bold">
                <ShieldCheck size={14} className="text-emerald-600" />
                Validação em Tempo Real
              </div>

              <p className="text-xs text-gray-600 leading-relaxed max-w-md">
                Apresente este QR Code em eventos, convenções ou quando solicitado. Ele direciona qualquer pessoa ou autoridade para a página oficial de validação da COMIEADEPA.
              </p>

              <p className="text-[11px] text-gray-400 font-mono break-all bg-gray-50 p-2 rounded-lg border border-gray-100">
                {qrUrl}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── 4. HISTÓRICO DE PEDIDOS DE IMPRESSÃO ── */}
      {historicoPedidos.length > 0 && (
        <div className="bg-white rounded-3xl border border-gray-200 shadow-lg p-6 sm:p-7">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-gray-100">
            <Calendar size={18} className="text-gray-500" />
            <h3 className="font-bold text-gray-900 text-base">Histórico de Solicitações</h3>
          </div>

          <div className="divide-y divide-gray-100">
            {historicoPedidos.map((ped) => (
              <div key={ped.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold text-gray-800">
                    Solicitação em {fmtDateTime(ped.solicitadoEm)}
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Valor: R$ {ped.valor.toFixed(2).replace('.', ',')}
                    {ped.pagoEm && ` · Pago em ${fmtDateTime(ped.pagoEm)}`}
                    {ped.entregueEm && ` · Entregue em ${fmtDateTime(ped.entregueEm)}`}
                  </p>
                </div>

                <span className="text-xs font-semibold px-3 py-1 rounded-full bg-gray-100 text-gray-700 self-start sm:self-auto border border-gray-200">
                  {ped.statusLabel}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
