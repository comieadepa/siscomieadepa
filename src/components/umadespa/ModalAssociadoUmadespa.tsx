import React, { useState } from 'react';
import { X, UserPlus, AlertCircle } from 'lucide-react';
import { cleanCpf } from '@/lib/cpf';

interface AssociadoFormProps {
  associado?: any | null;
  supervisoes: Array<{ id: string; nome: string }>;
  campos: Array<{ id: string; nome: string; supervisao_id?: string }>;
  isOpen: boolean;
  onClose: () => void;
  onSalvo: () => void;
}

export function ModalAssociadoUmadespa({
  associado,
  supervisoes,
  campos,
  isOpen,
  onClose,
  onSalvo,
}: AssociadoFormProps) {
  const isEdicao = Boolean(associado?.id);

  const [nome, setNome] = useState(associado?.nome || '');
  const [cpf, setCpf] = useState(associado?.cpf || '');
  const [dataNascimento, setDataNascimento] = useState(associado?.data_nascimento || '');
  const [sexo, setSexo] = useState(associado?.sexo || 'MASCULINO');
  const [supervisaoId, setSupervisaoId] = useState(associado?.supervisao_id || associado?.supervisao?.id || '');
  const [campoId, setCampoId] = useState(associado?.campo_id || associado?.campo?.id || '');
  const [fone, setFone] = useState(associado?.fone || '');
  const [email, setEmail] = useState(associado?.email || '');
  const [fotoUrl] = useState(associado?.foto_url || '');

  // Dados do Responsável (se menor)
  const [responsavelNome, setResponsavelNome] = useState(associado?.responsavel_nome || '');
  const [responsavelCpf, setResponsavelCpf] = useState(associado?.responsavel_cpf || '');
  const [responsavelFone, setResponsavelFone] = useState(associado?.responsavel_fone || '');
  const [responsavelTermo, setResponsavelTermo] = useState(associado?.responsavel_termo_aceite ?? true);

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (!isOpen) return null;

  // Filtra campos pela supervisão selecionada
  const camposFiltrados = supervisaoId
    ? campos.filter((c) => c.supervisao_id === supervisaoId)
    : campos;

  // Determina se pela data de nascimento é menor de 18 anos
  let isMenor = false;
  if (dataNascimento) {
    const dNasc = new Date(`${dataNascimento}T00:00:00`);
    const hoje = new Date();
    let idade = hoje.getFullYear() - dNasc.getFullYear();
    if (hoje.getMonth() < dNasc.getMonth() || (hoje.getMonth() === dNasc.getMonth() && hoje.getDate() < dNasc.getDate())) {
      idade--;
    }
    isMenor = idade < 18;
  }

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErro(null);

    try {
      const payload: any = {
        nome: nome.trim(),
        cpf: cleanCpf(cpf),
        data_nascimento: dataNascimento,
        sexo,
        supervisao_id: supervisaoId,
        campo_id: campoId,
        fone: fone.trim() || null,
        email: email.trim() || null,
        foto_url: fotoUrl.trim() || null,
      };

      if (isMenor) {
        payload.responsavel_nome = responsavelNome.trim();
        payload.responsavel_cpf = cleanCpf(responsavelCpf);
        payload.responsavel_fone = responsavelFone.trim();
        payload.responsavel_termo_aceite = responsavelTermo;
      }

      const url = isEdicao
        ? `/api/v1/secretaria/umadespa/associados/${associado.id}`
        : '/api/v1/secretaria/umadespa/associados';

      const method = isEdicao ? 'PATCH' : 'POST';

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Erro ao salvar associado.');
      }

      onSalvo();
      onClose();
    } catch (err: any) {
      setErro(err.message || 'Falha ao salvar dados do associado.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-xl relative animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-700 dark:text-slate-300 hover:text-slate-600 dark:hover:text-slate-200 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
            <UserPlus className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              {isEdicao ? 'Editar Associado da Juventude' : 'Novo Cadastro Administrativo UMADESPA'}
            </h3>
            <p className="text-xs text-slate-700 dark:text-slate-300">
              {isEdicao ? associado?.nome : 'O jovem será cadastrado como Membro inicialmente.'}
            </p>
          </div>
        </div>

        {erro && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{erro}</span>
          </div>
        )}

        <form onSubmit={handleSalvar} className="space-y-4 text-sm">
          {/* Dados Pessoais */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Nome Completo *
              </label>
              <input
                type="text"
                required
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 uppercase"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                CPF *
              </label>
              <input
                type="text"
                required
                placeholder="000.000.000-00"
                value={cpf}
                onChange={(e) => setCpf(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Data de Nascimento *
              </label>
              <input
                type="date"
                required
                value={dataNascimento}
                onChange={(e) => setDataNascimento(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Sexo *
              </label>
              <select
                value={sexo}
                onChange={(e) => setSexo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <option value="MASCULINO">Masculino</option>
                <option value="FEMININO">Feminino</option>
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Telefone / Celular
              </label>
              <input
                type="text"
                placeholder="(91) 9XXXX-XXXX"
                value={fone}
                onChange={(e) => setFone(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                E-mail
              </label>
              <input
                type="email"
                placeholder="exemplo@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Vínculo Eclesiástico */}
          <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Vínculo Eclesiástico Oficial
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Supervisão *
                </label>
                <select
                  required
                  value={supervisaoId}
                  onChange={(e) => {
                    setSupervisaoId(e.target.value);
                    setCampoId('');
                  }}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Selecione uma Supervisão</option>
                  {supervisoes.map((sup) => (
                    <option key={sup.id} value={sup.id}>
                      {sup.nome}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Campo Eclesiástico *
                </label>
                <select
                  required
                  value={campoId}
                  onChange={(e) => setCampoId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Selecione um Campo</option>
                  {camposFiltrados.map((cmp) => (
                    <option key={cmp.id} value={cmp.id}>
                      {cmp.nome}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Se menor de idade, exige responsável */}
          {isMenor && (
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded-xl border border-amber-200 dark:border-amber-800 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">
                Responsável Legal (Jovem Menor de 18 anos)
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Nome do Responsável *
                  </label>
                  <input
                    type="text"
                    required={isMenor}
                    value={responsavelNome}
                    onChange={(e) => setResponsavelNome(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 uppercase"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    CPF do Responsável *
                  </label>
                  <input
                    type="text"
                    required={isMenor}
                    value={responsavelCpf}
                    onChange={(e) => setResponsavelCpf(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Telefone do Responsável *
                  </label>
                  <input
                    type="text"
                    required={isMenor}
                    value={responsavelFone}
                    onChange={(e) => setResponsavelFone(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="termo_menor_check"
                  checked={responsavelTermo}
                  onChange={(e) => setResponsavelTermo(e.target.checked)}
                  className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                />
                <label htmlFor="termo_menor_check" className="text-xs text-amber-900 dark:text-amber-200">
                  Confirmo que o responsável autorizou a emissão da carteirinha e o tratamento dos dados.
                </label>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-3 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={salvando}
              className="px-4 py-2 text-xs font-medium rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="px-4 py-2 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
            >
              {salvando ? 'Salvando...' : isEdicao ? 'Salvar Alterações' : 'Concluir Cadastro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
