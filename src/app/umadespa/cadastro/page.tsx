'use client';

export const dynamic = 'force-dynamic';

import { useState, useEffect } from 'react';
import dynamicImport from 'next/dynamic';
import {
  Sparkles,
  Lock,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
  Building2,
  User,
  ShieldCheck,
} from 'lucide-react';
import { cleanCpf } from '@/lib/cpf';

// Lazy loading para componentes auxiliares
const UploadFoto3x4Umadespa = dynamicImport(
  () => import('@/components/umadespa/UploadFoto3x4Umadespa').then((m) => m.UploadFoto3x4Umadespa),
  { ssr: false }
);

const SecaoCarteirinhaPublicaUmadespa = dynamicImport(
  () => import('@/components/umadespa/SecaoCarteirinhaPublicaUmadespa').then((m) => m.SecaoCarteirinhaPublicaUmadespa),
  { ssr: false }
);

export default function UmadespaCadastroPublicoPage() {
  // Etapas: 'auth' (desafio CPF + Nascimento) -> 'formulario' (ficha do jovem)
  const [etapa, setEtapa] = useState<'auth' | 'formulario'>('auth');

  // Estados de Autenticação / Desafio
  const [cpfAuth, setCpfAuth] = useState('');
  const [dataNascAuth, setDataNascAuth] = useState('');
  const [tokenAuth, setTokenAuth] = useState<string | null>(null);
  const [associadoId, setAssociadoId] = useState<string>('novo');
  const [loadingAuth, setLoadingAuth] = useState(false);
  const [erroAuth, setErroAuth] = useState<string | null>(null);

  // Estados da Estrutura Eclesiástica
  const [supervisoes, setSupervisoes] = useState<any[]>([]);
  const [campos, setCampos] = useState<any[]>([]);
  const [congregacoes, setCongregacoes] = useState<any[]>([]);

  // Estados do Formulário
  const [nome, setNome] = useState('');
  const [cpf, setCpf] = useState('');
  const [dataNascimento, setDataNascimento] = useState('');
  const [sexo, setSexo] = useState('MASCULINO');
  const [rg, setRg] = useState('');
  const [orgaoEmissor, setOrgaoEmissor] = useState('');
  const [nacionalidade] = useState('BRASILEIRA');
  const [naturalidade, setNaturalidade] = useState('');
  const [nomePai, setNomePai] = useState('');
  const [nomeMae, setNomeMae] = useState('');
  const [tituloEleitoral, setTituloEleitoral] = useState('');
  const [fone, setFone] = useState('');
  const [email, setEmail] = useState('');
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);

  // Vínculos
  const [supervisaoId, setSupervisaoId] = useState('');
  const [campoId, setCampoId] = useState('');
  const [congregacaoId, setCongregacaoId] = useState('');

  // Menor de idade / Responsável
  const [responsavelNome, setResponsavelNome] = useState('');
  const [responsavelCpf, setResponsavelCpf] = useState('');
  const [responsavelFone, setResponsavelFone] = useState('');
  const [responsavelTermo, setResponsavelTermo] = useState(false);

  // Carteirinha
  const [carteirinhaAtual, setCarteirinhaAtual] = useState<any | null>(null);

  // Estados operacionais
  const [salvando, setSalvando] = useState(false);
  const [sucessoMsg, setSucessoMsg] = useState<string | null>(null);
  const [erroForm, setErroForm] = useState<string | null>(null);

  // Carrega Estrutura Eclesiástica
  useEffect(() => {
    async function carregarEstrutura() {
      try {
        const res = await fetch('/api/public/estrutura');
        const json = await res.json();
        if (res.ok && json) {
          setSupervisoes(json.supervisoes || []);
          setCampos(json.campos || []);
          setCongregacoes(json.congregacoes || []);
        }
      } catch (err) {
        console.error('Erro ao buscar estrutura:', err);
      }
    }
    carregarEstrutura();
  }, []);

  // Filtra campos pela supervisão selecionada
  const camposFiltrados = supervisaoId
    ? campos.filter((c) => c.supervisao_id === supervisaoId)
    : campos;

  // Filtra congregações pelo campo selecionado
  const congregacoesFiltradas = campoId
    ? congregacoes.filter((cg) => cg.campo_id === campoId)
    : congregacoes;

  // Determina se pela data de nascimento é menor de 18 anos
  let isMenor = false;
  let idadeCalculada = 0;
  if (dataNascimento) {
    const dNasc = new Date(`${dataNascimento}T00:00:00`);
    const hoje = new Date();
    let idade = hoje.getFullYear() - dNasc.getFullYear();
    if (hoje.getMonth() < dNasc.getMonth() || (hoje.getMonth() === dNasc.getMonth() && hoje.getDate() < dNasc.getDate())) {
      idade--;
    }
    idadeCalculada = Math.max(0, idade);
    isMenor = idadeCalculada < 18;
  }

  // 1. Desafio de Segurança e Acesso
  const handleValidarAcesso = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoadingAuth(true);
    setErroAuth(null);

    try {
      const res = await fetch('/api/public/umadespa/validar-acesso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: cpfAuth,
          dataNascimento: dataNascAuth,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Falha na validação dos dados.');
      }

      setTokenAuth(json.token);

      if (json.existe && json.associado) {
        // Popula os dados já existentes
        const a = json.associado;
        setAssociadoId(a.id);
        setNome(a.nome || '');
        setCpf(a.cpf || '');
        setDataNascimento(a.data_nascimento || '');
        setSexo(a.sexo || 'MASCULINO');
        setFone(a.fone || '');
        setEmail(a.email || '');
        setFotoUrl(a.foto_url || null);
        setSupervisaoId(a.supervisao_id || a.supervisao?.id || '');
        setCampoId(a.campo_id || a.campo?.id || '');
        setCongregacaoId(a.congregacao_id || a.congregacao?.id || '');
        setCarteirinhaAtual(a.carteirinha_atual || null);

        if (a.menor_idade) {
          setResponsavelNome(a.responsavel_nome || '');
          setResponsavelCpf(a.responsavel_cpf || '');
          setResponsavelFone(a.responsavel_fone || '');
          setResponsavelTermo(true);
        }
      } else {
        // Primeiro Acesso
        setAssociadoId('novo');
        setCpf(json.cpf || cleanCpf(cpfAuth));
        setDataNascimento(json.dataNascimento || dataNascAuth);
      }

      setEtapa('formulario');
    } catch (err: any) {
      setErroAuth(err.message || 'Erro ao validar acesso.');
    } finally {
      setLoadingAuth(false);
    }
  };

  // 2. Salvar Ficha de Inscrição
  const handleSalvarFicha = async (e: React.FormEvent) => {
    e.preventDefault();
    setSalvando(true);
    setErroForm(null);
    setSucessoMsg(null);

    // Validação de idade pública no front antes de enviar
    if (idadeCalculada > 30) {
      setErroForm('O cadastro público da UMADESPA é restrito a jovens até 30 anos (inclusive). Líderes e coordenadores acima dessa faixa devem ser cadastrados pela Secretaria da UMADESPA.');
      setSalvando(false);
      return;
    }

    try {
      const payload: any = {
        token: tokenAuth,
        associadoId,
        nome: nome.trim(),
        cpf: cleanCpf(cpf),
        data_nascimento: dataNascimento,
        sexo,
        rg: rg.trim() || null,
        orgao_emissor: orgaoEmissor.trim() || null,
        nacionalidade,
        naturalidade: naturalidade.trim() || null,
        nome_pai: nomePai.trim() || null,
        nome_mae: nomeMae.trim() || null,
        titulo_eleitoral: tituloEleitoral.trim() || null,
        supervisao_id: supervisaoId,
        campo_id: campoId,
        congregacao_id: congregacaoId || null,
        fone: fone.trim() || null,
        email: email.trim() || null,
        foto_url: fotoUrl || null,
        funcao: 'Membro', // Forçado
      };

      if (isMenor) {
        payload.responsavel_nome = responsavelNome.trim();
        payload.responsavel_cpf = cleanCpf(responsavelCpf);
        payload.responsavel_fone = responsavelFone.trim();
        payload.responsavel_termo_aceite = responsavelTermo;
      }

      const res = await fetch('/api/public/umadespa/cadastro', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-umadespa-token': tokenAuth || '',
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Erro ao salvar cadastro.');
      }

      if (json.data?.id) {
        setAssociadoId(json.data.id);
      }

      setSucessoMsg('Dados cadastrais salvos com sucesso!');
      setTimeout(() => setSucessoMsg(null), 4000);
    } catch (err: any) {
      setErroForm(err.message || 'Falha ao processar cadastro.');
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="py-8 px-4 sm:px-6 max-w-4xl mx-auto space-y-6">
      {/* Banner Superior Oficial */}
      <div className="bg-gradient-to-r from-emerald-800 via-emerald-700 to-teal-800 text-white rounded-3xl p-6 sm:p-8 shadow-lg text-center relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-6 -mr-6 w-32 h-32 rounded-full bg-emerald-500/20 blur-2xl" />
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-emerald-100 border border-white/20 mb-3">
          <Sparkles className="w-3.5 h-3.5" />
          Juventude COMIEADEPA
        </div>
        <h1 className="text-2xl sm:text-3xl font-black uppercase tracking-tight">
          UMADESPA — Inscrição & Credenciamento
        </h1>
        <p className="text-xs sm:text-sm text-emerald-100/90 mt-2 max-w-xl mx-auto font-medium">
          Portal oficial de cadastramento dos jovens das Assembleias de Deus no Estado do Pará e emissão de credenciais.
        </p>
      </div>

      {/* ETAPA 1: DESAFIO DE SEGURANÇA (CPF + DATA DE NASCIMENTO) */}
      {etapa === 'auth' && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm max-w-md mx-auto space-y-5 animate-in fade-in duration-200">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 flex items-center justify-center mx-auto mb-2">
              <Lock className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
              Identificação do Jovem
            </h2>
            <p className="text-xs text-slate-700 dark:text-slate-300">
              Informe seu CPF e data de nascimento para iniciar seu cadastro ou acessar seus dados.
            </p>
          </div>

          {erroAuth && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{erroAuth}</span>
            </div>
          )}

          <form onSubmit={handleValidarAcesso} className="space-y-4 text-sm">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                CPF do Jovem *
              </label>
              <input
                type="text"
                required
                placeholder="000.000.000-00"
                value={cpfAuth}
                onChange={(e) => setCpfAuth(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Data de Nascimento *
              </label>
              <input
                type="date"
                required
                value={dataNascAuth}
                onChange={(e) => setDataNascAuth(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <button
              type="submit"
              disabled={loadingAuth}
              className="w-full py-3 px-4 rounded-xl text-xs font-bold uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-700 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {loadingAuth ? 'Validando...' : 'Avançar para Inscrição'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>

          <p className="text-[11px] text-center text-slate-700 dark:text-slate-300 pt-2 border-t border-slate-100 dark:border-slate-800">
            Acesso seguro em conformidade com a LGPD e termos estatutários da UMADESPA.
          </p>
        </div>
      )}

      {/* ETAPA 2: FORMULÁRIO COMPLETO + SEÇÃO DE CARTEIRINHA */}
      {etapa === 'formulario' && (
        <div className="space-y-6 animate-in fade-in duration-200">
          {sucessoMsg && (
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300 text-xs font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>{sucessoMsg}</span>
            </div>
          )}

          {erroForm && (
            <div className="p-4 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{erroForm}</span>
            </div>
          )}

          {/* Form Principal */}
          <form onSubmit={handleSalvarFicha} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-600" />
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Dados do Jovem
                </h3>
              </div>
              <span className="text-xs px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-semibold">
                Função: Membro da Mocidade
              </span>
            </div>

            {/* Upload da Foto 3x4 */}
            <UploadFoto3x4Umadespa
              fotoUrl={fotoUrl}
              onFotoChange={setFotoUrl}
            />

            {/* Informações Básicas */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nome Completo *
                </label>
                <input
                  type="text"
                  required
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 uppercase focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  CPF *
                </label>
                <input
                  type="text"
                  readOnly
                  value={cpf}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-not-allowed"
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
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                />
                {idadeCalculada > 0 && (
                  <span className="text-[11px] text-slate-700 dark:text-slate-300 mt-0.5 block">
                    Idade: {idadeCalculada} anos {isMenor && '(Menor de 18)'}
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Sexo *
                </label>
                <select
                  value={sexo}
                  onChange={(e) => setSexo(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="MASCULINO">Masculino</option>
                  <option value="FEMININO">Feminino</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Telefone / WhatsApp *
                </label>
                <input
                  type="text"
                  required
                  placeholder="(91) 9XXXX-XXXX"
                  value={fone}
                  onChange={(e) => setFone(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  E-mail
                </label>
                <input
                  type="email"
                  placeholder="seuemail@exemplo.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  RG (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Número do RG"
                  value={rg}
                  onChange={(e) => setRg(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Órgão Emissor
                </label>
                <input
                  type="text"
                  placeholder="ex: SEGUP/PA"
                  value={orgaoEmissor}
                  onChange={(e) => setOrgaoEmissor(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Naturalidade
                </label>
                <input
                  type="text"
                  placeholder="Cidade - UF"
                  value={naturalidade}
                  onChange={(e) => setNaturalidade(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nome do Pai (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Nome do Pai"
                  value={nomePai}
                  onChange={(e) => setNomePai(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nome da Mãe (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Nome da Mãe"
                  value={nomeMae}
                  onChange={(e) => setNomeMae(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500 uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Título de Eleitor (Opcional)
                </label>
                <input
                  type="text"
                  placeholder="Título Eleitoral"
                  value={tituloEleitoral}
                  onChange={(e) => setTituloEleitoral(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            {/* Vínculo Eclesiástico */}
            <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60 space-y-3">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-emerald-600" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  Vínculo Eclesiástico Oficial
                </h4>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
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
                      setCongregacaoId('');
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Selecione sua Supervisão</option>
                    {supervisoes.map((sup) => (
                      <option key={sup.id} value={sup.id}>
                        {sup.nome}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Campo *
                  </label>
                  <select
                    required
                    value={campoId}
                    onChange={(e) => {
                      setCampoId(e.target.value);
                      setCongregacaoId('');
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Selecione seu Campo</option>
                    {camposFiltrados.map((cmp) => (
                      <option key={cmp.id} value={cmp.id}>
                        {cmp.nome}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Congregação (Opcional)
                  </label>
                  <select
                    value={congregacaoId}
                    onChange={(e) => setCongregacaoId(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Selecione sua Congregação</option>
                    {congregacoesFiltradas.map((cg) => (
                      <option key={cg.id} value={cg.id}>
                        {cg.nome}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Se menor de idade: exige identificação e consentimento do responsável */}
            {isMenor && (
              <div className="p-4 bg-amber-50/80 dark:bg-amber-950/40 rounded-xl border border-amber-200 dark:border-amber-800 space-y-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-amber-700 dark:text-amber-400" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200">
                    Consentimento do Responsável Legal (Menor de 18 Anos)
                  </h4>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Nome do Responsável *
                    </label>
                    <input
                      type="text"
                      required={isMenor}
                      value={responsavelNome}
                      onChange={(e) => setResponsavelNome(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 uppercase focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      CPF do Responsável *
                    </label>
                    <input
                      type="text"
                      required={isMenor}
                      placeholder="000.000.000-00"
                      value={responsavelCpf}
                      onChange={(e) => setResponsavelCpf(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                      Telefone do Responsável *
                    </label>
                    <input
                      type="text"
                      required={isMenor}
                      placeholder="(91) 9XXXX-XXXX"
                      value={responsavelFone}
                      onChange={(e) => setResponsavelFone(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="checkbox"
                    id="responsavel_aceite"
                    required={isMenor}
                    checked={responsavelTermo}
                    onChange={(e) => setResponsavelTermo(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
                  />
                  <label htmlFor="responsavel_aceite" className="text-xs text-amber-900 dark:text-amber-200">
                    O responsável legal autoriza formalmente a inscrição do menor e a confecção da credencial UMADESPA.
                  </label>
                </div>
              </div>
            )}

            <div className="flex justify-end pt-2 border-t border-slate-200 dark:border-slate-800">
              <button
                type="submit"
                disabled={salvando}
                className="py-2.5 px-6 rounded-xl text-xs font-bold uppercase tracking-wider text-white bg-emerald-600 hover:bg-emerald-700 transition-all shadow-sm disabled:opacity-50"
              >
                {salvando ? 'Salvando Ficha...' : 'Gravar Dados Cadastrais'}
              </button>
            </div>
          </form>

          {/* Seção da Credencial Oficial */}
          {associadoId && associadoId !== 'novo' && tokenAuth && (
            <SecaoCarteirinhaPublicaUmadespa
              associadoId={associadoId}
              token={tokenAuth}
              temFoto={Boolean(fotoUrl && fotoUrl.trim().length > 0)}
              menorIdade={isMenor}
              responsavelTermo={responsavelTermo}
              carteirinhaAtual={carteirinhaAtual}
              onSolicitacaoConcluida={(nova) => setCarteirinhaAtual(nova)}
            />
          )}
        </div>
      )}
    </div>
  );
}
