'use client';

import { useEffect, useState } from 'react';
import { authenticatedFetch } from '@/lib/api-client';
import { Video, Save, CheckCircle2, AlertCircle } from 'lucide-react';
import PageLayout from '@/components/PageLayout';

interface VideoConfig {
  titulo: string;
  descricao: string | null;
  url_video: string | null;
  ativo: boolean;
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
        setMsg({ type: 'success', text: 'Configuração salva com sucesso.' });
      }
    } catch {
      setMsg({ type: 'error', text: 'Erro de conexão.' });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <PageLayout
      title="Palavra do Presidente"
      description="Configure o vídeo exibido no Portal do Ministro"
      activeMenu="configuracoes"
    >
      <div className="max-w-xl">
        {loading ? (
          <p className="text-gray-500">Carregando...</p>
        ) : (
          <form onSubmit={handleSalvar} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
            <div className="flex items-center gap-3 mb-2">
              <Video size={20} className="text-[#0D2B4E]" />
              <h2 className="font-semibold text-gray-800">Configuração do Vídeo</h2>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Título</label>
              <input
                type="text"
                value={form.titulo}
                onChange={(e) => setForm({ ...form, titulo: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Descrição <span className="text-gray-400">(opcional)</span>
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
              <label className="block text-sm font-medium text-gray-700 mb-1">URL do vídeo</label>
              <input
                type="url"
                value={form.url_video || ''}
                onChange={(e) => setForm({ ...form, url_video: e.target.value })}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
              />
              <p className="text-xs text-gray-400 mt-1">Aceita links do YouTube, Vimeo ou direto (MP4).</p>
            </div>

            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="ativo"
                checked={form.ativo}
                onChange={(e) => setForm({ ...form, ativo: e.target.checked })}
                className="w-4 h-4 accent-[#0D2B4E]"
              />
              <label htmlFor="ativo" className="text-sm font-medium text-gray-700">
                Exibir o vídeo no Portal do Ministro
              </label>
            </div>

            {msg && (
              <div className={`flex items-center gap-2 text-sm rounded-lg px-4 py-3 ${
                msg.type === 'success'
                  ? 'bg-green-50 border border-green-200 text-green-700'
                  : 'bg-red-50 border border-red-200 text-red-700'
              }`}>
                {msg.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                {msg.text}
              </div>
            )}

            <button
              type="submit"
              disabled={salvando}
              className="inline-flex items-center gap-2 bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white font-semibold px-6 py-2.5 rounded-lg transition-colors disabled:opacity-60"
            >
              <Save size={16} />
              {salvando ? 'Salvando...' : 'Salvar configuração'}
            </button>
          </form>
        )}
      </div>
    </PageLayout>
  );
}
