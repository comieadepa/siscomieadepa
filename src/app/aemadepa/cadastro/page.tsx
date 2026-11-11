'use client';

import { useState, useRef, useEffect } from 'react';
import './aemadepa.css';
import {
  HeartHandshake,
  Search,
  CheckCircle2,
  Building2,
  Upload,
  User,
  AlertCircle,
  Sparkles,
  RefreshCw,
  X,
  Check,
  ShieldCheck,
  Lock,
  ArrowRight,
} from 'lucide-react';
import SecaoCarteirinhaAemadepa from '@/components/SecaoCarteirinhaAemadepa';

interface MinistroItem {
  id: string;
  nome: string;
  matricula: string;
  cargo: string;
  campo: string;
  supervisao: string;
  temEsposaCadastrada: boolean;
  status: string;
}

interface DadosFormulario {
  nome: string;
  cpf: string;
  rg: string;
  orgao_emissor: string;
  data_nascimento: string;
  nacionalidade: string;
  naturalidade: string;
  nome_pai: string;
  nome_mae: string;
  titulo_eleitoral: string;
  fone: string;
  email: string;
  tipo_sanguineo: string;
  foto_url: string | null;
}

const FORM_INICIAL: DadosFormulario = {
  nome: '',
  cpf: '',
  rg: '',
  orgao_emissor: '',
  data_nascimento: '',
  nacionalidade: 'BRASILEIRA',
  naturalidade: '',
  nome_pai: '',
  nome_mae: '',
  titulo_eleitoral: '',
  fone: '',
  email: '',
  tipo_sanguineo: '',
  foto_url: null,
};

const TIPOS_SANGUINEOS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export default function PublicAemadepaCadastroPage() {
  // 1. Busca e seleção de ministros
  const [busca, setBusca] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [resultados, setResultados] = useState<MinistroItem[]>([]);
  const [ministroSelecionado, setMinistroSelecionado] = useState<MinistroItem | null>(null);

  // 2. Desafio de Segurança LGPD (CPF + Data de Nascimento)
  const [desafioCpf, setDesafioCpf] = useState('');
  const [desafioDia, setDesafioDia] = useState('');
  const [desafioMes, setDesafioMes] = useState('');
  const [desafioAno, setDesafioAno] = useState('');
  const [validandoDesafio, setValidandoDesafio] = useState(false);
  const [desafioErro, setDesafioErro] = useState<string | null>(null);
  const [tokenAutorizacao, setTokenAutorizacao] = useState<string | null>(null);
  const [autorizado, setAutorizado] = useState(false);

  // 3. Formulário Principal da Esposa
  const [formData, setFormData] = useState<DadosFormulario>(FORM_INICIAL);
  const [esposaDia, setEsposaDia] = useState('');
  const [esposaMes, setEsposaMes] = useState('');
  const [esposaAno, setEsposaAno] = useState('');
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [erroBusca, setErroBusca] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const desafioMesRef = useRef<HTMLInputElement>(null);
  const desafioAnoRef = useRef<HTMLInputElement>(null);
  const esposaMesRef = useRef<HTMLInputElement>(null);
  const esposaAnoRef = useRef<HTMLInputElement>(null);

  // Helper de validação de data real de calendário (considera anos bissextos)
  const validarEConverterData = (diaStr: string, mesStr: string, anoStr: string): { valida: boolean; ymd: string; erro?: string } => {
    const dLimpo = diaStr.replace(/\D/g, '');
    const mLimpo = mesStr.replace(/\D/g, '');
    const aLimpo = anoStr.replace(/\D/g, '');

    if (!dLimpo || !mLimpo || !aLimpo) {
      return { valida: false, ymd: '', erro: 'Preencha o Dia, Mês e Ano completos.' };
    }

    const d = parseInt(dLimpo, 10);
    const m = parseInt(mLimpo, 10);
    const a = parseInt(aLimpo, 10);

    const anoAtual = new Date().getFullYear();
    if (a < 1900 || a > anoAtual) {
      return { valida: false, ymd: '', erro: `Ano deve estar entre 1900 e ${anoAtual}.` };
    }

    if (m < 1 || m > 12) {
      return { valida: false, ymd: '', erro: 'Mês inválido (deve ser entre 1 e 12).' };
    }

    // Dias máximos por mês considerando ano bissexto
    const diasPorMes = [31, (a % 4 === 0 && (a % 100 !== 0 || a % 400 === 0)) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    const maxDia = diasPorMes[m - 1];

    if (d < 1 || d > maxDia) {
      return { valida: false, ymd: '', erro: `Dia inválido para o mês ${String(m).padStart(2, '0')}/${a} (máximo ${maxDia} dias).` };
    }

    const ymd = `${a}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return { valida: true, ymd };
  };

  // Debounce na busca de ministros com AbortController e timeout de resiliência
  useEffect(() => {
    const termo = busca.trim();
    if (!termo || termo.length < 2) {
      setResultados([]);
      setErroBusca(null);
      setBuscando(false);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setBuscando(true);
      setErroBusca(null);
      try {
        const res = await fetch(`/api/public/aemadepa/ministros?q=${encodeURIComponent(termo)}`, {
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);

        if (res.ok && data?.ministros) {
          setResultados(data.ministros);
          setErroBusca(null);
        } else {
          setResultados([]);
          setErroBusca(data?.error || 'Não foi possível carregar os ministros no momento.');
        }
      } catch (e: any) {
        if (e.name === 'AbortError') return;
        console.error('Erro ao buscar ministros:', e);
        setResultados([]);
        setErroBusca('Falha na conexão ao buscar ministros. Tente novamente em instantes.');
      } finally {
        if (!controller.signal.aborted) {
          setBuscando(false);
        }
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [busca]);

  // Ao selecionar um ministro na lista de busca
  const selecionarMinistro = (min: MinistroItem) => {
    setMinistroSelecionado(min);
    setResultados([]);
    setErroBusca(null);
    setBusca('');
    setDesafioCpf('');
    setDesafioDia('');
    setDesafioMes('');
    setDesafioAno('');
    setDesafioErro(null);
    setTokenAutorizacao(null);
    setAutorizado(false);
    setFormData(FORM_INICIAL);
    setEsposaDia('');
    setEsposaMes('');
    setEsposaAno('');
    setFotoPreview(null);
    setErro(null);
  };

  const trocarMinistro = () => {
    setMinistroSelecionado(null);
    setErroBusca(null);
    setDesafioCpf('');
    setDesafioDia('');
    setDesafioMes('');
    setDesafioAno('');
    setDesafioErro(null);
    setTokenAutorizacao(null);
    setAutorizado(false);
    setFormData(FORM_INICIAL);
    setEsposaDia('');
    setEsposaMes('');
    setEsposaAno('');
    setFotoPreview(null);
    setErro(null);
  };

  // Submissão do Desafio LGPD (Validação no servidor)
  const handleValidarDesafio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ministroSelecionado) return;

    setDesafioErro(null);

    // Validação de calendário estrita
    const resData = validarEConverterData(desafioDia, desafioMes, desafioAno);
    if (!resData.valida) {
      setDesafioErro(resData.erro || 'Data de nascimento inválida. Digite Dia, Mês e Ano válidos.');
      return;
    }

    setValidandoDesafio(true);

    try {
      const res = await fetch('/api/public/aemadepa/validar-acesso', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ministroId: ministroSelecionado.id,
          cpf: desafioCpf,
          dataNascimento: resData.ymd,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Dados não conferem. Verifique as informações preenchidas.');
      }

      // Validação autorizada com sucesso!
      setTokenAutorizacao(data.token);
      setAutorizado(true);

      // Se retornou dados existentes da esposa para edição, preenche o formulário
      if (data.dadosEsposa) {
        const d = data.dadosEsposa;
        setFormData({
          nome: d.nome || '',
          cpf: d.cpf || '',
          rg: d.rg || '',
          orgao_emissor: d.orgao_emissor || '',
          data_nascimento: d.data_nascimento || '',
          nacionalidade: d.nacionalidade || 'BRASILEIRA',
          naturalidade: d.naturalidade || '',
          nome_pai: d.nome_pai || '',
          nome_mae: d.nome_mae || '',
          titulo_eleitoral: d.titulo_eleitoral || '',
          fone: d.fone || '',
          email: d.email || '',
          tipo_sanguineo: d.tipo_sanguineo || '',
          foto_url: d.foto_url || null,
        });

        // Preenche campos dia/mes/ano da esposa preservando formato
        if (d.data_nascimento && /^\d{4}-\d{2}-\d{2}$/.test(d.data_nascimento)) {
          const [ano, mes, dia] = d.data_nascimento.split('-');
          setEsposaDia(dia);
          setEsposaMes(mes);
          setEsposaAno(ano);
        } else {
          setEsposaDia('');
          setEsposaMes('');
          setEsposaAno('');
        }

        setFotoPreview(d.foto_url || null);
      } else {
        setFormData(FORM_INICIAL);
        setEsposaDia('');
        setEsposaMes('');
        setEsposaAno('');
        setFotoPreview(null);
      }
    } catch (err: any) {
      setDesafioErro(err.message || 'Erro ao validar dados. Tente novamente.');
    } finally {
      setValidandoDesafio(false);
    }
  };

  // Máscaras de formatação
  const formatCpf = (cpf: string) => {
    const digits = (cpf || '').replace(/\D/g, '').slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  };

  const formatPhone = (val: string) => {
    const digits = (val || '').replace(/\D/g, '').slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  // Upload e compressão de foto em Canvas
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErro('Por favor, selecione um arquivo de imagem válido (JPG, PNG).');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return;

      const img = document.createElement('img');
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 600;
        const MAX_HEIGHT = 800;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.drawImage(img, 0, 0, width, height);
        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.85);

        setFotoPreview(compressedBase64);
        setFormData((prev) => ({ ...prev, foto_url: compressedBase64 }));
        setErro(null);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleRemoverFoto = () => {
    setFotoPreview(null);
    setFormData((prev) => ({ ...prev, foto_url: null }));
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Submissão do formulário final com token
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);

    if (!ministroSelecionado || !tokenAutorizacao) {
      setErro('Sessão de validação expirada. Por favor, confirme seus dados de acesso novamente.');
      setAutorizado(false);
      return;
    }

    if (!formData.nome.trim()) {
      setErro('Por favor, preencha o seu nome completo.');
      return;
    }

    // Validação estrita da data de nascimento da esposa
    const resDataEsposa = validarEConverterData(esposaDia, esposaMes, esposaAno);
    if (!resDataEsposa.valida) {
      setErro(resDataEsposa.erro || 'Data de nascimento da esposa inválida. Preencha Dia, Mês e Ano válidos.');
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch('/api/public/aemadepa/cadastro', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-aemadepa-token': tokenAutorizacao,
        },
        body: JSON.stringify({
          ministroId: ministroSelecionado.id,
          token: tokenAutorizacao,
          ...formData,
          data_nascimento: resDataEsposa.ymd,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Falha ao processar cadastro.');
      }

      setSucesso(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      console.error('Erro ao enviar cadastro:', err);
      setErro(err.message || 'Ocorreu um erro ao enviar seu cadastro. Tente novamente.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="aemadepa-cadastro-page min-h-screen bg-gradient-to-b from-rose-50 via-slate-50 to-pink-50 py-8 px-4 sm:px-6 lg:px-8 text-gray-800">
      <div className="max-w-3xl mx-auto w-full">
        {/* Cabeçalho Oficial */}
        <div className="text-center mb-8 space-y-3">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-rose-600 via-pink-600 to-purple-700 text-white shadow-xl shadow-rose-600/20 mb-1">
            <HeartHandshake className="w-9 h-9" />
          </div>
          <div>
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 text-rose-800 tracking-wider uppercase mb-2">
              <Sparkles className="w-3.5 h-3.5 text-rose-600" />
              Cadastro Oficial AEMADEPA
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900 tracking-tight">
              Associação das Esposas de Ministros
            </h1>
            <p className="text-sm sm:text-base text-gray-600 font-medium max-w-xl mx-auto mt-1">
              COMIEADEPA — Convenção Interestadual de Ministros e Igrejas Evangélicas Assembleias de Deus no Pará
            </p>
          </div>
        </div>

        {/* Tela de Sucesso */}
        {sucesso ? (
          <div className="bg-white rounded-3xl shadow-xl border border-rose-100 p-8 text-center space-y-6 animate-in fade-in zoom-in-95 duration-300">
            <div className="w-20 h-20 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-inner">
              <CheckCircle2 className="w-12 h-12" />
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-black text-gray-900">Cadastro Salvo com Sucesso!</h2>
              <p className="text-gray-600 text-sm max-w-md mx-auto">
                Seus dados foram vinculados com sucesso ao cadastro do pastor <strong>{ministroSelecionado?.nome}</strong> na AEMADEPA.
              </p>
            </div>

            <div className="bg-rose-50/70 border border-rose-200 rounded-2xl p-5 text-left text-xs text-rose-900 space-y-1.5 max-w-md mx-auto">
              <p><strong>Esposa:</strong> {formData.nome}</p>
              {formData.cpf && <p><strong>CPF:</strong> {formatCpf(formData.cpf)}</p>}
              <p><strong>Ministro Vinculado:</strong> {ministroSelecionado?.nome} ({ministroSelecionado?.matricula})</p>
              {ministroSelecionado?.campo && <p><strong>Campo:</strong> {ministroSelecionado?.campo}</p>}
            </div>

            {/* Opção Facultativa de Solicitação de Carteirinha na Tela de Sucesso */}
            {ministroSelecionado && (
              <div className="max-w-xl mx-auto pt-2 text-left">
                <SecaoCarteirinhaAemadepa
                  ministroId={ministroSelecionado.id}
                  token={tokenAutorizacao}
                  dadosEsposaPreenchidos={{
                    nome: formData.nome,
                    cpf: formData.cpf,
                    dataNascimento: formData.data_nascimento,
                    fotoUrl: formData.foto_url,
                  }}
                />
              </div>
            )}

            <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setSucesso(false);
                  setMinistroSelecionado(null);
                  setAutorizado(false);
                  setTokenAutorizacao(null);
                  setFormData(FORM_INICIAL);
                  setFotoPreview(null);
                }}
                className="w-full sm:w-auto px-6 py-3 bg-gradient-to-r from-rose-600 to-pink-700 hover:from-rose-700 hover:to-pink-800 text-white font-bold text-sm rounded-xl shadow-md transition cursor-pointer"
              >
                Cadastrar / Atualizar Outra Associada
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* ETAPA 1: MINISTRO VINCULADO (SELEÇÃO) */}
            <div className="bg-white rounded-2xl shadow-sm border border-rose-200/80 p-5 sm:p-6 space-y-4">
              <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
                <div className="w-8 h-8 rounded-lg bg-rose-100 flex items-center justify-center text-rose-700">
                  <Building2 className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-gray-900 uppercase tracking-wide">
                    1. Ministro Vinculado
                  </h3>
                  <p className="text-xs text-gray-500">
                    Localize o ministro (seu esposo) para vincular seu cadastro na AEMADEPA
                  </p>
                </div>
              </div>

              {!ministroSelecionado ? (
                /* Campo de Busca de Ministro */
                <div className="space-y-3">
                  <div className="relative">
                    <input
                      type="text"
                      value={busca}
                      onChange={(e) => setBusca(e.target.value)}
                      placeholder="Digite o nome, CPF ou número de matrícula do pastor..."
                      className="w-full rounded-xl border border-gray-300 bg-white pl-10 pr-4 py-3 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                      autoFocus
                    />
                    <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-3.5" />
                    {buscando && (
                      <RefreshCw className="w-4 h-4 text-rose-500 animate-spin absolute right-3.5 top-3.5" />
                    )}
                  </div>

                  {/* Lista de Resultados de Ministros */}
                  {resultados.length > 0 && (
                    <div className="border border-gray-200 rounded-xl overflow-hidden shadow-md divide-y divide-gray-100 max-h-72 overflow-y-auto bg-white">
                      {resultados.map((min) => (
                        <div
                          key={min.id}
                          className="p-3.5 hover:bg-rose-50/50 flex items-center justify-between gap-3 transition"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-bold text-gray-900 truncate">
                              {min.nome}
                            </p>
                            <p className="text-xs text-gray-500 truncate mt-0.5">
                              Matrícula: <strong>{min.matricula || '—'}</strong> • {min.cargo} {min.campo ? `• ${min.campo}` : ''}
                              {min.status === 'JUBILADO' && (
                                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded-md">
                                  Jubilado
                                </span>
                              )}
                              {min.status === 'FALECIDO' && (
                                <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-gray-200 text-gray-700 rounded-md">
                                  Falecido
                                </span>
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => selecionarMinistro(min)}
                            className="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold text-xs rounded-lg border border-rose-200 transition shrink-0 cursor-pointer"
                          >
                            Selecionar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {erroBusca && !buscando && (
                    <p className="text-xs text-red-700 bg-red-50 p-3 rounded-xl border border-red-200 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                      <span>{erroBusca}</span>
                    </p>
                  )}

                  {!erroBusca && busca.trim().length >= 2 && !buscando && resultados.length === 0 && (
                    <p className="text-xs text-amber-700 bg-amber-50 p-3 rounded-xl border border-amber-200 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 shrink-0 text-amber-500" />
                      <span>Nenhum ministro encontrado com os termos pesquisados. Verifique o nome, CPF ou número de matrícula.</span>
                    </p>
                  )}
                </div>
              ) : (
                /* Card do Ministro Confirmado */
                <div className="bg-gradient-to-r from-rose-50 to-pink-50 border border-rose-200 rounded-xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-rose-800 uppercase tracking-wide">
                      <Check className="w-4 h-4 text-emerald-600" />
                      <span>Ministro Selecionado</span>
                    </div>
                    <p className="text-base font-extrabold text-gray-900">{ministroSelecionado.nome}</p>
                    <p className="text-xs text-gray-600">
                      Matrícula: <strong>{ministroSelecionado.matricula || '—'}</strong> • {ministroSelecionado.cargo}
                      {ministroSelecionado.campo ? ` • Campo: ${ministroSelecionado.campo}` : ''}
                      {ministroSelecionado.status === 'JUBILADO' && (
                        <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-800 rounded-md">
                          Jubilado
                        </span>
                      )}
                      {ministroSelecionado.status === 'FALECIDO' && (
                        <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold bg-gray-200 text-gray-700 rounded-md">
                          Falecido
                        </span>
                      )}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={trocarMinistro}
                    className="px-3 py-1.5 bg-white hover:bg-rose-100 text-rose-700 text-xs font-bold rounded-lg border border-rose-300 shadow-2xs transition cursor-pointer shrink-0"
                  >
                    Trocar Ministro
                  </button>
                </div>
              )}
            </div>

            {/* ETAPA 2: DESAFIO DE SEGURANÇA E PRIVACIDADE LGPD */}
            {ministroSelecionado && !autorizado && (
              <div className="bg-white rounded-2xl shadow-sm border border-amber-200 p-5 sm:p-6 space-y-4 animate-in fade-in duration-300">
                <div className="flex items-start gap-3 pb-3 border-b border-gray-100">
                  <div className="w-9 h-9 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                    <Lock className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-gray-900 uppercase tracking-wide">
                        2. Confirmação de Identidade e Segurança (LGPD)
                      </h3>
                      <span className="px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-800 uppercase">
                        Proteção de Dados
                      </span>
                    </div>
                    <p className="text-xs text-gray-600 mt-1">
                      {ministroSelecionado.temEsposaCadastrada ? (
                        <>
                          Identificamos um cadastro já existente para a esposa deste ministro. Para proteger seus dados pessoais, informe o <strong>CPF</strong> e a <strong>Data de Nascimento da Esposa</strong> para liberar a edição.
                        </>
                      ) : (
                        <>
                          Para cadastrar a esposa deste ministro pela primeira vez, confirme o <strong>CPF</strong> e a <strong>Data de Nascimento do Ministro (Esposo)</strong> conforme o cadastro oficial da COMIEADEPA.
                        </>
                      )}
                    </p>
                  </div>
                </div>

                {/* Mensagem de Erro do Desafio */}
                {desafioErro && (
                  <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-2.5 text-red-800 text-xs animate-in fade-in duration-200">
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Atenção</p>
                      <p className="text-red-700 mt-0.5">{desafioErro}</p>
                    </div>
                  </div>
                )}

                <form onSubmit={handleValidarDesafio} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Campo CPF */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        {ministroSelecionado.temEsposaCadastrada ? 'CPF da Esposa *' : 'CPF do Ministro (Esposo) *'}
                      </label>
                      <input
                        type="text"
                        required
                        value={formatCpf(desafioCpf)}
                        onChange={(e) => setDesafioCpf(e.target.value)}
                        placeholder="000.000.000-00"
                        maxLength={14}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                      />
                    </div>

                    {/* Campo Data de Nascimento (Mobile-Friendly: Dia, Mês, Ano) */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        {ministroSelecionado.temEsposaCadastrada
                          ? 'Data de Nascimento da Esposa *'
                          : 'Data de Nascimento do Ministro (Esposo) *'}
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            required
                            placeholder="Dia (DD)"
                            maxLength={2}
                            value={desafioDia}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                              setDesafioDia(val);
                              if (val.length === 2) desafioMesRef.current?.focus();
                            }}
                            className="w-full text-center rounded-xl border border-gray-300 bg-white px-2 py-2.5 text-sm font-semibold text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                          />
                        </div>
                        <div>
                          <input
                            ref={desafioMesRef}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            required
                            placeholder="Mês (MM)"
                            maxLength={2}
                            value={desafioMes}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                              setDesafioMes(val);
                              if (val.length === 2) desafioAnoRef.current?.focus();
                            }}
                            className="w-full text-center rounded-xl border border-gray-300 bg-white px-2 py-2.5 text-sm font-semibold text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                          />
                        </div>
                        <div>
                          <input
                            ref={desafioAnoRef}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            required
                            placeholder="Ano (AAAA)"
                            maxLength={4}
                            value={desafioAno}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                              setDesafioAno(val);
                            }}
                            className="w-full text-center rounded-xl border border-gray-300 bg-white px-2 py-2.5 text-sm font-semibold text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                          />
                        </div>
                      </div>
                      <span className="block text-[11px] text-gray-500 mt-1">Formato: DD/MM/AAAA (ex: 25 / 03 / 1980)</span>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 text-xs text-gray-500">
                      <ShieldCheck className="w-4 h-4 text-emerald-600" />
                      <span>Validação estritamente segura e confidencial</span>
                    </div>

                    <button
                      type="submit"
                      disabled={validandoDesafio || !desafioCpf || !desafioDia || !desafioMes || !desafioAno}
                      className="w-full sm:w-auto px-6 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl shadow transition flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {validandoDesafio ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          <span>Validando...</span>
                        </>
                      ) : (
                        <>
                          <span>Confirmar e Acessar Formulário</span>
                          <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* ETAPA 3: FORMULÁRIO DE DADOS DA ESPOSA (Liberado SOMENTE após validação) */}
            {ministroSelecionado && autorizado && (
              <form onSubmit={handleSubmit} className="space-y-6 animate-in fade-in duration-300">
                {/* Mensagem de Erro Global */}
                {erro && (
                  <div className="p-4 rounded-2xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-800 text-sm shadow-xs animate-in fade-in duration-200">
                    <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-bold">Atenção</p>
                      <p className="text-xs text-red-700 mt-0.5">{erro}</p>
                    </div>
                  </div>
                )}

                {/* Bloco 1: Foto e Identificação Principal */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sm:p-6 space-y-5">
                  <div className="flex items-center gap-2.5 pb-3 border-b border-gray-100">
                    <div className="w-8 h-8 rounded-lg bg-pink-100 flex items-center justify-center text-pink-700">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-base font-bold text-gray-900">3. Dados Pessoais da Esposa</h3>
                      <p className="text-xs text-gray-500">Informações cadastrais para a credencial e ficha AEMADEPA</p>
                    </div>
                  </div>

                  {/* Foto 3x4 da Esposa */}
                  <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 p-4 bg-slate-50/80 rounded-2xl border border-gray-200">
                    <div className="w-24 h-32 rounded-xl overflow-hidden bg-white border-2 border-dashed border-rose-300 flex items-center justify-center shrink-0 shadow-inner relative group">
                      {fotoPreview ? (
                        <>
                          <img
                            src={fotoPreview}
                            alt="Foto da Esposa"
                            className="w-full h-full object-cover"
                          />
                          <button
                            type="button"
                            onClick={handleRemoverFoto}
                            className="absolute top-1 right-1 w-6 h-6 bg-red-600 text-white rounded-full flex items-center justify-center text-xs opacity-80 hover:opacity-100 transition shadow"
                            title="Remover foto"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </>
                      ) : (
                        <div className="text-center p-2 text-gray-400">
                          <User className="w-8 h-8 mx-auto text-rose-300" />
                          <span className="text-[10px] font-semibold block mt-1">Foto 3x4</span>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2 text-center sm:text-left flex-1">
                      <h4 className="text-xs font-bold uppercase text-gray-700 tracking-wide">
                        Fotografia da Associada (Opcional)
                      </h4>
                      <p className="text-xs text-gray-500">
                        Envie uma foto nítida de rosto tipo documento (3x4). A foto será inserida automaticamente na credencial digital.
                      </p>

                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={handleFileChange}
                        className="hidden"
                      />

                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-rose-50 text-rose-700 font-bold text-xs rounded-xl border border-rose-300 shadow-2xs transition cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        {fotoPreview ? 'Trocar Fotografia' : 'Escolher Foto do Celular/PC'}
                      </button>
                    </div>
                  </div>

                  {/* Campos Principais */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Nome Completo */}
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        Nome Completo da Esposa *
                      </label>
                      <input
                        type="text"
                        required
                        value={formData.nome}
                        onChange={(e) => setFormData({ ...formData, nome: e.target.value.toUpperCase() })}
                        placeholder="Nome completo sem abreviações"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition uppercase"
                      />
                    </div>

                    {/* CPF */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        CPF da Esposa
                      </label>
                      <input
                        type="text"
                        value={formatCpf(formData.cpf)}
                        onChange={(e) => setFormData({ ...formData, cpf: e.target.value })}
                        placeholder="000.000.000-00"
                        maxLength={14}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                      />
                    </div>

                    {/* Data de Nascimento da Esposa (Mobile-Friendly: Dia, Mês, Ano) */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        Data de Nascimento da Esposa *
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            required
                            placeholder="Dia (DD)"
                            maxLength={2}
                            value={esposaDia}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                              setEsposaDia(val);
                              if (val.length === 2) esposaMesRef.current?.focus();
                            }}
                            className="w-full text-center rounded-xl border border-gray-300 bg-white px-2 py-2.5 text-sm font-semibold text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                          />
                        </div>
                        <div>
                          <input
                            ref={esposaMesRef}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            required
                            placeholder="Mês (MM)"
                            maxLength={2}
                            value={esposaMes}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 2);
                              setEsposaMes(val);
                              if (val.length === 2) esposaAnoRef.current?.focus();
                            }}
                            className="w-full text-center rounded-xl border border-gray-300 bg-white px-2 py-2.5 text-sm font-semibold text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                          />
                        </div>
                        <div>
                          <input
                            ref={esposaAnoRef}
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            required
                            placeholder="Ano (AAAA)"
                            maxLength={4}
                            value={esposaAno}
                            onChange={(e) => {
                              const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                              setEsposaAno(val);
                            }}
                            className="w-full text-center rounded-xl border border-gray-300 bg-white px-2 py-2.5 text-sm font-semibold text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                          />
                        </div>
                      </div>
                      <span className="block text-[11px] text-gray-500 mt-1">Formato: DD/MM/AAAA (ex: 15 / 08 / 1985)</span>
                    </div>

                    {/* RG */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        RG
                      </label>
                      <input
                        type="text"
                        value={formData.rg}
                        onChange={(e) => setFormData({ ...formData, rg: e.target.value })}
                        placeholder="Número do RG"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                      />
                    </div>

                    {/* Órgão Emissor */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        Órgão Emissor
                      </label>
                      <input
                        type="text"
                        value={formData.orgao_emissor}
                        onChange={(e) => setFormData({ ...formData, orgao_emissor: e.target.value.toUpperCase() })}
                        placeholder="Ex: SEGUP/PA, SSP/PA"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition uppercase"
                      />
                    </div>

                    {/* Tipo Sanguíneo */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        Tipo Sanguíneo
                      </label>
                      <select
                        value={formData.tipo_sanguineo}
                        onChange={(e) => setFormData({ ...formData, tipo_sanguineo: e.target.value })}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition cursor-pointer"
                      >
                        {TIPOS_SANGUINEOS.map((ts) => (
                          <option key={ts} value={ts}>{ts || 'Não informado'}</option>
                        ))}
                      </select>
                    </div>

                    {/* Nacionalidade */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        Nacionalidade
                      </label>
                      <input
                        type="text"
                        value={formData.nacionalidade}
                        onChange={(e) => setFormData({ ...formData, nacionalidade: e.target.value.toUpperCase() })}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition uppercase"
                      />
                    </div>

                    {/* Naturalidade */}
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        Naturalidade (Cidade / UF)
                      </label>
                      <input
                        type="text"
                        value={formData.naturalidade}
                        onChange={(e) => setFormData({ ...formData, naturalidade: e.target.value.toUpperCase() })}
                        placeholder="Ex: BELÉM / PA"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition uppercase"
                      />
                    </div>
                  </div>
                </div>

                {/* Bloco 2: Filiação & Documentos */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sm:p-6 space-y-4">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Filiação e Documentação Adicional
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Nome do Pai */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        Nome do Pai
                      </label>
                      <input
                        type="text"
                        value={formData.nome_pai}
                        onChange={(e) => setFormData({ ...formData, nome_pai: e.target.value.toUpperCase() })}
                        placeholder="Nome do pai"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition uppercase"
                      />
                    </div>

                    {/* Nome da Mãe */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        Nome da Mãe
                      </label>
                      <input
                        type="text"
                        value={formData.nome_mae}
                        onChange={(e) => setFormData({ ...formData, nome_mae: e.target.value.toUpperCase() })}
                        placeholder="Nome da mãe"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition uppercase"
                      />
                    </div>

                    {/* Título Eleitoral */}
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        Título de Eleitor
                      </label>
                      <input
                        type="text"
                        value={formData.titulo_eleitoral}
                        onChange={(e) => setFormData({ ...formData, titulo_eleitoral: e.target.value })}
                        placeholder="Número do título eleitoral"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                      />
                    </div>
                  </div>
                </div>

                {/* Bloco 3: Contatos */}
                <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5 sm:p-6 space-y-4">
                  <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                    Contatos da Associada
                  </h3>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Telefone / WhatsApp */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        WhatsApp / Celular
                      </label>
                      <input
                        type="text"
                        value={formatPhone(formData.fone)}
                        onChange={(e) => setFormData({ ...formData, fone: e.target.value })}
                        placeholder="(91) 90000-0000"
                        maxLength={15}
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition"
                      />
                    </div>

                    {/* E-mail */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                        E-mail
                      </label>
                      <input
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData({ ...formData, email: e.target.value.toLowerCase() })}
                        placeholder="seuemail@exemplo.com"
                        className="w-full rounded-xl border border-gray-300 bg-white px-3.5 py-2.5 text-sm text-gray-900 shadow-xs focus:border-rose-500 focus:outline-none focus:ring-3 focus:ring-rose-500/20 transition lowercase"
                      />
                    </div>
                  </div>
                </div>

                {/* Seção Facultativa de Carteirinha (na edição / parte inferior da ficha) */}
                {ministroSelecionado && autorizado && (
                  <SecaoCarteirinhaAemadepa
                    ministroId={ministroSelecionado.id}
                    token={tokenAutorizacao}
                    dadosEsposaPreenchidos={{
                      nome: formData.nome,
                      cpf: formData.cpf,
                      dataNascimento: formData.data_nascimento,
                      fotoUrl: formData.foto_url,
                    }}
                  />
                )}

                {/* Botão de Envio */}
                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={enviando}
                    className="w-full py-4 px-6 bg-gradient-to-r from-rose-600 via-pink-600 to-purple-700 hover:from-rose-700 hover:to-purple-800 text-white font-extrabold text-base rounded-2xl shadow-lg hover:shadow-xl transition flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {enviando ? (
                      <>
                        <RefreshCw className="w-5 h-5 animate-spin" />
                        <span>Enviando Cadastro...</span>
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-5 h-5" />
                        <span>Salvar Cadastro AEMADEPA</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Rodapé institucional */}
        <div className="text-center text-xs text-gray-400 mt-12 pb-6 space-y-1">
          <p>© {new Date().getFullYear()} COMIEADEPA — Convenção Interestadual de Ministros e Igrejas Evangélicas Assembleias de Deus no Estado do Pará</p>
          <p>AEMADEPA — Associação das Esposas de Ministros da COMIEADEPA</p>
        </div>
      </div>
    </div>
  );
}
