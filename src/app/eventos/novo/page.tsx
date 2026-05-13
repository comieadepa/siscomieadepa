'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import PageLayout from '@/components/PageLayout';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { createClient } from '@/lib/supabase-client';
import { normalizePayloadUppercase } from '@/lib/text';
import { authenticatedFetch } from '@/lib/api-client';

// ─── Tipos ───────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo       { id: string; nome: string; supervisao_id: string; }

interface FormData {
  nome: string;
  descricao: string;
  banner_url: string;
  departamento: string;
  data_inicio: string;
  data_fim: string;
  local: string;
  cidade: string;
  supervisao_id: string;
  campo_id: string;
  valor_inscricao: string;
  usar_tipos_inscricao: boolean;
  limite_vagas: string;
  limite_hospedagem: string;
  limite_brindes: string;
  publico_alvo: string;
  link_whatsapp: string;
  mensagem_confirmacao: string;
  permite_hospedagem: boolean;
  permite_alimentacao: boolean;
  permite_brinde: boolean;
  gerar_certificado: boolean;
  inscricoes_abertas: boolean;
  status: string;
  suporte_nome: string;
  suporte_whatsapp: string;
}

interface TipoDraft {
  nome: string;
  valor: string;
  inclui_alimentacao: boolean;
  inclui_hospedagem: boolean;
  ativo: boolean;
}

const TIPOS_PADRAO: TipoDraft[] = [
  { nome: 'Só Plenárias',                         valor: '', inclui_alimentacao: false, inclui_hospedagem: false, ativo: true },
  { nome: 'Plenárias + Alimentação',              valor: '', inclui_alimentacao: true,  inclui_hospedagem: false, ativo: true },
  { nome: 'Plenárias + Alimentação + Hospedagem', valor: '', inclui_alimentacao: true,  inclui_hospedagem: true,  ativo: true },
];

const DEPARTAMENTOS = ['AGO', 'COADESPA', 'UMADESPA', 'SEIADEPA', 'AVULSO'];

const FORM_INICIAL: FormData = {
  nome: '',
  descricao: '',
  banner_url: '',
  departamento: '',
  data_inicio: '',
  data_fim: '',
  local: '',
  cidade: '',
  supervisao_id: '',
  campo_id: '',
  valor_inscricao: '0',
  usar_tipos_inscricao: false,
  limite_vagas: '',
  limite_hospedagem: '',
  limite_brindes: '',
  publico_alvo: '',
  link_whatsapp: '',
  mensagem_confirmacao: '',
  permite_hospedagem: false,
  permite_alimentacao: false,
  permite_brinde: false,
  gerar_certificado: false,
  inscricoes_abertas: false,
  status: 'programado',  suporte_nome: '',
  suporte_whatsapp: '',};

// ─── Gerador de slug ─────────────────────────────────────────
function gerarSlug(nome: string): string {
  return nome
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    + '-' + Date.now();
}

async function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Falha ao carregar imagem.'));
    };
    img.src = url;
  });
}

async function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>(resolve => {
    canvas.toBlob(resolve, type, quality);
  });
}

async function resizeBannerImage(file: File) {
  const img = await loadImageFromFile(file);
  const maxWidth = 1200;
  const scale = img.width > maxWidth ? maxWidth / img.width : 1;
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas não suportado.');
  ctx.drawImage(img, 0, 0, width, height);

  const quality = 0.8;
  let blob = await canvasToBlob(canvas, 'image/webp', quality);
  let type = 'image/webp';
  if (!blob) {
    blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    type = 'image/jpeg';
  }
  if (!blob) {
    blob = await canvasToBlob(canvas, 'image/png');
    type = 'image/png';
  }
  if (!blob) throw new Error('Falha ao processar a imagem.');

  const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
  return { blob, type, ext };
}

// ─── Componente ──────────────────────────────────────────────
export default function NovoEventoPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const perfil = useEventosPerfil();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);

  const [form, setForm] = useState<FormData>(FORM_INICIAL);
  const [tiposDraft, setTiposDraft] = useState<TipoDraft[]>(TIPOS_PADRAO.map(t => ({ ...t })));
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos, setCampos]           = useState<Campo[]>([]);
  const [camposFiltrados, setCamposFiltrados] = useState<Campo[]>([]);
  const [salvando, setSalvando]       = useState(false);
  const [erro, setErro]               = useState<string | null>(null);
  const [bannerPreview, setBannerPreview] = useState('');
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerUploadErro, setBannerUploadErro] = useState<string | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (bannerPreview.startsWith('blob:')) URL.revokeObjectURL(bannerPreview);
    };
  }, [bannerPreview]);

  // Carrega supervisões e campos ao montar
  useEffect(() => {
    if (authLoading) return;
    const loadEstrutura = async () => {
      const res = await authenticatedFetch('/api/v1/estrutura');
      if (!res.ok) return;
      const data = await res.json().catch(() => null as any);
      setSupervisoes((data?.supervisoes as Supervisao[]) || []);
      setCampos((data?.campos as Campo[]) || []);
    };
    loadEstrutura();
  }, [authLoading]);

  // Guard: redireciona se não tem permissão para criar eventos
  useEffect(() => {
    if (!authLoading && !perfil.loading && !perfil.podeNovoEvento) {
      router.push('/eventos');
    }
  }, [authLoading, perfil.loading, perfil.podeNovoEvento, router]);

  // Pré-preenche e trava departamento para isDeptAdmin com dept específico
  useEffect(() => {
    if (!perfil.loading && perfil.isDeptAdmin && perfil.departamentoUsuario && perfil.departamentoUsuario !== 'TODOS') {
      setForm(f => ({ ...f, departamento: perfil.departamentoUsuario! }));
    }
  }, [perfil.loading, perfil.isDeptAdmin, perfil.departamentoUsuario]);

  // Filtra campos pela supervisão selecionada
  useEffect(() => {
    if (form.supervisao_id) {
      setCamposFiltrados(campos.filter(c => c.supervisao_id === form.supervisao_id));
    } else {
      setCamposFiltrados(campos);
    }
    // Limpa campo se não pertence mais à supervisão selecionada
    if (form.campo_id && form.supervisao_id) {
      const pertence = campos.some(
        c => c.id === form.campo_id && c.supervisao_id === form.supervisao_id
      );
      if (!pertence) setForm(f => ({ ...f, campo_id: '' }));
    }
  }, [form.supervisao_id, form.campo_id, campos]);

  if (authLoading || perfil.loading) return <div className="p-8 text-gray-500">Carregando...</div>;

  // ─── Handlers ──────────────────────────────────────────────
  function handleText(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  }

  function handleCheck(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, checked } = e.target;
    setForm(f => ({ ...f, [name]: checked }));
  }

  function setBannerPreviewSafe(nextUrl: string) {
    setBannerPreview(prev => {
      if (prev.startsWith('blob:')) URL.revokeObjectURL(prev);
      return nextUrl;
    });
  }

  async function handleBannerChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      setBannerUploadErro('Tipo de arquivo não suportado. Use PNG, JPG ou WebP.');
      return;
    }

    setBannerUploadErro(null);
    setBannerUploading(true);

    try {
      const { blob, type, ext } = await resizeBannerImage(file);
      const previewUrl = URL.createObjectURL(blob);
      setBannerPreviewSafe(previewUrl);

      const uploadFile = new File([blob], `banner.${ext}`, { type });
      const formData = new FormData();
      formData.append('file', uploadFile);

      const res = await fetch('/api/eventos/banner/upload', {
        method: 'POST',
        body: formData,
      });
      const json = await res.json();
      if (!res.ok || !json?.url) {
        throw new Error(json?.error || 'Erro ao fazer upload do banner.');
      }

      setForm(f => ({ ...f, banner_url: json.url }));
      setBannerPreviewSafe(json.url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setBannerUploadErro(msg);
    } finally {
      setBannerUploading(false);
      if (bannerInputRef.current) bannerInputRef.current.value = '';
    }
  }

  function handleBannerRemove() {
    setForm(f => ({ ...f, banner_url: '' }));
    setBannerPreviewSafe('');
    setBannerUploadErro(null);
    if (bannerInputRef.current) bannerInputRef.current.value = '';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro(null);

    // Validações básicas
    if (!form.nome.trim())        return setErro('O nome do evento é obrigatório.');
    if (!form.departamento)       return setErro('Selecione um departamento.');
    if (!form.data_inicio)        return setErro('A data de início é obrigatória.');
    if (!form.data_fim)           return setErro('A data de fim é obrigatória.');
    if (bannerUploading)          return setErro('Aguarde o upload do banner terminar.');
    if (form.data_fim < form.data_inicio)
      return setErro('A data de fim não pode ser anterior à data de início.');
    // Validação de segurança: isDeptAdmin não pode criar evento fora do seu dept
    if (perfil.isDeptAdmin && perfil.departamentoUsuario && form.departamento !== perfil.departamentoUsuario)
      return setErro(`Você só pode criar eventos para o departamento ${perfil.departamentoUsuario}.`);

    setSalvando(true);
    try {
      const payload = normalizePayloadUppercase({
        nome:                   form.nome.trim(),
        slug:                   gerarSlug(form.nome.trim()),
        descricao:              form.descricao.trim() || null,
        banner_url:             form.banner_url.trim() || null,
        departamento:           form.departamento,
        data_inicio:            form.data_inicio,
        data_fim:               form.data_fim,
        local:                  form.local.trim()     || null,
        cidade:                 form.cidade.trim()    || null,
        supervisao_id:          form.supervisao_id    || null,
        campo_id:               form.campo_id         || null,
        valor_inscricao:        form.usar_tipos_inscricao ? 0 : (parseFloat(form.valor_inscricao) || 0),
        usar_tipos_inscricao:   form.usar_tipos_inscricao,
        permite_hospedagem:     form.permite_hospedagem,
        permite_alimentacao:    form.permite_alimentacao,
        permite_brinde:         form.permite_brinde,
        gerar_certificado:      form.gerar_certificado,
        link_whatsapp:          form.link_whatsapp.trim()          || null,
        mensagem_confirmacao:   form.mensagem_confirmacao.trim()   || null,
        inscricoes_abertas:     form.inscricoes_abertas,
        suporte_nome:           form.suporte_nome.trim()           || null,
        suporte_whatsapp:       form.suporte_whatsapp.trim().replace(/\D/g, '') || null,
        limite_vagas:           form.limite_vagas ? parseInt(form.limite_vagas) : null,
        limite_hospedagem:      form.limite_hospedagem ? parseInt(form.limite_hospedagem) : null,
        limite_brindes:         form.limite_brindes ? parseInt(form.limite_brindes) : null,
        publico_alvo:           form.publico_alvo.trim() || null,
        status:                 form.status,
      });

      const { data: novoEvento, error } = await supabase
        .from('eventos')
        .insert([payload])
        .select('id')
        .single();
      if (error) throw error;

      // Salva tipos de inscrição se a opção estiver ativa
      if (form.usar_tipos_inscricao && novoEvento) {
        const unique = new Map<string, TipoDraft>();
        for (const t of tiposDraft.filter(tp => tp.ativo)) {
          const key = `${t.nome.trim().toLowerCase()}|${t.inclui_alimentacao ? 1 : 0}|${t.inclui_hospedagem ? 1 : 0}`;
          if (!unique.has(key)) unique.set(key, t);
        }
        const tiposPayload = Array.from(unique.values()).map((t, i) => ({
            nome: t.nome.trim() || `Tipo ${i + 1}`,
            valor: parseFloat(t.valor) || 0,
            inclui_alimentacao: t.inclui_alimentacao,
            inclui_hospedagem:  t.inclui_hospedagem,
            ativo: t.ativo,
            ordem: i + 1,
          }));
        await fetch(`/api/eventos/${novoEvento.id}/tipos-inscricao`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipos: tiposPayload }),
        });
      }

      router.push('/eventos');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErro('Erro ao salvar evento: ' + msg);
    } finally {
      setSalvando(false);
    }
  }

  // ─── UI helpers ────────────────────────────────────────────
  const labelClass = 'block text-sm font-semibold text-gray-700 mb-1';
  const inputClass =
    'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] focus:border-transparent bg-white';
  const selectClass = inputClass;

  const CheckboxField = ({
    name, label, checked,
  }: { name: keyof FormData; label: string; checked: boolean }) => (
    <label className="flex items-center gap-3 cursor-pointer group">
      <input
        type="checkbox"
        name={name as string}
        checked={checked}
        onChange={handleCheck}
        className="w-4 h-4 accent-[#123b63] cursor-pointer"
      />
      <span className="text-sm text-gray-700 group-hover:text-[#123b63] transition">{label}</span>
    </label>
  );

  // ─── Render ────────────────────────────────────────────────
  return (
    <PageLayout
      title="Novo Evento"
      description="Preencha os dados para criar um novo evento"
      activeMenu="eventos"
    >
      <form onSubmit={handleSubmit} noValidate>

        {/* Erro global */}
        {erro && (
          <div className="mb-6 bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">
            {erro}
          </div>
        )}

        {/* ── SEÇÃO 1: Identificação ─────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-[#F39C12] text-xl">📋</span>
            <h2 className="text-base font-bold text-[#123b63]">Identificação do Evento</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Nome */}
            <div className="md:col-span-2">
              <label className={labelClass} htmlFor="nome">Nome do Evento *</label>
              <input
                id="nome" name="nome" type="text"
                value={form.nome} onChange={handleText}
                placeholder="Ex: Congresso Estadual UMADESPA 2026"
                className={inputClass}
                required
              />
            </div>

            {/* Departamento */}
            <div>
              <label className={labelClass} htmlFor="departamento">Departamento *</label>
              <select
                id="departamento" name="departamento"
                value={form.departamento} onChange={handleText}
                className={selectClass}
                disabled={perfil.isDeptAdmin && perfil.departamentoUsuario !== 'TODOS'}
                required
              >
                <option value="">Selecione...</option>
                {DEPARTAMENTOS.map(d => (
                  <option key={d} value={d}>{d}</option>
                ))}
              </select>
              {perfil.isDeptAdmin && (
                <p className="mt-1 text-xs text-gray-400">Departamento fixo para o seu perfil.</p>
              )}
            </div>

            {/* Status */}
            <div>
              <label className={labelClass} htmlFor="status">Status</label>
              <select
                id="status" name="status"
                value={form.status} onChange={handleText}
                className={selectClass}
              >
                <option value="programado">Programado</option>
                <option value="realizado">Realizado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>

            {/* Público-alvo */}
            <div className="md:col-span-2">
              <label className={labelClass} htmlFor="publico_alvo">Público-alvo</label>
              <input
                id="publico_alvo" name="publico_alvo" type="text"
                value={form.publico_alvo} onChange={handleText}
                placeholder="Ex: Jovens, Pastores, Mulheres..."
                className={inputClass}
              />
            </div>

            {/* Descrição */}
            <div className="md:col-span-2">
              <label className={labelClass} htmlFor="descricao">Descrição do Evento</label>
              <textarea
                id="descricao" name="descricao"
                value={form.descricao} onChange={handleText}
                rows={7}
                placeholder="Descreva o evento em detalhes: programação, horários, palestrantes, instruções gerais...\n\nEste texto é exibido na página pública e usado pelo Assistente IA para responder perguntas."
                className={inputClass + ' resize-y'}
              />
              <p className="text-xs text-gray-400 mt-1">Preserve as quebras de linha. Este conteúdo alimenta o Assistente IA.</p>
            </div>

            {/* Banner */}
            <div className="md:col-span-2">
              <label className={labelClass}>Banner do Evento</label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={bannerInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={handleBannerChange}
                />
                <button
                  type="button"
                  onClick={() => bannerInputRef.current?.click()}
                  disabled={bannerUploading}
                  className="px-3 py-2 text-sm font-semibold rounded-lg border border-gray-300 text-gray-700 bg-white hover:border-[#123b63] hover:text-[#123b63] transition disabled:opacity-60"
                >
                  {form.banner_url ? 'Trocar banner' : 'Fazer upload'}
                </button>
                {form.banner_url && (
                  <button
                    type="button"
                    onClick={handleBannerRemove}
                    className="px-3 py-2 text-sm font-semibold rounded-lg border border-red-200 text-red-600 bg-white hover:border-red-300 hover:text-red-700 transition"
                  >
                    Remover
                  </button>
                )}
                {bannerUploading && (
                  <span className="text-xs text-gray-500">Enviando...</span>
                )}
              </div>
              <p className="text-xs text-gray-400 mt-1">Tamanho recomendado: 1200 × 360 px (proporção 10:3). Aceita PNG, JPG ou WebP.</p>
              {bannerUploadErro && (
                <p className="text-xs text-red-600 mt-1">{bannerUploadErro}</p>
              )}
              {(bannerPreview || form.banner_url.trim()) && (
                <div className="mt-3 rounded-lg overflow-hidden border border-gray-200 h-32 bg-gray-50">
                  <img
                    src={bannerPreview || form.banner_url.trim()}
                    alt="Preview do banner"
                    className="w-full h-full object-cover"
                  />
                </div>
              )}
            </div>

          </div>
        </div>

        {/* ── SEÇÃO 2: Datas e Local ─────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-[#F39C12] text-xl">📅</span>
            <h2 className="text-base font-bold text-[#123b63]">Datas e Local</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">

            <div>
              <label className={labelClass} htmlFor="data_inicio">Data de Início *</label>
              <input
                id="data_inicio" name="data_inicio" type="date"
                value={form.data_inicio} onChange={handleText}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="data_fim">Data de Fim *</label>
              <input
                id="data_fim" name="data_fim" type="date"
                value={form.data_fim} onChange={handleText}
                className={inputClass}
                required
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="local">Local / Espaço</label>
              <input
                id="local" name="local" type="text"
                value={form.local} onChange={handleText}
                placeholder="Ex: Igreja Sede, Ginásio Municipal..."
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="cidade">Cidade</label>
              <input
                id="cidade" name="cidade" type="text"
                value={form.cidade} onChange={handleText}
                placeholder="Ex: Belém - PA"
                className={inputClass}
              />
            </div>

          </div>
        </div>

        {/* ── SEÇÃO 3: Vínculo Hierárquico ──────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-[#F39C12] text-xl">🗂️</span>
            <h2 className="text-base font-bold text-[#123b63]">Vínculo Hierárquico (Opcional)</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">

            <div>
              <label className={labelClass} htmlFor="supervisao_id">Supervisão</label>
              <select
                id="supervisao_id" name="supervisao_id"
                value={form.supervisao_id} onChange={handleText}
                className={selectClass}
              >
                <option value="">Todas / Não vinculado</option>
                {supervisoes.map(s => (
                  <option key={s.id} value={s.id}>{s.nome}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelClass} htmlFor="campo_id">Campo</label>
              <select
                id="campo_id" name="campo_id"
                value={form.campo_id} onChange={handleText}
                className={selectClass}
              >
                <option value="">Todos / Não vinculado</option>
                {camposFiltrados.map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>

          </div>
        </div>

        {/* ── SEÇÃO 4: Inscrições ─────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-[#F39C12] text-xl">🎟️</span>
            <h2 className="text-base font-bold text-[#123b63]">Inscrições</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* Toggle: valor único ou tipos */}
            <div className="md:col-span-2">
              <CheckboxField
                name="usar_tipos_inscricao"
                label="Usar tipos de inscrição (Plenárias, Alimentação, Hospedagem)"
                checked={form.usar_tipos_inscricao}
              />
              <p className="mt-1 text-xs text-gray-400 ml-7">
                {form.usar_tipos_inscricao
                  ? 'Configure abaixo os tipos disponíveis para os inscritos escolherem.'
                  : 'Todos os inscritos pagam o mesmo valor.'}
              </p>
            </div>

            {/* Valor único — exibido quando NÃO usa tipos */}
            {!form.usar_tipos_inscricao && (
              <div>
                <label className={labelClass} htmlFor="valor_inscricao">Valor da Inscrição (R$)</label>
                <input
                  id="valor_inscricao" name="valor_inscricao" type="number"
                  min="0" step="0.01"
                  value={form.valor_inscricao} onChange={handleText}
                  className={inputClass}
                />
              </div>
            )}

            {/* Editor de tipos — exibido quando usa tipos */}
            {form.usar_tipos_inscricao && (
              <div className="md:col-span-2">
                <p className={labelClass}>Tipos de Inscrição</p>
                <div className="space-y-3 mt-2">
                  {tiposDraft.map((tipo, i) => (
                    <div
                      key={i}
                      className={`border rounded-xl p-4 transition ${tipo.ativo ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}
                    >
                      <div className="flex flex-wrap items-center gap-3">
                        {/* Ativo */}
                        <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={tipo.ativo}
                            onChange={e => setTiposDraft(prev => prev.map((t, j) => j === i ? { ...t, ativo: e.target.checked } : t))}
                            className="w-4 h-4 accent-[#123b63]"
                          />
                          <span className="text-xs font-semibold text-gray-600">Ativo</span>
                        </label>

                        {/* Nome */}
                        <input
                          value={tipo.nome}
                          onChange={e => setTiposDraft(prev => prev.map((t, j) => j === i ? { ...t, nome: e.target.value } : t))}
                          className="flex-1 min-w-[180px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
                          placeholder="Nome do tipo"
                          disabled={!tipo.ativo}
                        />

                        {/* Valor */}
                        <div className="flex items-center gap-1 w-32">
                          <span className="text-xs text-gray-400 shrink-0">R$</span>
                          <input
                            type="number" min="0" step="0.01"
                            value={tipo.valor}
                            onChange={e => setTiposDraft(prev => prev.map((t, j) => j === i ? { ...t, valor: e.target.value } : t))}
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
                            placeholder="0.00"
                            disabled={!tipo.ativo}
                          />
                        </div>

                        {/* Inclui Alimentação */}
                        <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={tipo.inclui_alimentacao}
                            onChange={e => setTiposDraft(prev => prev.map((t, j) => j === i ? { ...t, inclui_alimentacao: e.target.checked } : t))}
                            className="w-4 h-4 accent-[#123b63]"
                            disabled={!tipo.ativo}
                          />
                          <span className="text-xs text-gray-600">🍽️ Alimentação</span>
                        </label>

                        {/* Inclui Hospedagem */}
                        <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={tipo.inclui_hospedagem}
                            onChange={e => setTiposDraft(prev => prev.map((t, j) => j === i ? { ...t, inclui_hospedagem: e.target.checked } : t))}
                            className="w-4 h-4 accent-[#123b63]"
                            disabled={!tipo.ativo}
                          />
                          <span className="text-xs text-gray-600">🏨 Hospedagem</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  Ative apenas os tipos que o evento oferece. Hospedagem e alimentação são marcadas automaticamente na inscrição conforme o tipo escolhido.
                </p>
              </div>
            )}

            <div>
              <label className={labelClass} htmlFor="limite_vagas">Limite de Vagas</label>
              <input
                id="limite_vagas" name="limite_vagas" type="number"
                min="1" step="1"
                value={form.limite_vagas} onChange={handleText}
                placeholder="Deixe vazio para ilimitado"
                className={inputClass}
              />
            </div>

            {form.permite_hospedagem && (
              <div>
                <label className={labelClass} htmlFor="limite_hospedagem">Limite de Vagas — Hospedagem</label>
                <input
                  id="limite_hospedagem" name="limite_hospedagem" type="number"
                  min="1" step="1"
                  value={form.limite_hospedagem} onChange={handleText}
                  placeholder="Deixe vazio para ilimitado"
                  className={inputClass}
                />
              </div>
            )}

            {form.permite_brinde && (
              <div>
                <label className={labelClass} htmlFor="limite_brindes">Limite de Brindes</label>
                <input
                  id="limite_brindes" name="limite_brindes" type="number"
                  min="1" step="1"
                  value={form.limite_brindes} onChange={handleText}
                  placeholder="Deixe vazio para ilimitado"
                  className={inputClass}
                />
              </div>
            )}

            {/* Checkboxes de serviços */}
            <div className="md:col-span-2">
              <p className={labelClass}>Serviços incluídos</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
                <CheckboxField name="permite_hospedagem"  label="Hospedagem"  checked={form.permite_hospedagem}  />
                <CheckboxField name="permite_alimentacao" label="Alimentação"  checked={form.permite_alimentacao} />
                <CheckboxField name="permite_brinde"      label="Brinde"       checked={form.permite_brinde}      />
                <CheckboxField name="gerar_certificado"   label="Certificado"  checked={form.gerar_certificado}   />
              </div>
            </div>

            {/* Inscrições abertas */}
            <div className="md:col-span-2">
              <CheckboxField name="inscricoes_abertas" label="Inscrições abertas ao público" checked={form.inscricoes_abertas} />
            </div>

          </div>
        </div>

        {/* ── SEÇÃO 5: Comunicação ───────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-[#F39C12] text-xl">💬</span>
            <h2 className="text-base font-bold text-[#123b63]">Comunicação</h2>
          </div>
          <div className="p-6 grid grid-cols-1 gap-5">

            {/* Link WhatsApp */}
            <div>
              <label className={labelClass} htmlFor="link_whatsapp">Link do Grupo WhatsApp</label>
              <input
                id="link_whatsapp" name="link_whatsapp" type="url"
                value={form.link_whatsapp} onChange={handleText}
                placeholder="https://chat.whatsapp.com/..."
                className={inputClass}
              />
            </div>

            {/* Mensagem de confirmação */}
            <div>
              <label className={labelClass} htmlFor="mensagem_confirmacao">
                Mensagem de Confirmação de Inscrição
              </label>
              <textarea
                id="mensagem_confirmacao"
                name="mensagem_confirmacao"
                value={form.mensagem_confirmacao}
                onChange={handleText}
                rows={6}
                placeholder={`Ex: Olá, {NOME}! Sua inscrição no {EVENTO} foi confirmada com sucesso.\n\nEntrar no grupo: {LINK_GRUPO}\nSeu QR Code de credenciamento: {QR_CODE}`}
                className={inputClass + ' resize-y font-mono text-sm'}
              />
              <p className="mt-2 text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                <span className="font-semibold text-[#123b63]">Variáveis disponíveis futuramente:</span>
                {' '}
                <code className="bg-white border border-gray-200 rounded px-1 text-[#123b63]">{'{NOME}'}</code>,{' '}
                <code className="bg-white border border-gray-200 rounded px-1 text-[#123b63]">{'{EVENTO}'}</code>,{' '}
                <code className="bg-white border border-gray-200 rounded px-1 text-[#123b63]">{'{LINK_GRUPO}'}</code>,{' '}
                <code className="bg-white border border-gray-200 rounded px-1 text-[#123b63]">{'{QR_CODE}'}</code>
                <br />
                Essas variáveis serão substituídas automaticamente no e-mail de confirmação, no WhatsApp, no comprovante e no credenciamento.
              </p>
            </div>

          </div>
        </div>

        {/* ── SEÇÃO 6: Suporte do Evento ─────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-emerald-600 text-xl">📱</span>
            <h2 className="text-base font-bold text-[#123b63]">Suporte do Evento</h2>
            <span className="text-xs text-gray-400 ml-1">(exibido na página pública e no assistente)</span>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass} htmlFor="suporte_nome">Nome / Setor de Suporte</label>
              <input
                id="suporte_nome" name="suporte_nome" type="text"
                value={form.suporte_nome} onChange={handleText}
                placeholder='Ex: Secretaria UMADESPA ou Equipe de Inscrição'
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="suporte_whatsapp">WhatsApp de Suporte</label>
              <input
                id="suporte_whatsapp" name="suporte_whatsapp" type="tel"
                value={form.suporte_whatsapp} onChange={handleText}
                placeholder='(91) 99999-9999'
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">Somente números serão salvos. Será gerado um link wa.me automático.</p>
            </div>
          </div>
        </div>

        {/* ── Ações ──────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push('/eventos')}
            className="w-full sm:w-auto px-6 py-2.5 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 transition"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="w-full sm:w-auto px-8 py-2.5 rounded-lg bg-[#123b63] text-white text-sm font-semibold hover:bg-[#0f2a45] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {salvando ? (
              <>
                <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Salvando...
              </>
            ) : (
              '✅ Salvar Evento'
            )}
          </button>
        </div>

      </form>
    </PageLayout>
  );
}
