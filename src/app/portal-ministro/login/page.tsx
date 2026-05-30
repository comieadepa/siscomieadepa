'use client';

import { useState } from 'react';
import Image from 'next/image';
import { Eye, EyeOff, ArrowLeft } from 'lucide-react';

type Stage = 'cpf' | 'first_access' | 'password';

function maskCpf(v: string): string {
  const d = v.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

export default function PortalMinistroLoginPage() {
  const [stage, setStage] = useState<Stage>('cpf');
  const [cpf, setCpf] = useState('');
  const [nomeMinistro, setNomeMinistro] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [senha, setSenha] = useState('');
  const [senhaConfirm, setSenhaConfirm] = useState('');
  const [showSenha, setShowSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  const cpfLimpo = cpf.replace(/\D/g, '');

  // Etapa 1: verificar CPF
  const handleCheckCpf = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');
    if (cpfLimpo.length !== 11) { setErro('CPF inválido.'); return; }
    setLoading(true);
    try {
      const res = await fetch('/api/portal-ministro/auth/check-cpf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: cpfLimpo }),
      });
      const json = await res.json();
      if (!res.ok) { setErro(json.error || 'CPF não encontrado.'); return; }
      setNomeMinistro(json.nome || '');
      setStage(json.hasPassword ? 'password' : 'first_access');
    } catch {
      setErro('Erro de conexão. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  // Etapa 2a/2b: enviar login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro('');

    if (stage === 'first_access') {
      if (!dataNascimento) { setErro('Data de nascimento obrigatória.'); return; }
      if (!senha || senha.length < 6) { setErro('A senha deve ter pelo menos 6 caracteres.'); return; }
      if (senha !== senhaConfirm) { setErro('As senhas não coincidem.'); return; }
    } else {
      if (!senha) { setErro('Senha obrigatória.'); return; }
    }

    setLoading(true);
    try {
      const body: Record<string, string> = {
        cpf: cpfLimpo,
        tipo: stage === 'first_access' ? 'primeiro_acesso' : 'senha',
        senha,
      };
      if (stage === 'first_access') body.data_nascimento = dataNascimento;

      const res = await fetch('/api/portal-ministro/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (!res.ok) {
        setErro(json.error || 'Erro ao entrar.');
        setLoading(false);
        return;
      }

      // Usar navegação completa para garantir que o cookie seja enviado na próxima request
      window.location.href = '/portal-ministro/dashboard';
    } catch {
      setErro('Erro de conexão. Tente novamente.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#0D2B4E] to-[#1a4a7a] px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <Image
            src="/img/logo_comieadepa.png"
            alt="COMIEADEPA"
            width={120}
            height={120}
            className="mx-auto mb-4 drop-shadow-lg"
            style={{ width: '120px', height: 'auto' }}
            priority
          />
          <h1 className="text-white text-2xl font-bold">Portal do Ministro</h1>
          <p className="text-blue-200 text-sm mt-1">SISCOMIEADEPA</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {/* Etapa 1 — CPF */}
          {stage === 'cpf' && (
            <>
              <h2 className="text-xl font-semibold text-gray-800 mb-1">Identificação</h2>
              <p className="text-gray-500 text-sm mb-6">Digite seu CPF para continuar.</p>
              <form onSubmit={handleCheckCpf} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">CPF</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="000.000.000-00"
                    value={cpf}
                    onChange={(e) => setCpf(maskCpf(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                    required
                  />
                </div>
                {erro && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{erro}</div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-60"
                >
                  {loading ? 'Verificando...' : 'Continuar'}
                </button>
              </form>
            </>
          )}

          {/* Etapa 2a — Primeiro acesso */}
          {stage === 'first_access' && (
            <>
              <button
                onClick={() => { setStage('cpf'); setErro(''); setSenha(''); setSenhaConfirm(''); setNomeMinistro(''); }}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#0D2B4E] mb-4 -mt-1"
              >
                <ArrowLeft size={15} /> Trocar CPF
              </button>
              <h2 className="text-xl font-semibold text-gray-800 mb-1">Primeiro acesso</h2>
              <p className="text-gray-500 text-sm mb-6">
                Confirme sua identidade e crie uma senha para o portal.
              </p>
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Data de nascimento</label>
                  <input
                    type="date"
                    value={dataNascimento}
                    onChange={(e) => setDataNascimento(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nova senha</label>
                  <div className="relative">
                    <input
                      type={showSenha ? 'text' : 'password'}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      placeholder="Mínimo 6 caracteres"
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 pr-11 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowSenha((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Confirmar senha</label>
                  <input
                    type={showSenha ? 'text' : 'password'}
                    value={senhaConfirm}
                    onChange={(e) => setSenhaConfirm(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                    required
                  />
                </div>
                {erro && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{erro}</div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-60"
                >
                  {loading ? 'Criando acesso...' : 'Criar acesso e entrar'}
                </button>
              </form>
            </>
          )}

          {/* Etapa 2b — Login com senha */}
          {stage === 'password' && (
            <>
              <button
                onClick={() => { setStage('cpf'); setErro(''); setSenha(''); setNomeMinistro(''); }}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-[#0D2B4E] mb-4 -mt-1"
              >
                <ArrowLeft size={15} /> Trocar CPF
              </button>
              <h2 className="text-xl font-semibold text-gray-800 mb-1">
                {nomeMinistro ? `Bem-vindo, ${nomeMinistro.split(' ')[0]}!` : 'Bem-vindo de volta'}
              </h2>
              {nomeMinistro && (
                <p className="text-gray-700 text-sm font-medium mb-0.5">{nomeMinistro}</p>
              )}
              <p className="text-gray-400 text-xs mb-6">CPF: {cpf}</p>
              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Senha</label>
                  <div className="relative">
                    <input
                      type={showSenha ? 'text' : 'password'}
                      value={senha}
                      onChange={(e) => setSenha(e.target.value)}
                      autoFocus
                      className="w-full border border-gray-300 rounded-lg px-4 py-2.5 pr-11 text-gray-800 focus:outline-none focus:ring-2 focus:ring-[#0D2B4E]"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowSenha((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      {showSenha ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                {erro && (
                  <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{erro}</div>
                )}
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#0D2B4E] hover:bg-[#1a4a7a] text-white font-semibold py-3 rounded-lg transition-colors disabled:opacity-60"
                >
                  {loading ? 'Entrando...' : 'Entrar'}
                </button>
              </form>
            </>
          )}

          <p className="text-center text-xs text-gray-400 mt-6">
            Problemas para entrar? Contate a secretaria.
          </p>
        </div>
      </div>
    </div>
  );
}
