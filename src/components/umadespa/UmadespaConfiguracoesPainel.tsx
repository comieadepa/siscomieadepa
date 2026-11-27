import React, { useState, useEffect } from 'react';
import { Settings, Check, AlertCircle } from 'lucide-react';
import { useUserRole } from '@/hooks/useUserRole';

export function UmadespaConfiguracoesPainel() {
  const { role } = useUserRole();
  const isAdmin = role === 'super' || role === 'administrador';

  const [loading, setLoading] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [msgSucesso, setMsgSucesso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const [taxa1aVia, setTaxa1aVia] = useState('25.00');
  const [taxa2aVia, setTaxa2aVia] = useState('25.00');
  const [mesesValidade, setMesesValidade] = useState('24');
  const [idadeMaxPublico, setIdadeMaxPublico] = useState('30');
  const [permitePublico, setPermitePublico] = useState(true);

  useEffect(() => {
    async function carregarConfig() {
      setLoading(true);
      try {
        const res = await fetch('/api/v1/secretaria/umadespa/configuracoes');
        const json = await res.json();
        if (res.ok && json.data) {
          setTaxa1aVia(Number(json.data.taxa_primeira_via).toFixed(2));
          setTaxa2aVia(Number(json.data.taxa_segunda_via).toFixed(2));
          setMesesValidade(String(json.data.meses_validade_carteirinha || 24));
          setIdadeMaxPublico(String(json.data.idade_maxima_cadastro_publico || 30));
          setPermitePublico(json.data.permite_cadastro_publico !== false);
        }
      } catch (err) {
        console.error('Erro ao carregar configurações:', err);
      } finally {
        setLoading(false);
      }
    }
    carregarConfig();
  }, []);

  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) {
      setErro('Apenas administradores podem alterar configurações financeiras e operacionais.');
      return;
    }

    setSalvando(true);
    setErro(null);
    setMsgSucesso(null);

    try {
      const res = await fetch('/api/v1/secretaria/umadespa/configuracoes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taxa_primeira_via: parseFloat(taxa1aVia),
          taxa_segunda_via: parseFloat(taxa2aVia),
          meses_validade_carteirinha: parseInt(mesesValidade, 10),
          idade_maxima_cadastro_publico: parseInt(idadeMaxPublico, 10),
          permite_cadastro_publico: permitePublico,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Erro ao salvar parâmetros.');
      }

      setMsgSucesso('Configurações da UMADESPA atualizadas com sucesso!');
      setTimeout(() => setMsgSucesso(null), 4000);
    } catch (err: any) {
      setErro(err.message || 'Falha ao salvar configurações.');
    } finally {
      setSalvando(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 p-8 text-center text-xs text-slate-700 dark:text-slate-300">
        Carregando parâmetros operacionais...
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm p-6 max-w-3xl">
      <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
          <Settings className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Parâmetros & Taxas de Carteirinhas da UMADESPA
          </h3>
          <p className="text-xs text-slate-700 dark:text-slate-300">
            Defina os valores das vias, validade oficial e regras do exercício corrente.
          </p>
        </div>
      </div>

      {msgSucesso && (
        <div className="mb-4 p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-xs flex items-center gap-2">
          <Check className="w-4 h-4" />
          <span>{msgSucesso}</span>
        </div>
      )}

      {erro && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          <span>{erro}</span>
        </div>
      )}

      <form onSubmit={handleSalvar} className="space-y-4 text-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Taxa da 1ª Via da Carteirinha (R$)
            </label>
            <input
              type="number"
              step="0.50"
              disabled={!isAdmin}
              value={taxa1aVia}
              onChange={(e) => setTaxa1aVia(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Taxa da 2ª Via da Carteirinha (R$)
            </label>
            <input
              type="number"
              step="0.50"
              disabled={!isAdmin}
              value={taxa2aVia}
              onChange={(e) => setTaxa2aVia(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Prazo de Validade da Carteirinha (Meses)
            </label>
            <input
              type="number"
              min="1"
              max="120"
              disabled={!isAdmin}
              value={mesesValidade}
              onChange={(e) => setMesesValidade(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
            />
            <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-1">
              Padrão institucional: 24 meses (2 anos).
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Idade Máxima no Cadastro Público (Anos)
            </label>
            <input
              type="number"
              min="15"
              max="99"
              disabled={!isAdmin}
              value={idadeMaxPublico}
              onChange={(e) => setIdadeMaxPublico(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
            />
            <p className="text-[11px] text-slate-700 dark:text-slate-300 mt-1">
              Restrição pública: até 30 anos (inclusive).
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <input
            type="checkbox"
            id="permite_publico_check"
            disabled={!isAdmin}
            checked={permitePublico}
            onChange={(e) => setPermitePublico(e.target.checked)}
            className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500 disabled:opacity-60"
          />
          <label htmlFor="permite_publico_check" className="text-xs font-medium text-slate-700 dark:text-slate-300">
            Habilitar submissão através do link público da UMADESPA
          </label>
        </div>

        {!isAdmin && (
          <p className="text-xs text-amber-600 dark:text-amber-400 italic">
            * Seu nível de usuário permite visualizar, mas não alterar estas configurações.
          </p>
        )}

        {isAdmin && (
          <div className="flex justify-end pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="submit"
              disabled={salvando}
              className="px-5 py-2 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
            >
              {salvando ? 'Salvando...' : 'Salvar Parâmetros'}
            </button>
          </div>
        )}
      </form>
    </div>
  );
}
