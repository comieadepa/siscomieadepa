'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMinistro } from '../layout';
import {
  IdCard,
  History,
  DollarSign,
  Printer,
  CheckCircle2,
  Clock,
  Play,
} from 'lucide-react';

interface VideoConfig {
  titulo: string;
  descricao: string | null;
  urlVideo: string | null;
  ativo: boolean;
}

function getEmbedUrl(url: string | null): string | null {
  if (!url) return null;
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  // Vimeo
  const vmMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vmMatch) return `https://player.vimeo.com/video/${vmMatch[1]}`;
  return url; // Fallback: usa direto
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
    active:   { label: 'Ativo', color: 'bg-green-100 text-green-800', icon: <CheckCircle2 size={14} /> },
    inactive: { label: 'Inativo', color: 'bg-gray-100 text-gray-600', icon: <Clock size={14} /> },
    deceased: { label: 'Falecido', color: 'bg-gray-200 text-gray-700', icon: null },
    transferred: { label: 'Transferido', color: 'bg-yellow-100 text-yellow-800', icon: null },
  };
  const m = map[status] || { label: status, color: 'bg-gray-100 text-gray-600', icon: null };
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${m.color}`}>
      {m.icon}
      {m.label}
    </span>
  );
}

const QUICK_CARDS = [
  {
    href: '/portal-ministro/credencial',
    label: 'Minha Credencial',
    description: 'Acesse sua credencial digital',
    icon: IdCard,
    color: 'bg-blue-600',
  },
  {
    href: '/portal-ministro/historico',
    label: 'Histórico Ministerial',
    description: 'Consagrações, deliberações e mais',
    icon: History,
    color: 'bg-purple-600',
  },
  {
    href: '/portal-ministro/impressao',
    label: 'Solicitar Impressão',
    description: 'Taxa R$ 20,00 via ASAAS',
    icon: Printer,
    color: 'bg-teal-600',
  },
];

export default function PortalMinistroDashboard() {
  const { ministro } = useMinistro();
  const [video, setVideo] = useState<VideoConfig | null>(null);

  useEffect(() => {
    fetch('/api/portal-ministro/video-config')
      .then((r) => r.json())
      .then(setVideo)
      .catch(() => {});
  }, []);

  if (!ministro) return null;

  const quickCards = ministro.isPastorPresidente
    ? [
        ...QUICK_CARDS,
        {
          href: '/portal-ministro/contribuicoes',
          label: 'Contribuição Estatutária',
          description: 'Histórico e pagamentos',
          icon: DollarSign,
          color: 'bg-orange-600',
        },
      ]
    : QUICK_CARDS;

  const embedUrl = getEmbedUrl(video?.urlVideo || null);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* ── Card de identificação ─────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 flex flex-col sm:flex-row gap-6 items-start sm:items-center">
        {/* Foto */}
        <div className="flex-shrink-0">
          {ministro.fotoUrl ? (
            <img
              src={ministro.fotoUrl}
              alt={ministro.nome}
              className="w-20 h-20 rounded-full object-cover border-4 border-[#0D2B4E]/20"
            />
          ) : (
            <div className="w-20 h-20 rounded-full bg-[#0D2B4E] flex items-center justify-center text-white text-3xl font-bold">
              {ministro.nome.charAt(0)}
            </div>
          )}
        </div>

        {/* Dados */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-gray-900">{ministro.nome}</h1>
            <StatusBadge status={ministro.status} />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm text-gray-600 mt-2">
            {ministro.matricula && (
              <div><span className="text-gray-400">Matrícula:</span> {ministro.matricula}</div>
            )}
            <div><span className="text-gray-400">CPF:</span> {ministro.cpfMascarado}</div>
            {ministro.cargo && (
              <div><span className="text-gray-400">Cargo:</span> {ministro.cargo}</div>
            )}
            {ministro.campo && (
              <div><span className="text-gray-400">Campo:</span> {ministro.campo}</div>
            )}
            {ministro.supervisao && (
              <div><span className="text-gray-400">Supervisão:</span> {ministro.supervisao}</div>
            )}
          </div>
        </div>
      </div>

      {/* ── Vídeo: Palavra do Presidente ──────────────────────────────────── */}
      {video && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 pt-5 pb-3 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-[#0D2B4E]">{video.titulo}</h2>
              {video.descricao && <p className="text-sm text-gray-500 mt-0.5">{video.descricao}</p>}
            </div>
            <Play size={20} className="text-[#0D2B4E]/40" />
          </div>

          {embedUrl ? (
            <div className="relative w-full aspect-video bg-black">
              <iframe
                src={embedUrl}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
                title={video.titulo}
              />
            </div>
          ) : (
            <div className="mx-6 mb-6 h-48 bg-gradient-to-br from-[#0D2B4E] to-[#1a4a7a] rounded-xl flex flex-col items-center justify-center text-white gap-3">
              <Play size={40} className="opacity-60" />
              <span className="text-sm opacity-70">Nenhum vídeo configurado no momento</span>
            </div>
          )}
        </div>
      )}

      {/* ── Cards rápidos ──────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-base font-semibold text-gray-700 mb-3">Acesso rápido</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickCards.map(({ href, label, description, icon: Icon, color }) => (
            <Link
              key={href}
              href={href}
              className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow group"
            >
              <div className={`w-10 h-10 rounded-lg ${color} flex items-center justify-center`}>
                <Icon size={20} className="text-white" />
              </div>
              <div>
                <p className="font-semibold text-gray-800 text-sm group-hover:text-[#0D2B4E] transition-colors">
                  {label}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{description}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
