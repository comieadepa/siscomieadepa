'use client';

import { useState, useEffect } from 'react';
import { Comissao, ComissaoIntegrante, CARGOS_COMISSAO_PADRAO } from '@/types/comissao';
import { useUserRole } from '@/hooks/useUserRole';
import {
  X,
  UserPlus,
  RefreshCw,
  UserCheck,
  AlertCircle,
  Clock,
  Edit2,
  Trash2,
  Search,
} from 'lucide-react';

interface IntegrantesManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  comissao: Comissao;
  onSuccess: () => void;
}

interface MemberSearchResult {
  id: string;
  name: string;
  cpf?: string;
  cargo_ministerial?: string;
  numero_cgadb?: string;
  registro_comieadepa?: string;
}

export default function IntegrantesManagerModal({
  isOpen,
  onClose,
  comissao,
  onSuccess,
}: IntegrantesManagerModalProps) {
  const { role } = useUserRole();
  const podeGerenciar = role === 'super' || role === 'administrador';

  const [activeTab, setActiveTab] = useState<'ativos' | 'historico'>('ativos');
  const [integrantes, setIntegrantes] = useState<ComissaoIntegrante[]>(comissao.integrantes || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Estados de Inclusão / Substituição
  const [mode, setMode] = useState<'view' | 'add' | 'substitute' | 'edit'>('view');
  const [targetIntegrante, setTargetIntegrante] = useState<ComissaoIntegrante | null>(null);

  // Busca de Ministro Oficial
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<MemberSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedMember, setSelectedMember] = useState<MemberSearchResult | null>(null);

  // Campos do formulário
  const [cargo, setCargo] = useState('Membro');
  const [cargoPersonalizado, setCargoPersonalizado] = useState('');
  const [ordemHierarquia, setOrdemHierarquia] = useState(50);
  const [dataEntrada, setDataEntrada] = useState(new Date().toISOString().split('T')[0]);
  const [motivoSubstituicao, setMotivoSubstituicao] = useState('');
  const [observacoes, setObservacoes] = useState('');

  // Atualizar lista de integrantes quando a comissão mudar ou recarregar
  const reloadIntegrantes = async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/v1/comissoes/${comissao.id}`);
      if (res.ok) {
        const data = await res.json();
        setIntegrantes(data.integrantes || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setIntegrantes(comissao.integrantes || []);
      reloadIntegrantes();
      resetForm();
    }
  }, [isOpen, comissao.id]);

  const resetForm = () => {
    setMode('view');
    setTargetIntegrante(null);
    setSelectedMember(null);
    setSearchQuery('');
    setSearchResults([]);
    setCargo('Membro');
    setCargoPersonalizado('');
    setOrdemHierarquia(50);
    setDataEntrada(new Date().toISOString().split('T')[0]);
    setMotivoSubstituicao('');
    setObservacoes('');
    setError(null);
  };

  // Buscar ministros oficiais na tabela members
  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setSearching(true);
        const res = await fetch(`/api/v1/members/lookup?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.members || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Handler de cargo selecionado
  const handleCargoChange = (value: string) => {
    setCargo(value);
    const padrao = CARGOS_COMISSAO_PADRAO.find((c) => c.cargo === value);
    if (padrao) {
      setOrdemHierarquia(padrao.ordem);
    } else {
      setOrdemHierarquia(60);
    }
  };

  // Iniciar substituição de um membro
  const handleStartSubstitute = (integrante: ComissaoIntegrante) => {
    setTargetIntegrante(integrante);
    setCargo(integrante.cargo);
    setOrdemHierarquia(integrante.ordem_hierarquia);
    setSelectedMember(null);
    setSearchQuery('');
    setMotivoSubstituicao(`Substituição formal em portaria`);
    setMode('substitute');
  };

  // Iniciar edição de cargo de um membro ativo
  const handleStartEdit = (integrante: ComissaoIntegrante) => {
    setTargetIntegrante(integrante);
    setCargo(integrante.cargo);
    setOrdemHierarquia(integrante.ordem_hierarquia);
    setObservacoes(integrante.observacoes || '');
    setMode('edit');
  };

  // Submeter Adição ou Substituição
  const handleSubmitMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMsg(null);

    const cargoFinal = cargo === 'Outro' ? cargoPersonalizado.trim() : cargo.trim();
    if (!cargoFinal) {
      setError('Por favor, defina o cargo ministerial na comissão.');
      return;
    }

    if (mode === 'edit') {
      if (!targetIntegrante) return;
      try {
        setLoading(true);
        const res = await fetch(`/api/v1/comissoes/${comissao.id}/integrantes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            integrante_id: targetIntegrante.id,
            cargo: cargoFinal,
            ordem_hierarquia: ordemHierarquia,
            observacoes,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Erro ao atualizar cargo.');

        setSuccessMsg('Integrante atualizado com sucesso!');
        await reloadIntegrantes();
        onSuccess();
        resetForm();
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
      return;
    }

    if (!selectedMember) {
      setError('Selecione um ministro no cadastro oficial.');
      return;
    }

    try {
      setLoading(true);
      const payload: any = {
        ministro_id: selectedMember.id,
        cargo: cargoFinal,
        ordem_hierarquia: ordemHierarquia,
        data_entrada: dataEntrada,
        observacoes,
      };

      if (mode === 'substitute' && targetIntegrante) {
        payload.substituindo_integrante_id = targetIntegrante.id;
        payload.motivo_substituicao = motivoSubstituicao;
      }

      const res = await fetch(`/api/v1/comissoes/${comissao.id}/integrantes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Erro ao cadastrar integrante.');

      setSuccessMsg(
        mode === 'substitute'
          ? 'Substituição realizada com histórico preservado!'
          : 'Novo integrante adicionado com sucesso!'
      );
      await reloadIntegrantes();
      onSuccess();
      resetForm();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Encerrar participação / desligar integrante
  const handleDesligarIntegrante = async (integrante: ComissaoIntegrante) => {
    const confirmacao = window.confirm(
      `Deseja encerrar a participação de ${integrante.ministro?.name || 'este ministro'} na comissão? O histórico de atuação será mantido.`
    );
    if (!confirmacao) return;

    try {
      setLoading(true);
      const res = await fetch(`/api/v1/comissoes/${comissao.id}/integrantes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          integrante_id: integrante.id,
          status: 'desligado',
          data_saida: new Date().toISOString().split('T')[0],
          motivo_saida: 'Encerramento de mandato / Desligamento a pedido',
        }),
      });

      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Erro ao desligar integrante.');

      setSuccessMsg('Participação encerrada e arquivada no histórico.');
      await reloadIntegrantes();
      onSuccess();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const integrantesAtivos = integrantes.filter((i) => i.status === 'ativo');
  const integrantesHistorico = integrantes.filter((i) => i.status !== 'ativo');

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-black bg-opacity-60 flex items-center justify-center p-4">
      <div className="relative bg-white rounded-xl shadow-2xl max-w-4xl w-full overflow-hidden border border-gray-100 animate-fadeIn flex flex-col max-h-[90vh]">
        {/* Cabeçalho */}
        <div className="bg-[#123b63] text-white px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-bold">Composição e Integrantes</h3>
              {comissao.sigla && (
                <span className="bg-blue-800 text-blue-200 text-xs px-2 py-0.5 rounded font-bold">
                  {comissao.sigla}
                </span>
              )}
            </div>
            <p className="text-xs text-blue-200 mt-0.5">{comissao.nome}</p>
          </div>
          <button
            onClick={onClose}
            className="text-white hover:text-gray-200 transition p-1 rounded-lg hover:bg-white/10"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Mensagens de Alerta */}
        {error && (
          <div className="bg-red-50 border-l-4 border-red-500 p-3 mx-6 mt-4 rounded flex items-center gap-3 text-red-700 text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {successMsg && (
          <div className="bg-green-50 border-l-4 border-green-500 p-3 mx-6 mt-4 rounded flex items-center gap-3 text-green-700 text-sm">
            <UserCheck className="w-5 h-5 flex-shrink-0" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* Corpo principal */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {/* Formulário Inline para Adicionar / Substituir / Editar */}
          {mode !== 'view' && (
            <div className="bg-blue-50/60 border border-blue-200 rounded-xl p-5 mb-4 shadow-sm animate-fadeIn">
              <div className="flex items-center justify-between mb-4 border-b border-blue-200/80 pb-2">
                <h4 className="font-bold text-[#123b63] text-sm flex items-center gap-2">
                  {mode === 'add' && (
                    <>
                      <UserPlus className="w-4 h-4 text-blue-600" /> Designar Novo Ministro
                    </>
                  )}
                  {mode === 'substitute' && (
                    <>
                      <RefreshCw className="w-4 h-4 text-amber-600" /> Substituição de Integrante:
                      <span className="underline">{targetIntegrante?.ministro?.name}</span>
                    </>
                  )}
                  {mode === 'edit' && (
                    <>
                      <Edit2 className="w-4 h-4 text-blue-600" /> Editar Atribuições:
                      <span className="underline">{targetIntegrante?.ministro?.name}</span>
                    </>
                  )}
                </h4>
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-xs text-gray-500 hover:text-gray-800 font-medium"
                >
                  Cancelar
                </button>
              </div>

              <form onSubmit={handleSubmitMember} className="space-y-4">
                {/* Seleção de Ministro (apenas em add e substitute) */}
                {mode !== 'edit' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                      {mode === 'substitute' ? 'Ministro Substituto *' : 'Ministro Oficial *'}
                    </label>
                    {selectedMember ? (
                      <div className="flex items-center justify-between p-3 bg-white rounded-lg border border-blue-300">
                        <div>
                          <p className="text-sm font-bold text-gray-900">{selectedMember.name}</p>
                          <p className="text-xs text-gray-500">
                            {selectedMember.cargo_ministerial || 'Ministro'} • CGADB:{' '}
                            {selectedMember.numero_cgadb || 'N/A'} • Reg:{' '}
                            {selectedMember.registro_comieadepa || 'N/A'}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSelectedMember(null)}
                          className="text-xs text-red-600 hover:text-red-800 font-semibold"
                        >
                          Trocar Ministro
                        </button>
                      </div>
                    ) : (
                      <div className="relative">
                        <div className="relative flex items-center">
                          <Search className="absolute left-3 text-gray-400 w-4 h-4" />
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Digite o nome ou CPF do ministro oficial..."
                            className="w-full pl-9 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-[#123b63] outline-none bg-white"
                          />
                        </div>
                        {searching && (
                          <div className="text-xs text-gray-500 mt-1">Buscando ministros...</div>
                        )}
                        {searchResults.length > 0 && (
                          <ul className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto divide-y divide-gray-100">
                            {searchResults.map((m) => (
                              <li
                                key={m.id}
                                onClick={() => {
                                  setSelectedMember(m);
                                  setSearchResults([]);
                                }}
                                className="p-2 hover:bg-blue-50 cursor-pointer text-sm"
                              >
                                <span className="font-semibold text-gray-900">{m.name}</span>
                                <span className="text-xs text-gray-500 ml-2">
                                  ({m.cargo_ministerial || 'Ministro'} - Reg:{' '}
                                  {m.registro_comieadepa || 'N/A'})
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Cargo e Hierarquia */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                      Cargo na Comissão *
                    </label>
                    <select
                      value={cargo}
                      onChange={(e) => handleCargoChange(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-[#123b63] outline-none"
                    >
                      {CARGOS_COMISSAO_PADRAO.map((c) => (
                        <option key={c.cargo} value={c.cargo}>
                          {c.cargo}
                        </option>
                      ))}
                      <option value="Outro">Outro (Personalizado)...</option>
                    </select>
                  </div>

                  {cargo === 'Outro' && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                        Cargo Personalizado *
                      </label>
                      <input
                        type="text"
                        required
                        value={cargoPersonalizado}
                        onChange={(e) => setCargoPersonalizado(e.target.value)}
                        placeholder="Ex: Assessor Jurídico"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                      Ordem de Precedência
                    </label>
                    <input
                      type="number"
                      value={ordemHierarquia}
                      onChange={(e) => setOrdemHierarquia(Number(e.target.value))}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none"
                      title="Menor número = maior prioridade na exibição oficial (ex: 1 = Presidente)"
                    />
                  </div>

                  {mode !== 'edit' && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                        Data de Início *
                      </label>
                      <input
                        type="date"
                        required
                        value={dataEntrada}
                        onChange={(e) => setDataEntrada(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none"
                      />
                    </div>
                  )}
                </div>

                {mode === 'substitute' && (
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                      Motivo / Fundamentação da Substituição
                    </label>
                    <input
                      type="text"
                      value={motivoSubstituicao}
                      onChange={(e) => setMotivoSubstituicao(e.target.value)}
                      placeholder="Ex: Nomeado em substituição conforme Portaria 05/2026..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1">
                    Observações Administrativas (Opcional)
                  </label>
                  <input
                    type="text"
                    value={observacoes}
                    onChange={(e) => setObservacoes(e.target.value)}
                    placeholder="Anotações internas..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white outline-none"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={resetForm}
                    className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-xs hover:bg-gray-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="px-4 py-1.5 bg-[#123b63] text-white rounded-lg text-xs font-semibold hover:bg-[#0d2a47] disabled:opacity-50"
                  >
                    {loading ? 'Salvando...' : 'Confirmar Designação'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Abas e Botão de Ação */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-200 pb-3">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setActiveTab('ativos')}
                className={`text-sm font-bold pb-2 relative transition ${
                  activeTab === 'ativos'
                    ? 'text-[#123b63] border-b-2 border-[#123b63]'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Composição Vigente ({integrantesAtivos.length})
              </button>
              <button
                onClick={() => setActiveTab('historico')}
                className={`text-sm font-bold pb-2 relative transition ${
                  activeTab === 'historico'
                    ? 'text-[#123b63] border-b-2 border-[#123b63]'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Histórico & Substituições ({integrantesHistorico.length})
              </button>
            </div>

            {mode === 'view' && podeGerenciar && (
              <button
                onClick={() => setMode('add')}
                className="inline-flex items-center gap-1.5 bg-[#123b63] text-white text-xs px-3 py-1.5 rounded-lg font-semibold hover:bg-[#0d2a47] transition shadow-sm"
              >
                <UserPlus className="w-3.5 h-3.5" />
                Designar Ministro
              </button>
            )}
          </div>

          {/* Lista de Ativos */}
          {activeTab === 'ativos' && (
            <div className="space-y-3">
              {integrantesAtivos.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nenhum ministro designado ativamente nesta comissão.</p>
                  {podeGerenciar && (
                    <button
                      onClick={() => setMode('add')}
                      className="mt-3 text-xs text-[#123b63] font-bold hover:underline"
                    >
                      + Clique aqui para designar o primeiro membro
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600 font-bold uppercase">
                        <th className="py-2.5 px-3">Ordem</th>
                        <th className="py-2.5 px-3">Ministro Oficial</th>
                        <th className="py-2.5 px-3">Cargo na Comissão</th>
                        <th className="py-2.5 px-3">Início</th>
                        {podeGerenciar && <th className="py-2.5 px-3 text-right">Ações</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {integrantesAtivos.map((item) => (
                        <tr key={item.id} className="hover:bg-blue-50/40 transition">
                          <td className="py-3 px-3 text-xs font-semibold text-gray-500">
                            #{item.ordem_hierarquia}
                          </td>
                          <td className="py-3 px-3">
                            <div className="font-bold text-gray-900">
                              {item.ministro?.name || 'Ministro não identificado'}
                            </div>
                            <div className="text-xs text-gray-500">
                              {item.ministro?.cargo_ministerial || 'Ministro'} • CGADB:{' '}
                              {item.ministro?.numero_cgadb || 'N/A'} • Reg:{' '}
                              {item.ministro?.registro_comieadepa || 'N/A'}
                            </div>
                          </td>
                          <td className="py-3 px-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-[#123b63]/10 text-[#123b63]">
                              {item.cargo}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-xs text-gray-600">
                            {item.data_entrada
                              ? new Date(item.data_entrada).toLocaleDateString('pt-BR')
                              : '—'}
                          </td>
                          {podeGerenciar && (
                            <td className="py-3 px-3 text-right space-x-2">
                              <button
                                onClick={() => handleStartEdit(item)}
                                title="Editar atribuições"
                                className="text-gray-500 hover:text-blue-700 p-1 rounded hover:bg-gray-100"
                              >
                                <Edit2 className="w-4 h-4 inline" />
                              </button>
                              <button
                                onClick={() => handleStartSubstitute(item)}
                                title="Substituir por outro ministro (mantém histórico)"
                                className="text-amber-600 hover:text-amber-800 p-1 rounded hover:bg-amber-50"
                              >
                                <RefreshCw className="w-4 h-4 inline" />
                              </button>
                              <button
                                onClick={() => handleDesligarIntegrante(item)}
                                title="Encerrar mandato / desligar"
                                className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50"
                              >
                                <Trash2 className="w-4 h-4 inline" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Aba de Histórico e Membros Anteriores */}
          {activeTab === 'historico' && (
            <div className="space-y-3">
              {integrantesHistorico.length === 0 ? (
                <div className="text-center py-8 text-gray-400 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Não há substituições ou desligamentos registrados nesta comissão.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200 text-xs text-gray-600 font-bold uppercase">
                        <th className="py-2.5 px-3">Ministro Anterior</th>
                        <th className="py-2.5 px-3">Cargo Exercido</th>
                        <th className="py-2.5 px-3">Período</th>
                        <th className="py-2.5 px-3">Situação</th>
                        <th className="py-2.5 px-3">Motivo / Sucessor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {integrantesHistorico.map((item) => (
                        <tr key={item.id} className="hover:bg-gray-50 transition">
                          <td className="py-3 px-3">
                            <div className="font-semibold text-gray-800">
                              {item.ministro?.name || 'Ministro'}
                            </div>
                            <div className="text-xs text-gray-400">
                              {item.ministro?.cargo_ministerial || 'Ministro'}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-xs font-medium text-gray-700">
                            {item.cargo}
                          </td>
                          <td className="py-3 px-3 text-xs text-gray-500">
                            {item.data_entrada
                              ? new Date(item.data_entrada).toLocaleDateString('pt-BR')
                              : '—'}{' '}
                            até{' '}
                            {item.data_saida
                              ? new Date(item.data_saida).toLocaleDateString('pt-BR')
                              : 'Conclusão'}
                          </td>
                          <td className="py-3 px-3">
                            <span
                              className={`text-xs px-2 py-0.5 rounded font-bold ${
                                item.status === 'substituido'
                                  ? 'bg-amber-100 text-amber-800'
                                  : 'bg-gray-100 text-gray-700'
                              }`}
                            >
                              {item.status.toUpperCase()}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-xs text-gray-600">
                            {item.motivo_saida || 'Mandato concluído'}
                            {item.substituido_por && (
                              <div className="text-[11px] text-blue-800 font-medium mt-0.5">
                                Sucessor: {item.substituido_por.name}
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="bg-gray-50 px-6 py-3 border-t border-gray-200 flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-gray-500">
            * Apenas ministros cadastrados na base oficial são vinculados às comissões.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-gray-200 text-gray-800 rounded-lg text-xs font-semibold hover:bg-gray-300"
          >
            Concluir / Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
