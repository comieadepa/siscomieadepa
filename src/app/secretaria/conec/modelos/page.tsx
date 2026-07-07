'use client';

export const dynamic = 'force-dynamic';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import InteractiveCanvas from '@/components/InteractiveCanvas';
import { useRequireSupabaseAuth } from '@/hooks/useRequireSupabaseAuth';
import { createClient } from '@/lib/supabase-client';
import { resolveMinistryId } from '@/lib/cartoes-templates-sync';
import {
  loadCertificadosTemplatesForCurrentUser,
  persistCertificadosTemplatesSnapshotToSupabase,
} from '@/lib/certificados-templates-sync';
import { Award, Trash2, RefreshCw } from 'lucide-react';
import { obterPreviewTextoCertificado } from '@/lib/certificados-utils';
import ToastNotification, { useToasts } from '@/components/ToastNotification';

const SAFE_AREA_MARGIN = 25;

const ELEMENTOS_TIPOS = [
  { tipo: 'texto',          label: 'Texto / Campo Dinâmico', icone: '📝' },
  { tipo: 'caixa',          label: 'Caixa de Campo',         icone: '🔲' },
  { tipo: 'tabela',         label: 'Tabela',                 icone: '📊' },
  { tipo: 'logo',           label: 'Logo Oficial',           icone: '🏛️' },
  { tipo: 'imagem',         label: 'Imagem / Fundo',         icone: '🖼️' },
  { tipo: 'chapa',          label: 'Linha / Divisor',        icone: '━' },
  { tipo: 'qr_conec',       label: 'QR Code Validação',      icone: '▣' },
];

interface CertificadoElemento {
  id: string;
  tipo: 'texto' | 'logo' | 'imagem' | 'chapa' | 'foto-membro' | 'qrcode' | 'caixa' | 'tabela';
  x: number;
  y: number;
  largura: number;
  altura: number;
  fontSize?: number;
  cor?: string;
  fonte?: string;
  transparencia?: number;
  texto?: string;
  alinhamento?: 'left' | 'center' | 'right' | 'justify';
  negrito?: boolean;
  italico?: boolean;
  sublinhado?: boolean;
  imagemUrl?: string;
  visivel: boolean;
  borderWidth?: number;
  borderColor?: string;
  borderRadius?: number;
  backgroundColor?: string;
  padding?: number;
  linhas?: string[][];
}

interface CertificadoTemplate {
  id: string;
  nome: string;
  backgroundUrl?: string;
  elementos: CertificadoElemento[];
  orientacao?: 'landscape' | 'portrait';
  largura?: number;
  altura?: number;
  document_type?: string;
  ativo?: boolean;
  criado_pelo_usuario?: boolean;
}

const gId = () =>
  typeof crypto !== 'undefined' && (crypto as any).randomUUID
    ? (crypto as any).randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const novoTemplateEmBranco = (nome: string, type: 'termo' | 'certificado'): CertificadoTemplate => {
  const isTermo = type === 'termo';
  return {
    id: gId(),
    nome: `${nome} (${isTermo ? 'Termo A4' : 'Certificado CONEC'})`,
    orientacao: isTermo ? 'portrait' : 'landscape',
    largura: isTermo ? 794 : 1123,
    altura: isTermo ? 1123 : 794,
    ativo: false,
    criado_pelo_usuario: true,
    elementos: [],
    document_type: isTermo ? 'termo_conec' : 'certificado_conec',
  } as any;
};

export default function ConecTemplatesPage() {
  const { loading } = useRequireSupabaseAuth();
  const supabase = useMemo(() => createClient(), []);

  const backgroundInputRef = useRef<HTMLInputElement>(null);
  const imagemInputRef = useRef<HTMLInputElement>(null);
  const [canvasScale, setCanvasScale] = useState(1);
  const roRef = useRef<ResizeObserver | null>(null);

  // Calcula escala com base na orientação do modelo
  const [orientacaoAtual, setOrientacaoAtual] = useState<'landscape' | 'portrait'>('landscape');
  
  const currentCanvasWidth = orientacaoAtual === 'portrait' ? 794 : 1123;
  const currentCanvasHeight = orientacaoAtual === 'portrait' ? 1123 : 794;

  const canvasWrapperRef = useCallback((el: HTMLDivElement | null) => {
    if (roRef.current) { roRef.current.disconnect(); roRef.current = null; }
    if (!el) return;
    const update = () => {
      const parentWidth = el.clientWidth - 64; // 32px padding left/right
      const parentHeight = el.clientHeight - 80; // 40px padding top/bottom
      const scaleX = parentWidth / currentCanvasWidth;
      const scaleY = parentHeight / currentCanvasHeight;
      const newScale = Math.max(0.15, Math.min(scaleX, scaleY, 1.0)); // Zoom max 100%, min 15%
      setCanvasScale(newScale);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    roRef.current = ro;
  }, [currentCanvasWidth, currentCanvasHeight]);

  const [loadingData, setLoadingData]     = useState(true);
  const [ministryId, setMinistryId]       = useState<string | null>(null);

  const [templates, setTemplates]                         = useState<CertificadoTemplate[]>([]);
  const [salvando, setSalvando]                           = useState(false);
  const [templateEmEdicao, setTemplateEmEdicao]           = useState<CertificadoTemplate | null>(null);
  const [elementoSelecionado, setElementoSelecionado]     = useState<CertificadoElemento | null>(null);
  const [elementosSelecionados, setElementosSelecionados] = useState<CertificadoElemento[]>([]);
  const [statusMensagem, setStatusMensagem]               = useState('');
  const [novoNome, setNovoNome]                           = useState('');
  const [renomearId, setRenomearId]                       = useState<string | null>(null);
  const [renomearNome, setRenomearNome]                   = useState('');
  const [confirmDeleteId, setConfirmDeleteId]             = useState<string | null>(null);

  const { toasts, showToast, removeToast } = useToasts();

  const mostrarStatus = (msg: string) => {
    setStatusMensagem(msg);
    setTimeout(() => setStatusMensagem(''), 3000);
  };

  useEffect(() => {
    if (loading) return;
    setLoadingData(true);
    (async () => {
      const mid = await resolveMinistryId(supabase);
      setMinistryId(mid);
      const res = await loadCertificadosTemplatesForCurrentUser(supabase);
      // Filtrar apenas templates do CONEC ou templates genéricos
      const conecTemplates = (res.templates as any[]).filter(
        t => t.document_type === 'termo_conec' || t.document_type === 'certificado_conec' ||
             t.nome.toLowerCase().includes('conec') || t.nome.toLowerCase().includes('termo') || t.nome.toLowerCase().includes('credenciamento')
      ).map(t => ({
        ...t,
        document_type: t.document_type || (t.nome.toLowerCase().includes('termo') ? 'termo_conec' : 'certificado_conec')
      }));
      setTemplates(conecTemplates);
      if (conecTemplates.length > 0) {
        setTemplateEmEdicao(conecTemplates[0]);
        setOrientacaoAtual(conecTemplates[0].orientacao || 'landscape');
      }
      setLoadingData(false);
    })();
  }, [loading, supabase]);

  /* ---------- mutacoes de template ---------- */

  const salvarTodos = async (prox: CertificadoTemplate[]) => {
    setTemplates(prox);
    if (ministryId) {
      // Carregar todos os outros templates para não sobrescrever os templates normais de certificados do ministério
      const res = await loadCertificadosTemplatesForCurrentUser(supabase);
      const normalTemplates = (res.templates as any[]).filter(
        t => !(t.nome.toLowerCase().includes('conec') || t.nome.toLowerCase().includes('termo') || t.nome.toLowerCase().includes('credenciamento'))
      );
      await persistCertificadosTemplatesSnapshotToSupabase(supabase, ministryId, [...normalTemplates, ...prox]);
    }
  };

  const handleCriarNovo = async (type: 'termo' | 'certificado') => {
    const nome = novoNome.trim() || `Modelo CONEC ${templates.length + 1}`;
    const tmpl = novoTemplateEmBranco(nome, type);
    const prox = [...templates, tmpl];
    await salvarTodos(prox);
    setTemplateEmEdicao(tmpl);
    setOrientacaoAtual(tmpl.orientacao || 'landscape');
    setNovoNome('');
    showToast('success', `✔ Modelo "${nome}" criado.`);
  };

  const handleSalvar = async () => {
    if (!templateEmEdicao || !ministryId) return;
    setSalvando(true);
    try {
      const prox = templates.map((t) => (t.id === templateEmEdicao.id ? templateEmEdicao : t));
      await salvarTodos(prox);
      showToast('success', '✔ Modelo salvo com sucesso.');

      // Recarrega do banco para garantir persistencia
      const res = await loadCertificadosTemplatesForCurrentUser(supabase);
      const conecTemplates = (res.templates as any[]).filter(
        t => t.document_type === 'termo_conec' || t.document_type === 'certificado_conec' ||
             t.nome.toLowerCase().includes('conec') || t.nome.toLowerCase().includes('termo') || t.nome.toLowerCase().includes('credenciamento')
      ).map(t => ({
        ...t,
        document_type: t.document_type || (t.nome.toLowerCase().includes('termo') ? 'termo_conec' : 'certificado_conec')
      }));
      setTemplates(conecTemplates);
      const updated = conecTemplates.find(t => t.id === templateEmEdicao.id);
      if (updated) {
        setTemplateEmEdicao(updated);
        setOrientacaoAtual(updated.orientacao || 'landscape');
      }
    } catch (err: any) {
      showToast('error', '❌ Não foi possível salvar o modelo: ' + (err.message || String(err)));
    } finally {
      setSalvando(false);
    }
  };

  const handleRenomear = async (id: string) => {
    const nome = renomearNome.trim();
    if (!nome) return;
    const prox = templates.map((t) => (t.id === id ? { ...t, nome } : t));
    await salvarTodos(prox);
    if (templateEmEdicao?.id === id) setTemplateEmEdicao((prev) => prev ? { ...prev, nome } : prev);
    setRenomearId(null);
    mostrarStatus('Modelo renomeado.');
  };

  const handleDeletar = async (id: string) => {
    const prox = templates.filter((t) => t.id !== id);
    await salvarTodos(prox);
    if (templateEmEdicao?.id === id) {
      setTemplateEmEdicao(prox[0] ?? null);
      if (prox[0]) setOrientacaoAtual(prox[0].orientacao || 'landscape');
    }
    setConfirmDeleteId(null);
    showToast('info', '🗑 Modelo removido.');
  };

  const handleSelect = (t: CertificadoTemplate) => {
    setTemplateEmEdicao(t);
    setOrientacaoAtual(t.orientacao || 'landscape');
    setElementoSelecionado(null);
    setElementosSelecionados([]);
  };

  /* ---------- canvas helpers ---------- */

  const updateEl = (id: string, props: Partial<CertificadoElemento>) => {
    if (!templateEmEdicao) return;
    setTemplateEmEdicao({
      ...templateEmEdicao,
      elementos: templateEmEdicao.elementos.map((el) =>
        el.id === id ? { ...el, ...props } : el
      ),
    });
  };

  const updateMultiplos = (
    items: Array<{ id: string; propriedades: Partial<CertificadoElemento> }>
  ) => {
    if (!templateEmEdicao) return;
    const mapa = new Map(items.map((i) => [i.id, i.propriedades]));
    setTemplateEmEdicao({
      ...templateEmEdicao,
      elementos: templateEmEdicao.elementos.map((el) =>
        mapa.has(el.id) ? { ...el, ...mapa.get(el.id) } : el
      ),
    });
  };


  const handleAddEl = (tipo: any) => {
    if (!templateEmEdicao) return;
    let base: CertificadoElemento;
    const bx = SAFE_AREA_MARGIN + 10;
    const by = SAFE_AREA_MARGIN + 10;

    if (tipo === 'chapa') {
      base = {
        id: gId(),
        tipo: 'chapa',
        x: bx,
        y: by,
        largura: 250,
        altura: 6,
        cor: '#b89353',
        transparencia: 1,
        visivel: true
      };
    } else if (tipo === 'qr_conec') {
      base = {
        id: gId(),
        tipo: 'qrcode',
        x: bx,
        y: by,
        largura: 110,
        altura: 110,
        texto: 'qr_code_validacao',
        visivel: true
      };
    } else if (tipo === 'logo') {
      base = {
        id: gId(),
        tipo: 'logo',
        x: bx,
        y: by,
        largura: 120,
        altura: 120,
        imagemUrl: '/img/logo_conec.png',
        visivel: true
      };
    } else if (tipo === 'imagem') {
      base = {
        id: gId(),
        tipo: 'imagem',
        x: bx,
        y: by,
        largura: 200,
        imagemUrl: '/img/bg_termo.jpg',
        altura: 200,
        visivel: true
      };
    } else if (tipo === 'caixa') {
      base = {
        id: gId(),
        tipo: 'caixa',
        x: bx,
        y: by,
        largura: 350,
        altura: 80,
        fontSize: 14,
        cor: '#111827',
        fonte: 'Arial',
        alinhamento: 'left',
        texto: 'NOME: {nome_instituicao}',
        borderWidth: 1,
        borderColor: '#b89353',
        borderRadius: 4,
        backgroundColor: '#ffffff',
        padding: 8,
        visivel: true
      };
    } else if (tipo === 'tabela') {
      base = {
        id: gId(),
        tipo: 'tabela',
        x: bx,
        y: by,
        largura: 400,
        altura: 100,
        fontSize: 12,
        cor: '#111827',
        fonte: 'Arial',
        alinhamento: 'left',
        borderWidth: 1,
        borderColor: '#cbd5e1',
        backgroundColor: '#ffffff',
        padding: 4,
        linhas: [
          ['Item', 'Descrição'],
          ['Registro', '{numero_credenciamento}'],
          ['Validade', '{data_validade}']
        ],
        visivel: true
      };
    } else {
      base = {
        id: gId(),
        tipo: 'texto',
        x: bx,
        y: by,
        largura: 350,
        altura: 60,
        fontSize: 18,
        cor: '#111827',
        fonte: 'Arial',
        alinhamento: 'left',
        texto: 'Novo Bloco de Texto',
        visivel: true
      };
    }

    setTemplateEmEdicao({
      ...templateEmEdicao,
      elementos: [...templateEmEdicao.elementos, base],
    });
    setElementoSelecionado(base);
    setElementosSelecionados([base]);
  };

  const handleApplyPreset = (presetType: string) => {
    if (!templateEmEdicao) return;
    const bx = SAFE_AREA_MARGIN + 10;
    const by = SAFE_AREA_MARGIN + 10;
    let base: CertificadoElemento;

    switch (presetType) {
      case 'campo_com_borda':
        base = {
          id: gId(),
          tipo: 'caixa',
          x: bx,
          y: by,
          largura: 350,
          altura: 60,
          fontSize: 14,
          cor: '#1b202c',
          fonte: 'Arial',
          alinhamento: 'left',
          texto: 'NOME DA INSTITUIÇÃO: {nome_instituicao}',
          borderWidth: 1,
          borderColor: '#b89353',
          borderRadius: 4,
          backgroundColor: '#ffffff',
          padding: 8,
          visivel: true
        };
        break;
      case 'linha_dupla':
        base = {
          id: gId(),
          tipo: 'caixa',
          x: bx,
          y: by,
          largura: 400,
          altura: 8,
          texto: '',
          borderWidth: 3,
          borderColor: '#b89353',
          borderRadius: 0,
          backgroundColor: 'transparent',
          padding: 0,
          visivel: true
        };
        break;
      case 'caixa_observacoes':
        base = {
          id: gId(),
          tipo: 'caixa',
          x: bx,
          y: by,
          largura: 500,
          altura: 150,
          fontSize: 12,
          cor: '#374151',
          fonte: 'Arial',
          alinhamento: 'justify' as any,
          texto: 'Observações: {observacoes}',
          borderWidth: 1,
          borderColor: '#9ca3af',
          borderRadius: 6,
          backgroundColor: '#f9fafb',
          padding: 12,
          visivel: true
        };
        break;
      case 'tabela_2_colunas':
        base = {
          id: gId(),
          tipo: 'tabela',
          x: bx,
          y: by,
          largura: 450,
          altura: 120,
          fontSize: 12,
          cor: '#111827',
          fonte: 'Arial',
          alinhamento: 'left',
          borderWidth: 1,
          borderColor: '#b89353',
          backgroundColor: '#ffffff',
          padding: 6,
          linhas: [
            ['PARÂMETRO', 'VALOR'],
            ['CNPJ', '{cnpj}'],
            ['Cidade/UF', '{municipio} - {uf}'],
            ['Status', '{status}']
          ],
          visivel: true
        };
        break;
      case 'tabela_1_coluna':
        base = {
          id: gId(),
          tipo: 'tabela',
          x: bx,
          y: by,
          largura: 300,
          altura: 100,
          fontSize: 12,
          cor: '#111827',
          fonte: 'Arial',
          alinhamento: 'center',
          borderWidth: 1,
          borderColor: '#cbd5e1',
          backgroundColor: '#ffffff',
          padding: 6,
          linhas: [
            ['INFORMAÇÕES ADICIONAIS'],
            ['Diretor: {responsavel}'],
            ['Endereço: {endereco}']
          ],
          visivel: true
        };
        break;
      default:
        return;
    }

    setTemplateEmEdicao({
      ...templateEmEdicao,
      elementos: [...templateEmEdicao.elementos, base],
    });
    setElementoSelecionado(base);
    setElementosSelecionados([base]);
  };

  const handleDeletarElemento = (elId: string) => {
    if (!templateEmEdicao) return;
    setTemplateEmEdicao({
      ...templateEmEdicao,
      elementos: templateEmEdicao.elementos.filter((el) => el.id !== elId),
    });
    setElementoSelecionado(null);
    setElementosSelecionados([]);
  };

  /* ---------- upload de background e imagens ---------- */

  const handleBgUploadClick = () => backgroundInputRef.current?.click();
  const handleImgUploadClick = () => imagemInputRef.current?.click();

  const handleBgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !templateEmEdicao || !ministryId) return;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/v1/secretaria/uploads/conec-template-asset', {
        method: 'POST',
        body: formData,
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Erro ao enviar arquivo.');

      setTemplateEmEdicao({ ...templateEmEdicao, backgroundUrl: resData.url });
      showToast('success', '✔ Background enviado com sucesso.');
    } catch (err: any) {
      showToast('error', '❌ Erro ao enviar o background: ' + (err.message || String(err)));
    } finally {
      e.target.value = '';
    }
  };

  const handleImgUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !templateEmEdicao || !ministryId) return;

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/v1/secretaria/uploads/conec-template-asset', {
        method: 'POST',
        body: formData,
      });

      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || 'Erro ao enviar arquivo.');
      
      const elImg: CertificadoElemento = {
        id: gId(),
        tipo: 'imagem',
        x: SAFE_AREA_MARGIN + 10,
        y: SAFE_AREA_MARGIN + 10,
        largura: 150,
        altura: 150,
        imagemUrl: resData.url,
        visivel: true,
      };

      setTemplateEmEdicao({
        ...templateEmEdicao,
        elementos: [...templateEmEdicao.elementos, elImg],
      });
      setElementoSelecionado(elImg);
      setElementosSelecionados([elImg]);
      showToast('success', '✔ Upload concluído. Imagem adicionada ao modelo.');
    } catch (err: any) {
      showToast('error', '❌ Erro ao adicionar imagem: ' + (err.message || String(err)));
    } finally {
      e.target.value = '';
    }
  };

  if (loading || loadingData) {
    return (
      <div className="flex h-screen bg-gray-100 items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-gray-100">
      <Sidebar activeMenu="conec-editor" setActiveMenu={() => {}} />

      <div className="flex-grow flex flex-col overflow-hidden">
        {/* Topbar */}
        <div className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10 shadow-sm shrink-0">
          <div className="flex items-center gap-3">
            <Award className="w-6 h-6 text-emerald-600" />
            <h1 className="text-lg font-bold text-gray-800">Modelos de Credenciamento CONEC</h1>
            {statusMensagem && (
              <span className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg border border-emerald-250 animate-pulse">
                {statusMensagem}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleSalvar}
              disabled={!templateEmEdicao || salvando}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold px-4 py-2 rounded-xl text-sm transition shadow-md disabled:opacity-50"
            >
              {salvando ? '💾 Salvando...' : '💾 Salvar Alterações'}
            </button>
          </div>
        </div>

        {/* Content Pane */}
        <div className="flex-1 flex overflow-hidden">
          {/* Esquerda: Lista de Modelos */}
          <div className="w-72 bg-white border-r border-gray-200 flex flex-col shrink-0">
            <div className="p-4 border-b border-gray-100 flex flex-col gap-2">
              <input
                type="text"
                placeholder="Nome do novo modelo..."
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => handleCriarNovo('termo')}
                  className="bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold py-2 rounded-lg text-[10px] text-center border border-emerald-150 transition"
                >
                  📄 Criar Termo A4
                </button>
                <button
                  onClick={() => handleCriarNovo('certificado')}
                  className="bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold py-2 rounded-lg text-[10px] text-center border border-blue-150 transition"
                >
                  📜 Criar Certificado
                </button>
              </div>
            </div>

            <div className="flex-grow overflow-y-auto p-4 space-y-2">
              {templates.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">Nenhum modelo CONEC criado.</p>
              ) : (
                templates.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => handleSelect(t)}
                    className={`p-3 rounded-xl border-2 transition cursor-pointer flex flex-col gap-1.5 ${
                      templateEmEdicao?.id === t.id
                        ? 'border-emerald-500 bg-emerald-50/30'
                        : 'border-gray-150 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      {renomearId === t.id ? (
                        <input
                          type="text"
                          value={renomearNome}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setRenomearNome(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRenomear(t.id);
                            if (e.key === 'Escape') setRenomearId(null);
                          }}
                          className="border border-gray-300 rounded px-1.5 py-0.5 text-xs w-36"
                          autoFocus
                        />
                      ) : (
                        <span className="text-xs font-bold text-gray-800 truncate max-w-[160px]">{t.nome}</span>
                      )}

                      <div className="flex items-center gap-1">
                        {renomearId === t.id ? (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleRenomear(t.id); }}
                            className="text-xs text-emerald-600 hover:underline"
                          >
                            Ok
                          </button>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); setRenomearId(t.id); setRenomearNome(t.nome); }}
                            className="text-[10px] text-gray-400 hover:text-emerald-600 font-medium"
                          >
                            Renomear
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(t.id); }}
                          className="text-gray-400 hover:text-red-500"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[10px] text-gray-500">
                      <span>Orientação: {t.orientacao === 'portrait' ? 'Retrato (A4)' : 'Paisagem'}</span>
                      {t.ativo && <span className="text-emerald-600 font-bold uppercase">Ativo</span>}
                    </div>

                    {confirmDeleteId === t.id && (
                      <div className="mt-2 bg-red-50 border border-red-250 p-2 rounded-lg" onClick={(e) => e.stopPropagation()}>
                        <p className="text-[10px] text-red-800 font-bold">Deseja excluir permanentemente?</p>
                        <div className="flex gap-2 mt-1">
                          <button onClick={() => handleDeletar(t.id)} className="bg-red-600 text-white px-2 py-0.5 rounded text-[10px] font-bold">Sim</button>
                          <button onClick={() => setConfirmDeleteId(null)} className="bg-gray-200 text-gray-800 px-2 py-0.5 rounded text-[10px]">Não</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Centro: Canvas */}
          {/* Centro: Canvas (Com área cinza estilo workspace) */}
          <div ref={canvasWrapperRef} className="flex-grow bg-gray-200 p-8 flex items-center justify-center overflow-auto relative">
            {templateEmEdicao ? (
              <div className="flex flex-col gap-3 items-center">
                <div className="flex items-center justify-between text-xs text-gray-600 px-1 w-full max-w-full">
                  <span>Modelo em edição: <strong>{templateEmEdicao.nome}</strong> (A4 {orientacaoAtual === 'portrait' ? 'Retrato' : 'Paisagem'} - {Math.round(canvasScale * 100)}%)</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => {
                        const newOr = orientacaoAtual === 'portrait' ? 'landscape' : 'portrait';
                        setOrientacaoAtual(newOr);
                        setTemplateEmEdicao({
                          ...templateEmEdicao,
                          orientacao: newOr,
                          largura: newOr === 'portrait' ? 794 : 1123,
                          altura: newOr === 'portrait' ? 1123 : 794
                        });
                      }}
                      className="text-emerald-700 hover:underline flex items-center gap-1 font-semibold"
                    >
                      <RefreshCw className="w-3 h-3" /> Alternar Orientação
                    </button>
                  </div>
                </div>

                <div 
                  style={{
                    width: `${currentCanvasWidth * canvasScale}px`,
                    height: `${currentCanvasHeight * canvasScale}px`,
                    position: 'relative',
                    boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
                    borderRadius: '4px',
                    overflow: 'hidden',
                  }}
                  className="shrink-0 bg-white"
                >
                  <div
                    style={{
                      width: `${currentCanvasWidth}px`,
                      height: `${currentCanvasHeight}px`,
                      transform: `scale(${canvasScale})`,
                      transformOrigin: 'top left',
                      position: 'absolute',
                      left: 0,
                      top: 0,
                    }}
                  >
                    <InteractiveCanvas
                      elementos={templateEmEdicao.elementos}
                      elementoSelecionado={elementoSelecionado}
                      elementosSelecionados={elementosSelecionados}
                      onElementoSelecionado={setElementoSelecionado}
                      onElementosSelecionados={setElementosSelecionados}
                      onElementoAtualizado={updateEl}
                      onMultiplosElementosAtualizados={updateMultiplos}
                      onElementoRemovido={handleDeletarElemento}
                      getPreviewText={obterPreviewTextoCertificado}
                      backgroundUrl={templateEmEdicao.backgroundUrl || ''}
                      larguraCanvas={currentCanvasWidth}
                      alturaCanvas={currentCanvasHeight}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center p-8 bg-white border border-gray-200 rounded-2xl shadow max-w-sm">
                <Award className="w-12 h-12 text-gray-300 mx-auto mb-3" />
                <h3 className="text-sm font-bold text-gray-800 mb-1">Nenhum modelo selecionado</h3>
                <p className="text-xs text-gray-500 leading-relaxed">Selecione ou crie um modelo ao lado para iniciar a edição visual.</p>
              </div>
            )}
          </div>

          {/* Direita: Propriedades e Elementos */}
          <div className="w-80 bg-white border-l border-gray-200 flex flex-col shrink-0 overflow-y-auto">
            {/* Seletor de Elementos */}
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Adicionar Elemento</h3>
              <div className="grid grid-cols-2 gap-2">
                {ELEMENTOS_TIPOS.map((el) => (
                  <button
                    key={el.tipo}
                    onClick={() => handleAddEl(el.tipo)}
                    disabled={!templateEmEdicao}
                    className="flex items-center gap-2 bg-gray-50 hover:bg-emerald-50 hover:text-emerald-700 text-gray-700 border border-gray-200 px-3 py-2 rounded-xl text-[10px] font-bold text-left transition disabled:opacity-50"
                  >
                    <span>{el.icone}</span>
                    <span className="truncate">{el.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Imagem de Fundo e Uploads */}
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Upload de Mídias</h3>
              <div className="flex gap-2">
                <button
                  onClick={handleBgUploadClick}
                  disabled={!templateEmEdicao}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2 rounded-lg text-[10px] text-center border border-gray-250 transition disabled:opacity-50"
                >
                  🖼️ Upload Fundo
                </button>
                <button
                  onClick={handleImgUploadClick}
                  disabled={!templateEmEdicao}
                  className="flex-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold py-2 rounded-lg text-[10px] text-center border border-gray-250 transition disabled:opacity-50"
                >
                  ➕ Upload Assinatura/Logo
                </button>
              </div>
            </div>

            {/* Presets Rápidos */}
            <div className="p-4 border-b border-gray-100">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Presets Rápidos</h3>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  onClick={() => handleApplyPreset('campo_com_borda')}
                  disabled={!templateEmEdicao}
                  className="bg-gray-50 hover:bg-emerald-50 hover:text-emerald-700 text-gray-700 border border-gray-200 px-2 py-1.5 rounded-lg text-[9px] font-bold text-center transition disabled:opacity-50"
                >
                  🔲 Campo com borda
                </button>
                <button
                  onClick={() => handleApplyPreset('linha_dupla')}
                  disabled={!templateEmEdicao}
                  className="bg-gray-50 hover:bg-emerald-50 hover:text-emerald-700 text-gray-700 border border-gray-200 px-2 py-1.5 rounded-lg text-[9px] font-bold text-center transition disabled:opacity-50"
                >
                  ━ Linha dupla
                </button>
                <button
                  onClick={() => handleApplyPreset('caixa_observacoes')}
                  disabled={!templateEmEdicao}
                  className="bg-gray-50 hover:bg-emerald-50 hover:text-emerald-700 text-gray-700 border border-gray-200 px-2 py-1.5 rounded-lg text-[9px] font-bold text-center transition disabled:opacity-50 col-span-2"
                >
                  📝 Caixa de observações
                </button>
                <button
                  onClick={() => handleApplyPreset('tabela_2_colunas')}
                  disabled={!templateEmEdicao}
                  className="bg-gray-50 hover:bg-emerald-50 hover:text-emerald-700 text-gray-700 border border-gray-200 px-2 py-1.5 rounded-lg text-[9px] font-bold text-center transition disabled:opacity-50"
                >
                  📊 Tabela 2 colunas
                </button>
                <button
                  onClick={() => handleApplyPreset('tabela_1_coluna')}
                  disabled={!templateEmEdicao}
                  className="bg-gray-50 hover:bg-emerald-50 hover:text-emerald-700 text-gray-700 border border-gray-200 px-2 py-1.5 rounded-lg text-[9px] font-bold text-center transition disabled:opacity-50"
                >
                  📊 Tabela 1 coluna
                </button>
              </div>
            </div>

            {/* Propriedades do Elemento Selecionado */}
            <div className="p-4 flex-grow">
              <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Propriedades</h3>
              {elementoSelecionado ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between bg-gray-50 p-2.5 rounded-lg border border-gray-150">
                    <span className="text-[10px] text-gray-500 font-mono">ID: {elementoSelecionado.id.slice(0, 8)}</span>
                    <button
                      onClick={() => handleDeletarElemento(elementoSelecionado.id)}
                      className="text-xs text-red-600 hover:underline font-bold"
                    >
                      Remover Elemento
                    </button>
                  </div>

                  {/* URL da Imagem */}
                  {(elementoSelecionado.tipo === 'imagem' || elementoSelecionado.tipo === 'logo') && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1.5 uppercase">URL da Imagem</label>
                      <input
                        type="text"
                        value={elementoSelecionado.imagemUrl || ''}
                        onChange={(e) => updateEl(elementoSelecionado.id, { imagemUrl: e.target.value })}
                        placeholder="https://exemplo.com/imagem.png"
                        className="w-full border border-gray-350 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                      />
                    </div>
                  )}

                  {/* Conteúdo do Texto / Caixa */}
                  {(elementoSelecionado.tipo === 'texto' || elementoSelecionado.tipo === 'caixa') && (
                    <div>
                      <label className="block text-[10px] font-bold text-gray-600 mb-1.5 uppercase">Conteúdo do Texto</label>
                      <textarea
                        value={elementoSelecionado.texto || ''}
                        onChange={(e) => updateEl(elementoSelecionado.id, { texto: e.target.value })}
                        rows={3}
                        className="w-full border border-gray-300 rounded-lg px-2.5 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
                      />
                    </div>
                  )}

                  {/* Configurações de Borda, Fundo e Margens (Para Caixa e Tabela) */}
                  {(elementoSelecionado.tipo === 'caixa' || elementoSelecionado.tipo === 'tabela') && (
                    <div className="border border-gray-200 p-3 rounded-lg bg-gray-50 space-y-2.5">
                      <span className="block text-[9px] font-bold text-gray-400 uppercase">Aparência do Bloco</span>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-bold text-gray-500 uppercase">Borda (px)</label>
                          <input
                            type="number"
                            min={0}
                            max={20}
                            value={elementoSelecionado.borderWidth ?? 1}
                            onChange={(e) => updateEl(elementoSelecionado.id, { borderWidth: parseInt(e.target.value, 10) || 0 })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-gray-500 uppercase">Cor Borda</label>
                          <input
                            type="color"
                            value={elementoSelecionado.borderColor || '#000000'}
                            onChange={(e) => updateEl(elementoSelecionado.id, { borderColor: e.target.value })}
                            className="w-full h-8 border border-gray-350 rounded p-0.5 cursor-pointer bg-white"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-bold text-gray-500 uppercase">Fundo</label>
                          <input
                            type="color"
                            value={elementoSelecionado.backgroundColor || '#ffffff'}
                            onChange={(e) => updateEl(elementoSelecionado.id, { backgroundColor: e.target.value })}
                            className="w-full h-8 border border-gray-350 rounded p-0.5 cursor-pointer bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-bold text-gray-500 uppercase">Padding (px)</label>
                          <input
                            type="number"
                            min={0}
                            max={100}
                            value={elementoSelecionado.padding ?? 8}
                            onChange={(e) => updateEl(elementoSelecionado.id, { padding: parseInt(e.target.value, 10) || 0 })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                          />
                        </div>
                      </div>

                      {elementoSelecionado.tipo === 'caixa' && (
                        <div>
                          <label className="block text-[9px] font-bold text-gray-500 uppercase">Arredondar Cantos (px)</label>
                          <input
                            type="number"
                            min={0}
                            max={50}
                            value={elementoSelecionado.borderRadius ?? 4}
                            onChange={(e) => updateEl(elementoSelecionado.id, { borderRadius: parseInt(e.target.value, 10) || 0 })}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-xs bg-white"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Edição de Células de Tabela */}
                  {elementoSelecionado.tipo === 'tabela' && (
                    <div className="border border-gray-200 p-3 rounded-lg bg-gray-50 space-y-2">
                      <span className="block text-[9px] font-bold text-gray-400 uppercase">Conteúdo da Tabela</span>
                      <div className="flex gap-2">
                        <button
                          onClick={() => {
                            const currentRows = elementoSelecionado.linhas || [['Célula 1']];
                            const numCols = currentRows[0]?.length || 1;
                            const newRow = Array(numCols).fill('Nova Célula');
                            updateEl(elementoSelecionado.id, { linhas: [...currentRows, newRow] });
                          }}
                          className="bg-white hover:bg-gray-100 text-gray-800 text-[10px] px-2 py-1 rounded font-bold border border-gray-300 flex-1"
                        >
                          + Linha
                        </button>
                        <button
                          onClick={() => {
                            const currentRows = elementoSelecionado.linhas || [['Célula 1']];
                            if (currentRows.length > 1) {
                              updateEl(elementoSelecionado.id, { linhas: currentRows.slice(0, -1) });
                            }
                          }}
                          className="bg-red-50 hover:bg-red-100 text-red-700 text-[10px] px-2 py-1 rounded font-bold border border-red-200 flex-1"
                        >
                          - Linha
                        </button>
                        <button
                          onClick={() => {
                            const currentRows = elementoSelecionado.linhas || [['Célula 1']];
                            const updatedRows = currentRows.map(row => [...row, 'Nova Coluna']);
                            updateEl(elementoSelecionado.id, { linhas: updatedRows });
                          }}
                          className="bg-white hover:bg-gray-100 text-gray-800 text-[10px] px-2 py-1 rounded font-bold border border-gray-300 flex-1"
                        >
                          + Coluna
                        </button>
                        <button
                          onClick={() => {
                            const currentRows = elementoSelecionado.linhas || [['Célula 1']];
                            const numCols = currentRows[0]?.length || 1;
                            if (numCols > 1) {
                              const updatedRows = currentRows.map(row => row.slice(0, -1));
                              updateEl(elementoSelecionado.id, { linhas: updatedRows });
                            }
                          }}
                          className="bg-red-50 hover:bg-red-100 text-red-700 text-[10px] px-2 py-1 rounded font-bold border border-red-200 flex-1"
                        >
                          - Coluna
                        </button>
                      </div>

                      <div className="space-y-1.5 max-h-48 overflow-y-auto border border-gray-200 p-2 rounded bg-white">
                        {(elementoSelecionado.linhas || [['Célula 1']]).map((row, rIdx) => (
                          <div key={rIdx} className="flex gap-1 items-center">
                            <span className="text-[9px] text-gray-400 font-mono w-4">R{rIdx+1}</span>
                            {row.map((cell, cIdx) => (
                              <input
                                key={cIdx}
                                type="text"
                                value={cell}
                                onChange={(e) => {
                                  const newRows = (elementoSelecionado.linhas || [['Célula 1']]).map((r, ri) => 
                                    r.map((c, ci) => ri === rIdx && ci === cIdx ? e.target.value : c)
                                  );
                                  updateEl(elementoSelecionado.id, { linhas: newRows });
                                }}
                                className="min-w-0 flex-1 border border-gray-300 rounded px-1 py-0.5 text-[11px] focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Propriedades comuns de fonte */}
                  {(elementoSelecionado.tipo === 'texto' || elementoSelecionado.tipo === 'caixa' || elementoSelecionado.tipo === 'tabela') && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1 uppercase">Fonte</label>
                          <select
                            value={elementoSelecionado.fonte || 'Arial'}
                            onChange={(e) => updateEl(elementoSelecionado.id, { fonte: e.target.value })}
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                          >
                            <option value="Arial">Arial</option>
                            <option value="Times New Roman">Times New Roman</option>
                            <option value="Courier New">Courier New</option>
                            <option value="Georgia">Georgia</option>
                            <option value="Verdana">Verdana</option>
                          </select>
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1 uppercase">Tamanho</label>
                          <input
                            type="number"
                            value={elementoSelecionado.fontSize || 14}
                            onChange={(e) => updateEl(elementoSelecionado.id, { fontSize: Number(e.target.value) })}
                            className="w-full border border-gray-300 rounded-lg px-2 py-1 text-xs"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1 uppercase">Cor Fonte</label>
                          <input
                            type="color"
                            value={elementoSelecionado.cor || '#000000'}
                            onChange={(e) => updateEl(elementoSelecionado.id, { cor: e.target.value })}
                            className="w-full h-8 border border-gray-300 rounded-lg p-0.5 cursor-pointer bg-white"
                          />
                        </div>

                        <div>
                          <label className="block text-[10px] font-bold text-gray-600 mb-1 uppercase">Alinhamento</label>
                          <select
                            value={elementoSelecionado.alinhamento || 'left'}
                            onChange={(e) => updateEl(elementoSelecionado.id, { alinhamento: e.target.value as any })}
                            className="w-full border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white"
                          >
                            <option value="left">Esquerda</option>
                            <option value="center">Centralizado</option>
                            <option value="right">Direita</option>
                            <option value="justify">Justificado</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex gap-4">
                        <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!elementoSelecionado.negrito}
                            onChange={(e) => updateEl(elementoSelecionado.id, { negrito: e.target.checked })}
                            className="rounded text-emerald-600"
                          />
                          Negrito
                        </label>
                        <label className="flex items-center gap-1.5 text-xs font-semibold cursor-pointer">
                          <input
                            type="checkbox"
                            checked={!!elementoSelecionado.italico}
                            onChange={(e) => updateEl(elementoSelecionado.id, { italico: e.target.checked })}
                            className="rounded text-emerald-600"
                          />
                          Itálico
                        </label>
                      </div>
                    </div>
                  )}

                  {/* Placeholders / Campos Dinâmicos do CONEC */}
                  {(elementoSelecionado.tipo === 'texto' || elementoSelecionado.tipo === 'caixa' || elementoSelecionado.tipo === 'tabela') && (
                    <div className="border-t border-gray-150 pt-3">
                      <span className="block text-[9px] font-bold text-gray-400 uppercase mb-2">Campos Dinâmicos CONEC</span>
                      <div className="flex flex-wrap gap-1">
                        {[
                          { placeholder: '{nome_instituicao}', label: 'Nome Instituição' },
                          { placeholder: '{cnpj}', label: 'CNPJ' },
                          { placeholder: '{responsavel}', label: 'Responsável/Diretor' },
                          { placeholder: '{municipio}', label: 'Município' },
                          { placeholder: '{uf}', label: 'UF' },
                          { placeholder: '{endereco}', label: 'Endereço Completo' },
                          { placeholder: '{numero_credenciamento}', label: 'Reg. Credenciamento' },
                          { placeholder: '{data_emissao}', label: 'Data Emissão' },
                          { placeholder: '{data_validade}', label: 'Validade' },
                          { placeholder: '{status}', label: 'Status' },
                          { placeholder: '{observacoes}', label: 'Observações' },
                        ].map((ph) => (
                          <button
                            key={ph.placeholder}
                            onClick={() => {
                              if (elementoSelecionado.tipo === 'tabela') {
                                return;
                              }
                              const currText = elementoSelecionado.texto || '';
                              updateEl(elementoSelecionado.id, { texto: currText + ph.placeholder });
                            }}
                            title={ph.label}
                            className="bg-gray-50 hover:bg-emerald-50 hover:text-emerald-700 px-1.5 py-0.5 rounded text-[10px] font-mono border border-gray-200 transition"
                          >
                            {ph.placeholder}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center py-8">Selecione um elemento no canvas para editar suas propriedades.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <input ref={backgroundInputRef} type="file" accept="image/*" className="hidden" onChange={handleBgUpload} />
      <input ref={imagemInputRef} type="file" accept="image/*" className="hidden" onChange={handleImgUpload} />

      {/* Toast de notificações */}
      <ToastNotification toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
