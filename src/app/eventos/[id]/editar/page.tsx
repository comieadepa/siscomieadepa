'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useParams } from 'next/navigation';
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
  quantidade_refeicoes_str: string;
  ativo: boolean;
}

// ─── Tipos AGO ───────────────────────────────────────────────
interface AgoCategoriaDraft {
  key: string;
  nome: string;
  valor_str: string;
  cortesia: boolean;
  ativo: boolean;
  limite_vagas_str: string;
  inclui_alimentacao: boolean;
  quantidade_refeicoes_str: string;
}

interface SetorHospedagem {
  id: string;
  nome: string;
  grupo: string;
  tipos_leito: ('beliche' | 'colchonete' | 'rede')[];
  quantidade_leitos: number;
  quantidade_leitos_inferiores: number;
  observacoes: string;
  ativo: boolean;
}

interface AgoHospedagemConfig {
  enabled: boolean;
  grupos: string[];
  leitos_inferiores_preferenciais: boolean;
  preferencia_60_mais: boolean;
  preferencia_necessidade_especial: boolean;
  observacoes: string;
  habilitar_controle_plenarias: boolean;
  plenarias_datas: string[];
  habilitar_desconto_campo_missionario: boolean;
  valor_pastor_presidente_campo_missionario: string;
  valor_esposa_campo_missionario: string;
  setores: SetorHospedagem[];
}

const AGO_CATEGORIAS_DEFAULT: AgoCategoriaDraft[] = [
  { key: 'pastor_presidente',        nome: 'Pastor Presidente',           valor_str: '470.00', cortesia: false, ativo: true, limite_vagas_str: '', inclui_alimentacao: true,  quantidade_refeicoes_str: '15' },
  { key: 'esposa_pastor_presidente', nome: 'Esposa de Pastor Presidente', valor_str: '210.00', cortesia: false, ativo: true, limite_vagas_str: '', inclui_alimentacao: true,  quantidade_refeicoes_str: '15' },
  { key: 'pastor_auxiliar',          nome: 'Pastor Auxiliar',             valor_str: '210.00', cortesia: false, ativo: true, limite_vagas_str: '', inclui_alimentacao: true,  quantidade_refeicoes_str: '15' },
  { key: 'esposa_pastor_auxiliar',   nome: 'Esposa de Pastor Auxiliar',   valor_str: '130.00', cortesia: false, ativo: true, limite_vagas_str: '', inclui_alimentacao: true,  quantidade_refeicoes_str: '15' },
  { key: 'visitante',                nome: 'Visitante',                   valor_str: '210.00', cortesia: false, ativo: true, limite_vagas_str: '', inclui_alimentacao: true,  quantidade_refeicoes_str: '15' },
  { key: 'juventude_comieadepa',     nome: 'Juventude COMIEADEPA',        valor_str: '130.00', cortesia: false, ativo: true, limite_vagas_str: '', inclui_alimentacao: true,  quantidade_refeicoes_str: '15' },
  { key: 'pastor_jubilado',          nome: 'Pastor Jubilado',             valor_str: '0.00',   cortesia: true,  ativo: true, limite_vagas_str: '', inclui_alimentacao: true,  quantidade_refeicoes_str: '15' },
  { key: 'viuva',                    nome: 'Viúva',                       valor_str: '0.00',   cortesia: true,  ativo: true, limite_vagas_str: '', inclui_alimentacao: false, quantidade_refeicoes_str: '0'  },
  { key: 'esposa_pastor_jubilado',   nome: 'Esposa de Pastor Jubilado',   valor_str: '0.00',   cortesia: true,  ativo: true, limite_vagas_str: '', inclui_alimentacao: false, quantidade_refeicoes_str: '0'  },
];

const AGO_HOSP_DEFAULT: AgoHospedagemConfig = {
  enabled: false,
  grupos: ['Pastor Presidente / Pastor Jubilado', 'Pastor Auxiliar / Juventude', 'Mulheres'],
  leitos_inferiores_preferenciais: true,
  preferencia_60_mais: true,
  preferencia_necessidade_especial: true,
  observacoes: '',
  habilitar_controle_plenarias: true,
  plenarias_datas: [],
  habilitar_desconto_campo_missionario: false,
  valor_pastor_presidente_campo_missionario: '210.00',
  valor_esposa_campo_missionario: '210.00',
  setores: [],
};

const TIPOS_PADRAO: TipoDraft[] = [
  { nome: 'So Plenarias',                         valor: '', inclui_alimentacao: false, inclui_hospedagem: false, quantidade_refeicoes_str: '0',  ativo: true },
  { nome: 'Plenarias + Alimentacao',              valor: '', inclui_alimentacao: true,  inclui_hospedagem: false, quantidade_refeicoes_str: '15', ativo: true },
  { nome: 'Plenarias + Alimentacao + Hospedagem', valor: '', inclui_alimentacao: true,  inclui_hospedagem: true,  quantidade_refeicoes_str: '15', ativo: true },
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
  status: 'programado',
  suporte_nome: '',
  suporte_whatsapp: '',
};

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
export default function EditarEventoPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const perfil = useEventosPerfil();
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const supabase = useMemo(() => createClient(), []);

  const [form, setForm] = useState<FormData>(FORM_INICIAL);
  const [tiposDraft, setTiposDraft] = useState<TipoDraft[]>(TIPOS_PADRAO.map(t => ({ ...t })));
  const [agoCategorias, setAgoCategorias] = useState<AgoCategoriaDraft[]>(AGO_CATEGORIAS_DEFAULT.map(c => ({ ...c })));
  const [agoHospConfig, setAgoHospConfig] = useState<AgoHospedagemConfig>({ ...AGO_HOSP_DEFAULT });
  const [savedSetorSnapshots, setSavedSetorSnapshots] = useState<Record<string, string>>({});
  const isAGO = form.departamento === 'AGO';
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos, setCampos]           = useState<Campo[]>([]);
  const [camposFiltrados, setCamposFiltrados] = useState<Campo[]>([]);
  const [salvando, setSalvando]       = useState(false);
  const [erro, setErro]               = useState<string | null>(null);
  const [loadingEvento, setLoadingEvento] = useState(true);
  const [bannerPreview, setBannerPreview] = useState('');
  const [bannerUploading, setBannerUploading] = useState(false);
  const [bannerUploadErro, setBannerUploadErro] = useState<string | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Carrega supervisoes e campos ao montar
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

  // Guard: redireciona se nao tem permissao para editar eventos
  useEffect(() => {
    if (!authLoading && !perfil.loading && !perfil.podeEditar && id) {
      router.push(`/eventos/${id}`);
    }
  }, [authLoading, perfil.loading, perfil.podeEditar, router, id]);

  useEffect(() => {
    return () => {
      if (bannerPreview.startsWith('blob:')) URL.revokeObjectURL(bannerPreview);
    };
  }, [bannerPreview]);

  // Carrega evento para edicao
  useEffect(() => {
    if (authLoading || perfil.loading || !id) return;

    async function loadEvento() {
      setLoadingEvento(true);
      const { data, error } = await supabase.from('eventos').select('*').eq('id', id).single();
      if (error || !data) {
        setErro('Evento nao encontrado.');
        setLoadingEvento(false);
        return;
      }

      if (perfil.isDeptAdmin && perfil.departamentoUsuario !== 'TODOS' && data.departamento !== perfil.departamentoUsuario) {
        setErro(`Voce so pode editar eventos do departamento ${perfil.departamentoUsuario}.`);
        setLoadingEvento(false);
        return;
      }

      setForm({
        nome: data.nome ?? '',
        descricao: data.descricao ?? '',
        banner_url: data.banner_url ?? '',
        departamento: data.departamento ?? '',
        data_inicio: data.data_inicio ?? '',
        data_fim: data.data_fim ?? '',
        local: data.local ?? '',
        cidade: data.cidade ?? '',
        supervisao_id: data.supervisao_id ?? '',
        campo_id: data.campo_id ?? '',
        valor_inscricao: String(data.valor_inscricao ?? 0),
        usar_tipos_inscricao: !!data.usar_tipos_inscricao,
        limite_vagas: data.limite_vagas ? String(data.limite_vagas) : '',
        limite_hospedagem: data.limite_hospedagem ? String(data.limite_hospedagem) : '',
        limite_brindes: data.limite_brindes ? String(data.limite_brindes) : '',
        publico_alvo: data.publico_alvo ?? '',
        link_whatsapp: data.link_whatsapp ?? '',
        mensagem_confirmacao: data.mensagem_confirmacao ?? '',
        permite_hospedagem: !!data.permite_hospedagem,
        permite_alimentacao: !!data.permite_alimentacao,
        permite_brinde: !!data.permite_brinde,
        gerar_certificado: !!data.gerar_certificado,
        inscricoes_abertas: !!data.inscricoes_abertas,
        status: data.status ?? 'programado',
        suporte_nome: data.suporte_nome ?? '',
        suporte_whatsapp: data.suporte_whatsapp ?? '',
      });
      if (data.banner_url) setBannerPreview(data.banner_url);

      // Configura hospedagem AGO se disponivel
      if (data.departamento === 'AGO' && data.configuracoes_ago) {
        const cfg = data.configuracoes_ago as AgoHospedagemConfig;
        setAgoHospConfig({
          enabled:                          true,
          grupos:                           Array.isArray(cfg.grupos) ? cfg.grupos : AGO_HOSP_DEFAULT.grupos,
          leitos_inferiores_preferenciais:  cfg.leitos_inferiores_preferenciais ?? true,
          preferencia_60_mais:              cfg.preferencia_60_mais ?? true,
          preferencia_necessidade_especial: cfg.preferencia_necessidade_especial ?? true,
          observacoes:                      cfg.observacoes ?? '',
          habilitar_controle_plenarias:     (cfg as any).habilitar_controle_plenarias ?? true,
          plenarias_datas:                  Array.isArray((cfg as any).plenarias_datas) ? (cfg as any).plenarias_datas : [],
          habilitar_desconto_campo_missionario: (cfg as any).habilitar_desconto_campo_missionario ?? false,
          valor_pastor_presidente_campo_missionario: (cfg as any).valor_pastor_presidente_campo_missionario ?? '210.00',
          valor_esposa_campo_missionario: (cfg as any).valor_esposa_campo_missionario ?? (cfg as any).campo_missionario?.valor_esposa ?? '210.00',
          setores: Array.isArray((cfg as any).setores) ? (cfg as any).setores : [],
        });
        if (Array.isArray((cfg as any).setores) && (cfg as any).setores.length > 0) {
          const snaps: Record<string, string> = {};
          for (const s of (cfg as any).setores) { snaps[s.id] = JSON.stringify(s); }
          setSavedSetorSnapshots(snaps);
        }
      }

      // Tipos de inscricao
      try {
        const res = await fetch(`/api/eventos/${id}/tipos-inscricao`);
        if (res.ok) {
          const j = await res.json();
          const tipos = (j.tipos ?? []) as Array<{
            nome: string; valor: number;
            inclui_alimentacao: boolean; inclui_hospedagem: boolean;
            cortesia: boolean; limite_vagas: number | null; ativo: boolean;
            quantidade_refeicoes: number;
          }>;
          if (tipos.length > 0) {
            if (data.departamento === 'AGO') {
              // Mapeia para AgoCategoriaDraft preservando dados salvos
              const mapped = tipos.map((t, i) => {
                const def = AGO_CATEGORIAS_DEFAULT.find(
                  d => d.nome.toUpperCase() === (t.nome ?? '').toUpperCase()
                );
                return {
                  key: def?.key ?? `custom_${i}`,
                  nome: t.nome ?? '',
                  valor_str: String(t.valor ?? 0),
                  cortesia: !!t.cortesia,
                  ativo: t.ativo !== false,
                  limite_vagas_str: t.limite_vagas != null ? String(t.limite_vagas) : '',
                  inclui_alimentacao: !!t.inclui_alimentacao,
                  quantidade_refeicoes_str: String(t.quantidade_refeicoes ?? '0'),
                };
              });
              setAgoCategorias(mapped);
            } else {
              const unique = new Map<string, typeof tipos[0]>();
              for (const t of tipos) {
                const key = `${String(t.nome ?? '').trim().toLowerCase()}|${t.inclui_alimentacao ? 1 : 0}|${t.inclui_hospedagem ? 1 : 0}`;
                if (!unique.has(key)) unique.set(key, t);
              }
              const deduped = Array.from(unique.values());
              setTiposDraft(deduped.map(t => ({
                nome: t.nome ?? '',
                valor: String(t.valor ?? ''),
                inclui_alimentacao: !!t.inclui_alimentacao,
                inclui_hospedagem: !!t.inclui_hospedagem,
                quantidade_refeicoes_str: String(t.quantidade_refeicoes ?? '0'),
                ativo: t.ativo !== false,
              })));
            }
          } else {
            setTiposDraft(TIPOS_PADRAO.map(t => ({ ...t })));
          }
        }
      } catch {
        setTiposDraft(TIPOS_PADRAO.map(t => ({ ...t })));
      }

      setLoadingEvento(false);
    }

    loadEvento();
  }, [authLoading, perfil.loading, perfil.isDeptAdmin, perfil.departamentoUsuario, id, supabase]);

  // Filtra campos pela supervisao selecionada
  useEffect(() => {
    if (form.supervisao_id) {
      setCamposFiltrados(campos.filter(c => c.supervisao_id === form.supervisao_id));
    } else {
      setCamposFiltrados(campos);
    }
    if (form.campo_id && form.supervisao_id) {
      const pertence = campos.some(
        c => c.id === form.campo_id && c.supervisao_id === form.supervisao_id
      );
      if (!pertence) setForm(f => ({ ...f, campo_id: '' }));
    }
  }, [form.supervisao_id, form.campo_id, campos]);

  // Reset das configs AGO ao trocar departamento para nao-AGO
  useEffect(() => {
    if (form.departamento !== 'AGO') {
      setAgoCategorias(AGO_CATEGORIAS_DEFAULT.map(c => ({ ...c })));
      setAgoHospConfig({ ...AGO_HOSP_DEFAULT });
    }
  }, [form.departamento]);

  if (authLoading || perfil.loading || loadingEvento) {
    return <div className="p-8 text-gray-500">Carregando...</div>;
  }

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

    if (!form.nome.trim())        return setErro('O nome do evento e obrigatorio.');
    if (!form.departamento)       return setErro('Selecione um departamento.');
    if (!form.data_inicio)        return setErro('A data de inicio e obrigatoria.');
    if (!form.data_fim)           return setErro('A data de fim e obrigatoria.');
    if (bannerUploading)          return setErro('Aguarde o upload do banner terminar.');
    if (form.data_fim < form.data_inicio)
      return setErro('A data de fim nao pode ser anterior a data de inicio.');
    if (perfil.isDeptAdmin && perfil.departamentoUsuario && form.departamento !== perfil.departamentoUsuario)
      return setErro(`Voce so pode editar eventos do departamento ${perfil.departamentoUsuario}.`);

    setSalvando(true);
    try {
      const payload = normalizePayloadUppercase({
        nome:                   form.nome.trim(),
        descricao:              form.descricao.trim() || null,
        banner_url:             form.banner_url.trim() || null,
        departamento:           form.departamento,
        data_inicio:            form.data_inicio,
        data_fim:               form.data_fim,
        local:                  form.local.trim()     || null,
        cidade:                 form.cidade.trim()    || null,
        supervisao_id:          form.supervisao_id    || null,
        campo_id:               form.campo_id         || null,
        valor_inscricao:        (form.usar_tipos_inscricao || isAGO) ? 0 : (parseFloat(form.valor_inscricao) || 0),
        usar_tipos_inscricao:   form.usar_tipos_inscricao || isAGO,
        permite_hospedagem:     isAGO ? true : form.permite_hospedagem,
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
        configuracoes_ago:      isAGO ? { ...agoHospConfig, enabled: true, campo_missionario: agoHospConfig.habilitar_desconto_campo_missionario ? { enabled: true, valor_pastor_presidente: parseFloat(agoHospConfig.valor_pastor_presidente_campo_missionario) || 0, valor_esposa: parseFloat(agoHospConfig.valor_esposa_campo_missionario) || 0 } : null } : null,
      });

      const { error } = await supabase
        .from('eventos')
        .update(payload)
        .eq('id', id);
      if (error) throw error;

      // Salva categorias AGO
      if (isAGO) {
        const tiposAGO = agoCategorias
          .filter(c => c.ativo)
          .map((c, i) => ({
            nome: c.nome.trim() || `Categoria ${i + 1}`,
            valor: c.cortesia ? 0 : (parseFloat(c.valor_str) || 0),
            inclui_alimentacao: c.inclui_alimentacao,
            inclui_hospedagem: true,
            cortesia: c.cortesia,
            limite_vagas: c.limite_vagas_str ? parseInt(c.limite_vagas_str) : null,
            quantidade_refeicoes: c.inclui_alimentacao ? (parseInt(c.quantidade_refeicoes_str) || 0) : 0,
            ativo: true,
            ordem: i + 1,
          }));
        await fetch(`/api/eventos/${id}/tipos-inscricao`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipos: tiposAGO }),
        });
      }

      // Salva tipos genericos (nao-AGO)
      if (!isAGO && form.usar_tipos_inscricao) {
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
            quantidade_refeicoes: t.inclui_alimentacao ? (parseInt(t.quantidade_refeicoes_str) || 0) : 0,
            ativo: t.ativo,
            ordem: i + 1,
          }));
        await fetch(`/api/eventos/${id}/tipos-inscricao`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tipos: tiposPayload }),
        });
      }

      router.push(`/eventos/${id}?tab=configuracoes`);
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

  return (
    <PageLayout
      title="Editar Evento"
      description="Atualize os dados do evento"
      activeMenu="eventos"
    >
      <form onSubmit={handleSubmit} noValidate>

        {erro && (
          <div className="mb-6 bg-red-50 border border-red-300 text-red-700 px-4 py-3 rounded-lg text-sm">
            {erro}
          </div>
        )}

        {/* ── SECAO 1: Identificacao ─────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-[#F39C12] text-xl">📋</span>
            <h2 className="text-base font-bold text-[#123b63]">Identificacao do Evento</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">

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

            <div>
              <label className={labelClass} htmlFor="departamento">Departamento *</label>
              <select
                id="departamento" name="departamento"
                value={form.departamento} onChange={handleText}
                className={selectClass}
                disabled={perfil.isDeptAdmin}
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

            <div className="md:col-span-2">
              <label className={labelClass} htmlFor="publico_alvo">Publico-alvo</label>
              <input
                id="publico_alvo" name="publico_alvo" type="text"
                value={form.publico_alvo} onChange={handleText}
                placeholder="Ex: Jovens, Pastores, Mulheres..."
                className={inputClass}
              />
            </div>

            <div className="md:col-span-2">
              <label className={labelClass} htmlFor="descricao">Descricao do Evento</label>
              <textarea
                id="descricao" name="descricao"
                value={form.descricao} onChange={handleText}
                rows={7}
                placeholder="Descreva o evento em detalhes..."
                className={inputClass + ' resize-y'}
              />
              <p className="text-xs text-gray-400 mt-1">Preserve as quebras de linha.</p>
            </div>

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
              <p className="text-xs text-gray-400 mt-1">Tamanho recomendado: 1200 x 360 px. Aceita PNG, JPG ou WebP.</p>
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

        {/* ── SECAO 2: Datas e Local ─────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-[#F39C12] text-xl">📅</span>
            <h2 className="text-base font-bold text-[#123b63]">Datas e Local</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">

            <div>
              <label className={labelClass} htmlFor="data_inicio">Data de Inicio *</label>
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
              <label className={labelClass} htmlFor="local">Local / Espaco</label>
              <input
                id="local" name="local" type="text"
                value={form.local} onChange={handleText}
                placeholder="Ex: Igreja Sede, Ginasio Municipal..."
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="cidade">Cidade</label>
              <input
                id="cidade" name="cidade" type="text"
                value={form.cidade} onChange={handleText}
                placeholder="Ex: Belem - PA"
                className={inputClass}
              />
            </div>

          </div>
        </div>

        {/* ── SECAO 3: Vinculo Hierarquico ──────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-[#F39C12] text-xl">🗂️</span>
            <h2 className="text-base font-bold text-[#123b63]">Vinculo Hierarquico (Opcional)</h2>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">

            <div>
              <label className={labelClass} htmlFor="supervisao_id">Supervisao</label>
              <select
                id="supervisao_id" name="supervisao_id"
                value={form.supervisao_id} onChange={handleText}
                className={selectClass}
              >
                <option value="">Todas / Nao vinculado</option>
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
                <option value="">Todos / Nao vinculado</option>
                {camposFiltrados.map(c => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>

          </div>
        </div>

        {/* ── SECAO 4: Inscricoes ─────────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-[#F39C12] text-xl">🎟️</span>
            <h2 className="text-base font-bold text-[#123b63]">Inscricoes</h2>
            {isAGO && (
              <span className="ml-auto text-xs font-bold bg-amber-100 text-amber-700 border border-amber-300 px-2 py-0.5 rounded-full">
                Formato AGO
              </span>
            )}
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">

            {/* ── Categorias AGO ────────────────────────────────── */}
            {isAGO ? (
              <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <p className={labelClass}>Categorias de Inscricao (AGO)</p>
                  <button
                    type="button"
                    onClick={() => setAgoCategorias(AGO_CATEGORIAS_DEFAULT.map(c => ({ ...c })))}
                    className="text-xs text-[#123b63] underline hover:no-underline"
                  >
                    Restaurar padroes
                  </button>
                </div>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs font-semibold text-gray-500 uppercase">
                      <tr>
                        <th className="px-3 py-2 text-left">Ativo</th>
                        <th className="px-3 py-2 text-left">Categoria</th>
                        <th className="px-3 py-2 text-left">Valor (R$)</th>
                        <th className="px-3 py-2 text-left">Cortesia</th>
                        <th className="px-3 py-2 text-left">🍽️ Alim.</th>
                        <th className="px-3 py-2 text-left">Qtd. Ref.</th>
                        <th className="px-3 py-2 text-left">Limite Vagas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {agoCategorias.map((cat, i) => (
                        <tr key={cat.key} className={cat.ativo ? 'bg-white' : 'bg-gray-50 opacity-60'}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={cat.ativo}
                              onChange={e => setAgoCategorias(prev => prev.map((c, j) => j === i ? { ...c, ativo: e.target.checked } : c))}
                              className="w-4 h-4 accent-[#123b63]"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              value={cat.nome}
                              onChange={e => setAgoCategorias(prev => prev.map((c, j) => j === i ? { ...c, nome: e.target.value } : c))}
                              className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white"
                              disabled={!cat.ativo}
                            />
                          </td>
                          <td className="px-3 py-2 w-28">
                            {cat.cortesia ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-bold rounded-full border border-green-300">
                                🎁 Cortesia
                              </span>
                            ) : (
                              <input
                                type="number" min="0" step="0.01"
                                value={cat.valor_str}
                                onChange={e => setAgoCategorias(prev => prev.map((c, j) => j === i ? { ...c, valor_str: e.target.value } : c))}
                                className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white"
                                disabled={!cat.ativo}
                              />
                            )}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={cat.cortesia}
                              onChange={e => setAgoCategorias(prev => prev.map((c, j) => j === i ? { ...c, cortesia: e.target.checked, valor_str: e.target.checked ? '0.00' : c.valor_str } : c))}
                              className="w-4 h-4 accent-green-600"
                              disabled={!cat.ativo}
                            />
                          </td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={cat.inclui_alimentacao}
                              onChange={e => setAgoCategorias(prev => prev.map((c, j) => j === i ? { ...c, inclui_alimentacao: e.target.checked, quantidade_refeicoes_str: e.target.checked ? (c.quantidade_refeicoes_str || '15') : '0' } : c))}
                              className="w-4 h-4 accent-orange-500"
                              disabled={!cat.ativo}
                            />
                          </td>
                          <td className="px-3 py-2 w-20">
                            {cat.inclui_alimentacao ? (
                              <input
                                type="number" min="1" step="1"
                                value={cat.quantidade_refeicoes_str}
                                onChange={e => setAgoCategorias(prev => prev.map((c, j) => j === i ? { ...c, quantidade_refeicoes_str: e.target.value } : c))}
                                className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white"
                                disabled={!cat.ativo}
                                placeholder="15"
                              />
                            ) : (
                              <span className="text-gray-300 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 w-28">
                            <input
                              type="number" min="1" step="1"
                              value={cat.limite_vagas_str}
                              onChange={e => setAgoCategorias(prev => prev.map((c, j) => j === i ? { ...c, limite_vagas_str: e.target.value } : c))}
                              placeholder="∞"
                              className="w-full border border-gray-200 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white"
                              disabled={!cat.ativo}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  Categorias com <strong>Cortesia</strong> sao gratuitas. Deixe Limite de Vagas vazio para ilimitado.
                </p>
              </div>
            ) : (
              <>
                <div className="md:col-span-2">
                  <CheckboxField
                    name="usar_tipos_inscricao"
                    label="Usar tipos de inscricao (Plenarias, Alimentacao, Hospedagem)"
                    checked={form.usar_tipos_inscricao}
                  />
                  <p className="mt-1 text-xs text-gray-400 ml-7">
                    {form.usar_tipos_inscricao
                      ? 'Configure abaixo os tipos disponiveis para os inscritos escolherem.'
                      : 'Todos os inscritos pagam o mesmo valor.'}
                  </p>
                </div>

                {!form.usar_tipos_inscricao && (
                  <div>
                    <label className={labelClass} htmlFor="valor_inscricao">Valor da Inscricao (R$)</label>
                    <input
                      id="valor_inscricao" name="valor_inscricao" type="number"
                      min="0" step="0.01"
                      value={form.valor_inscricao} onChange={handleText}
                      className={inputClass}
                    />
                  </div>
                )}

                {form.usar_tipos_inscricao && (
                  <div className="md:col-span-2">
                    <p className={labelClass}>Tipos de Inscricao</p>
                    <div className="space-y-3 mt-2">
                      {tiposDraft.map((tipo, i) => (
                        <div
                          key={i}
                          className={`border rounded-xl p-4 transition ${tipo.ativo ? 'border-gray-200 bg-white' : 'border-gray-100 bg-gray-50 opacity-60'}`}
                        >
                          <div className="flex flex-wrap items-center gap-3">
                            <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                              <input
                                type="checkbox"
                                checked={tipo.ativo}
                                onChange={e => setTiposDraft(prev => prev.map((t, j) => j === i ? { ...t, ativo: e.target.checked } : t))}
                                className="w-4 h-4 accent-[#123b63]"
                              />
                              <span className="text-xs font-semibold text-gray-600">Ativo</span>
                            </label>

                            <input
                              value={tipo.nome}
                              onChange={e => setTiposDraft(prev => prev.map((t, j) => j === i ? { ...t, nome: e.target.value } : t))}
                              className="flex-1 min-w-[180px] border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]"
                              placeholder="Nome do tipo"
                              disabled={!tipo.ativo}
                            />

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

                            <label className="flex items-center gap-1.5 cursor-pointer shrink-0">
                              <input
                                type="checkbox"
                                checked={tipo.inclui_alimentacao}
                                onChange={e => setTiposDraft(prev => prev.map((t, j) => j === i ? { ...t, inclui_alimentacao: e.target.checked } : t))}
                                className="w-4 h-4 accent-[#123b63]"
                                disabled={!tipo.ativo}
                              />
                              <span className="text-xs text-gray-600">🍽️ Alimentacao</span>
                            </label>

                            {tipo.inclui_alimentacao && (
                              <div className="flex items-center gap-1 w-28 shrink-0">
                                <span className="text-xs text-gray-400 shrink-0">Ref.:</span>
                                <input
                                  type="number" min="1" step="1"
                                  value={tipo.quantidade_refeicoes_str}
                                  onChange={e => setTiposDraft(prev => prev.map((t, j) => j === i ? { ...t, quantidade_refeicoes_str: e.target.value } : t))}
                                  className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#123b63]"
                                  placeholder="15"
                                  disabled={!tipo.ativo}
                                />
                              </div>
                            )}

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
                      Ative apenas os tipos que o evento oferece.
                    </p>
                  </div>
                )}
              </>
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

            {(form.permite_hospedagem || isAGO) && (
              <div>
                <label className={labelClass} htmlFor="limite_hospedagem">Limite de Vagas - Hospedagem</label>
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

            <div className="md:col-span-2">
              <p className={labelClass}>Servicos incluidos</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-2">
                {!isAGO && !form.usar_tipos_inscricao && (
                  <CheckboxField name="permite_hospedagem"  label="Hospedagem"  checked={form.permite_hospedagem}  />
                )}
                <CheckboxField name="permite_alimentacao" label="Alimentacao"  checked={form.permite_alimentacao} />
                <CheckboxField name="permite_brinde"      label="Brinde"       checked={form.permite_brinde}      />
                <CheckboxField name="gerar_certificado"   label="Certificado"  checked={form.gerar_certificado}   />
              </div>
            </div>

          </div>
        </div>

        {/* ── SECAO 4.5: Hospedagem AGO (somente se isAGO) ───── */}
        {isAGO && (
          <div className="bg-white rounded-xl shadow-sm border border-amber-200 mb-6">
            <div className="px-6 py-4 border-b border-amber-100 flex items-center gap-3">
              <span className="text-amber-500 text-xl">🏨</span>
              <h2 className="text-base font-bold text-[#123b63]">Hospedagem AGO</h2>
            </div>
            <div className="p-6 space-y-5">

              {/* Grupos de hospedagem */}
              <div>
                <p className={labelClass}>Grupos de Hospedagem</p>
                <div className="space-y-2 mt-2">
                  {agoHospConfig.grupos.map((g, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input
                        value={g}
                        onChange={e => setAgoHospConfig(prev => {
                          const grupos = [...prev.grupos];
                          grupos[i] = e.target.value;
                          return { ...prev, grupos };
                        })}
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white"
                        placeholder={`Grupo ${i + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => setAgoHospConfig(prev => ({
                          ...prev,
                          grupos: prev.grupos.filter((_, j) => j !== i),
                        }))}
                        className="text-red-400 hover:text-red-600 text-lg leading-none"
                        title="Remover grupo"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setAgoHospConfig(prev => ({
                    ...prev,
                    grupos: [...prev.grupos, ''],
                  }))}
                  className="mt-2 text-xs text-[#123b63] underline hover:no-underline"
                >
                  + Adicionar grupo
                </button>
              </div>

              {/* Preferencias */}
              <div>
                <p className={labelClass}>Preferencias de Acomodacao</p>
                <div className="space-y-2 mt-2">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agoHospConfig.leitos_inferiores_preferenciais}
                      onChange={e => setAgoHospConfig(prev => ({ ...prev, leitos_inferiores_preferenciais: e.target.checked }))}
                      className="w-4 h-4 accent-[#123b63]"
                    />
                    <span className="text-sm text-gray-700">Leitos inferiores preferenciais disponiveis</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agoHospConfig.preferencia_60_mais}
                      onChange={e => setAgoHospConfig(prev => ({ ...prev, preferencia_60_mais: e.target.checked }))}
                      className="w-4 h-4 accent-[#123b63]"
                    />
                    <span className="text-sm text-gray-700">Preferencia para pessoas com 60 anos ou mais</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agoHospConfig.preferencia_necessidade_especial}
                      onChange={e => setAgoHospConfig(prev => ({ ...prev, preferencia_necessidade_especial: e.target.checked }))}
                      className="w-4 h-4 accent-[#123b63]"
                    />
                    <span className="text-sm text-gray-700">Preferencia para pessoas com necessidade especial</span>
                  </label>
                </div>
              </div>

              {/* Observacoes */}
              <div>
                <label className={labelClass} htmlFor="ago_obs">
                  Observacoes sobre hospedagem (exibidas na pagina de inscricao)
                </label>
                <textarea
                  id="ago_obs"
                  rows={3}
                  value={agoHospConfig.observacoes}
                  onChange={e => setAgoHospConfig(prev => ({ ...prev, observacoes: e.target.value }))}
                  placeholder="Ex: A hospedagem e em dormitorios coletivos separados por grupo..."
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] focus:border-transparent bg-white resize-none"
                />
              </div>

              {/* Setores de Hospedagem */}
              <div className="border border-blue-200 rounded-xl p-4 bg-blue-50">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-bold text-blue-900">🏠 Setores de Hospedagem</p>
                  <button
                    type="button"
                    onClick={() => setAgoHospConfig(c => ({
                      ...c,
                      setores: [...(c.setores || []), {
                        id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                        nome: '',
                        grupo: 'Todos',
                        tipos_leito: ['beliche'],
                        quantidade_leitos: 0,
                        quantidade_leitos_inferiores: 0,
                        observacoes: '',
                        ativo: true,
                      }],
                    }))}
                    className="text-xs bg-blue-700 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-blue-800 transition"
                  >
                    + Adicionar Setor
                  </button>
                </div>

                {/* Aviso confirmação */}
                {(agoHospConfig.setores || []).length > 0 && (
                  <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3 text-xs text-amber-800">
                    <span>💡</span>
                    <span>Confirme cada setor individualmente. Os setores serão <strong>gravados definitivamente ao clicar em &quot;Salvar Evento&quot;</strong>.</span>
                  </div>
                )}

                {/* Resumo de leitos */}
                {(agoHospConfig.setores || []).filter(s => s.ativo).length > 0 && (() => {
                  const atv = (agoHospConfig.setores || []).filter(s => s.ativo);
                  const t = {
                    leitos:     atv.reduce((n, s) => n + (s.quantidade_leitos || 0), 0),
                    beliche:    atv.filter(s => (s.tipos_leito||[]).includes('beliche')).reduce((n, s) => n + (s.quantidade_leitos || 0), 0),
                    colchonete: atv.filter(s => (s.tipos_leito||[]).includes('colchonete')).reduce((n, s) => n + (s.quantidade_leitos || 0), 0),
                    rede:       atv.filter(s => (s.tipos_leito||[]).includes('rede')).reduce((n, s) => n + (s.quantidade_leitos || 0), 0),
                    inferiores: atv.filter(s => (s.tipos_leito||[]).includes('beliche')).reduce((n, s) => n + (s.quantidade_leitos_inferiores || 0), 0),
                  };
                  return (
                    <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-4">
                      {([
                        { label: 'Setores ativos', v: atv.length,   bg: 'bg-blue-100 text-blue-900'      },
                        { label: 'Total leitos',   v: t.leitos,     bg: 'bg-indigo-100 text-indigo-900'  },
                        { label: 'Beliches',       v: t.beliche,    bg: 'bg-purple-100 text-purple-900'  },
                        { label: 'Colchonetes',    v: t.colchonete, bg: 'bg-orange-100 text-orange-900'  },
                        { label: 'Redes',          v: t.rede,       bg: 'bg-emerald-100 text-emerald-900'},
                        { label: 'L. inferiores',  v: t.inferiores, bg: 'bg-pink-100 text-pink-900'      },
                      ] as { label: string; v: number; bg: string }[]).map(card => (
                        <div key={card.label} className={`rounded-lg p-2 text-center ${card.bg}`}>
                          <div className="text-xl font-bold leading-tight">{card.v}</div>
                          <div className="text-xs leading-tight mt-0.5">{card.label}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {(agoHospConfig.setores || []).length === 0 && (
                  <p className="text-xs text-blue-600 text-center py-4 italic">Nenhum setor cadastrado. Clique em "+ Adicionar Setor" para iniciar.</p>
                )}

                <div className="space-y-3">
                  {(agoHospConfig.setores || []).map((setor, idx) => (
                    <div key={setor.id} className={`rounded-xl border p-4 bg-white transition-colors${!setor.ativo ? ' opacity-60' : ''}${(() => { const snap = savedSetorSnapshots[setor.id]; return (!snap || snap !== JSON.stringify(setor)) ? ' border-yellow-400' : ' border-green-400'; })()}`}>
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold text-gray-500 uppercase tracking-wide">
                            Setor #{idx + 1}{!setor.ativo && <span className="text-red-400 ml-2 normal-case">(inativo)</span>}
                          </span>
                          {(() => { const snap = savedSetorSnapshots[setor.id]; return (!snap || snap !== JSON.stringify(setor)) ? (
                            <span className="text-xs bg-yellow-100 text-yellow-800 border border-yellow-300 px-2 py-0.5 rounded-full font-semibold">⚠ Não confirmado</span>
                          ) : (
                            <span className="text-xs bg-green-100 text-green-800 border border-green-300 px-2 py-0.5 rounded-full font-semibold">✓ Confirmado</span>
                          ); })()}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSavedSetorSnapshots(snaps => { const n = { ...snaps }; delete n[setor.id]; return n; });
                            setAgoHospConfig(c => ({ ...c, setores: (c.setores || []).filter((_, j) => j !== idx) }));
                          }}
                          className="text-xs text-red-500 hover:text-red-700 font-semibold"
                        >✕ Remover</button>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Nome do Setor *</label>
                          <input
                            type="text"
                            value={setor.nome}
                            onChange={e => setAgoHospConfig(c => { const s = [...(c.setores||[])]; s[idx] = { ...s[idx], nome: e.target.value }; return { ...c, setores: s }; })}
                            placeholder="Ex: Alojamento Masculino 01, Ginásio, Sala 03"
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Grupo Permitido</label>
                          <select
                            value={setor.grupo}
                            onChange={e => setAgoHospConfig(c => { const s = [...(c.setores||[])]; s[idx] = { ...s[idx], grupo: e.target.value }; return { ...c, setores: s }; })}
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          >
                            <option value="Todos">Todos</option>
                            {agoHospConfig.grupos.map(g => <option key={g} value={g}>{g}</option>)}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Tipos de Leito</label>
                          <div className="flex flex-wrap gap-4 mt-1">
                            {(['beliche', 'colchonete', 'rede'] as const).map(tipo => (
                              <label key={tipo} className="flex items-center gap-2 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={(setor.tipos_leito || []).includes(tipo)}
                                  onChange={e => {
                                    const atual = setor.tipos_leito || [];
                                    const novo = e.target.checked ? [...atual, tipo] : atual.filter(t => t !== tipo);
                                    setAgoHospConfig(c => { const s = [...(c.setores||[])]; s[idx] = { ...s[idx], tipos_leito: novo, quantidade_leitos_inferiores: !novo.includes('beliche') ? 0 : s[idx].quantidade_leitos_inferiores }; return { ...c, setores: s }; });
                                  }}
                                  className="w-4 h-4 accent-blue-700"
                                />
                                <span className="text-sm text-gray-700 capitalize">{tipo}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Quantidade de Leitos *</label>
                          <input
                            type="number"
                            min="1"
                            value={setor.quantidade_leitos || ''}
                            onChange={e => {
                              const v = Math.max(0, parseInt(e.target.value) || 0);
                              setAgoHospConfig(c => { const s = [...(c.setores||[])]; s[idx] = { ...s[idx], quantidade_leitos: v, quantidade_leitos_inferiores: Math.min(s[idx].quantidade_leitos_inferiores, v) }; return { ...c, setores: s }; });
                            }}
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                        </div>
                        {(setor.tipos_leito || []).includes('beliche') ? (
                          <div>
                            <label className="block text-xs font-semibold text-gray-700 mb-1">Leitos Inferiores (beliches de baixo)</label>
                            <input
                              type="number"
                              min="0"
                              max={setor.quantidade_leitos}
                              value={setor.quantidade_leitos_inferiores || ''}
                              onChange={e => {
                                const v = Math.min(Math.max(0, parseInt(e.target.value) || 0), setor.quantidade_leitos);
                                setAgoHospConfig(c => { const s = [...(c.setores||[])]; s[idx] = { ...s[idx], quantidade_leitos_inferiores: v }; return { ...c, setores: s }; });
                              }}
                              className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                            />
                          </div>
                        ) : <div />}
                        <div className="sm:col-span-2">
                          <label className="block text-xs font-semibold text-gray-700 mb-1">Observações internas</label>
                          <input
                            type="text"
                            value={setor.observacoes}
                            onChange={e => setAgoHospConfig(c => { const s = [...(c.setores||[])]; s[idx] = { ...s[idx], observacoes: e.target.value }; return { ...c, setores: s }; })}
                            placeholder="Ex: Sem ventilação, acesso por rampa..."
                            className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                          />
                        </div>
                        <div className="sm:col-span-2 flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`ativo-${setor.id}`}
                            checked={setor.ativo}
                            onChange={e => setAgoHospConfig(c => { const s = [...(c.setores||[])]; s[idx] = { ...s[idx], ativo: e.target.checked }; return { ...c, setores: s }; })}
                            className="w-4 h-4 accent-blue-700"
                          />
                          <label htmlFor={`ativo-${setor.id}`} className="text-xs text-gray-700 cursor-pointer">Setor ativo (participa da alocação)</label>
                        </div>
                        <div className="sm:col-span-2 flex items-center justify-between pt-3 border-t border-gray-100 mt-1">
                          <p className="text-xs text-gray-400 italic">Confirme o setor; os dados serão gravados ao salvar o evento.</p>
                          <button
                            type="button"
                            onClick={() => {
                              if (!setor.nome.trim()) { alert('O Nome do Setor é obrigatório.'); return; }
                              if (!setor.quantidade_leitos || setor.quantidade_leitos < 1) { alert('Informe a Quantidade de Leitos (mínimo 1).'); return; }
                              setSavedSetorSnapshots(snaps => ({ ...snaps, [setor.id]: JSON.stringify(setor) }));
                            }}
                            className="text-xs bg-blue-700 hover:bg-blue-800 text-white px-4 py-1.5 rounded-lg font-bold transition"
                          >✔ Confirmar setor</button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Controle de Plenárias */}
              <div>
                <p className="block text-sm font-semibold text-[#123b63] mb-2">Controle de Plenárias AGO</p>
                <label className="flex items-center gap-3 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={agoHospConfig.habilitar_controle_plenarias}
                    onChange={e => setAgoHospConfig(c => ({ ...c, habilitar_controle_plenarias: e.target.checked }))}
                    className="w-4 h-4 accent-[#123b63]"
                  />
                  <span className="text-sm text-gray-700">Habilitar controle de frequência nas plenárias</span>
                </label>
                {agoHospConfig.habilitar_controle_plenarias && (
                  <div className="pl-2 space-y-2">
                    <p className="text-xs text-gray-500 mb-1">Datas das sessões plenárias:</p>
                    {agoHospConfig.plenarias_datas.map((d, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input
                          type="date"
                          value={d}
                          onChange={e => setAgoHospConfig(c => {
                            const arr = [...c.plenarias_datas];
                            arr[i] = e.target.value;
                            return { ...c, plenarias_datas: arr };
                          })}
                          className="border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63] bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setAgoHospConfig(c => ({ ...c, plenarias_datas: c.plenarias_datas.filter((_, j) => j !== i) }))}
                          className="text-red-400 hover:text-red-600 text-lg leading-none"
                        >×</button>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={() => setAgoHospConfig(c => ({ ...c, plenarias_datas: [...c.plenarias_datas, ''] }))}
                      className="text-xs text-[#123b63] underline hover:no-underline"
                    >+ Adicionar data de plenária</button>
                  </div>
                )}
              </div>

              {/* Desconto Campo Missionário */}
              <div className="border border-green-200 rounded-xl p-4 bg-green-50">
                <p className="block text-sm font-semibold text-green-800 mb-2">🏷 Desconto — Campo Missionário</p>
                <p className="text-xs text-green-700 mb-3">Quando habilitado, Pastores Presidentes pertencentes a um Campo Missionário recebem um valor diferenciado automaticamente.</p>
                <label className="flex items-center gap-3 cursor-pointer mb-3">
                  <input
                    type="checkbox"
                    checked={agoHospConfig.habilitar_desconto_campo_missionario}
                    onChange={e => setAgoHospConfig(c => ({ ...c, habilitar_desconto_campo_missionario: e.target.checked }))}
                    className="w-4 h-4 accent-green-700"
                  />
                  <span className="text-sm text-gray-700">Habilitar desconto para Pastor Presidente de Campo Missionário</span>
                </label>
                {agoHospConfig.habilitar_desconto_campo_missionario && (
                  <div className="pl-2 space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Valor especial — Pastor Presidente (R$)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={agoHospConfig.valor_pastor_presidente_campo_missionario}
                        onChange={e => setAgoHospConfig(c => ({ ...c, valor_pastor_presidente_campo_missionario: e.target.value }))}
                        className="border border-green-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 bg-white w-40"
                        placeholder="210.00"
                      />
                      <p className="mt-1 text-xs text-green-700">Substitui o valor padrão de Pastor Presidente quando o campo é missionário.</p>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1">Valor especial — Esposa de Pastor Presidente (R$)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={agoHospConfig.valor_esposa_campo_missionario}
                        onChange={e => setAgoHospConfig(c => ({ ...c, valor_esposa_campo_missionario: e.target.value }))}
                        className="border border-green-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-600 bg-white w-40"
                        placeholder="210.00"
                      />
                      <p className="mt-1 text-xs text-green-700">Quando o pastor inclui a esposa, este é o valor cobrado por ela.</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── SECAO 5: Comunicacao ───────────────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-[#F39C12] text-xl">💬</span>
            <h2 className="text-base font-bold text-[#123b63]">Comunicacao</h2>
          </div>
          <div className="p-6 grid grid-cols-1 gap-5">

            <div>
              <label className={labelClass} htmlFor="link_whatsapp">Link do Grupo WhatsApp</label>
              <input
                id="link_whatsapp" name="link_whatsapp" type="url"
                value={form.link_whatsapp} onChange={handleText}
                placeholder="https://chat.whatsapp.com/..."
                className={inputClass}
              />
            </div>

            <div>
              <label className={labelClass} htmlFor="mensagem_confirmacao">
                Mensagem de Confirmacao de Inscricao
              </label>
              <textarea
                id="mensagem_confirmacao"
                name="mensagem_confirmacao"
                value={form.mensagem_confirmacao}
                onChange={handleText}
                rows={6}
                placeholder="Ex: Ola, {NOME}! Sua inscricao foi confirmada..."
                className={inputClass + ' resize-y font-mono text-sm'}
              />
            </div>

          </div>
        </div>

        {/* ── SECAO 6: Suporte do Evento ─────────────────── */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 mb-6">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3">
            <span className="text-emerald-600 text-xl">📱</span>
            <h2 className="text-base font-bold text-[#123b63]">Suporte do Evento</h2>
            <span className="text-xs text-gray-400 ml-1">(exibido na pagina publica)</span>
          </div>
          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label className={labelClass} htmlFor="suporte_nome">Nome / Setor de Suporte</label>
              <input
                id="suporte_nome" name="suporte_nome" type="text"
                value={form.suporte_nome} onChange={handleText}
                placeholder="Ex: Secretaria UMADESPA"
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass} htmlFor="suporte_whatsapp">WhatsApp de Suporte</label>
              <input
                id="suporte_whatsapp" name="suporte_whatsapp" type="tel"
                value={form.suporte_whatsapp} onChange={handleText}
                placeholder="(91) 99999-9999"
                className={inputClass}
              />
              <p className="mt-1 text-xs text-gray-400">Somente numeros serao salvos.</p>
            </div>
          </div>
        </div>

        {/* ── Acoes ──────────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => router.push(`/eventos/${id}?tab=configuracoes`)}
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
