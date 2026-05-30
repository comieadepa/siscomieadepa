'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMinistro } from '../ministro-context';
import {
  IdCard, History, DollarSign, Printer,
  CheckCircle2, Clock, Play, CalendarDays, Bell,
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
  if (!url) return null;
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  const vmMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vmMatch) return `https://player.vimeo.com/video/${vmMatch[1]}`;
  return url;
}

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
      gradient: 'from-blue-600 to-blue-700',
      badge: credencial?.statusCredencial === 'ativa' ? 'Ativa' : credencial?.statusCredencial === 'vencida' ? 'Vencida' : null,
      badgeOk: credencial?.statusCredencial === 'ativa',
    },
    {
      href: '/portal-ministro/historico',
      label: 'Histórico Ministerial',
      description: 'Consagrações, cartas e deliberações',
      icon: History,
      gradient: 'from-purple-600 to-purple-700',
      badge: null, badgeOk: false,
    },
    {
      href: '/portal-ministro/impressao',
      label: 'Solicitar Impressão',
      description: 'Credencial física — R$ 20,00',
      icon: Printer,
      gradient: 'from-teal-600 to-teal-700',
      badge: null, badgeOk: false,
    },
    ...(ministro.isPastorPresidente ? [{
      href: '/portal-ministro/contribuicoes',
      label: 'Contribuição Estatutária',
      description: 'Histórico e pagamentos',
      icon: DollarSign,
      gradient: 'from-amber-600 to-amber-700',
      badge: null, badgeOk: false,
    }] : []),
  ];

  return (
    <div className="space-y-8 max-w-5xl mx-auto">

      {/* ── Card de identificação premium ─────────────────────── */}
      <div className="rounded-2xl overflow-hidden shadow-lg border border-[#0D2B4E]/10">
        <div className="bg-gradient-to-r from-[#0D2B4E] via-[#14396b] to-[#1a4a7a] px-6 py-7 sm:px-8">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">
            {/* Foto */}
            <div className="flex-shrink-0">
              {ministro.fotoUrl ? (
                <img
                  src={ministro.fotoUrl}
                  alt={ministro.nome}
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl object-cover border-4 border-white/20 shadow-xl"
                />
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-white/10 border-4 border-white/20 flex items-center justify-center text-white text-4xl font-bold shadow-xl">
                  {ministro.nome?.charAt(0) ?? '?'}
                </div>
              )}
            </div>

            {/* Dados principais */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-1.5">
                <h1 className="text-2xl font-bold text-white leading-tight">{ministro.nome}</h1>
                {ministro.status === 'active' && (
                  <span className="inline-flex items-center gap-1 bg-green-400/20 text-green-300 text-xs font-bold px-2.5 py-1 rounded-full border border-green-400/30">
                    <CheckCircle2 size={11} /> Ativo
                  </span>
                )}
                {ministro.isPastorPresidente && (
                  <span className="inline-flex items-center gap-1 bg-amber-400/20 text-amber-300 text-xs font-bold px-2.5 py-1 rounded-full border border-amber-400/30">
                    <Star size={11} /> Pastor Presidente
                  </span>
                )}
              </div>
              {ministro.cargo && (
                <p className="text-blue-200 text-sm font-medium mb-4">{ministro.cargo}</p>
              )}
              <div className="flex flex-wrap gap-x-6 gap-y-2">
                {ministro.matricula && (
                  <div className="flex items-center gap-1.5">
                    <Hash size={11} className="text-white/40" />
                    <span className="text-white/50 text-xs">Matrícula</span>
                    <span className="text-white/80 text-xs font-semibold">{ministro.matricula}</span>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <Shield size={11} className="text-white/40" />
                  <span className="text-white/50 text-xs">CPF</span>
                  <span className="text-white/80 text-xs font-semibold">{ministro.cpfMascarado}</span>
                </div>
                {ministro.campo && (
                  <div className="flex items-center gap-1.5">
                    <MapPin size={11} className="text-white/40" />
                    <span className="text-white/50 text-xs">Campo</span>
                    <span className="text-white/80 text-xs font-semibold">{ministro.campo}</span>
                  </div>
                )}
                {ministro.supervisao && (
                  <div className="flex items-center gap-1.5">
                    <Building size={11} className="text-white/40" />
                    <span className="text-white/50 text-xs">Supervisão</span>
                    <span className="text-white/80 text-xs font-semibold">{ministro.supervisao}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Rodapé branco */}
        <div className="bg-white px-6 sm:px-8 py-3 flex items-center justify-between border-t border-gray-100">
          <p className="text-xs text-gray-400">COMIEADEPA — Portal do Ministro</p>
          <span className="text-xs text-gray-400 italic">Atualização de dados: procure a Secretaria</span>
        </div>
      </div>

      {/* ── Palavra do Presidente ──────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 flex items-center gap-3 border-b border-gray-50">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-[#0D2B4E] to-[#1a4a7a] flex items-center justify-center shadow-sm">
            <Play size={15} className="text-white ml-0.5" />
          </div>
          <div>
            <h2 className="font-bold text-gray-900 text-base leading-tight">
              {video?.titulo || 'Palavra do Presidente'}
            </h2>
            {video?.descricao && (
              <p className="text-xs text-gray-500 mt-0.5">{video.descricao}</p>
            )}
          </div>
        </div>

        {embedUrl ? (
          <div className="relative w-full aspect-video bg-black">
            <iframe
              src={embedUrl}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
              title={video?.titulo || 'Vídeo'}
            />
          </div>
        ) : (
          <div className="m-4 rounded-xl overflow-hidden">
            <div className="h-52 bg-gradient-to-br from-[#0D2B4E] via-[#14396b] to-[#1a4a7a] flex flex-col items-center justify-center gap-4">
              <div className="w-16 h-16 rounded-full bg-white/10 border border-white/20 flex items-center justify-center">
                <Play size={28} className="text-white/70 ml-1" />
              </div>
              <p className="text-sm text-white/50 font-medium">Nenhum vídeo configurado</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Credencial + Pendências ────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Mini-preview credencial */}
        <div className={`rounded-2xl border p-5 ${
          credencial?.statusCredencial === 'ativa'
            ? 'bg-green-50 border-green-200'
            : credencial?.statusCredencial === 'vencida'
            ? 'bg-red-50 border-red-200'
            : 'bg-gray-50 border-gray-200'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${
              credencial?.statusCredencial === 'ativa' ? 'bg-green-500'
              : credencial?.statusCredencial === 'vencida' ? 'bg-red-500'
              : 'bg-gray-400'
            }`}>
              {credencial?.statusCredencial === 'ativa'
                ? <CheckCircle2 size={18} className="text-white" />
                : credencial?.statusCredencial === 'vencida'
                ? <AlertTriangle size={18} className="text-white" />
                : <Clock size={18} className="text-white" />
              }
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm">Credencial Digital</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {credencial?.statusCredencial === 'ativa' && `Válida até ${fmtDateShort(credencial.dataValidade)}`}
                {credencial?.statusCredencial === 'vencida' && 'Credencial vencida'}
                {(!credencial || credencial.statusCredencial === 'pendente') && 'Sem credencial emitida'}
              </p>
            </div>
          </div>
          <div className="flex gap-2.5">
            <Link
              href="/portal-ministro/credencial"
              className="flex-1 text-center text-xs font-bold py-2.5 px-3 rounded-xl bg-[#0D2B4E] text-white hover:bg-[#1a4a7a] transition-colors"
            >
              Ver Credencial
            </Link>
            <Link
              href="/portal-ministro/impressao"
              className="flex-1 text-center text-xs font-bold py-2.5 px-3 rounded-xl border-2 border-[#0D2B4E]/20 text-[#0D2B4E] hover:bg-[#0D2B4E]/5 transition-colors"
            >
              Solicitar Impressão
            </Link>
          </div>
        </div>

        {/* Central de Pendências */}
        <div className={`rounded-2xl border p-5 ${
          hasUrgent ? 'bg-red-50 border-red-200'
          : hasPendencias ? 'bg-amber-50 border-amber-200'
          : 'bg-green-50 border-green-200'
        }`}>
          <div className="flex items-center gap-3 mb-4">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shadow-sm ${
              hasUrgent ? 'bg-red-500' : hasPendencias ? 'bg-amber-500' : 'bg-green-500'
            }`}>
              {hasPendencias
                ? <AlertTriangle size={18} className="text-white" />
                : <CheckCircle2 size={18} className="text-white" />
              }
            </div>
            <div>
              <p className="font-bold text-gray-900 text-sm">Central de Pendências</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {hasPendencias
                  ? `${extras!.pendencias.length} pendência${extras!.pendencias.length > 1 ? 's' : ''}`
                  : 'Situação regular'}
              </p>
            </div>
          </div>
          {hasPendencias ? (
            <ul className="space-y-1.5">
              {extras!.pendencias.slice(0, 2).map((p, i) => (
                <li key={i} className={`text-xs rounded-lg px-3 py-2 font-medium ${
                  p.urgente ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-amber-100 text-amber-800 border border-amber-200'
                }`}>
                  {p.mensagem}
                </li>
              ))}
              {extras!.pendencias.length > 2 && (
                <p className="text-xs text-gray-400 pl-1 mt-1">+{extras!.pendencias.length - 2} mais...</p>
              )}
            </ul>
          ) : (
            <p className="text-sm text-green-700 font-semibold flex items-center gap-1.5">
              <CheckCircle2 size={14} /> Sem pendências. Tudo em dia!
            </p>
          )}
        </div>
      </div>

      {/* ── Acesso rápido ─────────────────────────────────────── */}
      <div>
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Acesso rápido</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickCards.map(({ href, label, description, icon: Icon, gradient, badge, badgeOk }) => (
            <Link
              key={href}
              href={href}
              className="group bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-200 p-5 flex flex-col"
            >
              <div className={`w-13 h-13 w-12 h-12 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center mb-4 shadow-md`}>
                <Icon size={22} className="text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-start justify-between gap-1 mb-1">
                  <p className="font-bold text-gray-800 text-sm group-hover:text-[#0D2B4E] transition-colors leading-tight">
                    {label}
                  </p>
                  {badge && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ${badgeOk ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">{description}</p>
              </div>
              <div className="mt-4 flex items-center text-xs font-semibold text-gray-400 group-hover:text-[#0D2B4E] transition-colors">
                Acessar <ArrowRight size={12} className="ml-1 group-hover:translate-x-1 transition-transform" />
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Agenda (AGO + Evento) ──────────────────────────────── */}
      {extras && (extras.proximaAgo || extras.proximoEvento) && (
        <div>
          <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Agenda</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {extras.proximaAgo && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-sm">
                    <CalendarDays size={18} className="text-white" />
                  </div>
                  <p className="font-bold text-gray-800 text-sm">Próxima AGO</p>
                </div>
                <p className="text-sm font-semibold text-gray-700 leading-tight">{extras.proximaAgo.nome}</p>
                <p className="text-xs text-gray-500 mt-1.5">{fmtDate(extras.proximaAgo.data_inicio)}</p>
                {extras.proximaAgo.cidade && (
                  <p className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                    <MapPin size={10} />{extras.proximaAgo.cidade}
                  </p>
                )}
              </div>
            )}
            {extras.proximoEvento && (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-purple-600 to-purple-700 flex items-center justify-center shadow-sm">
                    <Bell size={18} className="text-white" />
                  </div>
                  <p className="font-bold text-gray-800 text-sm">Próximo Evento</p>
                </div>
                <p className="text-sm font-semibold text-gray-700 leading-tight">{extras.proximoEvento.nome}</p>
                <p className="text-xs text-gray-500 mt-1.5">{fmtDate(extras.proximoEvento.data_inicio)}</p>
                {extras.proximoEvento.departamento && (
                  <p className="text-xs text-gray-400 mt-0.5">{extras.proximoEvento.departamento}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Timeline resumida ──────────────────────────────────── */}
      {historico.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider">Histórico recente</h2>
            <Link
              href="/portal-ministro/historico"
              className="text-xs text-[#0D2B4E] font-bold hover:underline flex items-center gap-1"
            >
              Ver tudo <ArrowRight size={11} />
            </Link>
          </div>
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
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
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
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
