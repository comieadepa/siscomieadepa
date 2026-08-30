'use client';

import { useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/api-client';
import { Video, Save, CheckCircle2, AlertCircle, Play } from 'lucide-react';
import PageLayout from '@/components/PageLayout';

interface VideoConfig {
  titulo: string;
  descricao: string | null;
  url_video: string | null;
  ativo: boolean;
}

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

export default function VideoConfigPage() {
  const [form, setForm] = useState<VideoConfig>({
    titulo: 'Palavra do Presidente',
    descricao: '',
    url_video: '',
    ativo: false,
  });
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    authenticatedFetch('/api/portal-ministro/video-admin')
      .then((r) => r.json())
      .then((d) => {
        if (d.data) {
          setForm({
            titulo: d.data.titulo || 'Palavra do Presidente',
            descricao: d.data.descricao || '',
            url_video: d.data.url_video || '',
            ativo: !!d.data.ativo,
          });
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setMsg(null);
    try {
      const res = await authenticatedFetch('/api/portal-ministro/video-admin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg({ type: 'error', text: json.error || 'Erro ao salvar.' });
      } else {
        setMsg({ type: 'success', text: 'Configuração do vídeo salva com sucesso.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Erro de conexão com o servidor.' });
    } finally {
      setSalvando(false);
    }
  };

  const embedUrl = getEmbedUrl(form.url_video);

  return (
    <PageLayout
      title="Palavra do Presidente"
      description="Configure o vídeo exibido no Portal do Ministro"
      activeMenu="configuracoes"
    >
      <div className="max-w-5xl">
        {loading ? (
          <p className="text-gray-500">Carregando configurações...</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Formulário */}
            <form onSubmit={handleSalvar} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 rounded-xl bg-[#0D2B4E]/10 flex items-center justify-center text-[#0D2B4E]">
                  <Video size={20} />
                </div>
                <div>
                  <h2 className="font-bold text-gray-800 text-base">Configuração do Vídeo</h2>
                  <p className="text-xs text-gray-500">Defina os dados do vídeo pastoral exibido no Portal</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Título do Vídeo *</label>
                <input
                  type="text"
                  value={form.titulo}
                  onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Subtítulo / Descrição <span className="text-gray-400 font-normal">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={form.descricao || ''}
                  onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                  placeholder="Ex: Mensagem especial para os ministros"
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">URL do vídeo</label>
                <input
                  type="url"
                  value={form.url_video || ''}
                  onChange={(e) => setForm({ ...form, url_video: e.target.value })}
                  placeholder="https://www.youtube.com/watch?v=..."
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                />
                <p className="text-xs text-gray-400 mt-1">Aceita links do YouTube, Vimeo ou link direto (MP4).</p>
              </div>

              <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <input
                  type="checkbox"
                  id="ativo"
                  checked={form.ativo}
                  onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                  className="w-5 h-5 accent-[#0D2B4E] rounded cursor-pointer"
                />
                <label htmlFor="ativo" className="text-sm font-medium text-gray-800 cursor-pointer">
                  Exibir o vídeo no Portal do Ministro
                </label>
              </div>

              {msg && (
                <div
                  className={`flex items-center gap-2 text-sm rounded-xl px-4 py-3 ${
                    msg.type === 'success'
                      ? 'bg-green-50 border border-green-200 text-green-700'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}
                >
                  {msg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                  <span>{msg.text}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={salvando}
                className="w-full inline-flex items-center justify-center gap-2 bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white font-bold px-6 py-3 rounded-xl transition-all shadow-md active:scale-[0.98] disabled:opacity-60"
              >
                <Save size={16} />
                <span>{salvando ? 'Salvando...' : 'Salvar Configuração'}</span>
              </button>
            </form>

            {/* Prévia do Card */}
            <div className="space-y-4">
              <h3 className="text-base font-bold text-gray-800 flex items-center gap-2">
                <span>👁️</span> Prévia do Card no Portal do Ministro
              </h3>

              <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-5 py-3.5 flex items-center gap-3 border-b border-gray-100 bg-[#0D2B4E] text-white">
                  <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                    <Play size={14} className="text-white ml-0.5" />
                  </div>
                  <div className="min-w-0">
                    <h4 className="font-bold text-sm truncate">{form.titulo || 'Palavra do Presidente'}</h4>
                    {form.descricao && <p className="text-xs text-blue-200 truncate">{form.descricao}</p>}
                  </div>
                </div>

                {embedUrl && form.ativo ? (
                  <div className="relative w-full aspect-video bg-black">
                    <iframe
                      src={embedUrl}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="absolute inset-0 w-full h-full"
                      title="Prévia do Vídeo"
                    />
                  </div>
                ) : (
                  <div className="p-8 text-center bg-gray-50">
                    <div className="w-14 h-14 rounded-full bg-gray-200 flex items-center justify-center mx-auto mb-3 text-gray-400">
                      <Play size={24} className="ml-1" />
                    </div>
                    <p className="text-sm font-semibold text-gray-600">
                      {!form.ativo ? 'Vídeo atualmente desativado' : 'Nenhum link de vídeo configurado'}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {!form.ativo
                        ? 'Marque a opção "Exibir o vídeo no Portal do Ministro" para ativá-lo.'
                        : 'Insira uma URL do YouTube ou Vimeo ao lado para carregar o player.'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </PageLayout>
  );
}
