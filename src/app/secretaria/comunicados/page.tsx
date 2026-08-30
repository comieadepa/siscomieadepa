'use client';

import { useEffect, useState, useCallback } from 'react';
import PageLayout from '@/components/PageLayout';
import { authenticatedFetch } from '@/lib/api-client';
import {
  Send,
  Bell,
  Mail,
  History,
  CheckCircle2,
  AlertCircle,
  Clock,
  RefreshCw,
  X,
  ExternalLink,
} from 'lucide-react';

interface SupervisaoOption {
  id: string;
  nome: string;
}

interface CampoOption {
  id: string;
  nome: string;
  supervisao_id?: string;
}

interface ComunicadoItem {
  id: string;
  titulo: string;
  mensagem: string;
  linkAcao: string | null;
  canal: 'in_app' | 'email' | 'ambos';
  publicoTipo: 'todos' | 'pastores_presidentes' | 'supervisao' | 'campo' | 'cargo';
  supervisaoNome: string | null;
  campoNome: string | null;
  cargoAlvo: string | null;
  enviadoEm: string;
  totalAlvos: number;
}

const CARGOS_OPCOES = [
  'Pastor',
  'Pastor Presidente',
  'Evangelista',
  'Presbítero',
  'Diácono',
  'Missionário',
  'Missionária',
];

const fmtDate = (v: string | null) => {
  if (!v) return '—';
  return new Date(v).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export default function ComunicadosSecretariaPage() {
  // Estados do formulário
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');
  const [linkAcao, setLinkAcao] = useState('');
  const [canal, setCanal] = useState<'in_app' | 'email' | 'ambos'>('ambos');
  const [publicoTipo, setPublicoTipo] = useState<'todos' | 'pastores_presidentes' | 'supervisao' | 'campo' | 'cargo'>('todos');
  const [supervisaoId, setSupervisaoId] = useState('');
  const [campoId, setCampoId] = useState('');
  const [cargoAlvo, setCargoAlvo] = useState('');

  // Dados auxiliares de seletores
  const [supervisoes, setSupervisoes] = useState<SupervisaoOption[]>([]);
  const [campos, setCampos] = useState<CampoOption[]>([]);

  // Estados de confirmação e envio
  const [modalConfirmacao, setModalConfirmacao] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Estados do histórico
  const [historico, setHistorico] = useState<ComunicadoItem[]>([]);
  const [loadingHistorico, setLoadingHistorico] = useState(true);

  // Carrega opções de supervisões e campos
  useEffect(() => {
    async function carregarFiltros() {
      try {
        const [resSup, resCam] = await Promise.all([
          authenticatedFetch('/api/v1/secretaria/supervisoes'),
          authenticatedFetch('/api/v1/secretaria/campos'),
        ]);

        if (resSup.ok) {
          const d = await resSup.json();
          setSupervisoes(d.data || []);
        }

        if (resCam.ok) {
          const d = await resCam.json();
          setCampos(d.data || []);
        }
      } catch (err) {
        console.error('Erro ao carregar supervisões e campos:', err);
      }
    }
    void carregarFiltros();
  }, []);

  // Carrega histórico de comunicados
  const carregarHistorico = useCallback(async () => {
    setLoadingHistorico(true);
    try {
      const res = await authenticatedFetch('/api/secretaria/comunicados');
      if (res.ok) {
        const d = await res.json();
        setHistorico(d.data || []);
      }
    } catch (err) {
      console.error('Erro ao carregar histórico de comunicados:', err);
    } finally {
      setLoadingHistorico(false);
    }
  }, []);

  useEffect(() => {
    void carregarHistorico();
  }, [carregarHistorico]);

  // Validação preliminar antes de abrir modal de confirmação
  const handleAbrirConfirmacao = (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);

    if (!titulo.trim()) {
      setMsg({ type: 'error', text: 'Informe o título do comunicado.' });
      return;
    }
    if (!mensagem.trim()) {
      setMsg({ type: 'error', text: 'Informe a mensagem do comunicado.' });
      return;
    }
    if (publicoTipo === 'supervisao' && !supervisaoId) {
      setMsg({ type: 'error', text: 'Selecione a supervisão de destino.' });
      return;
    }
    if (publicoTipo === 'campo' && !campoId) {
      setMsg({ type: 'error', text: 'Selecione o campo de destino.' });
      return;
    }
    if (publicoTipo === 'cargo' && !cargoAlvo) {
      setMsg({ type: 'error', text: 'Selecione o cargo ministerial de destino.' });
      return;
    }

    setModalConfirmacao(true);
  };

  // Submissão real para a API
  const handlePublicarComunicado = async () => {
    setEnviando(true);
    setMsg(null);

    try {
      const res = await authenticatedFetch('/api/secretaria/comunicados', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titulo: titulo.trim(),
          mensagem: mensagem.trim(),
          linkAcao: linkAcao.trim() || null,
          canal,
          publicoTipo,
          supervisaoId: publicoTipo === 'supervisao' ? supervisaoId : null,
          campoId: publicoTipo === 'campo' ? campoId : null,
          cargoAlvo: publicoTipo === 'cargo' ? cargoAlvo : null,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setMsg({ type: 'error', text: data.error || 'Erro ao publicar comunicado.' });
      } else {
        setMsg({
          type: 'success',
          text: 'Comunicado cadastrado com sucesso! O job de background iniciará o envio em lotes.',
        });
        // Limpa formulário
        setTitulo('');
        setMensagem('');
        setLinkAcao('');
        setPublicoTipo('todos');
        setSupervisaoId('');
        setCampoId('');
        setCargoAlvo('');
        setModalConfirmacao(false);
        void carregarHistorico();
      }
    } catch {
      setMsg({ type: 'error', text: 'Erro de conexão com o servidor.' });
    } finally {
      setEnviando(false);
    }
  };

  const getDescricaoPublico = () => {
    switch (publicoTipo) {
      case 'todos':
        return 'Todos os Ministros Ativos da COMIEADEPA';
      case 'pastores_presidentes':
        return 'Apenas Pastores Presidentes';
      case 'supervisao': {
        const sup = supervisoes.find((s) => s.id === supervisaoId);
        return `Ministros da Supervisão: ${sup?.nome || 'Selecionada'}`;
      }
      case 'campo': {
        const cam = campos.find((c) => c.id === campoId);
        return `Ministros do Campo: ${cam?.nome || 'Selecionado'}`;
      }
      case 'cargo':
        return `Ministros com o Cargo: ${cargoAlvo}`;
    }
  };

  const getPublicoBadge = (item: ComunicadoItem) => {
    switch (item.publicoTipo) {
      case 'todos':
        return { label: 'Todos os Ministros', bg: 'bg-blue-100 text-blue-800' };
      case 'pastores_presidentes':
        return { label: 'Pastores Presidentes', bg: 'bg-purple-100 text-purple-800' };
      case 'supervisao':
        return { label: `Supervisão: ${item.supervisaoNome || '—'}`, bg: 'bg-emerald-100 text-emerald-800' };
      case 'campo':
        return { label: `Campo: ${item.campoNome || '—'}`, bg: 'bg-amber-100 text-amber-800' };
      case 'cargo':
        return { label: `Cargo: ${item.cargoAlvo || '—'}`, bg: 'bg-indigo-100 text-indigo-800' };
    }
  };

  const getCanalBadge = (c: string) => {
    switch (c) {
      case 'in_app':
        return { label: 'In-App (Sino)', icon: Bell, bg: 'bg-gray-100 text-gray-700' };
      case 'email':
        return { label: 'E-mail', icon: Mail, bg: 'bg-sky-100 text-sky-800' };
      case 'ambos':
      default:
        return { label: 'In-App + E-mail', icon: Send, bg: 'bg-emerald-100 text-emerald-800' };
    }
  };

  return (
    <PageLayout
      title="Comunicados Oficiais"
      description="Emissão e distribuição de comunicados oficiais para os ministros da COMIEADEPA"
      activeMenu="secretaria"
    >
      <div className="space-y-8">
        {/* Mensagem de Feedback */}
        {msg && (
          <div
            className={`p-4 rounded-xl border flex items-center justify-between gap-3 ${
              msg.type === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <div className="flex items-center gap-2.5">
              {msg.type === 'success' ? <CheckCircle2 size={20} /> : <AlertCircle size={20} />}
              <span className="text-sm font-medium">{msg.text}</span>
            </div>
            <button onClick={() => setMsg(null)} className="text-gray-400 hover:text-gray-600">
              <X size={16} />
            </button>
          </div>
        )}

        {/* Card: Formulário de Criação */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-gray-100">
            <div className="w-10 h-10 rounded-xl bg-[#0D2B4E]/10 flex items-center justify-center text-[#0D2B4E]">
              <Send size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-gray-900">Novo Comunicado Oficial</h2>
              <p className="text-xs text-gray-500">
                Redija o comunicado e selecione a segmentação de ministros para envio em lote
              </p>
            </div>
          </div>

          <form onSubmit={handleAbrirConfirmacao} className="space-y-6">
            {/* Título */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                Título do Comunicado *
              </label>
              <input
                type="text"
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                placeholder="Ex: Convocação para Reunião de Pastores / Recadastramento Ministerial"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-[#0D2B4E] focus:outline-none transition-all"
                required
              />
            </div>

            {/* Mensagem */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                Mensagem do Comunicado *
              </label>
              <textarea
                rows={4}
                value={mensagem}
                onChange={(e) => setMensagem(e.target.value)}
                placeholder="Escreva a mensagem oficial que será entregue aos ministros no Portal e por e-mail..."
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-[#0D2B4E] focus:outline-none transition-all resize-y"
                required
              />
            </div>

            {/* Link de Ação */}
            <div>
              <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-2">
                Link de Ação no Portal (Opcional)
              </label>
              <input
                type="text"
                value={linkAcao}
                onChange={(e) => setLinkAcao(e.target.value)}
                placeholder="Ex: /portal-ministro/credencial ou /portal-ministro/eventos"
                className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:bg-white focus:ring-2 focus:ring-[#0D2B4E] focus:outline-none transition-all"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                Ao clicar na notificação, o ministro será direcionado diretamente para esta página.
              </p>
            </div>

            {/* Configurações de Envio: Canal e Público */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4 border-t border-gray-100">
              {/* Canal */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">
                  Canal de Notificação *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { key: 'ambos', label: 'In-App + E-mail', icon: Send },
                    { key: 'in_app', label: 'Apenas In-App', icon: Bell },
                    { key: 'email', label: 'Apenas E-mail', icon: Mail },
                  ].map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setCanal(key as any)}
                      className={`flex flex-col items-center justify-center p-3 rounded-xl border text-xs font-semibold transition-all ${
                        canal === key
                          ? 'border-[#0D2B4E] bg-[#0D2B4E] text-white shadow-sm'
                          : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      <Icon size={16} className="mb-1.5" />
                      <span>{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Segmentação de Público */}
              <div>
                <label className="block text-xs font-bold text-gray-700 uppercase tracking-wider mb-3">
                  Público-Alvo *
                </label>
                <select
                  value={publicoTipo}
                  onChange={(e) => setPublicoTipo(e.target.value as any)}
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium focus:bg-white focus:ring-2 focus:ring-[#0D2B4E] focus:outline-none transition-all"
                >
                  <option value="todos">Todos os Ministros Ativos</option>
                  <option value="pastores_presidentes">Apenas Pastores Presidentes</option>
                  <option value="supervisao">Segmentar por Supervisão</option>
                  <option value="campo">Segmentar por Campo</option>
                  <option value="cargo">Segmentar por Cargo Ministerial</option>
                </select>
              </div>
            </div>

            {/* Seletores Dinâmicos de Segmentação */}
            {publicoTipo === 'supervisao' && (
              <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                <label className="block text-xs font-bold text-[#0D2B4E] uppercase tracking-wider mb-2">
                  Selecione a Supervisão de Destino *
                </label>
                <select
                  value={supervisaoId}
                  onChange={(e) => setSupervisaoId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0D2B4E] focus:outline-none"
                  required
                >
                  <option value="">Selecione uma supervisão...</option>
                  {supervisoes.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {publicoTipo === 'campo' && (
              <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                <label className="block text-xs font-bold text-[#0D2B4E] uppercase tracking-wider mb-2">
                  Selecione o Campo de Destino *
                </label>
                <select
                  value={campoId}
                  onChange={(e) => setCampoId(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0D2B4E] focus:outline-none"
                  required
                >
                  <option value="">Selecione um campo...</option>
                  {campos.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {publicoTipo === 'cargo' && (
              <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100">
                <label className="block text-xs font-bold text-[#0D2B4E] uppercase tracking-wider mb-2">
                  Selecione o Cargo Ministerial de Destino *
                </label>
                <select
                  value={cargoAlvo}
                  onChange={(e) => setCargoAlvo(e.target.value)}
                  className="w-full px-4 py-2.5 bg-white border border-blue-200 rounded-xl text-sm focus:ring-2 focus:ring-[#0D2B4E] focus:outline-none"
                  required
                >
                  <option value="">Selecione um cargo...</option>
                  {CARGOS_OPCOES.map((cg) => (
                    <option key={cg} value={cg}>
                      {cg}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Botão de Ação */}
            <div className="flex justify-end pt-4 border-t border-gray-100">
              <button
                type="submit"
                className="flex items-center gap-2 px-6 py-3 bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white font-bold text-sm rounded-xl shadow-md transition-all active:scale-[0.98]"
              >
                <Send size={16} />
                <span>Revisar e Publicar Comunicado</span>
              </button>
            </div>
          </form>
        </div>

        {/* Modal de Confirmação Pré-Publicação */}
        {modalConfirmacao && (
          <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden animate-fadeIn">
              <div className="px-6 py-4 bg-[#0D2B4E] text-white flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <Send size={18} className="text-blue-300" />
                  <h3 className="font-bold text-sm">Confirmar Publicação de Comunicado</h3>
                </div>
                <button
                  onClick={() => setModalConfirmacao(false)}
                  disabled={enviando}
                  className="text-white/70 hover:text-white"
                >
                  <X size={18} />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Título</span>
                  <p className="text-sm font-bold text-gray-900 mt-0.5">{titulo}</p>
                </div>

                <div>
                  <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Público-Alvo</span>
                  <p className="text-sm font-semibold text-blue-900 mt-0.5">{getDescricaoPublico()}</p>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div>
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Canal</span>
                    <p className="text-xs font-semibold text-gray-700 mt-0.5">
                      {canal === 'ambos' ? 'In-App + E-mail' : canal === 'in_app' ? 'In-App (Sino)' : 'E-mail'}
                    </p>
                  </div>
                  {linkAcao && (
                    <div>
                      <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Link de Ação</span>
                      <p className="text-xs font-mono text-gray-700 truncate mt-0.5">{linkAcao}</p>
                    </div>
                  )}
                </div>

                <div className="p-4 bg-amber-50 rounded-xl border border-amber-200 flex items-start gap-3 mt-4">
                  <Clock size={18} className="text-amber-700 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-800 leading-relaxed">
                    O comunicado será cadastrado na matriz oficial e <strong>processado em lotes seguros pelo job de background</strong>, sendo entregue progressivamente a todos os ministros elegíveis.
                  </p>
                </div>
              </div>

              <div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalConfirmacao(false)}
                  disabled={enviando}
                  className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 rounded-xl transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handlePublicarComunicado}
                  disabled={enviando}
                  className="flex items-center gap-2 px-5 py-2.5 bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white font-bold text-sm rounded-xl shadow-sm transition-all disabled:opacity-50"
                >
                  {enviando ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span>Cadastrando...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={16} />
                      <span>Confirmar Publicação</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Card: Histórico de Comunicados */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center text-gray-600">
                <History size={20} />
              </div>
              <div>
                <h2 className="text-base font-bold text-gray-900">Histórico de Comunicados</h2>
                <p className="text-xs text-gray-500">
                  Comunicados emitidos pela Convenção e progresso de entrega aos ministros
                </p>
              </div>
            </div>

            <button
              onClick={() => void carregarHistorico()}
              disabled={loadingHistorico}
              className="p-2 text-gray-500 hover:text-[#0D2B4E] hover:bg-gray-100 rounded-xl transition-colors"
              title="Atualizar Histórico"
            >
              <RefreshCw size={16} className={loadingHistorico ? 'animate-spin' : ''} />
            </button>
          </div>

          {loadingHistorico ? (
            <div className="py-12 text-center">
              <div className="w-8 h-8 border-3 border-[#0D2B4E]/30 border-t-[#0D2B4E] rounded-full animate-spin mx-auto mb-3" />
              <p className="text-xs text-gray-500">Carregando histórico...</p>
            </div>
          ) : historico.length === 0 ? (
            <div className="py-12 text-center">
              <History size={36} className="mx-auto mb-2 text-gray-300" />
              <p className="text-sm font-semibold text-gray-600">Nenhum comunicado cadastrado</p>
              <p className="text-xs text-gray-400 mt-0.5">Os comunicados emitidos aparecerão listados aqui.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-gray-600">
                <thead className="bg-gray-50 text-[11px] font-bold text-gray-500 uppercase tracking-wider border-b border-gray-100">
                  <tr>
                    <th className="px-6 py-3.5">Título / Mensagem</th>
                    <th className="px-6 py-3.5">Público-Alvo</th>
                    <th className="px-6 py-3.5">Canal</th>
                    <th className="px-6 py-3.5">Data de Envio</th>
                    <th className="px-6 py-3.5 text-center">Destinatários Notificados</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {historico.map((item) => {
                    const pub = getPublicoBadge(item);
                    const can = getCanalBadge(item.canal);
                    const IconCanal = can.icon;

                    return (
                      <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                        {/* Título e Mensagem */}
                        <td className="px-6 py-4 max-w-xs">
                          <p className="font-bold text-gray-900 text-sm leading-snug">{item.titulo}</p>
                          <p className="text-gray-500 text-xs line-clamp-2 mt-1 leading-relaxed">
                            {item.mensagem}
                          </p>
                          {item.linkAcao && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-blue-700 font-medium mt-1">
                              <ExternalLink size={10} />
                              {item.linkAcao}
                            </span>
                          )}
                        </td>

                        {/* Público */}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-block px-2.5 py-1 rounded-full text-[11px] font-bold ${pub.bg}`}>
                            {pub.label}
                          </span>
                        </td>

                        {/* Canal */}
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-bold ${can.bg}`}
                          >
                            <IconCanal size={12} />
                            {can.label}
                          </span>
                        </td>

                        {/* Data */}
                        <td className="px-6 py-4 whitespace-nowrap font-medium text-gray-500">
                          {fmtDate(item.enviadoEm)}
                        </td>

                        {/* Total Alvos */}
                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 text-blue-800 text-xs font-bold ring-1 ring-blue-200">
                            {item.totalAlvos} ministro{item.totalAlvos === 1 ? '' : 's'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </PageLayout>
  );
}
