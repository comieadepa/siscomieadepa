'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { authenticatedFetch } from '@/lib/api-client';
import {
  Building2,
  UtensilsCrossed,
  Plus,
  Pencil,
  Power,
  PowerOff,
  ChevronUp,
  ChevronDown,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Info,
} from 'lucide-react';

export interface LocalCheckin {
  id: string;
  evento_id: string;
  tipo: 'plenaria' | 'refeitorio';
  nome: string;
  descricao: string | null;
  ativo: boolean;
  ordem: number;
  created_at: string;
  updated_at: string;
}

interface GerenciadorLocaisCheckinProps {
  eventoId: string;
}

export default function GerenciadorLocaisCheckin({ eventoId }: GerenciadorLocaisCheckinProps) {
  const [locais, setLocais] = useState<LocalCheckin[]>([]);
  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [reordenando, setReordenando] = useState(false);

  // Estados de feedback
  const [mensagemSucesso, setMensagemSucesso] = useState<string | null>(null);
  const [mensagemErro, setMensagemErro] = useState<string | null>(null);

  // Modal de Adicionar / Editar
  const [modalAberto, setModalAberto] = useState(false);
  const [editandoLocal, setEditandoLocal] = useState<LocalCheckin | null>(null);
  const [formTipo, setFormTipo] = useState<'plenaria' | 'refeitorio'>('plenaria');
  const [formNome, setFormNome] = useState('');
  const [formDescricao, setFormDescricao] = useState('');
  const [formAtivo, setFormAtivo] = useState(true);

  const limparFeedback = () => {
    setMensagemSucesso(null);
    setMensagemErro(null);
  };

  const carregarLocais = useCallback(async () => {
    try {
      setLoading(true);
      limparFeedback();
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/locais-checkin`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Falha ao carregar setores de check-in');
      }
      const data = await res.json();
      setLocais(data.locais || []);
    } catch (err: any) {
      setMensagemErro(err.message || 'Erro ao comunicar com o servidor');
    } finally {
      setLoading(false);
    }
  }, [eventoId]);

  useEffect(() => {
    carregarLocais();
  }, [carregarLocais]);

  // Filtros derivados
  const plenarias = locais
    .filter(l => l.tipo === 'plenaria')
    .sort((a, b) => a.ordem - b.ordem);

  const refeitorios = locais
    .filter(l => l.tipo === 'refeitorio')
    .sort((a, b) => a.ordem - b.ordem);

  const totalPlenariasAtivas = plenarias.filter(l => l.ativo).length;
  const totalRefeitoriosAtivos = refeitorios.filter(l => l.ativo).length;

  // Abrir Modal de Criação
  const abrirNovo = (tipo: 'plenaria' | 'refeitorio') => {
    limparFeedback();
    setEditandoLocal(null);
    setFormTipo(tipo);
    setFormNome('');
    setFormDescricao('');
    setFormAtivo(true);
    setModalAberto(true);
  };

  // Abrir Modal de Edição
  const abrirEditar = (local: LocalCheckin) => {
    limparFeedback();
    setEditandoLocal(local);
    setFormTipo(local.tipo);
    setFormNome(local.nome);
    setFormDescricao(local.descricao || '');
    setFormAtivo(local.ativo);
    setModalAberto(true);
  };

  // Salvar (POST ou PATCH)
  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formNome.trim()) {
      setMensagemErro('Informe o nome do setor ou restaurante.');
      return;
    }

    try {
      setSalvando(true);
      limparFeedback();

      if (editandoLocal) {
        // Atualização via PATCH
        const res = await authenticatedFetch(`/api/eventos/${eventoId}/locais-checkin`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: editandoLocal.id,
            nome: formNome.trim(),
            descricao: formDescricao.trim() || null,
            ativo: formAtivo,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Erro ao atualizar local.');

        setMensagemSucesso(`"${formNome.trim()}" atualizado com sucesso!`);
      } else {
        // Criação via POST
        const res = await authenticatedFetch(`/api/eventos/${eventoId}/locais-checkin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tipo: formTipo,
            nome: formNome.trim(),
            descricao: formDescricao.trim() || null,
            ativo: formAtivo,
          }),
        });

        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Erro ao cadastrar local.');

        setMensagemSucesso(
          `${formTipo === 'plenaria' ? 'Plenária' : 'Restaurante'} cadastrado com sucesso!`
        );
      }

      setModalAberto(false);
      await carregarLocais();
    } catch (err: any) {
      setMensagemErro(err.message || 'Erro ao salvar informações.');
    } finally {
      setSalvando(false);
    }
  };

  // Ativar / Inativar Rápido
  const toggleAtivo = async (local: LocalCheckin) => {
    try {
      setTogglingId(local.id);
      limparFeedback();

      const novoStatus = !local.ativo;
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/locais-checkin`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: local.id,
          ativo: novoStatus,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erro ao alterar status do local.');

      setLocais(prev =>
        prev.map(l => (l.id === local.id ? { ...l, ativo: novoStatus } : l))
      );
      setMensagemSucesso(
        `Setor "${local.nome}" foi ${novoStatus ? 'ativado' : 'inativado'} com sucesso.`
      );
    } catch (err: any) {
      setMensagemErro(err.message || 'Erro ao alterar status.');
    } finally {
      setTogglingId(null);
    }
  };

  // Reordenação (Mover para cima ou para baixo)
  const moverOrdem = async (lista: LocalCheckin[], index: number, direcao: 'cima' | 'baixo') => {
    const novoIndex = direcao === 'cima' ? index - 1 : index + 1;
    if (novoIndex < 0 || novoIndex >= lista.length) return;

    try {
      setReordenando(true);
      limparFeedback();

      const novaLista = [...lista];
      const itemAtual = novaLista[index];
      const itemAlvo = novaLista[novoIndex];

      novaLista[index] = itemAlvo;
      novaLista[novoIndex] = itemAtual;

      // Atribui nova ordem sequencial
      const itensAtualizados = novaLista.map((item, idx) => ({
        id: item.id,
        ordem: idx,
      }));

      // Atualiza localmente primeiro para UX instantânea
      setLocais(prev =>
        prev.map(l => {
          const match = itensAtualizados.find(i => i.id === l.id);
          return match ? { ...l, ordem: match.ordem } : l;
        })
      );

      // Envia PUT para a API persistir a nova ordem no banco
      const res = await authenticatedFetch(`/api/eventos/${eventoId}/locais-checkin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itens: itensAtualizados }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Erro ao persistir nova ordenação.');
      }

      setMensagemSucesso('Ordenação atualizada com sucesso.');
    } catch (err: any) {
      setMensagemErro(err.message || 'Erro ao reordenar.');
      await carregarLocais(); // Reverte caso haja erro
    } finally {
      setReordenando(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Alertas de Feedback */}
      {mensagemSucesso && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl p-4 flex items-center justify-between text-sm shadow-sm transition">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
            <span className="font-medium">{mensagemSucesso}</span>
          </div>
          <button
            onClick={() => setMensagemSucesso(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs font-bold ml-4">
            ✕
          </button>
        </div>
      )}

      {mensagemErro && (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl p-4 flex items-center justify-between text-sm shadow-sm transition">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0" />
            <span className="font-medium">{mensagemErro}</span>
          </div>
          <button
            onClick={() => setMensagemErro(null)}
            className="text-red-700 hover:text-red-900 text-xs font-bold ml-4">
            ✕
          </button>
        </div>
      )}

      {/* Grid de Seções: Plenárias e Restaurantes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SEÇÃO 1: SETORES DE PLENÁRIA                                   */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-4 mb-4 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-100 flex items-center justify-center text-[#123b63]">
                  <Building2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-base">Setores de Plenária</h3>
                  <p className="text-xs text-gray-500">
                    Locais oficiais de registro de presença e sessões
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-blue-100 text-blue-800">
                  {totalPlenariasAtivas} / {plenarias.length} ativo{plenarias.length === 1 ? '' : 's'}
                </span>
                <button
                  onClick={() => abrirNovo('plenaria')}
                  className="bg-[#123b63] hover:bg-[#0d2b4e] active:scale-95 text-white font-semibold text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 transition">
                  <Plus className="w-3.5 h-3.5" />
                  <span>Nova Plenária</span>
                </button>
              </div>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center text-gray-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-[#123b63]" />
                <span className="text-xs">Carregando plenárias...</span>
              </div>
            ) : plenarias.length === 0 ? (
              <div className="py-10 text-center border-2 border-dashed border-gray-100 rounded-xl my-2">
                <Building2 className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-gray-700">Nenhuma plenária cadastrada</p>
                <p className="text-xs text-gray-400 max-w-xs mx-auto mt-1 mb-4">
                  Cadastre os setores onde os participantes realizam check-in de plenária (ex: Geral dos Ministros, Juventude).
                </p>
                <button
                  onClick={() => abrirNovo('plenaria')}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold px-3 py-1.5 rounded-lg transition">
                  + Adicionar Primeira Plenária
                </button>
              </div>
            ) : (
              <div className="space-y-2.5 my-2">
                {plenarias.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 transition ${
                      item.ativo
                        ? 'bg-white border-gray-200 hover:border-gray-300'
                        : 'bg-gray-50/70 border-gray-200 text-gray-400'
                    }`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Botões de Ordenação */}
                      <div className="flex flex-col gap-0.5">
                        <button
                          title="Mover para cima"
                          disabled={idx === 0 || reordenando}
                          onClick={() => moverOrdem(plenarias, idx, 'cima')}
                          className="p-1 text-gray-400 hover:text-[#123b63] disabled:opacity-20 disabled:hover:text-gray-400">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title="Mover para baixo"
                          disabled={idx === plenarias.length - 1 || reordenando}
                          onClick={() => moverOrdem(plenarias, idx, 'baixo')}
                          className="p-1 text-gray-400 hover:text-[#123b63] disabled:opacity-20 disabled:hover:text-gray-400">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Informações */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-semibold text-sm truncate ${item.ativo ? 'text-gray-900' : 'text-gray-500'}`}>
                            {item.nome}
                          </p>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              item.ativo
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-gray-200 text-gray-600'
                            }`}>
                            {item.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                        {item.descricao && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{item.descricao}</p>
                        )}
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        title={item.ativo ? 'Inativar Plenária' : 'Ativar Plenária'}
                        disabled={togglingId === item.id}
                        onClick={() => toggleAtivo(item)}
                        className={`p-1.5 rounded-lg border text-xs font-semibold transition ${
                          item.ativo
                            ? 'border-gray-200 text-gray-600 hover:bg-gray-100'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        }`}>
                        {togglingId === item.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                        ) : item.ativo ? (
                          <PowerOff className="w-4 h-4 text-gray-500" />
                        ) : (
                          <Power className="w-4 h-4 text-emerald-600" />
                        )}
                      </button>

                      <button
                        title="Editar Plenária"
                        onClick={() => abrirEditar(item)}
                        className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-[#123b63] transition">
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <span>Rastreabilidade vinculada por local_id</span>
            <span className="flex items-center gap-1 text-gray-400" title="Exclusão física bloqueada para proteger o histórico de presenças">
              <Info className="w-3.5 h-3.5" /> Preservação ativa
            </span>
          </div>
        </div>

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* SEÇÃO 2: RESTAURANTES / REFEITÓRIOS                            */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-start justify-between gap-4 mb-4 pb-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-700">
                  <UtensilsCrossed className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-base">Restaurantes / Refeitórios</h3>
                  <p className="text-xs text-gray-500">
                    Pontos de alimentação e débito das refeições
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2 py-1 rounded-full bg-amber-100 text-amber-800">
                  {totalRefeitoriosAtivos} / {refeitorios.length} ativo{refeitorios.length === 1 ? '' : 's'}
                </span>
                <button
                  onClick={() => abrirNovo('refeitorio')}
                  className="bg-amber-600 hover:bg-amber-700 active:scale-95 text-white font-semibold text-xs px-3 py-2 rounded-lg flex items-center gap-1.5 transition">
                  <Plus className="w-3.5 h-3.5" />
                  <span>Novo Restaurante</span>
                </button>
              </div>
            </div>

            {loading ? (
              <div className="py-12 flex flex-col items-center justify-center text-gray-400 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-amber-600" />
                <span className="text-xs">Carregando restaurantes...</span>
              </div>
            ) : refeitorios.length === 0 ? (
              <div className="py-10 text-center border-2 border-dashed border-gray-100 rounded-xl my-2">
                <UtensilsCrossed className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm font-semibold text-gray-700">Nenhum restaurante cadastrado</p>
                <p className="text-xs text-gray-400 max-w-xs mx-auto mt-1 mb-4">
                  Cadastre os restaurantes e refeitórios onde os operadores validam QR Codes de alimentação.
                </p>
                <button
                  onClick={() => abrirNovo('refeitorio')}
                  className="bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-bold px-3 py-1.5 rounded-lg transition">
                  + Adicionar Primeiro Restaurante
                </button>
              </div>
            ) : (
              <div className="space-y-2.5 my-2">
                {refeitorios.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`rounded-xl border p-3.5 flex items-center justify-between gap-3 transition ${
                      item.ativo
                        ? 'bg-white border-gray-200 hover:border-gray-300'
                        : 'bg-gray-50/70 border-gray-200 text-gray-400'
                    }`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      {/* Botões de Ordenação */}
                      <div className="flex flex-col gap-0.5">
                        <button
                          title="Mover para cima"
                          disabled={idx === 0 || reordenando}
                          onClick={() => moverOrdem(refeitorios, idx, 'cima')}
                          className="p-1 text-gray-400 hover:text-amber-700 disabled:opacity-20 disabled:hover:text-gray-400">
                          <ChevronUp className="w-3.5 h-3.5" />
                        </button>
                        <button
                          title="Mover para baixo"
                          disabled={idx === refeitorios.length - 1 || reordenando}
                          onClick={() => moverOrdem(refeitorios, idx, 'baixo')}
                          className="p-1 text-gray-400 hover:text-amber-700 disabled:opacity-20 disabled:hover:text-gray-400">
                          <ChevronDown className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Informações */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={`font-semibold text-sm truncate ${item.ativo ? 'text-gray-900' : 'text-gray-500'}`}>
                            {item.nome}
                          </p>
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                              item.ativo
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-gray-200 text-gray-600'
                            }`}>
                            {item.ativo ? 'Ativo' : 'Inativo'}
                          </span>
                        </div>
                        {item.descricao && (
                          <p className="text-xs text-gray-500 truncate mt-0.5">{item.descricao}</p>
                        )}
                      </div>
                    </div>

                    {/* Ações */}
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        title={item.ativo ? 'Inativar Restaurante' : 'Ativar Restaurante'}
                        disabled={togglingId === item.id}
                        onClick={() => toggleAtivo(item)}
                        className={`p-1.5 rounded-lg border text-xs font-semibold transition ${
                          item.ativo
                            ? 'border-gray-200 text-gray-600 hover:bg-gray-100'
                            : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        }`}>
                        {togglingId === item.id ? (
                          <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                        ) : item.ativo ? (
                          <PowerOff className="w-4 h-4 text-gray-500" />
                        ) : (
                          <Power className="w-4 h-4 text-emerald-600" />
                        )}
                      </button>

                      <button
                        title="Editar Restaurante"
                        onClick={() => abrirEditar(item)}
                        className="p-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-100 hover:text-amber-700 transition">
                        <Pencil className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-400">
            <span>Rastreabilidade em evento_refeicoes_consumo</span>
            <span className="flex items-center gap-1 text-gray-400" title="Exclusão física bloqueada para proteger auditoria de débitos de refeição">
              <Info className="w-3.5 h-3.5" /> Preservação ativa
            </span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* MODAL: ADICIONAR / EDITAR LOCAL                                */}
      {/* ═══════════════════════════════════════════════════════════════ */}
      {modalAberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => !salvando && setModalAberto(false)}>
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-150"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
              <div className="flex items-center gap-2.5">
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    formTipo === 'plenaria'
                      ? 'bg-blue-50 text-[#123b63]'
                      : 'bg-amber-50 text-amber-700'
                  }`}>
                  {formTipo === 'plenaria' ? (
                    <Building2 className="w-5 h-5" />
                  ) : (
                    <UtensilsCrossed className="w-5 h-5" />
                  )}
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-base">
                    {editandoLocal
                      ? `Editar ${editandoLocal.tipo === 'plenaria' ? 'Plenária' : 'Restaurante'}`
                      : `Nova ${formTipo === 'plenaria' ? 'Plenária' : 'Restaurante'}`}
                  </h3>
                  <p className="text-xs text-gray-500">Defina o nome e detalhes de identificação</p>
                </div>
              </div>
              <button
                disabled={salvando}
                onClick={() => setModalAberto(false)}
                className="text-gray-400 hover:text-gray-700 text-lg leading-none p-1">
                ✕
              </button>
            </div>

            <form onSubmit={handleSalvar} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Nome do Local / Setor <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  placeholder={
                    formTipo === 'plenaria'
                      ? 'Ex: Plenária Geral dos Ministros, Juventude COMIEADEPA'
                      : 'Ex: Restaurante Principal, Refeitório Anexo'
                  }
                  value={formNome}
                  onChange={e => setFormNome(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white text-gray-900"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">
                  Descrição ou Localização Física <span className="text-gray-400">(Opcional)</span>
                </label>
                <input
                  type="text"
                  maxLength={255}
                  placeholder="Ex: Térreo - Auditório 1, Ala Leste"
                  value={formDescricao}
                  onChange={e => setFormDescricao(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white text-gray-900"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <input
                  type="checkbox"
                  id="chk-ativo-local"
                  checked={formAtivo}
                  onChange={e => setFormAtivo(e.target.checked)}
                  className="w-4 h-4 text-[#123b63] rounded border-gray-300 focus:ring-[#123b63]"
                />
                <label htmlFor="chk-ativo-local" className="text-sm font-medium text-gray-700 cursor-pointer">
                  Disponível e ativo para operações de check-in
                </label>
              </div>

              <div className="pt-3 border-t border-gray-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  disabled={salvando}
                  onClick={() => setModalAberto(false)}
                  className="px-4 py-2 rounded-lg text-xs font-semibold border border-gray-200 text-gray-600 hover:bg-gray-50 transition">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando}
                  className={`px-5 py-2 rounded-lg text-xs font-bold text-white transition flex items-center gap-2 ${
                    formTipo === 'plenaria'
                      ? 'bg-[#123b63] hover:bg-[#0d2b4e]'
                      : 'bg-amber-600 hover:bg-amber-700'
                  } disabled:opacity-50`}>
                  {salvando && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editandoLocal ? 'Salvar Alterações' : 'Cadastrar Local'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
