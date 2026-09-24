'use client';

import { useState, useEffect, useRef } from 'react';
import {
  HeartHandshake,
  X,
  Save,
  Upload,
  User,
  Phone,
  Mail,
  CreditCard,
  Building2,
  AlertCircle,
  CheckCircle2,
} from 'lucide-react';
import { authenticatedFetch } from '@/lib/api-client';

export interface MinistroAemadepaInfo {
  id: string; // member_id do ministro
  nome: string;
  matricula: string;
  cpf: string;
  cargo: string;
  campo: string;
  supervisao: string;
}

export interface DadosEsposaForm {
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
  numero_aemadepa: string;
}

interface ModalAemadepaProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  ministro: MinistroAemadepaInfo | null;
  dadosIniciais?: Partial<DadosEsposaForm> | null;
  // Lista opcional de todos os ministros para quando abrir como "Nova Associada" geral
  todosMinistros?: MinistroAemadepaInfo[];
}

const FORM_VAZIO: DadosEsposaForm = {
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
  numero_aemadepa: '',
};

const TIPOS_SANGUINEOS = ['', 'A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

export default function ModalAemadepa({
  isOpen,
  onClose,
  onSaved,
  ministro: ministroProp,
  dadosIniciais,
  todosMinistros = [],
}: ModalAemadepaProps) {
  const [ministroSelecionado, setMinistroSelecionado] = useState<MinistroAemadepaInfo | null>(ministroProp);
  const [formData, setFormData] = useState<DadosEsposaForm>(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [sucesso, setSucesso] = useState<string | null>(null);

  // Estados de upload e foto
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const [enviandoFoto, setEnviandoFoto] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Busca de ministro quando aberto sem ministro pré-selecionado
  const [buscaMinistro, setBuscaMinistro] = useState('');

  useEffect(() => {
    if (isOpen) {
      setMinistroSelecionado(ministroProp);
      setFormData({
        ...FORM_VAZIO,
        ...(dadosIniciais || {}),
        nacionalidade: dadosIniciais?.nacionalidade || 'BRASILEIRA',
      });
      setFotoPreview(dadosIniciais?.foto_url || null);
      setErro(null);
      setSucesso(null);
      setBuscaMinistro('');
    }
  }, [isOpen, ministroProp, dadosIniciais]);

  if (!isOpen) return null;

  const onlyDigits = (val: string) => val.replace(/\D/g, '');

  const formatCpf = (cpf: string) => {
    const digits = onlyDigits(cpf).slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 3) return digits;
    if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
    if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
    return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
  };

  const formatPhone = (val: string) => {
    const digits = onlyDigits(val).slice(0, 11);
    if (!digits) return '';
    if (digits.length <= 2) return `(${digits}`;
    if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  // Upload e redimensionamento de foto
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setErro('Por favor, selecione um arquivo de imagem válido (JPG, PNG).');
      return;
    }

    // Leitura e compressão em Canvas
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      if (!dataUrl) return;

      try {
        setEnviandoFoto(true);
        // Redimensionamento para 3:4 padrão (300x400)
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d');
          const targetW = 300;
          const targetH = 400;
          canvas.width = targetW;
          canvas.height = targetH;
          if (ctx) {
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, targetW, targetH);
            const sourceRatio = img.width / img.height;
            const targetRatio = targetW / targetH;
            let drawW = targetW;
            let drawH = targetH;
            if (sourceRatio > targetRatio) {
              drawH = targetH;
              drawW = targetH * sourceRatio;
            } else {
              drawW = targetW;
              drawH = targetW / sourceRatio;
            }
            ctx.drawImage(img, - (drawW - targetW) / 2, - (drawH - targetH) / 2, drawW, drawH);
            const compressed = canvas.toDataURL('image/jpeg', 0.85);
            setFotoPreview(compressed);
            setFormData(prev => ({ ...prev, foto_url: compressed }));
          }
          setEnviandoFoto(false);
        };
        img.src = dataUrl;
      } catch (err: any) {
        console.error('Erro ao processar imagem:', err);
        setErro('Erro ao processar imagem.');
        setEnviandoFoto(false);
      }
    };
    reader.readAsDataURL(file);
  };

  // Upload para o servidor (Supabase Storage via endpoint existente)
  const uploadFotoSeNecessario = async (targetMemberId: string): Promise<string | null> => {
    if (!formData.foto_url || !formData.foto_url.startsWith('data:image/')) {
      return formData.foto_url;
    }

    try {
      const blob = await fetch(formData.foto_url).then(res => res.blob());
      const file = new File([blob], `esposa-${targetMemberId}.jpg`, { type: 'image/jpeg' });
      const form = new FormData();
      form.append('file', file);
      form.append('membroId', targetMemberId);

      const resp = await authenticatedFetch('/api/v1/secretaria/uploads/membro-foto', {
        method: 'POST',
        body: form,
      });

      const payload = await resp.json().catch(() => null as any);
      if (!resp.ok) {
        throw new Error(payload?.error || 'Erro ao enviar foto para o servidor.');
      }
      return payload?.url || null;
    } catch (err: any) {
      console.warn('Aviso no upload da foto:', err);
      return formData.foto_url;
    }
  };

  // Salvamento
  const handleSalvar = async (e: React.FormEvent) => {
    e.preventDefault();
    setErro(null);
    setSucesso(null);

    const targetMinistro = ministroSelecionado || ministroProp;
    if (!targetMinistro?.id) {
      setErro('Selecione o ministro vinculado à associada.');
      return;
    }

    if (!formData.nome.trim()) {
      setErro('O nome completo da esposa é obrigatório.');
      return;
    }

    setSalvando(true);
    try {
      // 1. Busca os dados atuais do ministro para preservar 100% de seus campos e custom_fields
      const resAtual = await authenticatedFetch(`/api/v1/members/${targetMinistro.id}`);
      const membroAtual = await resAtual.json().catch(() => null as any);

      if (!resAtual.ok || !membroAtual) {
        throw new Error(membroAtual?.error || 'Erro ao consultar cadastro do ministro.');
      }

      // 2. Faz upload da foto se for base64
      let fotoFinalUrl = formData.foto_url;
      if (fotoFinalUrl && fotoFinalUrl.startsWith('data:image/')) {
        fotoFinalUrl = await uploadFotoSeNecessario(targetMinistro.id);
      }

      // 3. Monta os custom_fields preservando todos os campos existentes do ministro
      const customFieldsExistente = membroAtual.custom_fields && typeof membroAtual.custom_fields === 'object'
        ? membroAtual.custom_fields
        : {};

      const novosCustomFields = {
        ...customFieldsExistente,
        nomeConjuge: formData.nome.trim(),
        cpfConjuge: onlyDigits(formData.cpf) || null,
        dataNascimentoConjuge: formData.data_nascimento || null,
        conjugeRg: formData.rg.trim() || null,
        conjugeOrgaoEmissor: formData.orgao_emissor.trim() || null,
        conjugeNacionalidade: formData.nacionalidade.trim() || 'BRASILEIRA',
        conjugeNaturalidade: formData.naturalidade.trim() || null,
        conjugeNomePai: formData.nome_pai.trim() || null,
        conjugeNomeMae: formData.nome_mae.trim() || null,
        conjugeTituloEleitoral: formData.titulo_eleitoral.trim() || null,
        conjugeFone: formData.fone.trim() || null,
        conjugeEmail: formData.email.trim() || null,
        conjugeTipoSanguineo: formData.tipo_sanguineo || null,
        conjugeFotoUrl: fotoFinalUrl || null,
        numero_aemadepa: formData.numero_aemadepa.trim() || null,
        numeroAemadepa: formData.numero_aemadepa.trim() || null,
      };

      // 4. Monta o payload completo para PUT /api/v1/members/[id] preservando todos os campos do ministro
      const payloadPut = {
        ...membroAtual,
        // Campos diretos da esposa no banco
        nome_conjuge: formData.nome.trim(),
        cpf_conjuge: onlyDigits(formData.cpf) || null,
        data_nascimento_conjuge: formData.data_nascimento || null,
        conjuge_rg: formData.rg.trim() || null,
        conjuge_orgao_emissor: formData.orgao_emissor.trim() || null,
        conjuge_nacionalidade: formData.nacionalidade.trim() || 'BRASILEIRA',
        conjuge_naturalidade: formData.naturalidade.trim() || null,
        conjuge_nome_pai: formData.nome_pai.trim() || null,
        conjuge_nome_mae: formData.nome_mae.trim() || null,
        conjuge_titulo_eleitoral: formData.titulo_eleitoral.trim() || null,
        conjuge_fone: formData.fone.trim() || null,
        conjuge_email: formData.email.trim() || null,
        conjuge_tipo_sanguineo: formData.tipo_sanguineo || null,
        conjuge_foto_url: fotoFinalUrl || null,
        numero_aemadepa: formData.numero_aemadepa.trim() || null,
        // Custom fields preservados e mesclados
        custom_fields: novosCustomFields,
      };

      const resUpdate = await authenticatedFetch(`/api/v1/members/${targetMinistro.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadPut),
      });

      const jsonUpdate = await resUpdate.json().catch(() => null as any);
      if (!resUpdate.ok) {
        throw new Error(jsonUpdate?.error || 'Erro ao salvar dados da associada.');
      }

      setSucesso('Dados da associada AEMADEPA salvos com sucesso!');
      setTimeout(() => {
        onSaved();
        onClose();
      }, 900);
    } catch (err: any) {
      console.error('Erro ao salvar associada AEMADEPA:', err);
      setErro(err instanceof Error ? err.message : 'Erro ao salvar dados.');
    } finally {
      setSalvando(false);
    }
  };

  // Filtragem de ministros para o modo "Nova Associada" livre
  const ministrosFiltrados = todosMinistros.filter(m => {
    if (!buscaMinistro) return true;
    const q = buscaMinistro.toLowerCase();
    return (
      m.nome.toLowerCase().includes(q) ||
      m.matricula.toLowerCase().includes(q) ||
      m.cpf.toLowerCase().includes(q) ||
      m.campo.toLowerCase().includes(q)
    );
  }).slice(0, 8);

  const ministroAtivo = ministroSelecionado || ministroProp;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full my-6 flex flex-col max-h-[92vh] border border-rose-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header do Modal */}
        <div className="flex justify-between items-center px-6 py-4 bg-gradient-to-r from-rose-700 via-pink-700 to-purple-800 text-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center shadow-inner">
              <HeartHandshake className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight">
                {dadosIniciais?.nome ? 'Editar Associada AEMADEPA' : 'Cadastrar Associada AEMADEPA'}
              </h2>
              <p className="text-xs text-rose-100">
                Gestão cadastral da esposa do ministro vinculada à COMIEADEPA
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={salvando}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition disabled:opacity-50"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Formulário com Scroll */}
        <form onSubmit={handleSalvar} className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Mensagens de Alerta */}
          {erro && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 text-red-800 text-sm">
              <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold">Atenção</p>
                <p className="text-xs text-red-700 mt-0.5">{erro}</p>
              </div>
            </div>
          )}

          {sucesso && (
            <div className="p-4 rounded-xl bg-green-50 border border-green-200 flex items-start gap-3 text-green-800 text-sm">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-bold">Sucesso</p>
                <p className="text-xs text-green-700 mt-0.5">{sucesso}</p>
              </div>
            </div>
          )}

          {/* Seção 1: Ministro Vinculado (Somente Leitura / Seleção) */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Building2 className="w-4 h-4 text-slate-500" />
                Ministro Vinculado
              </span>
              {ministroAtivo && !ministroProp && (
                <button
                  type="button"
                  onClick={() => setMinistroSelecionado(null)}
                  className="text-xs text-rose-600 hover:text-rose-700 font-semibold"
                >
                  Trocar Ministro
                </button>
              )}
            </div>

            {ministroAtivo ? (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-white p-3.5 rounded-lg border border-slate-200 text-xs">
                <div>
                  <p className="text-gray-400 font-medium">Nome do Ministro</p>
                  <p className="font-bold text-gray-800 text-sm">{ministroAtivo.nome}</p>
                </div>
                <div>
                  <p className="text-gray-400 font-medium">Matrícula / Cargo</p>
                  <p className="font-semibold text-gray-700">
                    {ministroAtivo.matricula || '—'} {ministroAtivo.cargo && `• ${ministroAtivo.cargo}`}
                  </p>
                </div>
                <div>
                  <p className="text-gray-400 font-medium">Campo / Supervisão</p>
                  <p className="font-semibold text-gray-700">
                    {ministroAtivo.campo || '—'} {ministroAtivo.supervisao && `(${ministroAtivo.supervisao})`}
                  </p>
                </div>
              </div>
            ) : (
              /* Selecionador de Ministro quando aberto genericamente */
              <div className="space-y-2">
                <input
                  type="text"
                  value={buscaMinistro}
                  onChange={e => setBuscaMinistro(e.target.value)}
                  placeholder="Pesquise o ministro por nome, matrícula ou campo..."
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                {todosMinistros.length > 0 && (
                  <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-lg bg-white divide-y divide-gray-100">
                    {ministrosFiltrados.map(m => (
                      <button
                        type="button"
                        key={m.id}
                        onClick={() => {
                          setMinistroSelecionado(m);
                          setBuscaMinistro('');
                        }}
                        className="w-full text-left px-3.5 py-2 hover:bg-rose-50 transition flex items-center justify-between text-xs"
                      >
                        <div>
                          <p className="font-bold text-gray-800">{m.nome}</p>
                          <p className="text-gray-500 text-[11px]">Matrícula: {m.matricula} • {m.campo}</p>
                        </div>
                        <span className="px-2 py-1 bg-rose-100 text-rose-800 font-semibold rounded text-[10px]">
                          Selecionar
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Seção 2: Foto e Identificação Principal */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
            {/* Foto 3:4 */}
            <div className="md:col-span-4 flex flex-col items-center p-4 bg-rose-50/40 rounded-xl border border-rose-100 space-y-3">
              <span className="text-xs font-bold text-rose-900 uppercase tracking-wider">
                Foto da Associada
              </span>

              <div className="w-28 h-36 bg-white rounded-lg shadow-sm border-2 border-dashed border-rose-300 overflow-hidden flex items-center justify-center relative group">
                {fotoPreview ? (
                  <img
                    src={fotoPreview}
                    alt="Foto da Esposa"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-center p-2 text-rose-300">
                    <User className="w-10 h-10 mx-auto mb-1 opacity-60" />
                    <span className="text-[10px] font-medium block">Sem Foto</span>
                  </div>
                )}
                {enviandoFoto && (
                  <div className="absolute inset-0 bg-black/40 flex items-center justify-center text-white text-xs">
                    Processando...
                  </div>
                )}
              </div>

              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="image/*"
                className="hidden"
              />

              <div className="flex gap-2 w-full">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 py-1.5 px-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1 transition"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Carregar
                </button>
                {fotoPreview && (
                  <button
                    type="button"
                    onClick={() => {
                      setFotoPreview(null);
                      setFormData(prev => ({ ...prev, foto_url: null }));
                    }}
                    className="py-1.5 px-2.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs font-semibold transition"
                    title="Remover foto"
                  >
                    ✕
                  </button>
                )}
              </div>
              <p className="text-[10px] text-gray-500 text-center">
                Formato ideal: proporção 3:4 (300x400)
              </p>
            </div>

            {/* Dados Principais */}
            <div className="md:col-span-8 space-y-4">
              {/* Nome Completo */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Nome Completo da Esposa / Associada *
                </label>
                <input
                  type="text"
                  required
                  value={formData.nome}
                  onChange={e => setFormData(prev => ({ ...prev, nome: e.target.value.toUpperCase() }))}
                  placeholder="EX: MARIA JOSÉ SILVA"
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500 font-semibold"
                />
              </div>

              {/* No AEMADEPA e CPF */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-purple-900 mb-1 flex items-center gap-1">
                    <CreditCard className="w-3.5 h-3.5 text-purple-600" />
                    Número / Matrícula AEMADEPA
                  </label>
                  <input
                    type="text"
                    value={formData.numero_aemadepa}
                    onChange={e => setFormData(prev => ({ ...prev, numero_aemadepa: e.target.value.toUpperCase() }))}
                    placeholder="EX: 1234"
                    className="w-full px-3.5 py-2 text-sm border border-purple-300 rounded-lg bg-purple-50/30 focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono font-bold text-purple-800"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    CPF
                  </label>
                  <input
                    type="text"
                    value={formData.cpf}
                    onChange={e => setFormData(prev => ({ ...prev, cpf: formatCpf(e.target.value) }))}
                    placeholder="000.000.000-00"
                    className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>

              {/* RG, Órgão Emissor e Data de Nascimento */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    RG
                  </label>
                  <input
                    type="text"
                    value={formData.rg}
                    onChange={e => setFormData(prev => ({ ...prev, rg: e.target.value.toUpperCase() }))}
                    placeholder="Número RG"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Órgão Emissor
                  </label>
                  <input
                    type="text"
                    value={formData.orgao_emissor}
                    onChange={e => setFormData(prev => ({ ...prev, orgao_emissor: e.target.value.toUpperCase() }))}
                    placeholder="Ex: SEGUP/PA"
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Data de Nascimento
                  </label>
                  <input
                    type="date"
                    value={formData.data_nascimento}
                    onChange={e => setFormData(prev => ({ ...prev, data_nascimento: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Seção 3: Contatos e Dados Pessoais Complementares */}
          <div className="space-y-4 pt-4 border-t border-gray-200">
            <span className="text-xs font-bold text-gray-700 uppercase tracking-wider block">
              Contatos e Complementos
            </span>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-gray-500" />
                  Telefone / WhatsApp
                </label>
                <input
                  type="text"
                  value={formData.fone}
                  onChange={e => setFormData(prev => ({ ...prev, fone: formatPhone(e.target.value) }))}
                  placeholder="(00) 00000-0000"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-gray-500" />
                  E-Mail
                </label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData(prev => ({ ...prev, email: e.target.value.toLowerCase() }))}
                  placeholder="exemplo@email.com"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Tipo Sanguíneo
                </label>
                <select
                  value={formData.tipo_sanguineo}
                  onChange={e => setFormData(prev => ({ ...prev, tipo_sanguineo: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500 bg-white"
                >
                  <option value="">Selecione...</option>
                  {TIPOS_SANGUINEOS.filter(Boolean).map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Nacionalidade
                </label>
                <input
                  type="text"
                  value={formData.nacionalidade}
                  onChange={e => setFormData(prev => ({ ...prev, nacionalidade: e.target.value.toUpperCase() }))}
                  placeholder="BRASILEIRA"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Naturalidade (Cidade/UF)
                </label>
                <input
                  type="text"
                  value={formData.naturalidade}
                  onChange={e => setFormData(prev => ({ ...prev, naturalidade: e.target.value.toUpperCase() }))}
                  placeholder="Ex: Belém/PA"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Título de Eleitor
                </label>
                <input
                  type="text"
                  value={formData.titulo_eleitoral}
                  onChange={e => setFormData(prev => ({ ...prev, titulo_eleitoral: e.target.value }))}
                  placeholder="Número do título"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>

            {/* Filiação */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Nome do Pai
                </label>
                <input
                  type="text"
                  value={formData.nome_pai}
                  onChange={e => setFormData(prev => ({ ...prev, nome_pai: e.target.value.toUpperCase() }))}
                  placeholder="Nome do pai da associada"
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Nome da Mãe
                </label>
                <input
                  type="text"
                  value={formData.nome_mae}
                  onChange={e => setFormData(prev => ({ ...prev, nome_mae: e.target.value.toUpperCase() }))}
                  placeholder="Nome da mãe da associada"
                  className="w-full px-3.5 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>
            </div>
          </div>

          {/* Footer do Modal */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={salvando}
              className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold text-sm transition disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="px-6 py-2.5 bg-gradient-to-r from-rose-700 to-purple-800 hover:from-rose-800 hover:to-purple-900 text-white font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition flex items-center gap-2 disabled:opacity-60"
            >
              <Save className="w-4 h-4" />
              {salvando ? 'Salvando...' : 'Salvar Associada'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
