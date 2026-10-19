'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMinistro } from '../ministro-context';
import {
  IdCard, History, DollarSign, Printer,
  CheckCircle2, Play, CalendarDays, Bell,
  AlertTriangle, ChevronRight, Star, Shield,
  ArrowRight, Hash, MapPin, Building,
} from 'lucide-react';

interface VideoConfig {
  titulo: string;
  descricao: string | null;
  urlVideo: string | null;
  ativo: boolean;
}

interface DashboardExtras {
  proximaAgo: { nome: string; data_inicio: string; cidade?: string | null } | null;
  proximoEvento: { nome: string; data_inicio: string; departamento?: string | null; cidade?: string | null } | null;
  pendencias: { tipo: string; mensagem: string; urgente: boolean }[];
}

interface CredencialData {
  statusCredencial: 'ativa' | 'vencida' | 'pendente';
  dataValidade: string | null;
}

interface HistoricoItem {
  id: string;
  tipo: string;
  tipoLabel: string;
  titulo: string | null;
  descricao: string;
  ocorrencia: string;
}

const fmtDate = (v: string | null) => {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
};

const fmtDateShort = (v: string | null) => {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
};

function getEmbedUrl(url: string | null): string | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  const ytMatch = trimmed.match(
    /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com\/(?:watch\?.*v=|shorts\/|live\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
  );
  if (ytMatch && ytMatch[1]) {
    return `https://www.youtube.com/embed/${ytMatch[1]}`;
  }

  const vmMatch = trimmed.match(/(?:https?:\/\/)?(?:www\.)?(?:player\.)?vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vmMatch && vmMatch[1]) {
    return `https://player.vimeo.com/video/${vmMatch[1]}`;
  }

  return trimmed;
}

const getCalendarParts = (dateStr: string | null) => {
  if (!dateStr) return { dia: '--', mes: '---', ano: '----' };
  try {
    const d = new Date(dateStr.includes('T') ? dateStr : dateStr + 'T00:00:00');
    if (isNaN(d.getTime())) return { dia: '--', mes: '---', ano: '----' };
    const dia = d.toLocaleDateString('pt-BR', { day: '2-digit' });
    const mes = d.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
    const ano = d.getFullYear().toString();
    return { dia, mes, ano };
  } catch {
    return { dia: '--', mes: '---', ano: '----' };
  }
};

const TIPO_COLOR: Record<string, string> = {
  credencial_emitida:        'bg-blue-500',
  carta_emitida:             'bg-green-500',
  progressao_ministerial:    'bg-purple-500',
  consagracao:               'bg-yellow-500',
  apresentacao:              'bg-teal-500',
  deliberacao_comissao:      'bg-orange-500',
  assumiu_pastor_presidente: 'bg-red-500',
  transferencia:             'bg-indigo-500',
  mudanca_de_campo:          'bg-cyan-500',
  jubilacao:                 'bg-amber-500',
  reativacao:                'bg-emerald-500',
  desligamento:              'bg-rose-600',
};

export default function PortalMinistroDashboard() {
  const { ministro } = useMinistro();
  const [video, setVideo] = useState<VideoConfig | null>(null);
  const [extras, setExtras] = useState<DashboardExtras | null>(null);
  const [credencial, setCredencial] = useState<CredencialData | null>(null);
  const [historico, setHistorico] = useState<HistoricoItem[]>([]);

  useEffect(() => {
    fetch('/api/portal-ministro/video-config').then((r) => r.json()).then(setVideo).catch(() => {});
    fetch('/api/portal-ministro/dashboard').then((r) => r.ok ? r.json() : null).then((d) => { if (d) setExtras(d); }).catch(() => {});
    fetch('/api/portal-ministro/credencial').then((r) => r.ok ? r.json() : null).then((d) => { if (d) setCredencial(d); }).catch(() => {});
    fetch('/api/portal-ministro/historico').then((r) => r.ok ? r.json() : null).then((d) => { if (d?.data) setHistorico(d.data.slice(0, 3)); }).catch(() => {});
  }, []);

  if (!ministro) return null;

  const embedUrl = getEmbedUrl(video?.urlVideo || null);
  const hasPendencias = (extras?.pendencias?.length ?? 0) > 0;
  const hasUrgent = extras?.pendencias?.some((p) => p.urgente) ?? false;

  const quickCards = [
    {
      href: '/portal-ministro/credencial',
      label: 'Minha Credencial',
      description: 'Credencial digital e QR Code',
      icon: IdCard,
      iconBg: 'bg-blue-600',
      badge: credencial?.statusCredencial === 'ativa' ? 'Ativa' : credencial?.statusCredencial === 'vencida' ? 'Vencida' : null,
      badgeOk: credencial?.statusCredencial === 'ativa',
    },
    {
      href: '/portal-ministro/historico',
      label: 'Histórico Ministerial',
      description: 'Consagrações, cartas e deliberações',
      icon: History,
      iconBg: 'bg-purple-600',
      badge: null,
      badgeOk: false,
    },
    {
      href: '/portal-ministro/impressao',
      label: 'Solicitar Impressão',
      description: 'Credencial física — R$ 20,00',
      icon: Printer,
      iconBg: 'bg-[#007b70]',
      badge: null,
      badgeOk: false,
    },
    ...(ministro.isPastorPresidente ? [{
      href: '/portal-ministro/contribuicoes',
      label: 'Contribuição Estatutária',
      description: 'Histórico e pagamentos',
      icon: DollarSign,
      iconBg: 'bg-amber-600',
      badge: null,
      badgeOk: false,
    }] : []),
  ];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">

      {/* ── Card de identificação institucional ─────────────────────── */}
      <div className="rounded-3xl overflow-hidden shadow-sm border border-gray-100 bg-white">
        <div className="relative bg-gradient-to-r from-[#07192f] via-[#0d2a4e] to-[#17487c] p-6 sm:p-7 text-white overflow-hidden">
          {/* Imagem de fundo sutil com marca d'água da sede */}
          <div
            className="absolute right-0 top-0 bottom-0 w-1/2 opacity-15 pointer-events-none bg-no-repeat bg-right bg-cover"
            style={{ backgroundImage: "url('/img/login-bg.png')" }}
          />

          <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center gap-5 sm:gap-6">
            {/* Foto */}
            <div className="flex-shrink-0">
              {ministro.fotoUrl ? (
                <img
                  src={ministro.fotoUrl}
                  alt={ministro.nome}
                  className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl object-cover border-2 border-white/20 shadow-md bg-white/10"
                />
              ) : (
                <div className="w-20 h-20 sm:w-22 sm:h-22 rounded-2xl bg-white/10 border-2 border-white/20 flex items-center justify-center text-white text-3xl font-bold shadow-md">
                  {ministro.nome?.charAt(0) ?? '?'}
                </div>
              )}
            </div>

            {/* Informações */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1">
                <h1 className="text-xl sm:text-2xl font-black text-white uppercase tracking-wide leading-tight">
                  {ministro.nome}
                </h1>
                {ministro.status === 'active' && (
                  <span className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-semibold border border-emerald-400/30">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" /> Ativo
                  </span>
                )}
                {ministro.isPastorPresidente && (
                  <span className="inline-flex items-center gap-1 px-3 py-0.5 rounded-full bg-amber-400/20 text-amber-300 text-xs font-semibold border border-amber-400/30">
                    <Star size={11} /> Pastor Presidente
                  </span>
                )}
              </div>

              {ministro.cargo && (
                <p className="text-xs font-bold text-blue-200 uppercase tracking-widest mb-3.5">
                  {ministro.cargo}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs">
                {ministro.matricula && (
                  <div className="flex items-center gap-1.5">
                    <Hash size={13} className="text-blue-300/70" />
                    <span className="text-blue-200/70">Matrícula:</span>
                    <span className="text-white font-bold">{ministro.matricula}</span>
                  </div>
                )}
                {ministro.cpfMascarado && (
                  <div className="flex items-center gap-1.5">
                    <Shield size={13} className="text-blue-300/70" />
                    <span className="text-blue-200/70">CPF:</span>
                    <span className="text-white font-bold">{ministro.cpfMascarado}</span>
                  </div>
                )}
                {ministro.campo && (
                  <div className="flex items-center gap-1.5">
                    <MapPin size={13} className="text-blue-300/70" />
                    <span className="text-blue-200/70">Campo:</span>
                    <span className="text-white font-bold uppercase">{ministro.campo}</span>
                  </div>
                )}
                {ministro.supervisao && (
                  <div className="flex items-center gap-1.5">
                    <Building size={13} className="text-blue-300/70" />
                    <span className="text-blue-200/70">Supervisão:</span>
                    <span className="text-white font-bold uppercase">{ministro.supervisao}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Barra inferior limpa do card */}
        <div className="bg-white px-6 sm:px-7 py-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 text-[11px] text-gray-400">
          <div className="flex items-center gap-1.5 font-medium">
            <span>COMIEADEPA</span>
            <span className="text-gray-300">&gt;</span>
            <span className="text-gray-600 font-semibold">Portal do Ministro</span>
          </div>
          <span className="italic text-gray-400">Atualização de dados: procure a Secretaria</span>
        </div>
      </div>

      {/* ── Palavra do Presidente ──────────────────────────────── */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3.5 border-b border-gray-50">
          <div className="w-10 h-10 rounded-xl bg-[#0D2B4E] flex items-center justify-center shadow-sm flex-shrink-0">
            <Play size={16} className="text-white fill-white ml-0.5" />
          </div>
          <div>
            <h2 className="font-extrabold text-[#0D2B4E] text-base leading-tight">
              {video?.titulo || 'Palavra do Presidente'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {video?.descricao || 'Pr. Ozélio Nauar – Presidente da COMIEADEPA'}
            </p>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {embedUrl ? (
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-black shadow-inner">
              <iframe
                src={embedUrl}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
                title={video?.titulo || 'Palavra do Presidente'}
              />
            </div>
          ) : (
            <div className="rounded-2xl overflow-hidden">
              <div className="h-56 bg-gradient-to-br from-[#0D2B4E] via-[#14396b] to-[#1a4a7a] flex flex-col items-center justify-center gap-4">
                <div className="w-16 h-16 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
                  <Play size={28} className="text-white/70 ml-1" />
                </div>
                <p className="text-sm text-white/60 font-medium">Nenhum vídeo configurado</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Credencial + Pendências (2 Colunas) ──────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Credencial Digital */}
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center gap-3.5 mb-2">
              <div className="w-10 h-10 rounded-xl bg-gray-100 text-[#0D2B4E] flex items-center justify-center shadow-inner flex-shrink-0">
                <IdCard size={20} />
              </div>
              <div>
                <p className="font-extrabold text-gray-900 text-sm">Credencial Digital</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {credencial?.statusCredencial === 'ativa' && `Válida até ${fmtDateShort(credencial.dataValidade)}`}
                  {credencial?.statusCredencial === 'vencida' && 'Credencial vencida'}
                  {(!credencial || credencial.statusCredencial === 'pendente') && 'Sem credencial emitida'}
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
            <Link
              href="/portal-ministro/credencial"
              className="w-full text-center text-xs font-bold py-3 px-4 rounded-xl bg-[#0D2B4E] text-white hover:bg-[#153e6d] transition-all flex items-center justify-center gap-2 shadow-sm"
            >
              <IdCard size={15} /> Ver Credencial
            </Link>
            <Link
              href="/portal-ministro/impressao"
              className="w-full text-center text-xs font-bold py-3 px-4 rounded-xl border-2 border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 transition-all flex items-center justify-center gap-2"
            >
              <Printer size={15} /> Solicitar Impressão
            </Link>
          </div>
        </div>

        {/* Central de Pendências */}
        <div className={`rounded-3xl border shadow-sm p-6 flex flex-col justify-between ${
          hasUrgent
            ? 'bg-rose-50/70 border-rose-200'
            : hasPendencias
            ? 'bg-amber-50/70 border-amber-200'
            : 'bg-[#ecfdf5] border-emerald-200/80'
        }`}>
          <div>
            <div className="flex items-center gap-3.5 mb-3">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm flex-shrink-0 ${
                hasUrgent ? 'bg-red-500' : hasPendencias ? 'bg-amber-500' : 'bg-emerald-500'
              }`}>
                {hasPendencias ? (
                  <AlertTriangle size={20} className="text-white" />
                ) : (
                  <CheckCircle2 size={20} className="text-white" />
                )}
              </div>
              <div>
                <p className="font-extrabold text-gray-900 text-sm">Central de Pendências</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {hasPendencias
                    ? `${extras!.pendencias.length} pendência${extras!.pendencias.length > 1 ? 's' : ''}`
                    : 'Situação regular'}
                </p>
              </div>
            </div>

            {hasPendencias ? (
              <ul className="space-y-2 mt-4">
                {extras!.pendencias.slice(0, 2).map((p, i) => (
                  <li
                    key={i}
                    className={`text-xs rounded-xl p-3 font-medium ${
                      p.urgente
                        ? 'bg-red-100 text-red-700 border border-red-200'
                        : 'bg-amber-100/80 text-amber-800 border border-amber-200'
                    }`}
                  >
                    {p.mensagem}
                  </li>
                ))}
                {extras!.pendencias.length > 2 && (
                  <p className="text-xs text-gray-400 pl-1">
                    +{extras!.pendencias.length - 2} mais...
                  </p>
                )}
              </ul>
            ) : (
              <div className="mt-4 pt-2">
                <p className="text-sm text-emerald-800 font-bold flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-emerald-600" /> Sem pendências. Tudo em dia!
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Acesso Rápido ─────────────────────────────────────── */}
      <div className="pt-2">
        <div className="flex items-center gap-2 text-xs font-black tracking-wider text-[#0D2B4E] uppercase mb-3.5">
          <div className="w-1.5 h-4 bg-[#0D2B4E] rounded-full" />
          <span>Acesso Rápido</span>
        </div>

        <div className={`grid grid-cols-1 sm:grid-cols-2 ${quickCards.length > 3 ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-4`}>
          {quickCards.map(({ href, label, description, icon: Icon, iconBg, badge, badgeOk }) => (
            <Link
              key={href}
              href={href}
              className="group bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-md hover:border-gray-200 transition-all duration-200 p-5 flex flex-col justify-between relative overflow-hidden"
            >
              {/* Ícone sutil decorativo ao fundo */}
              <Icon
                size={80}
                className="absolute -right-4 -bottom-4 text-gray-100 opacity-40 group-hover:opacity-60 group-hover:scale-105 transition-all pointer-events-none"
              />

              <div className="relative z-10">
                <div className="flex items-start justify-between gap-2 mb-4">
                  <div className={`w-11 h-11 rounded-2xl ${iconBg} flex items-center justify-center text-white shadow-sm`}>
                    <Icon size={20} />
                  </div>
                  <div className="w-7 h-7 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 group-hover:bg-[#0D2B4E] group-hover:text-white transition-colors">
                    <ArrowRight size={13} className="group-hover:translate-x-0.5 transition-transform" />
                  </div>
                </div>

                <div className="flex items-center gap-1.5 mb-1">
                  <h3 className="font-extrabold text-gray-900 text-sm group-hover:text-[#0D2B4E] transition-colors leading-tight">
                    {label}
                  </h3>
                  {badge && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      badgeOk ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed pr-6">{description}</p>
              </div>

              <div className="relative z-10 mt-5 pt-3 border-t border-gray-50 flex items-center text-xs font-bold text-[#0D2B4E]">
                <span>Acessar</span>
                <ArrowRight size={13} className="ml-1.5 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Agenda ────────────────────────────────────────────── */}
      {extras && (extras.proximaAgo || extras.proximoEvento) && (
        <div className="pt-2">
          <div className="flex items-center gap-2 text-xs font-black tracking-wider text-[#0D2B4E] uppercase mb-3.5">
            <div className="w-1.5 h-4 bg-[#0D2B4E] rounded-full" />
            <span>Agenda</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Próxima AGO */}
            {extras.proximaAgo && (() => {
              const cal = getCalendarParts(extras.proximaAgo.data_inicio);
              return (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 flex items-center gap-4 relative overflow-hidden group">
                  <CalendarDays
                    size={72}
                    className="absolute -right-3 -bottom-3 text-rose-50 opacity-60 group-hover:scale-105 transition-transform pointer-events-none"
                  />
                  {/* Bloco de Data */}
                  <div className="w-16 h-20 rounded-2xl bg-rose-50 border border-rose-100/80 flex flex-col items-center justify-center flex-shrink-0 text-center shadow-xs">
                    <span className="text-[10px] font-extrabold text-rose-600 tracking-wider uppercase">
                      {cal.mes}
                    </span>
                    <span className="text-2xl font-black text-gray-900 leading-none my-0.5">
                      {cal.dia}
                    </span>
                    <span className="text-[10px] font-semibold text-rose-400">
                      {cal.ano}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0 relative z-10">
                    <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider text-rose-600 mb-1">
                      Próxima AGO
                    </span>
                    <p className="font-extrabold text-gray-900 text-sm leading-snug truncate">
                      {extras.proximaAgo.nome}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <CalendarDays size={12} className="text-gray-400" />
                        {fmtDate(extras.proximaAgo.data_inicio)}
                      </span>
                      {extras.proximaAgo.cidade && (
                        <span className="flex items-center gap-1 text-gray-400">
                          <MapPin size={12} />
                          {extras.proximaAgo.cidade}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Próximo Evento */}
            {extras.proximoEvento && (() => {
              const cal = getCalendarParts(extras.proximoEvento.data_inicio);
              return (
                <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 flex items-center gap-4 relative overflow-hidden group">
                  <Bell
                    size={72}
                    className="absolute -right-3 -bottom-3 text-purple-50 opacity-60 group-hover:scale-105 transition-transform pointer-events-none"
                  />
                  {/* Bloco de Data */}
                  <div className="w-16 h-20 rounded-2xl bg-purple-50 border border-purple-100/80 flex flex-col items-center justify-center flex-shrink-0 text-center shadow-xs">
                    <span className="text-[10px] font-extrabold text-purple-600 tracking-wider uppercase">
                      {cal.mes}
                    </span>
                    <span className="text-2xl font-black text-gray-900 leading-none my-0.5">
                      {cal.dia}
                    </span>
                    <span className="text-[10px] font-semibold text-purple-400">
                      {cal.ano}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0 relative z-10">
                    <span className="inline-block text-[10px] font-extrabold uppercase tracking-wider text-purple-600 mb-1">
                      Próximo Evento
                    </span>
                    <p className="font-extrabold text-gray-900 text-sm leading-snug truncate">
                      {extras.proximoEvento.nome}
                    </p>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-gray-500">
                      <span className="flex items-center gap-1">
                        <CalendarDays size={12} className="text-gray-400" />
                        {fmtDate(extras.proximoEvento.data_inicio)}
                      </span>
                      {extras.proximoEvento.departamento && (
                        <span className="flex items-center gap-1 text-gray-400">
                          <Building size={12} />
                          {extras.proximoEvento.departamento}
                        </span>
                      )}
                      {extras.proximoEvento.cidade && (
                        <span className="flex items-center gap-1 text-gray-400">
                          <MapPin size={12} />
                          {extras.proximoEvento.cidade}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* ── Timeline resumida ──────────────────────────────────── */}
      {historico.length > 0 && (
        <div className="pt-2">
          <div className="flex items-center justify-between mb-3.5">
            <div className="flex items-center gap-2 text-xs font-black tracking-wider text-[#0D2B4E] uppercase">
              <div className="w-1.5 h-4 bg-[#0D2B4E] rounded-full" />
              <span>Histórico Recente</span>
            </div>
            <Link
              href="/portal-ministro/historico"
              className="text-xs text-[#0D2B4E] font-bold hover:underline flex items-center gap-1"
            >
              Ver tudo <ArrowRight size={11} />
            </Link>
          </div>
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            {historico.map((item, idx) => {
              const dot = TIPO_COLOR[item.tipo] || 'bg-gray-400';
              return (
                <div key={item.id} className={`flex items-start gap-4 p-5 ${idx < historico.length - 1 ? 'border-b border-gray-50' : ''}`}>
                  <div className={`mt-1.5 w-2.5 h-2.5 rounded-full flex-shrink-0 ${dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full text-white ${dot}`}>
                        {item.tipoLabel}
                      </span>
                      <span className="text-xs text-gray-400">{fmtDateShort(item.ocorrencia)}</span>
                    </div>
                    {item.titulo && <p className="text-sm font-semibold text-gray-800">{item.titulo}</p>}
                    <p className="text-xs text-gray-500 truncate">{item.descricao}</p>
                  </div>
                </div>
              );
            })}
            <div className="px-5 py-3.5 bg-gray-50/60 border-t border-gray-100">
              <Link
                href="/portal-ministro/historico"
                className="flex items-center justify-center gap-1.5 text-xs font-bold text-[#0D2B4E] hover:underline"
              >
                Ver histórico completo <ChevronRight size={13} />
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
