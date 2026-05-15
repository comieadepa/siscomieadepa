'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { useEventosPerfil } from '@/hooks/useEventosPerfil';
import { createClient } from '@/lib/supabase-client';
import { generateQRCodeToken } from '@/lib/qrcode-token';
import { normalizePayloadUppercase } from '@/lib/text';
import { EventBadge } from '@/components/EventBadge';
import { authenticatedFetch } from '@/lib/api-client';

// ─── Tipos ────────────────────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; supervisao_id: string; }

interface Evento {
  id: string; nome: string; slug: string; departamento: string;
  data_inicio: string; data_fim: string; local: string | null; cidade: string | null;
  banner_url: string | null; valor_inscricao: number;
  permite_hospedagem: boolean; permite_alimentacao: boolean; permite_brinde: boolean;
  limite_vagas: number | null; limite_hospedagem: number | null; limite_brindes: number | null;
  inscricoes_abertas: boolean; status: string; usar_tipos_inscricao: boolean;
  gerar_certificado: boolean;
}

interface TipoInscricao {
  id: string; nome: string; valor: number;
  inclui_alimentacao: boolean; inclui_hospedagem: boolean;
}

interface InscricaoSalva {
  id: string; nome_inscrito: string; cpf: string | null;
  supervisao_id: string | null; campo_id: string | null;
  status_pagamento: string; hospedagem: boolean; alimentacao: boolean; brinde: boolean;
  qr_code: string | null; checkin_realizado: boolean;
}

interface InscricaoResumo {
  id: string;
  lote_id?: string | null;
  nome_inscrito: string;
  cpf: string | null;
  whatsapp: string | null;
  email: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
  valor_final: number | null;
  valor_pago: number | null;
  status_pagamento: string;
  forma_pagamento: string | null;
  asaas_payment_id: string | null;
  invoice_url: string | null;
  checkin_realizado: boolean;
  checkin_at: string | null;
  etiqueta_impressa: boolean;
  certificado_enviado: boolean;
  created_at: string;
}

interface EditFormBalcao {
  nome_inscrito: string;
  cpf: string;
  email: string;
  whatsapp: string;
  supervisao_id: string;
  campo_id: string;
}

interface FormState {
  nome: string; cpf: string; email: string;
  whatsapp: string; sexo: string;
  supervisao_id: string; campo_id: string;
  hospedagem: boolean; alimentacao: boolean; brinde: boolean;
  tipo_id: string;
  cupom: string;
  forma_pagamento: string; // 'dinheiro' | 'pix_manual' | 'cartao' | 'isento' | 'asaas'
  observacoes: string;
  // Campos hospedagem AGO
  hosp_necessidade_especial: boolean;
  hosp_descricao_necessidade: string;
  hosp_cama_inferior: boolean;
  hosp_observacoes: string;
}

type BalcaoTab = 'nova' | 'inscritos';

const FORM_VAZIO: FormState = {
  nome: '', cpf: '', email: '', whatsapp: '', sexo: '',
  supervisao_id: '', campo_id: '',
  hospedagem: false, alimentacao: false, brinde: false,
  tipo_id: '', cupom: '', forma_pagamento: 'dinheiro', observacoes: '',
  hosp_necessidade_especial: false,
  hosp_descricao_necessidade: '',
  hosp_cama_inferior: false,
  hosp_observacoes: '',
};

// ─── Helpers ──────────────────────────────────────────────────────────────
const fmtMoeda = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const inputCls =
  'w-full border border-gray-600 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#F39C12] bg-[#1a3050] text-white placeholder-gray-400';
const labelCls = 'block text-xs font-semibold text-gray-300 mb-1 uppercase tracking-wide';

const PAGAMENTO_CFG: Record<string, { label: string; cls: string }> = {
  pendente:  { label: 'Pendente',  cls: 'bg-amber-500/20 text-amber-300' },
  pago:      { label: 'Pago',      cls: 'bg-emerald-500/20 text-emerald-300' },
  isento:    { label: 'Isento',    cls: 'bg-blue-500/20 text-blue-300' },
  cancelado: { label: 'Cancelado', cls: 'bg-red-500/20 text-red-300' },
};

// ─── Componente principal ──────────────────────────────────────────────────
export default function BalcaoPage() {
  const { loading: authLoading } = useRequireSupabaseAuth();
  const perfil = useEventosPerfil();
  const router = useRouter();
  const params = useParams();
  const id = params?.id as string;
  const supabase = useMemo(() => createClient(), []);
  const permissaoEvento = useMemo(() => (id ? perfil.permissaoParaEvento(id) : null), [id, perfil]);
  const podeCheckinManual = perfil.isGlobal || perfil.isDeptAdmin || permissaoEvento === 'admin_evento' || permissaoEvento === 'operador';

  // ── Estado geral ──────────────────────────────────────────
  const [evento,      setEvento]      = useState<Evento | null>(null);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [tipos,       setTipos]       = useState<TipoInscricao[]>([]);
  const [loadingInit, setLoadingInit] = useState(true);
  const [acessoNegado, setAcessoNegado] = useState(false);
  const [activeTab, setActiveTab] = useState<BalcaoTab>('nova');

  // ── Estado da lista de inscritos ─────────────────────────
  const [inscricoesLista, setInscricoesLista] = useState<InscricaoResumo[]>([]);
  const [loadingLista, setLoadingLista] = useState(false);
  const [listaErro, setListaErro] = useState<string | null>(null);
  const [buscaLista, setBuscaLista] = useState('');
  const [filtroPag, setFiltroPag] = useState('');
  const [filtroSup, setFiltroSup] = useState('');
  const [filtroCampo, setFiltroCampo] = useState('');
  const [destacarId, setDestacarId] = useState<string | null>(null);
  const [listaMsg, setListaMsg] = useState<{ tipo: 'ok' | 'erro' | 'aviso'; texto: string } | null>(null);
  const [enviandoEmail, setEnviandoEmail] = useState<Record<string, boolean>>({});
  const [enviandoCert, setEnviandoCert] = useState<Record<string, boolean>>({});
  const [marcandoEtiqueta, setMarcandoEtiqueta] = useState<Record<string, boolean>>({});
  const [abrindoPagamento, setAbrindoPagamento] = useState<Record<string, boolean>>({});
  const [checkinManual, setCheckinManual] = useState<Record<string, boolean>>({});
  const [editando, setEditando] = useState<InscricaoResumo | null>(null);
  const [editForm, setEditForm] = useState<EditFormBalcao | null>(null);
  const [salvandoEdit, setSalvandoEdit] = useState(false);
  const [erroEdit, setErroEdit] = useState<string | null>(null);
  const [precisaAtualizar, setPrecisaAtualizar] = useState(false);

  // ── Estado do formulário ──────────────────────────────────
  const [form,       setForm]       = useState<FormState>(FORM_VAZIO);
  const [cpfBusca,   setCpfBusca]   = useState('');
  const [buscando,   setBuscando]   = useState(false);
  const [ministroEncontrado, setMinistroEncontrado] = useState(false);
  const [nomeMinistro, setNomeMinistro] = useState('');
  // Alerta de CPF já inscrito neste evento
  const [inscricaoDuplicada, setInscricaoDuplicada] = useState<{ id: string; nome: string } | null>(null);

  // ── Estado do cupom ───────────────────────────────────────
  const [cupomStatus,   setCupomStatus]   = useState<'idle' | 'validando' | 'ok' | 'erro'>('idle');
  const [cupomDesconto, setCupomDesconto] = useState(0);
  const [cupomMsg,      setCupomMsg]      = useState('');

  // ── Estado de valores ─────────────────────────────────────
  const valorBase = useMemo(() => {
    if (form.tipo_id && tipos.length > 0) {
      const t = tipos.find(t => t.id === form.tipo_id);
      return t ? t.valor : (evento?.valor_inscricao ?? 0);
    }
    return evento?.valor_inscricao ?? 0;
  }, [form.tipo_id, tipos, evento]);

  const valorFinal = Math.max(0, valorBase - cupomDesconto);

  // Inclui serviços do tipo selecionado
  const tipoSel = useMemo(
    () => tipos.find(t => t.id === form.tipo_id) ?? null,
    [form.tipo_id, tipos]
  );

  // ── Estado pós-inscrição ──────────────────────────────────
  const [salvando,      setSalvando]      = useState(false);
  const [erroSave,      setErroSave]      = useState<string | null>(null);
  const [inscricaoSalva, setInscricaoSalva] = useState<InscricaoSalva | null>(null);
  const [contadorTotal,  setContadorTotal]  = useState(0);
  const [asaasData,      setAsaasData]      = useState<{ invoiceUrl?: string; pixCopiaECola?: string; valor: number } | null>(null);

  // ── Refs para foco ────────────────────────────────────────
  const cpfRef    = useRef<HTMLInputElement>(null);
  const nomeRef   = useRef<HTMLInputElement>(null);
  const supRef    = useRef<HTMLSelectElement>(null);
  const listaMsgTimeoutRef = useRef<number | null>(null);

  // ─────────────────────────────────────────────────────────
  // Inicialização
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading || perfil.loading) return;
    if (!id) return;

    // Gate de permissão: checkin não pode acessar balcão
    if (!perfil.isGlobal) {
      const perm = perfil.permissaoParaEvento(id);
      if (!perm || perm === 'checkin') {
        setAcessoNegado(true);
        setLoadingInit(false);
        return;
      }
    }

    async function init() {
      try {
        const [
          { data: ev },
          estruturaRes,
          { data: tps },
        ] = await Promise.all([
          supabase.from('eventos').select(
            'id,nome,slug,departamento,data_inicio,data_fim,local,cidade,banner_url,valor_inscricao,permite_hospedagem,permite_alimentacao,permite_brinde,limite_vagas,limite_hospedagem,limite_brindes,inscricoes_abertas,status,usar_tipos_inscricao,gerar_certificado'
          ).eq('id', id).single(),
          authenticatedFetch('/api/v1/estrutura'),
          supabase.from('evento_tipos_inscricao').select('id,nome,valor,inclui_alimentacao,inclui_hospedagem').eq('evento_id', id).eq('ativo', true).order('ordem'),
        ]);
        // Gate de departamento: isDeptAdmin só acessa eventos do seu dept (exceto subcategoria TODOS)
        if (ev && perfil.isDeptAdmin && perfil.departamentoUsuario !== 'TODOS' && (ev as Evento).departamento !== perfil.departamentoUsuario) {
          setAcessoNegado(true); setLoadingInit(false); return;
        }

        setEvento(ev as Evento);
        if (estruturaRes.ok) {
          const estrutura = await estruturaRes.json().catch(() => null as any);
          setSupervisoes((estrutura?.supervisoes as Supervisao[]) || []);
          setCampos((estrutura?.campos as Campo[]) || []);
        }
        setTipos((tps ?? []) as TipoInscricao[]);

        // Se há exatamente um tipo, pré-selecionar (somente quando evento usa tipos)
        if (ev && (ev as Evento).usar_tipos_inscricao && tps && tps.length === 1) {
          setForm(f => ({ ...f, tipo_id: tps[0].id }));
        }
      } finally {
        setLoadingInit(false);
      }
    }
    init();
  }, [authLoading, perfil.loading, perfil.isGlobal, perfil.isDeptAdmin, perfil.departamentoUsuario, id, supabase]);

  // ─────────────────────────────────────────────────────────
  // Atalhos de teclado globais
  // ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Esc = limpar formulário (apenas se não estiver na tela de confirmação)
      if (e.key === 'Escape' && !inscricaoSalva) {
        e.preventDefault();
        limparTudo();
      }
      // Ctrl+Enter = salvar
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-confirmar')?.click();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inscricaoSalva]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────
  // Helpers do form
  // ─────────────────────────────────────────────────────────
  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm(f => ({ ...f, [k]: v }));
  }

  function handleText(e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    setForm(f => ({ ...f, [name]: value }));
  }

  const camposFiltrados = form.supervisao_id
    ? campos.filter(c => c.supervisao_id === form.supervisao_id)
    : campos;

  function limparTudo(options?: { focoCpf?: boolean }) {
    setForm(FORM_VAZIO);
    setCpfBusca('');
    setMinistroEncontrado(false);
    setNomeMinistro('');
    setCupomStatus('idle');
    setCupomDesconto(0);
    setCupomMsg('');
    setErroSave(null);
    setInscricaoDuplicada(null);
    setInscricaoSalva(null);
    setAsaasData(null);
    // Se há só um tipo, pré-selecionar (somente quando evento usa tipos)
    if (evento?.usar_tipos_inscricao && tipos.length === 1) setForm(f => ({ ...f, tipo_id: tipos[0].id }));
    if (options?.focoCpf !== false) {
      setTimeout(() => cpfRef.current?.focus(), 50);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Busca CPF
  // ─────────────────────────────────────────────────────────
  async function buscarCPF() {
    if (!cpfBusca.trim()) return;
    setBuscando(true);
    setMinistroEncontrado(false);
    setNomeMinistro('');
    setInscricaoDuplicada(null);
    const cpfLimpo = cpfBusca.replace(/\D/g, '');

    // Busca membro E verifica duplicidade em paralelo
    const [lookupRes, dupRes] = await Promise.all([
      authenticatedFetch(`/api/v1/members/lookup?search=${encodeURIComponent(cpfLimpo || cpfBusca)}&limit=1`),
      cpfLimpo
        ? supabase
            .from('evento_inscricoes')
            .select('id,nome_inscrito')
            .eq('evento_id', id)
            .eq('cpf', cpfLimpo)
            .limit(1)
        : Promise.resolve({ data: [] as { id: string; nome_inscrito: string }[] }),
    ]);
    const lookupJson = lookupRes.ok ? await lookupRes.json().catch(() => null as any) : null;
    const data = (lookupJson?.data ?? []) as { id: string; nome?: string | null; name?: string | null; cpf?: string | null; celular?: string | null; phone?: string | null; whatsapp?: string | null; email?: string | null; supervisao?: string | null; campo?: string | null; supervisao_id?: string | null; campo_id?: string | null }[];
    const dupData = (dupRes as { data?: { id: string; nome_inscrito: string }[] }).data ?? [];
    setBuscando(false);

    // Alerta de duplicidade (exibe antes de preencher o form)
    if (dupData && Array.isArray(dupData) && dupData.length > 0) {
      setInscricaoDuplicada({ id: (dupData[0] as { id: string; nome_inscrito: string }).id, nome: (dupData[0] as { id: string; nome_inscrito: string }).nome_inscrito });
    }

    if (data && data.length > 0) {
      const m = data[0];
      const nome = (m.nome ?? m.name ?? '') as string;
      const celular = (m.celular ?? m.phone ?? '') as string;
      const sup   = supervisoes.find(s => s.id === m.supervisao_id || s.nome === m.supervisao);
      const campo = campos.find(c => c.id === m.campo_id || c.nome === m.campo);
      setMinistroEncontrado(true);
      setNomeMinistro(nome || '');
      setForm(f => ({
        ...f,
        nome:         nome || f.nome,
        cpf:          m.cpf  || cpfBusca,
        whatsapp:     m.whatsapp || celular || f.whatsapp,
        email:        m.email   || f.email,
        supervisao_id: sup?.id  || f.supervisao_id,
        campo_id:     campo?.id || f.campo_id,
      }));
      setTimeout(() => supRef.current?.focus(), 50);
    } else {
      setForm(f => ({
        ...f,
        cpf:          cpfBusca,
        nome:         '',
        email:        '',
        whatsapp:     '',
        sexo:         '',
        supervisao_id: '',
        campo_id:     '',
      }));
      setTimeout(() => nomeRef.current?.focus(), 50);
    }
  }

  // ─────────────────────────────────────────────────────────
  // Validação e aplicação de cupom
  // ─────────────────────────────────────────────────────────
  async function validarCupom() {
    if (!form.cupom.trim() || !evento) return;
    setCupomStatus('validando');
    try {
      const res = await fetch(`/api/eventos/${evento.id}/cupons/validar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: form.cupom.trim().toUpperCase(), valor_base: valorBase }),
      });
      const json = await res.json() as { valido: boolean; desconto?: number; valorFinal?: number; erro?: string };
      if (json.valido && json.desconto !== undefined) {
        setCupomStatus('ok');
        setCupomDesconto(json.desconto);
        setCupomMsg(`Desconto de ${fmtMoeda(json.desconto)} aplicado!`);
      } else {
        setCupomStatus('erro');
        setCupomDesconto(0);
        setCupomMsg(json.erro || 'Cupom inválido.');
      }
    } catch {
      setCupomStatus('erro');
      setCupomMsg('Erro ao validar cupom.');
    }
  }

  function removerCupom() {
    setField('cupom', '');
    setCupomStatus('idle');
    setCupomDesconto(0);
    setCupomMsg('');
  }

  // Ao mudar tipo, recalcular cupom se houver
  useEffect(() => {
    if (cupomStatus === 'ok' && form.cupom) {
      setCupomStatus('idle');
      setCupomDesconto(0);
      setCupomMsg('Recalcule o cupom após mudar o tipo de inscrição.');
    }
  }, [form.tipo_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─────────────────────────────────────────────────────────
  // Salvar inscrição
  // ─────────────────────────────────────────────────────────
  const salvar = useCallback(async () => {
    if (!evento || !form.nome.trim()) {
      setErroSave('Nome do inscrito é obrigatório.');
      return;
    }
    if (!form.supervisao_id) {
      setErroSave('Supervisão é obrigatória.');
      return;
    }
    if (evento.usar_tipos_inscricao && !tipoSel) {
      setErroSave('Selecione um tipo de inscrição.');
      return;
    }
    setErroSave(null);
    setSalvando(true);

    try {
      const isGratuito = valorFinal <= 0 || form.forma_pagamento === 'isento';
      const hospedagem = tipoSel ? tipoSel.inclui_hospedagem : form.hospedagem;
      const alimentacao = tipoSel ? tipoSel.inclui_alimentacao : form.alimentacao;

      // ── Inscrição via ASAAS (rota pública de inscrição) ──
      if (form.forma_pagamento === 'asaas' && !isGratuito) {
        const qrTokenAsaas = generateQRCodeToken();
        const payloadApi = normalizePayloadUppercase({
          slug:          evento.slug,
          nome_inscrito: form.nome.trim(),
          cpf:           form.cpf.replace(/\D/g, '') || undefined,
          email:         form.email.trim() || undefined,
          whatsapp:      form.whatsapp.trim() || undefined,
          sexo:          form.sexo || undefined,
          supervisao_id: form.supervisao_id,
          campo_id:      form.campo_id || undefined,
          hospedagem,
          alimentacao,
          brinde:        form.brinde,
          tipo_inscricao: tipoSel?.nome || undefined,
          cupom_codigo:  form.cupom && cupomStatus === 'ok' ? form.cupom.trim().toUpperCase() : undefined,
          qr_code:       qrTokenAsaas,
          // Campos hospedagem AGO
          hosp_necessidade_especial:  form.hosp_necessidade_especial,
          hosp_descricao_necessidade: form.hosp_descricao_necessidade.trim() || undefined,
          hosp_cama_inferior:         form.hosp_cama_inferior,
          hosp_observacoes:           form.hosp_observacoes.trim() || undefined,
        });
        const res = await fetch('/api/eventos/inscricao', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadApi),
        });
        const json = await res.json() as {
          inscricaoId?: string; statusPagamento?: string;
          pagamento?: { invoiceUrl?: string; pixCopiaECola?: string; valor?: number } | null;
          error?: string;
        };

        if (!res.ok || json.error) {
          setErroSave(json.error || 'Erro ao processar inscrição.');
          setSalvando(false);
          return;
        }

        // Busca inscrição completa
        const { data: insc } = await supabase
          .from('evento_inscricoes')
          .select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,hospedagem,alimentacao,brinde,qr_code,checkin_realizado')
          .eq('id', json.inscricaoId!)
          .single();

        setInscricaoSalva(insc as InscricaoSalva);
        registrarInscricaoCriada(insc as InscricaoSalva);
        if (json.pagamento) {
          setAsaasData({ invoiceUrl: json.pagamento.invoiceUrl, pixCopiaECola: json.pagamento.pixCopiaECola, valor: json.pagamento.valor ?? valorFinal });
        }
        setContadorTotal(c => c + 1);
        setSalvando(false);
        return;
      }

      // ── Inscrição local (dinheiro/pix_manual/cartão/isento) ──
      const qrToken = generateQRCodeToken();
      const cupomCodigo = form.cupom && cupomStatus === 'ok' ? form.cupom.trim().toUpperCase() : null;
      const statusPag = isGratuito ? 'isento' : 'pago';

      const payload: Record<string, unknown> = normalizePayloadUppercase({
        evento_id:        evento.id,
        nome_inscrito:    form.nome.trim(),
        cpf:              form.cpf.replace(/\D/g, '') || null,
        email:            form.email.trim() || null,
        whatsapp:         form.whatsapp.trim() || null,
        sexo:             form.sexo || null,
        supervisao_id:    form.supervisao_id,
        campo_id:         form.campo_id || null,
        hospedagem,
        alimentacao,
        brinde:           form.brinde,
        tipo_inscricao:   tipoSel?.nome || null,
        valor_original:   valorBase,
        cupom_codigo:     cupomCodigo,
        desconto_valor:   cupomDesconto,
        valor_final:      valorFinal,
        valor_pago:       isGratuito ? 0 : valorFinal,
        status_pagamento: statusPag,
        forma_pagamento:  isGratuito ? null : form.forma_pagamento === 'pix_manual' ? 'pix' : form.forma_pagamento,
        observacoes:      form.observacoes.trim() || null,
        qr_code:          qrToken,
        // Campos hospedagem AGO
        hosp_necessidade_especial:  form.hosp_necessidade_especial,
        hosp_descricao_necessidade: form.hosp_descricao_necessidade.trim() || null,
        hosp_cama_inferior:         form.hosp_cama_inferior,
        hosp_observacoes:           form.hosp_observacoes.trim() || null,
      });

      const { data: insc, error } = await supabase
        .from('evento_inscricoes')
        .insert([payload])
        .select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,hospedagem,alimentacao,brinde,qr_code,checkin_realizado')
        .single();

      if (error) {
        setErroSave('Erro ao salvar: ' + error.message);
        setSalvando(false);
        return;
      }

      // Incrementa cupom se usado
      if (cupomCodigo) {
        const { data: cup } = await supabase
          .from('evento_cupons')
          .select('usados')
          .eq('evento_id', evento.id)
          .eq('codigo', cupomCodigo)
          .single();
        if (cup) {
          await supabase.from('evento_cupons').update({ usados: cup.usados + 1 }).eq('evento_id', evento.id).eq('codigo', cupomCodigo);
        }
      }

      // Cria registro de hospedagem AGO (fluxo local)
      if (hospedagem && evento.departamento === 'AGO' && insc) {
        const tipoNome = (tipoSel?.nome ?? '').toLowerCase();
        const prioridade =
          (form.hosp_necessidade_especial ? 100 : 0) +
          (form.hosp_cama_inferior        ?  80 : 0) +
          (tipoNome.includes('jubilado')  ?  40 : 0) +
          (tipoNome.includes('presidente')?  30 : 0);
        const hospedagemPayload = normalizePayloadUppercase({
          evento_id:            evento.id,
          inscricao_id:         (insc as { id: string }).id,
          status:               'solicitada',
          prioridade,
          necessidade_especial: form.hosp_necessidade_especial,
          descricao_necessidade: form.hosp_descricao_necessidade.trim() || null,
          cama_inferior:        form.hosp_cama_inferior,
          observacoes:          form.hosp_observacoes.trim() || null,
          alocacao_automatica:  true,
        });
        await supabase.from('evento_hospedagens').insert([hospedagemPayload]);
      }

      setInscricaoSalva(insc as InscricaoSalva);
      registrarInscricaoCriada(insc as InscricaoSalva);
      setAsaasData(null);
      setContadorTotal(c => c + 1);
    } catch (err: unknown) {
      setErroSave('Erro inesperado: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSalvando(false);
    }
  }, [evento, form, tipoSel, valorBase, valorFinal, cupomDesconto, cupomStatus, supabase]);

  // ─────────────────────────────────────────────────────────
  // Impressão de crachá
  // ─────────────────────────────────────────────────────────
  function imprimirCracha() {
    if (!inscricaoSalva) return;
    window.open(`/eventos/${id}/etiquetas/print?ids=${inscricaoSalva.id}&size=medium`, '_blank', 'width=900,height=700');
  }

  function registrarInscricaoCriada(insc: InscricaoSalva) {
    setDestacarId(insc.id);
    setPrecisaAtualizar(true);
  }

  const fetchInscricoesLista = useCallback(async (options?: { silent?: boolean }) => {
    if (!id) return;
    if (!options?.silent) setLoadingLista(true);
    setListaErro(null);
    try {
      const { data, error } = await supabase
        .from('evento_inscricoes')
        .select('id,lote_id,nome_inscrito,cpf,whatsapp,email,supervisao_id,campo_id,valor_final,valor_pago,status_pagamento,forma_pagamento,asaas_payment_id,invoice_url,checkin_realizado,checkin_at,etiqueta_impressa,certificado_enviado,created_at')
        .eq('evento_id', id)
        .order('created_at', { ascending: false });
      if (error) {
        setListaErro('Erro ao carregar inscritos.');
        return;
      }
      setInscricoesLista((data as InscricaoResumo[]) || []);
      setPrecisaAtualizar(false);
    } catch {
      setListaErro('Erro ao carregar inscritos.');
    } finally {
      if (!options?.silent) setLoadingLista(false);
    }
  }, [id, supabase]);

  useEffect(() => {
    if (!inscricaoSalva) return;
    if (!['pago', 'isento'].includes(inscricaoSalva.status_pagamento)) return;
    const timer = window.setTimeout(() => {
      limparTudo({ focoCpf: false });
      setActiveTab('inscritos');
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [inscricaoSalva]);

  useEffect(() => {
    if (activeTab !== 'inscritos') return;
    fetchInscricoesLista();
    const timer = window.setInterval(() => {
      fetchInscricoesLista({ silent: true });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [activeTab, fetchInscricoesLista]);

  useEffect(() => {
    if (activeTab === 'inscritos' && precisaAtualizar) {
      fetchInscricoesLista();
    }
  }, [activeTab, precisaAtualizar, fetchInscricoesLista]);

  useEffect(() => {
    if (!destacarId) return;
    const timer = window.setTimeout(() => setDestacarId(null), 12000);
    return () => window.clearTimeout(timer);
  }, [destacarId]);

  useEffect(() => {
    if (activeTab !== 'inscritos' || !destacarId) return;
    const timer = window.setTimeout(() => {
      document.getElementById(`insc-${destacarId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 200);
    return () => window.clearTimeout(timer);
  }, [activeTab, destacarId, inscricoesLista.length, buscaLista, filtroPag, filtroSup, filtroCampo]);

  useEffect(() => {
    if (!destacarId) return;
    setDestacarId(null);
  }, [buscaLista, filtroPag, filtroSup, filtroCampo]);

  useEffect(() => {
    if (activeTab === 'nova' && !inscricaoSalva) {
      setTimeout(() => cpfRef.current?.focus(), 50);
    }
  }, [activeTab, inscricaoSalva]);

  useEffect(() => () => {
    if (listaMsgTimeoutRef.current) window.clearTimeout(listaMsgTimeoutRef.current);
  }, []);

  // ─────────────────────────────────────────────────────────
  // Helpers de nomes
  // ─────────────────────────────────────────────────────────
  const supervisaoById = useMemo(
    () => new Map(supervisoes.map(s => [s.id, s.nome])),
    [supervisoes]
  );
  const campoById = useMemo(
    () => new Map(campos.map(c => [c.id, c])),
    [campos]
  );

  const nomeSup   = (sid: string | null) => supervisoes.find(s => s.id === sid)?.nome ?? '';
  const nomeCampo = (cid: string | null) => campos.find(c => c.id === cid)?.nome ?? '';

  const supervisoesLista = useMemo(() => {
    const map = new Map<string, string>();
    inscricoesLista.forEach(i => {
      const id = i.supervisao_id;
      if (!id) return;
      const nome = (supervisaoById.get(id) ?? '').trim();
      if (!nome) return;
      map.set(id, nome);
    });
    return Array.from(map.entries())
      .map(([id, nome]) => ({ id, nome }))
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [inscricoesLista, supervisaoById]);

  const camposBaseLista = useMemo(() => {
    const map = new Map<string, { id: string; nome: string; supervisao_id: string | null }>();
    inscricoesLista.forEach(i => {
      const id = i.campo_id;
      if (!id) return;
      const campo = campoById.get(id);
      const nome = (campo?.nome ?? '').trim();
      if (!nome) return;
      map.set(id, { id, nome, supervisao_id: campo?.supervisao_id ?? i.supervisao_id ?? null });
    });
    return Array.from(map.values())
      .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
  }, [inscricoesLista, campoById]);

  const camposLista = useMemo(
    () => (filtroSup ? camposBaseLista.filter(c => c.supervisao_id === filtroSup) : camposBaseLista),
    [camposBaseLista, filtroSup]
  );

  const inscritosFiltrados = useMemo(() => {
    const q = buscaLista.trim().toLowerCase();
    return inscricoesLista.filter(i => {
      if (q) {
        const nomeOk = i.nome_inscrito.toLowerCase().includes(q);
        const cpfOk = (i.cpf || '').includes(q);
        const wppOk = (i.whatsapp || '').includes(q);
        if (!nomeOk && !cpfOk && !wppOk) return false;
      }
      if (filtroSup && i.supervisao_id !== filtroSup) return false;
      if (filtroCampo && i.campo_id !== filtroCampo) return false;
      if (filtroPag && i.status_pagamento !== filtroPag) return false;
      // Filtro de check-in removido no balcao.
      return true;
    });
  }, [inscricoesLista, buscaLista, filtroSup, filtroCampo, filtroPag]);

  function definirMsgLista(tipo: 'ok' | 'erro' | 'aviso', texto: string) {
    setListaMsg({ tipo, texto });
    if (listaMsgTimeoutRef.current) window.clearTimeout(listaMsgTimeoutRef.current);
    listaMsgTimeoutRef.current = window.setTimeout(() => setListaMsg(null), 4000);
  }

  async function reenviarEmail(ins: InscricaoResumo) {
    if (!ins.email) {
      definirMsgLista('aviso', 'E-mail nao cadastrado para esta inscricao.');
      return;
    }
    setEnviandoEmail(p => ({ ...p, [ins.id]: true }));
    try {
      const res = await fetch(`/api/eventos/${id}/notificacoes/reenviar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscricao_id: ins.id }),
      });
      const json = await res.json();
      if (res.ok) {
        definirMsgLista('ok', 'E-mail reenviado com sucesso.');
      } else {
        definirMsgLista('erro', json.error || 'Falha ao reenviar e-mail.');
      }
    } catch {
      definirMsgLista('erro', 'Erro de rede ao reenviar e-mail.');
    } finally {
      setEnviandoEmail(p => ({ ...p, [ins.id]: false }));
    }
  }

  async function enviarCertificadoLista(ins: InscricaoResumo) {
    if (!ins.email) {
      definirMsgLista('aviso', 'E-mail nao cadastrado para esta inscricao.');
      return;
    }
    if (!['pago', 'isento'].includes(ins.status_pagamento)) {
      definirMsgLista('aviso', 'Pagamento pendente: certificado indisponivel.');
      return;
    }
    if (!ins.checkin_realizado) {
      definirMsgLista('aviso', 'Check-in pendente: certificado indisponivel.');
      return;
    }
    setEnviandoCert(p => ({ ...p, [ins.id]: true }));
    try {
      const res = await fetch(`/api/eventos/${id}/certificados/enviar-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscricao_id: ins.id, reenviar: ins.certificado_enviado }),
      });
      const json = await res.json();
      if (json.jaEnviado) {
        definirMsgLista('ok', 'Certificado ja enviado anteriormente.');
      } else if (res.ok) {
        definirMsgLista('ok', 'Certificado enviado com sucesso.');
        setInscricoesLista(list => list.map(i => i.id === ins.id ? { ...i, certificado_enviado: true } : i));
      } else {
        definirMsgLista('erro', json.error || 'Falha ao enviar certificado.');
      }
    } catch {
      definirMsgLista('erro', 'Erro de rede ao enviar certificado.');
    } finally {
      setEnviandoCert(p => ({ ...p, [ins.id]: false }));
    }
  }

  async function realizarCheckinManual(ins: InscricaoResumo) {
    if (!podeCheckinManual) return;
    if (!['pago', 'isento'].includes(ins.status_pagamento)) {
      definirMsgLista('aviso', 'Somente inscricoes pagas/isentas podem fazer check-in.');
      return;
    }
    setCheckinManual(p => ({ ...p, [ins.id]: true }));
    try {
      const now = new Date().toISOString();
      await supabase
        .from('evento_inscricoes')
        .update({ checkin_realizado: true, checkin_at: now })
        .eq('id', ins.id);
      await supabase
        .from('evento_checkins')
        .insert([{ evento_id: id, inscricao_id: ins.id, metodo: 'manual' }]);
      setInscricoesLista(list => list.map(i => i.id === ins.id ? { ...i, checkin_realizado: true, checkin_at: now } : i));
      definirMsgLista('ok', 'Check-in realizado com sucesso.');
    } catch {
      definirMsgLista('erro', 'Erro ao realizar check-in.');
    } finally {
      setCheckinManual(p => ({ ...p, [ins.id]: false }));
    }
  }

  function imprimirEtiqueta(ins: InscricaoResumo) {
    window.open(`/eventos/${id}/etiquetas/print?mode=thermal&ids=${ins.id}`, '_blank', 'width=520,height=420');
  }

  async function alternarEtiquetaImpressa(ins: InscricaoResumo) {
    if (!perfil.podeEditarInscricoes) {
      definirMsgLista('aviso', 'Sem permissao para alterar etiqueta.');
      return;
    }
    setMarcandoEtiqueta(p => ({ ...p, [ins.id]: true }));
    try {
      const res = await fetch(`/api/eventos/${id}/inscricoes/${ins.id}/etiqueta`, {
        method: 'PATCH',
      });
      const json = await res.json();
      if (!res.ok) {
        definirMsgLista('erro', json.error || 'Falha ao atualizar etiqueta.');
        return;
      }
      setInscricoesLista(list => list.map(i => i.id === ins.id
        ? { ...i, etiqueta_impressa: !!json.etiqueta_impressa }
        : i));
      definirMsgLista('ok', json.etiqueta_impressa ? 'Etiqueta marcada como impressa.' : 'Etiqueta desmarcada.');
    } catch {
      definirMsgLista('erro', 'Erro de rede ao atualizar etiqueta.');
    } finally {
      setMarcandoEtiqueta(p => ({ ...p, [ins.id]: false }));
    }
  }

  async function abrirSegundaVia(ins: InscricaoResumo, gerarSeAusente = false) {
    setAbrindoPagamento(p => ({ ...p, [ins.id]: true }));
    try {
      const res = await fetch(`/api/eventos/${id}/inscricoes/${ins.id}/invoice`, {
        method: gerarSeAusente ? 'POST' : 'GET',
      });
      const json = await res.json();
      if (!res.ok || !json.invoice_url) {
        definirMsgLista('aviso', json.error || 'Sem cobranca ASAAS disponivel.');
        return;
      }
      if (gerarSeAusente) {
        setInscricoesLista(list => list.map(i => i.id === ins.id
          ? { ...i, invoice_url: json.invoice_url, asaas_payment_id: i.asaas_payment_id || 'gerado' }
          : i));
        definirMsgLista('ok', 'Cobranca ASAAS gerada.');
      }
      window.open(json.invoice_url, '_blank', 'noopener,noreferrer');
    } catch {
      definirMsgLista('erro', 'Erro ao abrir link de pagamento.');
    } finally {
      setAbrindoPagamento(p => ({ ...p, [ins.id]: false }));
    }
  }

  function abrirEdicao(ins: InscricaoResumo) {
    if (!perfil.podeEditarInscricoes) return;
    setErroEdit(null);
    setEditando(ins);
    setEditForm({
      nome_inscrito: ins.nome_inscrito,
      cpf: ins.cpf ?? '',
      email: ins.email ?? '',
      whatsapp: ins.whatsapp ?? '',
      supervisao_id: ins.supervisao_id ?? '',
      campo_id: ins.campo_id ?? '',
    });
  }

  async function salvarEdicao() {
    if (!editando || !editForm) return;
    if (!perfil.podeEditarInscricoes) return;
    if (!editForm.nome_inscrito.trim()) {
      setErroEdit('Nome do inscrito e obrigatorio.');
      return;
    }
    if (!editForm.supervisao_id) {
      setErroEdit('Supervisao e obrigatoria.');
      return;
    }
    setErroEdit(null);
    setSalvandoEdit(true);
    try {
      const cpfLimpo = editForm.cpf.replace(/\D/g, '') || null;
      const payload = normalizePayloadUppercase({
        nome_inscrito: editForm.nome_inscrito.trim(),
        cpf: cpfLimpo,
        email: editForm.email.trim() || null,
        whatsapp: editForm.whatsapp.trim() || null,
        supervisao_id: editForm.supervisao_id,
        campo_id: editForm.campo_id || null,
      });
      const { error } = await supabase
        .from('evento_inscricoes')
        .update(payload)
        .eq('id', editando.id);
      if (error) {
        setErroEdit(error.message);
        return;
      }
      const normalized = payload as {
        nome_inscrito?: string;
        cpf?: string | null;
        email?: string | null;
        whatsapp?: string | null;
        supervisao_id?: string | null;
        campo_id?: string | null;
      };
      setInscricoesLista(list => list.map(i => i.id === editando.id ? {
        ...i,
        nome_inscrito: normalized.nome_inscrito ?? editForm.nome_inscrito.trim(),
        cpf: normalized.cpf ?? cpfLimpo,
        email: normalized.email ?? (editForm.email.trim() || null),
        whatsapp: normalized.whatsapp ?? (editForm.whatsapp.trim() || null),
        supervisao_id: normalized.supervisao_id ?? editForm.supervisao_id,
        campo_id: normalized.campo_id ?? (editForm.campo_id || null),
      } : i));
      definirMsgLista('ok', 'Inscricao atualizada com sucesso.');
      setEditando(null);
      setEditForm(null);
    } catch {
      setErroEdit('Erro ao salvar edicao.');
    } finally {
      setSalvandoEdit(false);
    }
  }

  function trocarAba(tab: BalcaoTab) {
    setActiveTab(tab);
    setInscricaoSalva(null);
  }

  function verNaListaInscritos() {
    const idAtual = inscricaoSalva?.id ?? null;
    limparTudo({ focoCpf: false });
    if (idAtual) setDestacarId(idAtual);
    setActiveTab('inscritos');
    setPrecisaAtualizar(true);
  }

  function limparFiltrosLista() {
    setBuscaLista('');
    setFiltroPag('');
    setFiltroSup('');
    setFiltroCampo('');
  }

  // ─────────────────────────────────────────────────────────
  // Guards de carregamento
  // ─────────────────────────────────────────────────────────
  if (authLoading || perfil.loading || loadingInit) {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center">
        <div className="text-center text-white space-y-3">
          <div className="w-10 h-10 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto" />
          <p className="text-sm text-white/60">Carregando modo balcão...</p>
        </div>
      </div>
    );
  }

  if (acessoNegado) {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center p-8">
        <div className="text-center text-white space-y-4 max-w-sm">
          <p className="text-5xl">🚫</p>
          <h1 className="text-xl font-bold">Acesso Negado</h1>
          <p className="text-white/60 text-sm">Você não tem permissão para acessar o Modo Balcão.</p>
          <button onClick={() => router.back()} className="mt-4 px-6 py-2 bg-white/10 hover:bg-white/20 rounded-lg text-sm font-semibold transition">← Voltar</button>
        </div>
      </div>
    );
  }

  if (!evento) {
    return (
      <div className="min-h-screen bg-[#0D2B4E] flex items-center justify-center">
        <p className="text-white/60">Evento não encontrado.</p>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────
  // Formulário principal
  // ─────────────────────────────────────────────────────────
  const temTipos = (evento?.usar_tipos_inscricao ?? false) && tipos.length > 0;

  return (
    <div className="min-h-screen bg-[#0D2B4E] flex flex-col">
      {/* ── Header ── */}
      <header className="bg-[#0a2040] border-b border-white/10 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <button
          onClick={() => router.push(`/eventos/${id}`)}
          className="text-white/50 hover:text-white text-sm px-3 py-1.5 rounded-lg hover:bg-white/10 transition"
          title="Voltar ao evento"
        >
          ← Sair
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-white font-bold text-sm truncate">🏪 Modo Balcão — {evento.nome}</h1>
          <p className="text-white/40 text-xs hidden sm:block">Inscrição presencial rápida · Esc=Limpar · Ctrl+Enter=Salvar</p>
        </div>
        {contadorTotal > 0 && (
          <div className="bg-emerald-500 text-white text-xs font-bold px-3 py-1 rounded-full flex-shrink-0">
            {contadorTotal} inscrição{contadorTotal !== 1 ? 'ões' : ''} hoje
          </div>
        )}
      </header>

      {/* ── Abas internas ── */}
      <div className="bg-[#0a2040] border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 lg:px-6">
          <div className="flex gap-2 py-3 overflow-x-auto pb-1">
            <button
              type="button"
              onClick={() => trocarAba('nova')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition whitespace-nowrap flex-shrink-0 ${
                activeTab === 'nova'
                  ? 'bg-[#F39C12] text-[#0D2B4E]'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
            >
              📝 Nova Inscrição
            </button>
            <button
              type="button"
              onClick={() => trocarAba('inscritos')}
              className={`px-4 py-2 rounded-xl text-sm font-bold transition whitespace-nowrap flex-shrink-0 ${
                activeTab === 'inscritos'
                  ? 'bg-[#F39C12] text-[#0D2B4E]'
                  : 'bg-white/10 text-white/70 hover:bg-white/20'
              }`}
            >
              👥 Inscritos
            </button>
          </div>
        </div>
      </div>

      {/* ── Corpo principal ── */}
      <div className="flex-1 overflow-y-auto">
        <div className={`mx-auto p-4 lg:p-6 ${activeTab === 'inscritos' ? 'max-w-[1400px]' : 'max-w-5xl'}`}>

          {activeTab === 'nova' && inscricaoSalva && (
            <ConfirmacaoScreen
              inscricao={inscricaoSalva}
              evento={evento}
              nomeSup={nomeSup(inscricaoSalva.supervisao_id)}
              nomeCampo={nomeCampo(inscricaoSalva.campo_id)}
              valorFinal={valorFinal}
              formaPagamento={form.forma_pagamento}
              asaasData={asaasData}
              contadorTotal={contadorTotal}
              onNova={() => { limparTudo(); setActiveTab('nova'); }}
              onImprimir={imprimirCracha}
              onVerLista={verNaListaInscritos}
            />
          )}

          {activeTab === 'nova' && !inscricaoSalva && (
            <>
              {/* ── Bloco 1: Busca CPF ── */}
              <section className="bg-[#123b63] rounded-2xl p-5 mb-4 border border-white/10">
            <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-[#F39C12] text-[#0D2B4E] rounded-full flex items-center justify-center text-xs font-black">1</span>
              Identificação
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                ref={cpfRef}
                type="text"
                placeholder="Digite CPF e pressione Enter"
                value={cpfBusca}
                onChange={e => setCpfBusca(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && buscarCPF()}
                className={inputCls + ' w-full sm:flex-1'}
                autoFocus
              />
              <button
                onClick={buscarCPF}
                disabled={buscando || !cpfBusca.trim()}
                className="w-full sm:w-auto bg-[#F39C12] hover:bg-[#D68910] disabled:opacity-40 text-[#0D2B4E] font-bold px-5 py-2.5 rounded-lg text-sm transition flex-shrink-0 whitespace-nowrap"
              >
                {buscando ? '...' : '🔍 Buscar'}
              </button>
            </div>
            {ministroEncontrado && (
              <div className="mt-2 bg-emerald-900/50 border border-emerald-500/30 rounded-lg px-4 py-2 text-sm text-emerald-300 flex items-center gap-2">
                <span className="text-emerald-400">✅</span>
                <span>Ministro encontrado: <strong>{nomeMinistro}</strong></span>
              </div>
            )}
            {/* Alerta de CPF já inscrito neste evento */}
            {inscricaoDuplicada && (
              <div className="mt-3 bg-amber-900/70 border-2 border-amber-500/60 rounded-xl px-4 py-3 flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">⚠️</span>
                <div className="flex-1">
                  <p className="text-amber-300 font-black text-sm">CPF já inscrito neste evento</p>
                  <p className="text-amber-200/80 text-xs mt-0.5">
                    <strong className="text-amber-100">{inscricaoDuplicada.nome}</strong> já possui inscrição.
                    Confirme antes de criar uma nova.
                  </p>
                </div>
                <a
                  href={`/eventos/${id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-shrink-0 text-xs bg-amber-500/20 hover:bg-amber-500/40 border border-amber-500/50 text-amber-300 px-3 py-1.5 rounded-lg font-bold transition whitespace-nowrap"
                >
                  Ver inscrição ↗
                </a>
              </div>
            )}
          </section>

          {/* ── Bloco 2: Dados pessoais ── */}
          <section className="bg-[#123b63] rounded-2xl p-5 mb-4 border border-white/10">
            <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-[#F39C12] text-[#0D2B4E] rounded-full flex items-center justify-center text-xs font-black">2</span>
              Dados do Inscrito
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <div className="lg:col-span-2">
                <label className={labelCls}>Nome completo *</label>
                <input
                  ref={nomeRef}
                  name="nome"
                  value={form.nome}
                  onChange={handleText}
                  onKeyDown={e => e.key === 'Enter' && supRef.current?.focus()}
                  className={inputCls}
                  placeholder="Nome completo"
                  required
                />
              </div>
              <div>
                <label className={labelCls}>Sexo</label>
                <select name="sexo" value={form.sexo} onChange={handleText} className={inputCls}>
                  <option value="">-</option>
                  <option value="M">Masculino</option>
                  <option value="F">Feminino</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>WhatsApp</label>
                <input name="whatsapp" value={form.whatsapp} onChange={handleText} className={inputCls} placeholder="(00) 00000-0000" />
              </div>
              <div>
                <label className={labelCls}>E-mail</label>
                <input name="email" type="email" value={form.email} onChange={handleText} className={inputCls} placeholder="email@exemplo.com" />
              </div>
              <div />
              <div>
                <label className={labelCls}>Supervisão *</label>
                <select
                  ref={supRef}
                  name="supervisao_id"
                  value={form.supervisao_id}
                  onChange={e => { handleText(e); setForm(f => ({ ...f, campo_id: '' })); }}
                  className={inputCls}
                >
                  <option value="">Selecione...</option>
                  {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Campo</label>
                <select name="campo_id" value={form.campo_id} onChange={handleText} className={inputCls}>
                  <option value="">Selecione...</option>
                  {camposFiltrados.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
            </div>
          </section>

          {/* ── Bloco 3: Tipo + Serviços ── */}
          <section className="bg-[#123b63] rounded-2xl p-5 mb-4 border border-white/10">
            <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-[#F39C12] text-[#0D2B4E] rounded-full flex items-center justify-center text-xs font-black">3</span>
              Inscrição
            </h2>

            {/* Tipos de inscrição */}
            {temTipos && (
              <div className="mb-4">
                <label className={labelCls}>Tipo de inscrição</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {tipos.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setField('tipo_id', form.tipo_id === t.id ? '' : t.id)}
                      className={`text-left rounded-xl border-2 px-4 py-3 transition ${
                        form.tipo_id === t.id
                          ? 'border-[#F39C12] bg-[#F39C12]/10 text-white'
                          : 'border-white/20 hover:border-white/40 text-white/70'
                      }`}
                    >
                      <p className="font-semibold text-sm">{t.nome}</p>
                      <p className="text-xs mt-0.5 opacity-70">
                        {t.valor === 0 ? 'Gratuito' : fmtMoeda(t.valor)}
                        {t.inclui_alimentacao && ' · Alim.'}
                        {t.inclui_hospedagem  && ' · Hosp.'}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Serviços avulsos (se não tem tipo OU nenhum tipo selecionado) */}
            {(!temTipos || !tipoSel) && (
              <div className="flex flex-wrap gap-3 mb-1">
                {evento.permite_hospedagem && (
                  <ToggleService
                    label="🏨 Hospedagem"
                    active={form.hospedagem}
                    onClick={() => setField('hospedagem', !form.hospedagem)}
                  />
                )}
                {evento.permite_alimentacao && (
                  <ToggleService
                    label="🍽️ Alimentação"
                    active={form.alimentacao}
                    onClick={() => setField('alimentacao', !form.alimentacao)}
                  />
                )}
                {evento.permite_brinde && (
                  <ToggleService
                    label="🎁 Brinde"
                    active={form.brinde}
                    onClick={() => setField('brinde', !form.brinde)}
                  />
                )}
              </div>
            )}

            {/* Brinde avulso quando tipo está selecionado (brinde não entra no tipo) */}
            {tipoSel && evento.permite_brinde && (
              <div className="mt-2 flex gap-3">
                <ToggleService
                  label="🎁 Brinde"
                  active={form.brinde}
                  onClick={() => setField('brinde', !form.brinde)}
                />
              </div>
            )}

            {/* Campos AGO — aparecem quando AGO + hospedagem selecionada */}
            {evento.departamento === 'AGO' && evento.permite_hospedagem &&
              (form.hospedagem || tipoSel?.inclui_hospedagem) && (
              <div className="mt-4 border border-amber-500/40 bg-amber-500/10 rounded-xl p-4 space-y-3">
                <p className="text-amber-300 text-xs font-bold uppercase tracking-wider">🏨 Hospedagem AGO</p>

                {/* Necessidade especial */}
                <label className="flex items-start gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={form.hosp_necessidade_especial}
                    onChange={e => setField('hosp_necessidade_especial', e.target.checked)}
                    className="mt-0.5 accent-amber-400" />
                  <span className="text-sm text-white/80">
                    Possui <strong className="text-white">necessidade especial</strong>
                    <span className="block text-xs text-white/40">mobilidade reduzida, coluna, cirurgia recente…</span>
                  </span>
                </label>

                {form.hosp_necessidade_especial && (
                  <div>
                    <label className={labelCls + ' text-amber-300'}>Descreva a necessidade *</label>
                    <input
                      value={form.hosp_descricao_necessidade}
                      onChange={e => setField('hosp_descricao_necessidade', e.target.value)}
                      placeholder="Ex: usa andador, dificuldade em escadas..."
                      className={inputCls + ' border-amber-500/50'}
                    />
                  </div>
                )}

                {/* Cama inferior */}
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={form.hosp_cama_inferior}
                    onChange={e => setField('hosp_cama_inferior', e.target.checked)}
                    className="accent-amber-400" />
                  <span className="text-sm text-white/80">
                    Precisa de <strong className="text-white">cama inferior</strong> (beliche de baixo)
                  </span>
                </label>

                {/* Observações hospedagem */}
                <div>
                  <label className={labelCls + ' text-amber-300'}>Observações (opcional)</label>
                  <textarea
                    value={form.hosp_observacoes}
                    onChange={e => setField('hosp_observacoes', e.target.value)}
                    rows={2}
                    placeholder="Informações adicionais para a equipe de hospedagem..."
                    className={inputCls + ' resize-none border-amber-500/50'}
                  />
                </div>
              </div>
            )}
          </section>

          {/* ── Bloco 4: Cupom ── */}
          <section className="bg-[#123b63] rounded-2xl p-5 mb-4 border border-white/10">
            <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-[#F39C12] text-[#0D2B4E] rounded-full flex items-center justify-center text-xs font-black">4</span>
              Cupom de Desconto
              <span className="text-white/30 text-xs font-normal">(opcional)</span>
            </h2>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                name="cupom"
                value={form.cupom}
                onChange={e => { handleText(e); if (cupomStatus !== 'idle') { setCupomStatus('idle'); setCupomDesconto(0); setCupomMsg(''); } }}
                onKeyDown={e => e.key === 'Enter' && validarCupom()}
                className={inputCls + ' uppercase w-full sm:flex-1'}
                placeholder="Código do cupom"
                disabled={cupomStatus === 'ok'}
              />
              {cupomStatus === 'ok' ? (
                <button onClick={removerCupom} className="w-full sm:w-auto bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-lg text-sm font-semibold transition flex-shrink-0">
                  ✕ Remover
                </button>
              ) : (
                <button
                  onClick={validarCupom}
                  disabled={!form.cupom.trim() || cupomStatus === 'validando'}
                  className="w-full sm:w-auto bg-[#F39C12] hover:bg-[#D68910] disabled:opacity-40 text-[#0D2B4E] font-bold px-5 py-2.5 rounded-lg text-sm transition flex-shrink-0"
                >
                  {cupomStatus === 'validando' ? '...' : 'Aplicar'}
                </button>
              )}
            </div>
            {cupomMsg && (
              <p className={`mt-2 text-xs font-semibold ${cupomStatus === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>
                {cupomMsg}
              </p>
            )}
          </section>

          {/* ── Bloco 5: Pagamento ── */}
          <section className="bg-[#123b63] rounded-2xl p-5 mb-4 border border-white/10">
            <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
              <span className="w-6 h-6 bg-[#F39C12] text-[#0D2B4E] rounded-full flex items-center justify-center text-xs font-black">5</span>
              Pagamento
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 mb-4">
              {[
                { id: 'dinheiro',   label: '💵 Dinheiro'  },
                { id: 'pix_manual', label: '📱 PIX Manual' },
                { id: 'cartao',     label: '💳 Cartão'    },
                { id: 'isento',     label: '🎟️ Isento'    },
                { id: 'asaas',      label: '🔗 ASAAS'     },
              ].map(op => (
                <button
                  key={op.id}
                  type="button"
                  onClick={() => setField('forma_pagamento', op.id)}
                  className={`rounded-xl border-2 px-3 py-3 text-sm font-semibold transition ${
                    form.forma_pagamento === op.id
                      ? 'border-[#F39C12] bg-[#F39C12]/10 text-white'
                      : 'border-white/20 hover:border-white/40 text-white/60'
                  }`}
                >
                  {op.label}
                </button>
              ))}
            </div>
            {form.forma_pagamento === 'asaas' && (
              <p className="text-xs text-[#F39C12]/80 bg-[#F39C12]/10 rounded-lg px-3 py-2">
                ⚡ Será gerada cobrança ASAAS. O link de pagamento aparecerá na confirmação.
              </p>
            )}
          </section>

          {/* ── Bloco 6: Observações ── */}
          <section className="bg-[#123b63] rounded-2xl p-4 mb-4 border border-white/10">
            <label className={labelCls}>Observações (opcional)</label>
            <textarea
              name="observacoes"
              value={form.observacoes}
              onChange={handleText}
              rows={2}
              className={inputCls + ' resize-none'}
              placeholder="Anotações da inscrição..."
            />
          </section>

          {/* ── Rodapé: Valor + Botão ── */}
          <div className="relative sticky bottom-0 bg-[#0a2040] border-t border-white/10 p-4 flex flex-col sm:flex-row items-center gap-4">
            {/* Resumo do valor */}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                {valorBase > 0 && cupomDesconto > 0 && (
                  <div className="text-white/40 text-sm line-through">{fmtMoeda(valorBase)}</div>
                )}
                <div className={`text-3xl font-black ${valorFinal <= 0 || form.forma_pagamento === 'isento' ? 'text-emerald-400' : 'text-[#F39C12]'}`}>
                  {valorFinal <= 0 || form.forma_pagamento === 'isento' ? 'GRATUITO' : fmtMoeda(valorFinal)}
                </div>
                {cupomDesconto > 0 && (
                  <div className="bg-emerald-900/50 text-emerald-400 text-xs font-bold px-2 py-1 rounded-full border border-emerald-500/30">
                    −{fmtMoeda(cupomDesconto)}
                  </div>
                )}
                {tipoSel && (
                  <div className="text-white/50 text-xs bg-white/5 px-2 py-1 rounded-full truncate max-w-[150px]">{tipoSel.nome}</div>
                )}
              </div>
              <p className="text-white/30 text-xs mt-1">{form.forma_pagamento === 'asaas' ? 'Cobrança via ASAAS' : form.forma_pagamento === 'isento' ? 'Isento' : 'Pago na hora'}</p>
            </div>

            {/* Botões */}
            <div className="flex gap-2 flex-shrink-0 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => limparTudo()}
                className="flex-1 sm:flex-none border border-white/20 text-white/60 hover:text-white hover:border-white/40 px-5 py-3.5 rounded-xl text-sm font-semibold transition"
                title="Esc"
              >
                🗑️ Limpar
              </button>
              <button
                id="btn-confirmar"
                type="button"
                onClick={salvar}
                disabled={salvando || !form.nome.trim() || !form.supervisao_id}
                className="flex-1 sm:flex-none bg-emerald-500 hover:bg-emerald-400 active:scale-95 disabled:opacity-40 text-white font-black px-8 py-3.5 rounded-xl text-base transition"
                title="Ctrl+Enter"
              >
                {salvando ? (
                  <span className="flex items-center gap-2 justify-center"><span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" /> Salvando...</span>
                ) : (
                  '✅ Confirmar Inscrição'
                )}
              </button>
            </div>

            {erroSave && (
              <div className="w-full bg-red-600 border border-red-400 text-white px-4 py-3 rounded-xl text-sm font-bold flex items-start gap-2">
                <span className="text-xl flex-shrink-0">🚨</span>
                <span className="flex-1">{erroSave}</span>
                <button onClick={() => setErroSave(null)} className="ml-2 text-white/70 hover:text-white text-lg leading-none flex-shrink-0">×</button>
              </div>
            )}
          </div>
            </>
          )}

          {activeTab === 'inscritos' && (
            <div className="space-y-4">
              <div className="bg-[#123b63] rounded-2xl border border-white/10 p-4">
                <div className="flex flex-wrap gap-2">
                  <input
                    type="text"
                    placeholder="🔍 Buscar nome, CPF, WhatsApp"
                    value={buscaLista}
                    onChange={e => setBuscaLista(e.target.value)}
                    className={inputCls + ' w-full sm:flex-1 sm:min-w-[220px]'}
                  />
                  <select
                    value={filtroSup}
                    onChange={e => { setFiltroSup(e.target.value); setFiltroCampo(''); }}
                    className={inputCls + ' w-full sm:w-44'}
                  >
                    <option value="">Todas supervisões</option>
                    {supervisoesLista.map(s => (
                      <option key={s.id} value={s.id}>{s.nome}</option>
                    ))}
                  </select>
                  <select
                    value={filtroCampo}
                    onChange={e => setFiltroCampo(e.target.value)}
                    className={inputCls + ' w-full sm:w-44'}
                  >
                    <option value="">Todos campos</option>
                    {camposLista.map(c => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                  <select
                    value={filtroPag}
                    onChange={e => setFiltroPag(e.target.value)}
                    className={inputCls + ' w-full sm:w-40'}
                  >
                    <option value="">Pagamento</option>
                    <option value="pendente">Pendente</option>
                    <option value="pago">Pago</option>
                    <option value="isento">Isento</option>
                    <option value="cancelado">Cancelado</option>
                  </select>
                  <button
                    type="button"
                    onClick={limparFiltrosLista}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-lg text-xs font-bold bg-white/10 text-white/70 hover:bg-white/20 transition"
                  >
                    Limpar
                  </button>
                  <button
                    type="button"
                    onClick={() => fetchInscricoesLista()}
                    disabled={loadingLista}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-lg text-xs font-bold bg-[#F39C12] text-[#0D2B4E] hover:bg-[#D68910] disabled:opacity-50 transition"
                  >
                    {loadingLista ? 'Atualizando...' : 'Atualizar'}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-white/50">
                  <span>{inscritosFiltrados.length} inscrito(s)</span>
                  {precisaAtualizar && <span className="text-amber-300">Lista pendente de atualizacao</span>}
                </div>
                {listaMsg && (
                  <div className={`mt-3 text-xs font-bold px-3 py-2 rounded-lg border ${
                    listaMsg.tipo === 'ok'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : listaMsg.tipo === 'aviso'
                      ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                      : 'bg-red-500/10 border-red-500/30 text-red-300'
                  }`}>
                    {listaMsg.texto}
                  </div>
                )}
                {listaErro && (
                  <div className="mt-3 text-xs font-bold px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300">
                    {listaErro}
                  </div>
                )}
              </div>

              {loadingLista ? (
                <div className="bg-[#123b63] rounded-2xl border border-white/10 p-6 text-white/60 text-sm">
                  Carregando inscritos...
                </div>
              ) : inscritosFiltrados.length === 0 ? (
                <div className="bg-[#123b63] rounded-2xl border border-white/10 p-6 text-white/60 text-sm">
                  Nenhum inscrito encontrado com os filtros atuais.
                </div>
              ) : (
                <div className="bg-[#123b63] rounded-2xl border border-white/10 overflow-x-auto">
                  <table className="min-w-[1100px] w-full text-sm">
                    <thead className="bg-[#0a2040] text-white/70">
                      <tr>
                        {['Nome', 'Campo', 'Valor', 'Pagamento', 'Etiqueta', 'Ações'].map(h => (
                          <th key={h} className="text-left px-3 py-3 text-xs font-semibold whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {inscritosFiltrados.map(ins => {
                        const pagCfg = PAGAMENTO_CFG[ins.status_pagamento] ?? PAGAMENTO_CFG.pendente;
                        const valorExib = ins.valor_pago ?? ins.valor_final ?? 0;
                        const isDestaque = ins.id === destacarId;
                        const podeCert = perfil.podeCertificados && evento.gerar_certificado;
                        const elegivelCheckin = ['pago', 'isento'].includes(ins.status_pagamento);
                        const podeMostrarCheckin = podeCheckinManual && !ins.checkin_realizado && elegivelCheckin;
                        const podeMostrarCert = podeCert && !!ins.email && ins.checkin_realizado && elegivelCheckin;
                        const etiquetaAtiva = !!ins.etiqueta_impressa;
                        const etiquetaTooltip = etiquetaAtiva
                          ? 'Etiqueta impressa · Desmarcar impressão'
                          : 'Marcar etiqueta';
                        const hasAsaas = !!ins.asaas_payment_id && !!ins.invoice_url;
                        const podeAbrirPagamento = ins.status_pagamento === 'pendente';
                        const pagamentoTooltip = ins.status_pagamento === 'pendente'
                          ? (hasAsaas ? 'Abrir link de pagamento' : 'Gerar link ASAAS')
                          : ins.status_pagamento === 'cancelado'
                          ? 'Pagamento cancelado'
                          : 'Pagamento já confirmado';
                        return (
                          <tr
                            key={ins.id}
                            id={`insc-${ins.id}`}
                            className={`border-b border-white/5 ${isDestaque ? 'bg-amber-400/10' : 'hover:bg-white/5'}`}
                          >
                            <td className="px-3 py-3 text-white font-semibold whitespace-nowrap">
                              {ins.nome_inscrito}
                              {isDestaque && (
                                <span className="ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300">
                                  Recém cadastrada
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-white/70 whitespace-nowrap">{nomeCampo(ins.campo_id) || '-'}</td>
                            <td className="px-3 py-3 text-white whitespace-nowrap">{fmtMoeda(valorExib)}</td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <span className={`text-xs font-bold px-2 py-1 rounded-full ${pagCfg.cls}`}>{pagCfg.label}</span>
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              {ins.etiqueta_impressa ? '🏷️' : <span className="text-white/30">—</span>}
                            </td>
                            <td className="px-3 py-3 whitespace-nowrap">
                              <div className="flex flex-wrap gap-1">
                                {perfil.podeEditarInscricoes && (
                                  <button
                                    type="button"
                                    onClick={() => abrirEdicao(ins)}
                                    className="px-2 py-1 text-xs font-bold rounded-md bg-white/10 text-white/70 hover:bg-white/20"
                                    title="Editar inscrição"
                                  >
                                    ✏️
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => imprimirEtiqueta(ins)}
                                  className="px-2 py-1 text-xs font-bold rounded-md bg-purple-500/20 text-purple-200 hover:bg-purple-500/30"
                                  title="Imprimir etiqueta"
                                >
                                  🏷️
                                </button>
                                {perfil.podeEditarInscricoes && (
                                  <button
                                    type="button"
                                    onClick={() => alternarEtiquetaImpressa(ins)}
                                    disabled={marcandoEtiqueta[ins.id]}
                                    className={`px-2 py-1 text-xs font-bold rounded-md transition disabled:opacity-50 ${
                                      etiquetaAtiva
                                        ? 'bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30'
                                        : 'bg-white/10 text-white/60 hover:bg-white/20'
                                    }`}
                                    title={etiquetaTooltip}
                                  >
                                    {marcandoEtiqueta[ins.id] ? '⏳' : etiquetaAtiva ? '✅' : '🏷️'}
                                  </button>
                                )}
                                {perfil.podeComunicacao && (
                                  <button
                                    type="button"
                                    onClick={() => reenviarEmail(ins)}
                                    disabled={enviandoEmail[ins.id]}
                                    className="px-2 py-1 text-xs font-bold rounded-md bg-sky-500/20 text-sky-200 hover:bg-sky-500/30 disabled:opacity-50"
                                    title="Reenviar e-mail"
                                  >
                                    {enviandoEmail[ins.id] ? '⏳' : '✉️'}
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() => podeAbrirPagamento && abrirSegundaVia(ins, !hasAsaas)}
                                  disabled={!podeAbrirPagamento || abrindoPagamento[ins.id]}
                                  className="px-2 py-1 text-xs font-bold rounded-md bg-white/10 text-white/60 hover:bg-white/20 disabled:opacity-50"
                                  title={pagamentoTooltip}
                                >
                                  {abrindoPagamento[ins.id] ? '⏳' : '💳'}
                                </button>
                                {podeMostrarCheckin && (
                                  <button
                                    type="button"
                                    onClick={() => realizarCheckinManual(ins)}
                                    disabled={checkinManual[ins.id]}
                                    className="px-2 py-1 text-xs font-bold rounded-md bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30 disabled:opacity-50"
                                    title="Check-in manual"
                                  >
                                    {checkinManual[ins.id] ? '⏳' : '✅'}
                                  </button>
                                )}
                                {podeMostrarCert && (
                                  <button
                                    type="button"
                                    onClick={() => enviarCertificadoLista(ins)}
                                    disabled={enviandoCert[ins.id]}
                                    className="px-2 py-1 text-xs font-bold rounded-md bg-blue-500/20 text-blue-200 hover:bg-blue-500/30 disabled:opacity-50"
                                    title="Enviar certificado"
                                  >
                                    {enviandoCert[ins.id] ? '⏳' : '🎓'}
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {editando && editForm && (
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => { setEditando(null); setEditForm(null); }}>
              <div className="bg-[#123b63] border border-white/10 rounded-2xl w-full max-w-lg p-5" onClick={e => e.stopPropagation()}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-white font-bold text-sm">✏️ Editar inscrição</h3>
                    <p className="text-white/50 text-xs">{editando.nome_inscrito}</p>
                  </div>
                  <button className="text-white/60 hover:text-white text-lg" onClick={() => { setEditando(null); setEditForm(null); }}>×</button>
                </div>

                {erroEdit && (
                  <div className="mb-3 text-xs font-bold px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-300">
                    {erroEdit}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="sm:col-span-2">
                    <label className={labelCls}>Nome completo *</label>
                    <input
                      value={editForm.nome_inscrito}
                      onChange={e => setEditForm(f => f ? { ...f, nome_inscrito: e.target.value } : f)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>CPF</label>
                    <input
                      value={editForm.cpf}
                      onChange={e => setEditForm(f => f ? { ...f, cpf: e.target.value } : f)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>WhatsApp</label>
                    <input
                      value={editForm.whatsapp}
                      onChange={e => setEditForm(f => f ? { ...f, whatsapp: e.target.value } : f)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>E-mail</label>
                    <input
                      type="email"
                      value={editForm.email}
                      onChange={e => setEditForm(f => f ? { ...f, email: e.target.value } : f)}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Supervisão *</label>
                    <select
                      value={editForm.supervisao_id}
                      onChange={e => { setEditForm(f => f ? { ...f, supervisao_id: e.target.value, campo_id: '' } : f); }}
                      className={inputCls}
                    >
                      <option value="">Selecione...</option>
                      {supervisoes.map(s => <option key={s.id} value={s.id}>{s.nome}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>Campo</label>
                    <select
                      value={editForm.campo_id}
                      onChange={e => setEditForm(f => f ? { ...f, campo_id: e.target.value } : f)}
                      className={inputCls}
                    >
                      <option value="">Selecione...</option>
                      {campos.filter(c => !editForm.supervisao_id || c.supervisao_id === editForm.supervisao_id)
                        .map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                    </select>
                  </div>
                </div>

                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={() => { setEditando(null); setEditForm(null); }}
                    className="flex-1 border border-white/20 text-white/70 hover:text-white hover:border-white/40 py-2.5 rounded-lg text-sm font-bold transition"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={salvarEdicao}
                    disabled={salvandoEdit}
                    className="flex-1 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-white py-2.5 rounded-lg text-sm font-bold transition"
                  >
                    {salvandoEdit ? 'Salvando...' : 'Salvar'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Subcomponente: Serviço toggle ────────────────────────────────────────
function ToggleService({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border-2 px-5 py-2.5 text-sm font-semibold transition ${
        active
          ? 'border-[#F39C12] bg-[#F39C12]/15 text-[#F39C12]'
          : 'border-white/20 text-white/50 hover:border-white/40'
      }`}
    >
      {active ? '✓ ' : ''}{label}
    </button>
  );
}

// ─── Subcomponente: Tela de confirmação ───────────────────────────────────
function ConfirmacaoScreen({
  inscricao, evento, nomeSup, nomeCampo,
  valorFinal, formaPagamento, asaasData,
  contadorTotal, onNova, onImprimir, onVerLista,
}: {
  inscricao: InscricaoSalva;
  evento: { id: string; nome: string; departamento: string; data_inicio: string; data_fim: string; local: string | null; cidade: string | null; banner_url: string | null };
  nomeSup: string; nomeCampo: string;
  valorFinal: number; formaPagamento: string;
  asaasData: { invoiceUrl?: string; pixCopiaECola?: string; valor: number } | null;
  contadorTotal: number;
  onNova: () => void;
  onImprimir: () => void;
  onVerLista: () => void;
}) {
  const fmtMoeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  // Auto-foco no botão "Nova inscrição"
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setTimeout(() => btnRef.current?.focus(), 200);
  }, []);

  // Atalho Enter = nova inscrição
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Enter') { e.preventDefault(); onNova(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNova]);

  const isGratuito = valorFinal <= 0 || formaPagamento === 'isento';

  return (
    <div className="min-h-[70vh] bg-[#0D2B4E] flex flex-col items-center justify-center p-4">
      {/* Ícone de sucesso */}
      <div className="mb-6 text-center">
        <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-500/30">
          <span className="text-4xl">✅</span>
        </div>
        <h1 className="text-2xl font-black text-white">Inscrição Confirmada!</h1>
        <p className="text-emerald-400 text-sm mt-1 font-semibold">{contadorTotal} inscri{contadorTotal !== 1 ? 'ções realizadas' : 'ção realizada'} hoje</p>
      </div>

      {/* Card do inscrito */}
      <div className="w-full max-w-lg bg-[#123b63] rounded-2xl border border-white/10 overflow-hidden mb-6">
        {/* Preview crachá */}
        <div className="p-5 flex justify-center bg-gradient-to-b from-[#0D2B4E] to-[#123b63]">
          <EventBadge
            inscricao={inscricao}
            evento={evento}
            nomeSup={nomeSup}
            nomeCampo={nomeCampo}
            size="medium"
            printMode={false}
          />
        </div>

        {/* Dados resumo */}
        <div className="px-5 py-4 space-y-2">
          <Row label="Nome"       value={inscricao.nome_inscrito} />
          <Row label="Supervisão" value={nomeSup   || '-'}        />
          <Row label="Campo"      value={nomeCampo || '-'}        />
          <Row
            label="Pagamento"
            value={isGratuito ? 'Gratuito / Isento' : fmtMoeda(valorFinal) + ' — ' + (formaPagamento === 'pix_manual' ? 'PIX' : formaPagamento === 'asaas' ? 'ASAAS' : formaPagamento)}
            highlight={!isGratuito}
          />
          {inscricao.hospedagem  && <Row label="Hospedagem"  value="✓ Incluída"  />}
          {inscricao.alimentacao && <Row label="Alimentação" value="✓ Incluída"  />}
          {inscricao.brinde      && <Row label="Brinde"      value="✓ Incluído"  />}
        </div>

        {/* Dados ASAAS */}
        {asaasData && (
          <div className="px-5 pb-4 space-y-2">
            {asaasData.pixCopiaECola && (
              <div>
                <p className="text-xs text-white/50 mb-1">PIX Copia e Cola</p>
                <div className="bg-[#0D2B4E] rounded-lg px-3 py-2 text-xs text-white/70 font-mono break-all select-all">
                  {asaasData.pixCopiaECola}
                </div>
              </div>
            )}
            {asaasData.invoiceUrl && (
              <a
                href={asaasData.invoiceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-center bg-[#F39C12] hover:bg-[#D68910] text-[#0D2B4E] font-bold py-2.5 rounded-xl text-sm transition"
              >
                💳 Abrir Fatura ASAAS
              </a>
            )}
          </div>
        )}
      </div>

      {/* Ações */}
      <div className="flex flex-col gap-3 w-full max-w-lg">
        {/* Botão destaque: imprimir + nova */}
        <button
          type="button"
          onClick={() => { onImprimir(); setTimeout(onNova, 600); }}
          className="w-full bg-[#F39C12] hover:bg-[#D68910] active:scale-95 text-[#0D2B4E] font-black py-4 rounded-xl text-base transition shadow-lg shadow-[#F39C12]/30 flex items-center justify-center gap-2"
        >
          🖨️ Imprimir Crachá e Nova Inscrição
        </button>
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onImprimir}
            className="flex-1 border-2 border-[#F39C12]/40 hover:border-[#F39C12] text-[#F39C12] hover:bg-[#F39C12]/10 font-bold py-3 rounded-xl text-sm transition"
          >
            🖨️ Só Imprimir
          </button>
          <button
            ref={btnRef}
            type="button"
            onClick={onNova}
            className="flex-1 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-white font-black py-3 rounded-xl text-base transition shadow-lg shadow-emerald-500/30"
            title="Enter"
          >
            ➕ Nova Inscrição
          </button>
        </div>
        <button
          type="button"
          onClick={onVerLista}
          className="w-full border border-white/20 text-white/80 hover:text-white hover:border-white/40 py-3 rounded-xl text-sm font-bold transition"
        >
          👥 Ver na lista de inscritos
        </button>
      </div>
      <p className="text-white/30 text-xs mt-3">Enter = Nova inscrição &nbsp;&middot;&nbsp; Ctrl+P = Só imprimir</p>
    </div>
  );
}

// ─── Subcomponente: linha de resumo ───────────────────────────────────────
function Row({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-sm">
      <span className="text-white/40 text-xs">{label}</span>
      <span className={`font-semibold ${highlight ? 'text-[#F39C12]' : 'text-white'}`}>{value}</span>
    </div>
  );
}
