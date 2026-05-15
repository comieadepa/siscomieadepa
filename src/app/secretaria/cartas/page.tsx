'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Ban, Eye, Printer } from 'lucide-react';
import PageLayout from '@/components/PageLayout';
import Tabs from '@/components/Tabs';
import Section from '@/components/Section';
import CartaLayout from '@/components/cartas/CartaLayout';
import { authenticatedFetch } from '@/lib/api-client';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useAuditLog } from '@/hooks/useAuditLog';
import { buildCartaTexto, getCartaTitulo, type CartaDados, type CartaTipo } from '@/lib/cartas/templates';

export const dynamic = 'force-dynamic';

type CartaStatus = 'emitida' | 'pendente' | 'cancelada';

type CartaItem = {
  id: string;
  numero: string;
  tipo: CartaTipo;
  ministro_nome: string;
  matricula: string | null;
  emitido_em: string | null;
  emitido_por_email: string | null;
  status: CartaStatus;
};

type CartaDetalhe = CartaItem & {
  cpf: string | null;
  rg: string | null;
  dados_json: CartaDados;
  texto_final: string;
  motivo_cancelamento?: string | null;
};

type MinistroOption = {
  id: string;
  nome: string;
  cpf: string | null;
  rg: string | null;
  matricula: string | null;
  numero_cgadb: string | null;
  registro_comieadepa: string | null;
  supervisao: string | null;
  campo: string | null;
};

type PreviewState = {
  modo: 'nova' | 'existente';
  numero: string;
  titulo: string;
  texto: string;
  validade?: string;
  dados: CartaDados;
  cartaId?: string;
  status?: CartaStatus;
};

const TIPO_LABEL: Record<CartaTipo, string> = {
  requerimento_cgadb: 'Requerimento CGADB',
  carta_recomendacao: 'Carta de Recomendacao',
  carta_mudanca: 'Carta de Mudanca',
};

const STATUS_LABEL: Record<CartaStatus, string> = {
  emitida: 'Emitida',
  pendente: 'Pendente',
  cancelada: 'Cancelada',
};

const STATUS_STYLE: Record<CartaStatus, string> = {
  emitida: 'bg-emerald-100 text-emerald-700',
  pendente: 'bg-amber-100 text-amber-700',
  cancelada: 'bg-red-100 text-red-700',
};

const todayValue = () => new Date().toISOString().slice(0, 10);

export default function CartasPage() {
  const { loading } = useRequireSupabaseAuth();
  const { registrarAcao } = useAuditLog();

  const [activeTab, setActiveTab] = useState('emitidas');
  const [cartas, setCartas] = useState<CartaItem[]>([]);
  const [loadingList, setLoadingList] = useState(false);
  const [listError, setListError] = useState('');
  const [filtroBusca, setFiltroBusca] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<CartaStatus | ''>('');
  const [filtroDe, setFiltroDe] = useState('');
  const [filtroAte, setFiltroAte] = useState('');
  const [aplicarKey, setAplicarKey] = useState(0);

  const [preview, setPreview] = useState<PreviewState | null>(null);
  const previewRef = useRef<HTMLDivElement | null>(null);

  const [confirmarCancelamento, setConfirmarCancelamento] = useState<CartaItem | null>(null);
  const [motivoCancelamento, setMotivoCancelamento] = useState('');
  const [cancelando, setCancelando] = useState(false);

  const [mensagem, setMensagem] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [ministroQuery, setMinistroQuery] = useState('');
  const [ministros, setMinistros] = useState<MinistroOption[]>([]);
  const [ministroLoading, setMinistroLoading] = useState(false);
  const [ministroSelecionado, setMinistroSelecionado] = useState<MinistroOption | null>(null);

  const [draft, setDraft] = useState<CartaDados>({
    ministroNome: '',
    matricula: '',
    cpf: '',
    rg: '',
    registroCgadb: '',
    dataFiliacao: '',
    dataEmissao: todayValue(),
    presidente: 'Pr. Océlio Nauar de Araújo',
    cidadeUf: '',
    observacoesInternas: '',
    destinoPresidente: '',
    destinoConvencao: '',
    destinoSigla: '',
    destinoCidadeUf: '',
  });

  const [draftTipo, setDraftTipo] = useState<CartaTipo>('requerimento_cgadb');

  const resetDraft = () => {
    setDraft({
      ministroNome: '',
      matricula: '',
      cpf: '',
      rg: '',
      registroCgadb: '',
      dataFiliacao: '',
      dataEmissao: todayValue(),
      presidente: 'Pr. Océlio Nauar de Araújo',
      cidadeUf: '',
      observacoesInternas: '',
      destinoPresidente: '',
      destinoConvencao: '',
      destinoSigla: '',
      destinoCidadeUf: '',
    });
    setDraftTipo('requerimento_cgadb');
    setMinistroQuery('');
    setMinistroSelecionado(null);
    setMinistros([]);
  };

  const statusTab: CartaStatus | null = useMemo(() => {
    if (activeTab === 'emitidas') return 'emitida';
    return null;
  }, [activeTab]);

  const tabs = [
    { id: 'emitidas', label: 'Emitidas' },
    { id: 'nova', label: 'Nova Carta' },
  ];

  const formatDate = (value?: string | null) => {
    if (!value) return '-';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '-';
    return dt.toLocaleDateString('pt-BR');
  };

  const resetMensagem = () => setMensagem(null);

  const loadCartas = useCallback(async () => {
    if (!statusTab) return;
    setLoadingList(true);
    setListError('');

    try {
      const params = new URLSearchParams();
      const statusFiltro = filtroStatus || statusTab;
      if (statusFiltro) params.set('status', statusFiltro);
      if (filtroBusca.trim()) params.set('search', filtroBusca.trim());
      if (filtroTipo) params.set('tipo', filtroTipo);
      if (filtroDe) params.set('from', filtroDe);
      if (filtroAte) params.set('to', filtroAte);

      const res = await authenticatedFetch(`/api/secretaria/cartas?${params.toString()}`);
      const json = await res.json().catch(() => null as any);
      if (!res.ok) {
        setListError(json?.error || 'Falha ao carregar cartas.');
        setCartas([]);
        return;
      }
      setCartas((json?.data || []) as CartaItem[]);
    } catch {
      setListError('Falha de conexao. Tente novamente.');
      setCartas([]);
    } finally {
      setLoadingList(false);
    }
  }, [statusTab, filtroStatus, filtroBusca, filtroTipo, filtroDe, filtroAte]);

  useEffect(() => {
    if (statusTab) {
      loadCartas().catch(() => null);
    }
  }, [statusTab, aplicarKey, loadCartas]);

  useEffect(() => {
    if (statusTab) {
      setFiltroStatus(statusTab);
    }
  }, [statusTab]);

  useEffect(() => {
    if (ministroQuery.trim().length < 2) {
      setMinistros([]);
      return;
    }

    if (ministroSelecionado && ministroSelecionado.nome === ministroQuery.trim()) {
      setMinistros([]);
      return;
    }

    const handle = setTimeout(async () => {
      setMinistroLoading(true);
      try {
        const res = await authenticatedFetch(`/api/secretaria/cartas/ministros?q=${encodeURIComponent(ministroQuery.trim())}`);
        const json = await res.json().catch(() => null as any);
        if (!res.ok) {
          setMinistros([]);
          return;
        }
        setMinistros((json?.data || []) as MinistroOption[]);
      } finally {
        setMinistroLoading(false);
      }
    }, 350);

    return () => clearTimeout(handle);
  }, [ministroQuery, ministroSelecionado]);

  const aplicarFiltros = () => setAplicarKey((prev) => prev + 1);

  const limparFiltros = () => {
    setFiltroBusca('');
    setFiltroTipo('');
    setFiltroStatus(statusTab || '');
    setFiltroDe('');
    setFiltroAte('');
    setAplicarKey((prev) => prev + 1);
  };

  const handleStatusChange = (value: string) => {
    const next = value as CartaStatus;
    setFiltroStatus(next);
  };

  const handleSelecionarMinistro = (item: MinistroOption) => {
    setMinistroSelecionado(item);
    setMinistroQuery(item.nome);
    setMinistros([]);
    setDraft((prev) => ({
      ...prev,
      ministroNome: item.nome,
      matricula: item.matricula || item.registro_comieadepa || '',
      cpf: item.cpf || '',
      rg: item.rg || '',
      registroCgadb: item.numero_cgadb || '',
    }));
  };

  const validarDraft = () => {
    if (!draft.ministroNome.trim()) return 'Informe o ministro.';
    if (!draft.dataEmissao) return 'Informe a data de emissao.';
    if (!draft.presidente.trim()) return 'Informe o presidente.';
    if (!draft.cidadeUf.trim()) return 'Informe cidade/UF.';

    if (draftTipo === 'carta_mudanca') {
      if (!draft.destinoConvencao?.trim()) return 'Informe a convencao de destino.';
      if (!draft.destinoPresidente?.trim()) return 'Informe o presidente de destino.';
      if (!draft.destinoSigla?.trim()) return 'Informe a sigla da convencao de destino.';
      if (!draft.destinoCidadeUf?.trim()) return 'Informe cidade/UF de destino.';
      if (!draft.matricula?.trim()) return 'Informe a matricula.';
      if (!draft.cpf?.trim()) return 'Informe o CPF.';
      if (!draft.rg?.trim()) return 'Informe o RG.';
    }

    if (draftTipo === 'requerimento_cgadb') {
      if (!draft.registroCgadb?.trim() && !draft.matricula?.trim()) {
        return 'Informe o registro CGADB ou matricula.';
      }
    }

    return '';
  };

  const abrirPreviewDraft = () => {
    const erro = validarDraft();
    if (erro) {
      setMensagem({ type: 'error', text: erro });
      return;
    }

    const info = buildCartaTexto(draftTipo, draft);
    setPreview({
      modo: 'nova',
      numero: 'PREVIEW',
      titulo: info.titulo,
      texto: info.texto,
      validade: info.validade,
      dados: draft,
    });
  };

  const imprimirCarta = () => {
    if (!previewRef.current || !preview) return;
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8" />
      <title>${preview.titulo}</title>
      <style>
        *{box-sizing:border-box;}
        body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;}
        @page{size:A4;margin:12mm;}
      </style>
    </head><body>${previewRef.current.innerHTML}</body></html>`);
    w.document.close();
    setTimeout(() => w.print(), 300);

    if (preview.modo === 'existente' && preview.cartaId) {
      void registrarAcao({
        acao: 'reimprimir_carta',
        modulo: 'secretaria',
        descricao: `Reimpressao da carta ${preview.numero}`,
        dados_novos: { numero: preview.numero, tipo: preview.titulo },
      });
    }
  };

  const salvarCarta = async (status: CartaStatus) => {
    const erro = validarDraft();
    if (erro) {
      setMensagem({ type: 'error', text: erro });
      return;
    }

    const info = preview || {
      modo: 'nova' as const,
      numero: 'PREVIEW',
      ...buildCartaTexto(draftTipo, draft),
      dados: draft,
    };
    try {
      const res = await authenticatedFetch('/api/secretaria/cartas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo: draftTipo,
          status,
          ministroId: ministroSelecionado?.id || null,
          dados: info.dados,
        }),
      });
      const json = await res.json().catch(() => null as any);
      if (!res.ok) {
        setMensagem({ type: 'error', text: json?.error || 'Erro ao salvar carta.' });
        return;
      }

      const carta = json?.data as CartaDetalhe;
      setMensagem({ type: 'success', text: status === 'emitida' ? 'Carta emitida.' : 'Carta salva como pendente.' });
      setPreview({
        modo: 'existente',
        numero: carta.numero,
        titulo: getCartaTitulo(carta.tipo),
        texto: carta.texto_final,
        validade: json?.validade || undefined,
        dados: carta.dados_json,
        cartaId: carta.id,
        status: carta.status,
      });

      if (status === 'emitida') {
        void registrarAcao({
          acao: 'emitir_carta',
          modulo: 'secretaria',
          descricao: `Carta emitida: ${carta.numero} (${TIPO_LABEL[carta.tipo]})`,
          dados_novos: { numero: carta.numero, tipo: carta.tipo, ministro: carta.ministro_nome },
        });
        imprimirCarta();
        resetDraft();
        setPreview(null);
        setActiveTab('emitidas');
      }

      if (statusTab) {
        loadCartas().catch(() => null);
      }
    } catch {
      setMensagem({ type: 'error', text: 'Falha ao salvar carta.' });
    }
  };

  const buscarCarta = async (id: string) => {
    const res = await authenticatedFetch(`/api/secretaria/cartas/${id}`);
    const json = await res.json().catch(() => null as any);
    if (!res.ok) throw new Error(json?.error || 'Carta nao encontrada.');
    return json?.data as CartaDetalhe;
  };

  const abrirPreviewCarta = async (id: string) => {
    try {
      const carta = await buscarCarta(id);
      setPreview({
        modo: 'existente',
        numero: carta.numero,
        titulo: getCartaTitulo(carta.tipo),
        texto: carta.texto_final,
        dados: carta.dados_json,
        cartaId: carta.id,
        status: carta.status,
      });
      void registrarAcao({
        acao: 'visualizar_carta',
        modulo: 'secretaria',
        descricao: `Visualizar carta ${carta.numero}`,
        dados_novos: { numero: carta.numero, tipo: carta.tipo, ministro: carta.ministro_nome },
      });
    } catch (error) {
      setMensagem({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao abrir carta.' });
    }
  };

  const reimprimirCarta = async (id: string) => {
    await abrirPreviewCarta(id);
    setTimeout(() => {
      imprimirCarta();
    }, 200);
  };

  const emitirCartaPendente = async () => {
    if (!preview?.cartaId) return;
    try {
      const carta = await buscarCarta(preview.cartaId);
      const res = await authenticatedFetch(`/api/secretaria/cartas/${preview.cartaId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'emitir', tipo: carta.tipo, dados: carta.dados_json }),
      });
      const json = await res.json().catch(() => null as any);
      if (!res.ok) {
        setMensagem({ type: 'error', text: json?.error || 'Erro ao emitir carta.' });
        return;
      }
      const atualizado = json?.data as CartaDetalhe;
      setMensagem({ type: 'success', text: 'Carta emitida.' });
      setPreview({
        modo: 'existente',
        numero: atualizado.numero,
        titulo: getCartaTitulo(atualizado.tipo),
        texto: atualizado.texto_final,
        dados: atualizado.dados_json,
        cartaId: atualizado.id,
        status: atualizado.status,
      });
      void registrarAcao({
        acao: 'emitir_carta',
        modulo: 'secretaria',
        descricao: `Carta emitida: ${atualizado.numero} (${TIPO_LABEL[atualizado.tipo]})`,
        dados_novos: { numero: atualizado.numero, tipo: atualizado.tipo, ministro: atualizado.ministro_nome },
      });
      setTimeout(() => imprimirCarta(), 200);
      loadCartas().catch(() => null);
    } catch (error) {
      setMensagem({ type: 'error', text: error instanceof Error ? error.message : 'Erro ao emitir carta.' });
    }
  };

  const cancelarCarta = async () => {
    if (!confirmarCancelamento) return;
    if (!motivoCancelamento.trim()) {
      setMensagem({ type: 'error', text: 'Informe o motivo do cancelamento.' });
      return;
    }

    setCancelando(true);
    try {
      const res = await authenticatedFetch(`/api/secretaria/cartas/${confirmarCancelamento.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancelar', motivo: motivoCancelamento.trim() }),
      });
      const json = await res.json().catch(() => null as any);
      if (!res.ok) {
        setMensagem({ type: 'error', text: json?.error || 'Erro ao cancelar carta.' });
        return;
      }

      setMensagem({ type: 'success', text: 'Carta cancelada com sucesso.' });
      void registrarAcao({
        acao: 'cancelar_carta',
        modulo: 'secretaria',
        descricao: `Carta cancelada: ${confirmarCancelamento.numero}`,
        dados_novos: { numero: confirmarCancelamento.numero, motivo: motivoCancelamento.trim() },
      });
      setConfirmarCancelamento(null);
      setMotivoCancelamento('');
      loadCartas().catch(() => null);
    } finally {
      setCancelando(false);
    }
  };

  const cartaEmissao = preview?.dados?.dataEmissao || todayValue();

  if (loading) return <div className="p-8">Carregando...</div>;

  return (
    <PageLayout title="Cartas Ministeriais" description="Emissao e controle de cartas ministeriais" activeMenu="cartas">
      {mensagem && (
        <div className={`rounded-xl px-4 py-3 text-sm font-semibold border mb-4 ${
          mensagem.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
            : 'bg-red-50 border-red-200 text-red-700'
        }`}>
          <div className="flex items-center justify-between">
            <span>{mensagem.text}</span>
            <button onClick={resetMensagem} className="text-xs underline">Fechar</button>
          </div>
        </div>
      )}

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab !== 'nova' && (
          <Section title="Cartas ministeriais">
            <div className="grid grid-cols-1 md:grid-cols-6 gap-3 mb-4">
              <input
                value={filtroBusca}
                onChange={(e) => setFiltroBusca(e.target.value)}
                placeholder="Buscar por nome, matricula ou numero"
                className="md:col-span-2 border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <select
                value={filtroTipo}
                onChange={(e) => setFiltroTipo(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">Todos os tipos</option>
                {Object.entries(TIPO_LABEL).map(([key, label]) => (
                  <option key={key} value={key}>{label}</option>
                ))}
              </select>
              <select
                value={filtroStatus}
                onChange={(e) => handleStatusChange(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="emitida">Emitida</option>
                <option value="pendente">Pendente</option>
                <option value="cancelada">Cancelada</option>
              </select>
              <input
                type="date"
                value={filtroDe}
                onChange={(e) => setFiltroDe(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
              <input
                type="date"
                value={filtroAte}
                onChange={(e) => setFiltroAte(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>
            <div className="flex items-center gap-2 mb-5">
              <button
                onClick={aplicarFiltros}
                className="px-4 py-2 rounded-lg bg-[#123b63] text-white text-xs font-semibold hover:bg-[#0f2a45]"
              >
                Aplicar filtros
              </button>
              <button
                onClick={limparFiltros}
                className="px-4 py-2 rounded-lg border border-gray-300 text-xs font-semibold text-gray-600 hover:bg-gray-50"
              >
                Limpar
              </button>
            </div>

            {listError && (
              <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-4 text-sm text-red-700 mb-4">
                {listError}
              </div>
            )}

            {loadingList ? (
              <div className="space-y-3 animate-pulse">
                {Array.from({ length: 4 }).map((_, idx) => (
                  <div key={`skel-${idx}`} className="h-12 bg-gray-100 rounded-lg" />
                ))}
              </div>
            ) : cartas.length === 0 ? (
              <div className="text-center py-10 text-sm text-gray-500">
                Nenhuma carta encontrada para este filtro.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase text-gray-500 border-b">
                      <th className="py-3 pr-4">Data</th>
                      <th className="py-3 pr-4">No</th>
                      <th className="py-3 pr-4">Tipo</th>
                      <th className="py-3 pr-4">Ministro</th>
                      <th className="py-3 pr-4">Matricula/Registro</th>
                      <th className="py-3 pr-4">Status</th>
                      <th className="py-3">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cartas.map((carta) => (
                      <tr key={carta.id} className="border-b last:border-b-0">
                        <td className="py-3 pr-4 text-gray-500">{formatDate(carta.emitido_em)}</td>
                        <td className="py-3 pr-4 font-semibold text-gray-700">{carta.numero}</td>
                        <td className="py-3 pr-4 text-gray-600">{TIPO_LABEL[carta.tipo]}</td>
                        <td className="py-3 pr-4 font-semibold text-gray-700">{carta.ministro_nome}</td>
                        <td className="py-3 pr-4 text-gray-500">{carta.matricula || '-'}</td>
                        <td className="py-3 pr-4">
                          <span className={`text-[11px] font-semibold px-2 py-1 rounded-full ${STATUS_STYLE[carta.status]}`}>
                            {STATUS_LABEL[carta.status]}
                          </span>
                        </td>
                        <td className="py-3">
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => abrirPreviewCarta(carta.id)}
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
                              title="Visualizar"
                              aria-label="Visualizar"
                            >
                              <Eye size={16} />
                            </button>
                            {carta.status === 'emitida' && (
                              <button
                                onClick={() => reimprimirCarta(carta.id)}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-blue-200 text-blue-600 hover:bg-blue-50"
                                title="Reimprimir"
                                aria-label="Reimprimir"
                              >
                                <Printer size={16} />
                              </button>
                            )}
                            {carta.status !== 'cancelada' && (
                              <button
                                onClick={() => setConfirmarCancelamento(carta)}
                                className="inline-flex items-center justify-center w-8 h-8 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                                title="Cancelar carta"
                                aria-label="Cancelar carta"
                              >
                                <Ban size={16} />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        )}

        {activeTab === 'nova' && (
          <Section title="Nova carta">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-gray-600">Tipo da carta</label>
                  <select
                    value={draftTipo}
                    onChange={(e) => setDraftTipo(e.target.value as CartaTipo)}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  >
                    {Object.entries(TIPO_LABEL).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="relative">
                  <label className="text-xs font-semibold text-gray-600">Ministro</label>
                  <input
                    value={ministroQuery}
                    onChange={(e) => {
                      setMinistroQuery(e.target.value);
                      setMinistroSelecionado(null);
                      setDraft((prev) => ({ ...prev, ministroNome: e.target.value }));
                    }}
                    placeholder="Digite nome ou matricula"
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                  {ministroLoading && (
                    <div className="text-xs text-gray-400 mt-1">Buscando ministros...</div>
                  )}
                  {ministros.length > 0 && (
                    <div className="absolute z-10 mt-2 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-auto">
                      {ministros.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelecionarMinistro(item)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50"
                        >
                          <div className="font-semibold text-gray-700">{item.nome}</div>
                          <div className="text-[11px] text-gray-500">
                            {item.matricula || 'Sem matricula'} {item.supervisao ? `- ${item.supervisao}` : ''}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Matricula/Registro</label>
                    <input
                      value={draft.matricula || ''}
                      onChange={(e) => setDraft((prev) => ({ ...prev, matricula: e.target.value }))}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Registro CGADB</label>
                    <input
                      value={draft.registroCgadb || ''}
                      onChange={(e) => setDraft((prev) => ({ ...prev, registroCgadb: e.target.value }))}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  {draftTipo === 'carta_mudanca' && (
                    <>
                      <div>
                        <label className="text-xs font-semibold text-gray-600">CPF</label>
                        <input
                          value={draft.cpf || ''}
                          onChange={(e) => setDraft((prev) => ({ ...prev, cpf: e.target.value }))}
                          className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600">RG</label>
                        <input
                          value={draft.rg || ''}
                          onChange={(e) => setDraft((prev) => ({ ...prev, rg: e.target.value }))}
                          className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                        />
                      </div>
                    </>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Data de emissao</label>
                    <input
                      type="date"
                      value={draft.dataEmissao}
                      onChange={(e) => setDraft((prev) => ({ ...prev, dataEmissao: e.target.value }))}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Presidente</label>
                    <input
                      value={draft.presidente}
                      onChange={(e) => setDraft((prev) => ({ ...prev, presidente: e.target.value }))}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-gray-600">Cidade/UF</label>
                  <input
                    value={draft.cidadeUf}
                    onChange={(e) => setDraft((prev) => ({ ...prev, cidadeUf: e.target.value }))}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                  />
                </div>

                {draftTipo === 'requerimento_cgadb' && (
                  <div>
                    <label className="text-xs font-semibold text-gray-600">Data de filiacao (CGADB)</label>
                    <input
                      type="date"
                      value={draft.dataFiliacao || ''}
                      onChange={(e) => setDraft((prev) => ({ ...prev, dataFiliacao: e.target.value }))}
                      className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                    />
                  </div>
                )}

                {draftTipo === 'carta_mudanca' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-semibold text-gray-600">Convencao destino</label>
                      <input
                        value={draft.destinoConvencao || ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, destinoConvencao: e.target.value }))}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600">Sigla destino</label>
                      <input
                        value={draft.destinoSigla || ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, destinoSigla: e.target.value }))}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600">Presidente destino</label>
                      <input
                        value={draft.destinoPresidente || ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, destinoPresidente: e.target.value }))}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600">Cidade/UF destino</label>
                      <input
                        value={draft.destinoCidadeUf || ''}
                        onChange={(e) => setDraft((prev) => ({ ...prev, destinoCidadeUf: e.target.value }))}
                        className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold text-gray-600">Observacoes internas</label>
                  <textarea
                    value={draft.observacoesInternas || ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, observacoesInternas: e.target.value }))}
                    className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[90px]"
                  />
                </div>

                {draftTipo === 'carta_recomendacao' && (
                  <div className="text-xs text-gray-500">
                    Validade estimada: {buildCartaTexto('carta_recomendacao', draft).validade || '-'} (90 dias)
                  </div>
                )}

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={abrirPreviewDraft}
                    className="px-4 py-2 rounded-lg bg-[#123b63] text-white text-sm font-semibold hover:bg-[#0f2a45]"
                  >
                    Gerar previa
                  </button>
                  <button
                    onClick={() => salvarCarta('emitida')}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Salvar e Emitir Carta
                  </button>
                </div>
              </div>

              <div className="bg-slate-50 border border-gray-200 rounded-xl p-4">
                <h3 className="text-sm font-bold text-gray-700 mb-3">Resumo rapido</h3>
                <div className="space-y-2 text-sm text-gray-600">
                  <p><span className="font-semibold">Tipo:</span> {TIPO_LABEL[draftTipo]}</p>
                  <p><span className="font-semibold">Ministro:</span> {draft.ministroNome || '-'}</p>
                  <p><span className="font-semibold">Matricula:</span> {draft.matricula || '-'}</p>
                  <p><span className="font-semibold">Cidade/UF:</span> {draft.cidadeUf || '-'}</p>
                  <p><span className="font-semibold">Data emissao:</span> {formatDate(draft.dataEmissao)}</p>
                </div>
              </div>
            </div>
          </Section>
        )}
      </Tabs>

      {preview && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <div>
                <h3 className="text-sm font-bold text-gray-800">{preview.titulo}</h3>
                <p className="text-xs text-gray-500">Previa e impressao</p>
              </div>
              <button
                onClick={() => setPreview(null)}
                className="text-xs font-semibold text-gray-500 hover:text-gray-700"
              >
                Fechar
              </button>
            </div>
            <div className="max-h-[70vh] overflow-auto bg-gray-100 p-6">
              <div ref={previewRef}>
                <CartaLayout
                  numero={preview.numero}
                  titulo={preview.titulo}
                  dataEmissao={cartaEmissao}
                  cidadeUf={preview.dados.cidadeUf || ''}
                  presidente={preview.dados.presidente || ''}
                  texto={preview.texto}
                  validade={preview.validade}
                  observacoes={preview.dados.observacoesInternas || ''}
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-4 border-t border-gray-200 bg-white">
              {preview.modo === 'nova' ? (
                <>
                  <button
                    onClick={() => salvarCarta('pendente')}
                    className="px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                  >
                    Salvar pendente
                  </button>
                  <button
                    onClick={() => salvarCarta('emitida')}
                    className="px-4 py-2 rounded-lg bg-[#123b63] text-white text-sm font-semibold hover:bg-[#0f2a45]"
                  >
                    Emitir e imprimir
                  </button>
                </>
              ) : preview.status === 'pendente' ? (
                <button
                  onClick={emitirCartaPendente}
                  className="px-4 py-2 rounded-lg bg-[#123b63] text-white text-sm font-semibold hover:bg-[#0f2a45]"
                >
                  Emitir e imprimir
                </button>
              ) : (
                <button
                  onClick={imprimirCarta}
                  className="px-4 py-2 rounded-lg bg-[#123b63] text-white text-sm font-semibold hover:bg-[#0f2a45]"
                >
                  Imprimir
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {confirmarCancelamento && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6">
            <h3 className="text-sm font-bold text-gray-800 mb-2">Cancelar carta</h3>
            <p className="text-xs text-gray-500 mb-4">
              Esta carta sera cancelada e o procedimento ficara registrado para consultas futuras.
            </p>
            <textarea
              value={motivoCancelamento}
              onChange={(e) => setMotivoCancelamento(e.target.value)}
              placeholder="Informe o motivo do cancelamento"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm min-h-[80px]"
            />
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setConfirmarCancelamento(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-gray-300 text-sm font-semibold text-gray-600"
              >
                Voltar
              </button>
              <button
                onClick={cancelarCarta}
                disabled={cancelando}
                className="flex-1 px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-semibold disabled:opacity-60"
              >
                {cancelando ? 'Cancelando...' : 'Confirmar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </PageLayout>
  );
}
