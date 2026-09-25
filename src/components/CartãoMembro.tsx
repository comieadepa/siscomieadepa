'use client';

import { useEffect, useState, useRef } from 'react';
import { QRCodeSVG as QRCode } from 'qrcode.react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import {
  Download,
  X,
  AlertTriangle,
  CreditCard,
  Layers,
} from 'lucide-react';
import { substituirPlaceholders, processarElementosComReflow } from '@/lib/cartoes-utils';
import { createClient } from '@/lib/supabase-client';
import { loadOrgNomenclaturasFromSupabaseOrMigrate } from '@/lib/org-nomenclaturas';
import { loadTemplatesWithLocalCache } from '@/lib/cartoes-templates-sync';
import { fetchConfiguracaoIgrejaFromSupabase } from '@/lib/igreja-config-utils';
import { buildUrl, getAppBaseUrl } from '@/lib/urls';
import { authenticatedFetch } from '@/lib/api-client';

interface Membro {
  id: string;
  uniqueId: string;
  matricula: string;
  nome: string;
  cpf: string;
  rg?: string;
  tipoCadastro: 'membro' | 'congregado' | 'ministro' | 'crianca' | 'funcionario';
  cargo?: string;
  supervisao?: string;
  campo?: string;
  dataNascimento?: string;
  dataBatismo?: string;
  filiacao?: string;
  nomePai?: string;
  nomeMae?: string;
  naturalidade?: string;
  nacionalidade?: string;
  estadoCivil?: string;
  tipoSanguineo?: string;
  validade?: string;
  email?: string;
  celular?: string;
  whatsapp?: string;
  logradouro?: string;
  numero?: string;
  bairro?: string;
  cidade?: string;
  qualFuncao?: string;
  dataBatismoAguas?: string;
  dataBatismoEspiritoSanto?: string;
  status: 'ativo' | 'inativo';
  fotoUrl?: string;
  [key: string]: any;
}

interface CartãoMembroProps {
  membro: Membro;
  onClose?: () => void;
  registroAction?: 'emitir' | 'reimprimir';
}

interface ElementoCartao {
  id: string;
  tipo: 'texto' | 'qrcode' | 'logo' | 'foto-membro' | 'chapa' | 'imagem';
  x: number;
  y: number;
  largura: number;
  altura: number;
  fontSize?: number;
  cor?: string;
  fonte?: string;
  transparencia?: number;
  borderRadius?: number;
  texto?: string;
  alinhamento?: 'left' | 'center' | 'right';
  negrito?: boolean;
  italico?: boolean;
  sublinhado?: boolean;
  visivel: boolean;
  backgroundColor?: string;
  imagemUrl?: string;
  sombreado?: boolean;
}

interface TemplateCartao {
  id: string;
  nome: string;
  tipoCadastro: 'membro' | 'congregado' | 'ministro' | 'funcionario';
  backgroundUrl?: string;
  elementos: ElementoCartao[];
  temVerso?: boolean;
  elementosVerso?: ElementoCartao[];
  backgroundUrlVerso?: string;
  orientacao?: 'landscape' | 'portrait';
  validadeAnos?: number;
  dataEmissao?: string;
  tipoImpressao?: string;
  [key: string]: any;
}

export default function CartãoMembro({ membro, onClose, registroAction = 'emitir' }: CartãoMembroProps) {
  const supabase = createClient();

  const [template, setTemplate] = useState<TemplateCartao | null>(null);
  const [configIgreja, setConfigIgreja] = useState<any>(null);
  const [orgNomenclaturas, setOrgNomenclaturas] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [gerandoPDF, setGerandoPDF] = useState(false);

  const printRef = useRef<HTMLDivElement>(null);
  const frenteRef = useRef<HTMLDivElement>(null);
  const versoRef = useRef<HTMLDivElement>(null);

  // Função auxiliar para dimensões CSS baseado na orientação
  const getDimensoesCSSCartao = (orientacao?: string) => {
    if (orientacao === 'portrait') {
      return { width: '291px', height: '465px' };
    }
    return { width: '465px', height: '291px' };
  };

  const resolvePrintBackgroundColor = (bgUrl?: string) => (bgUrl ? 'transparent' : 'white');

  // Dimensões do canvas baseadas na orientação do template
  const isPortrait = template?.orientacao === 'portrait';
  const canvasWidth = isPortrait ? 291 : 465;
  const canvasHeight = isPortrait ? 465 : 291;

  useEffect(() => {
    loadOrgNomenclaturasFromSupabaseOrMigrate(supabase, { syncLocalStorage: false })
      .then(setOrgNomenclaturas)
      .catch(() => setOrgNomenclaturas(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { templates: templatesSalvos } = await loadTemplatesWithLocalCache(supabase, { allowLocalMigration: true });

        // Carregar config da igreja
        try {
          const config = await fetchConfiguracaoIgrejaFromSupabase(supabase);
          setConfigIgreja(config);
        } catch (e) {
          console.error('Erro ao carregar config igreja', e);
        }

        let templateCarregado: TemplateCartao | null = null;
        const tipoMapeado = membro.tipoCadastro === 'crianca' ? 'membro' : (membro.tipoCadastro as any);

        // Primeiro: buscar template ATIVO do tipo
        const templateAtivo = templatesSalvos.find((t: any) =>
          t.tipoCadastro === tipoMapeado && t.ativo === true
        );

        // Segundo: buscar qualquer template do tipo
        const templateSalvo = templatesSalvos.find((t: any) => t.tipoCadastro === tipoMapeado);

        if (templateAtivo) {
          templateCarregado = templateAtivo;
        } else if (templateSalvo) {
          templateCarregado = templateSalvo;
        } else {
          // Fallback: usar template padrão
          const { getTemplatesPorTipo, converterParaTemplateEditavel } = require('@/lib/card-templates');
          const padroes = getTemplatesPorTipo(tipoMapeado);
          const fallback = padroes.length > 0 ? padroes[0] : null;
          templateCarregado = fallback ? converterParaTemplateEditavel(fallback) : null;
        }

        // Garantir orientação portrait para funcionário
        if (tipoMapeado === 'funcionario' && templateCarregado) {
          templateCarregado = {
            ...templateCarregado,
            orientacao: 'portrait',
          };
        }

        setTemplate(templateCarregado);
      } catch (err) {
        console.error('Erro ao carregar template:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [membro.tipoCadastro]);

  // Compõe background em alta resolução com os elementos
  const compositeWithBackground = (
    foreground: HTMLCanvasElement,
    bgUrl: string | undefined
  ): Promise<HTMLCanvasElement> => {
    if (!bgUrl) return Promise.resolve(foreground);
    return new Promise((resolve) => {
      const out = document.createElement('canvas');
      out.width = foreground.width;
      out.height = foreground.height;
      const ctx = out.getContext('2d', { alpha: true });
      if (!ctx) {
        resolve(foreground);
        return;
      }
      ctx.clearRect(0, 0, out.width, out.height);
      const img = new Image();
      if (!bgUrl.startsWith('data:')) img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, out.width, out.height);
          ctx.drawImage(foreground, 0, 0);
          resolve(out);
        } catch (e) {
          console.warn('Falha ao desenhar composição de background:', e);
          resolve(foreground);
        }
      };
      img.onerror = (e) => {
        console.warn('Falha ao carregar background para composição:', e);
        resolve(foreground);
      };
      img.src = bgUrl;
    });
  };

  // Renderizar Elementos com suporte à compensação de lift no PDF
  const renderizarElemento = (elemento: ElementoCartao, isPdf = false) => {
    if (!elemento || !elemento.visivel) return null;

    const fontSize = elemento.fontSize || 10;
    // Compensação apenas para o PDF, preview fica centralizado
    const lift = isPdf ? (fontSize > 16 ? '-15px' : '-8px') : '0px';
    const lineHeight = '1.2';

    const estilo: React.CSSProperties = {
      position: 'absolute',
      left: `${elemento.x}px`,
      top: `${elemento.y}px`,
      width: `${elemento.largura}px`,
      height: `${elemento.altura}px`,
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent:
        elemento.alinhamento === 'right'
          ? 'flex-end'
          : elemento.alinhamento === 'center'
          ? 'center'
          : 'flex-start',
      fontFamily: (elemento.fonte || 'Arial').replace(' Semibold', ''),
      fontSize: elemento.fontSize ? `${elemento.fontSize}px` : 'inherit',
      color: elemento.cor || '#000',
      fontWeight: (elemento.fonte || '').endsWith(' Semibold') ? 600 : elemento.negrito ? 'bold' : 'normal',
      fontStyle: elemento.italico ? 'italic' : 'normal',
      textDecoration: elemento.sublinhado ? 'underline' : 'none',
      textAlign: (elemento.alinhamento || 'left') as any,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    };

    switch (elemento.tipo) {
      case 'texto': {
        const membroComConfig = {
          ...membro,
          validadeAnos: template?.validadeAnos || 1,
          nomeIgreja: configIgreja?.nome || 'Igreja',
          dataEmissao: template?.dataEmissao || membro.dataEmissao,
        };
        const textoSubstituido = substituirPlaceholders(elemento.texto || '', membroComConfig, orgNomenclaturas);

        return (
          <div
            key={elemento.id}
            style={{
              ...estilo,
              backgroundColor: elemento.backgroundColor || 'transparent',
              borderRadius: `${elemento.borderRadius || 0}px`,
              padding: '0',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'stretch',
              overflow: 'visible',
            }}
          >
            <div
              style={{
                position: 'relative',
                top: lift,
                width: '100%',
                paddingLeft: elemento.backgroundColor ? '10px' : '0',
                paddingRight: elemento.backgroundColor ? '5px' : '0',
                boxSizing: 'border-box',
                lineHeight: lineHeight,
                textAlign: (elemento.alinhamento || 'left') as any,
                display: 'block',
              }}
              dangerouslySetInnerHTML={{ __html: textoSubstituido }}
            />
          </div>
        );
      }
      case 'qrcode':
        return (
          <div key={elemento.id} style={estilo}>
            <QRCode
              value={buildUrl(getAppBaseUrl(), `/autentica_qrcode-05985642/${membro.uniqueId || membro.id}`)}
              size={Math.min(elemento.largura, elemento.altura)}
              level="H"
              includeMargin={false}
            />
          </div>
        );

      case 'imagem': {
        const styleContainer: React.CSSProperties = {
          ...estilo,
          overflow: 'hidden',
          borderRadius: `${elemento.borderRadius || 0}px`,
          opacity: elemento.transparencia ?? 1,
          backgroundColor: elemento.imagemUrl ? elemento.backgroundColor || 'transparent' : '#f3f4f6',
          border: elemento.imagemUrl ? undefined : '1px dashed #d1d5db',
          alignItems: 'center',
          justifyContent: 'center',
        };

        if (!elemento.imagemUrl) {
          return (
            <div key={elemento.id} style={styleContainer}>
              <span style={{ color: '#9ca3af', fontSize: Math.min(elemento.largura, elemento.altura) * 0.35 }}>
                🖼️
              </span>
            </div>
          );
        }

        return (
          <div key={elemento.id} style={styleContainer}>
            <img
              src={elemento.imagemUrl}
              alt="Imagem"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
                display: 'block',
              }}
            />
          </div>
        );
      }
      case 'logo':
        const logoUrl = configIgreja?.logo || '/img/logo_menu.png';
        return (
          <div
            key={elemento.id}
            style={{
              ...estilo,
              opacity: elemento.transparencia || 1,
            }}
          >
            <img
              src={logoUrl}
              alt="Logo"
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'contain',
              }}
            />
          </div>
        );
      case 'foto-membro':
        return (
          <div
            key={elemento.id}
            style={{
              ...estilo,
              background: membro.fotoUrl ? '#fff' : 'linear-gradient(to bottom, #f3f4f6, #e5e7eb)',
              color: '#9ca3af',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              border: membro.fotoUrl ? 'none' : '1px solid #d1d5db',
            }}
          >
            {membro.fotoUrl ? (
              <img
                src={membro.fotoUrl}
                alt="Foto"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <span style={{ fontSize: `${Math.min(elemento.largura, elemento.altura) * 0.4}px` }}>👤</span>
            )}
          </div>
        );
      case 'chapa':
        return (
          <div
            key={elemento.id}
            style={{
              ...estilo,
              backgroundColor: elemento.cor || '#ff0000',
              borderRadius: `${elemento.borderRadius || 4}px`,
              opacity: elemento.transparencia || 1,
            }}
          />
        );
      default:
        return null;
    }
  };

  const temVerso = Boolean(template?.temVerso && template?.elementosVerso && template.elementosVerso.length > 0);

  // Geração de PDF de Alta Resolução restaurada com precisão
  const gerarPDF = async () => {
    if (!printRef.current || !template || gerandoPDF) return;
    setGerandoPDF(true);

    try {
      const frenteEl = printRef.current.querySelector('#print-frente') as HTMLElement;
      if (!frenteEl) throw new Error('Elemento da frente não encontrado na área de impressão');

      // 1. Capturar elementos sem backgroundImage CSS (evita desfoque e taint no html2canvas)
      const bgFrente = frenteEl.style.backgroundImage;
      const bgColorFrente = frenteEl.style.backgroundColor;
      frenteEl.style.backgroundImage = 'none';
      frenteEl.style.backgroundColor = 'transparent';
      const captFrente = await html2canvas(frenteEl, {
        scale: 4,
        useCORS: true,
        backgroundColor: null,
        logging: false,
      });
      frenteEl.style.backgroundImage = bgFrente;
      frenteEl.style.backgroundColor = bgColorFrente;

      // 2. Compor background em alta resolução
      const canvasFrente = await compositeWithBackground(captFrente, template.backgroundUrl);

      const tipoImpressao = template.tipoImpressao || 'pvc';
      const orientacao = template.orientacao || 'landscape';
      const largCartaoMM = orientacao === 'portrait' ? 53.98 : 85.6;
      const altCartaoMM = orientacao === 'portrait' ? 85.6 : 53.98;

      let pdf: jsPDF;

      if (tipoImpressao === 'a4') {
        pdf = new jsPDF({
          orientation: 'portrait',
          unit: 'mm',
          format: 'a4',
        });

        const margemSuperior = 12;
        const margemEsquerda = 18.5;
        const espacamentoH = 2;

        pdf.addImage(canvasFrente.toDataURL('image/png'), 'PNG', margemEsquerda, margemSuperior, largCartaoMM, altCartaoMM);

        if (temVerso) {
          const versoEl = printRef.current.querySelector('#print-verso') as HTMLElement;
          if (versoEl) {
            const bgVerso = versoEl.style.backgroundImage;
            const bgColorVerso = versoEl.style.backgroundColor;
            versoEl.style.backgroundImage = 'none';
            versoEl.style.backgroundColor = 'transparent';
            const captVerso = await html2canvas(versoEl, {
              scale: 4,
              useCORS: true,
              backgroundColor: null,
              logging: false,
            });
            versoEl.style.backgroundImage = bgVerso;
            versoEl.style.backgroundColor = bgColorVerso;

            const canvasVerso = await compositeWithBackground(captVerso, template.backgroundUrlVerso);
            pdf.addPage();
            const xVerso = margemEsquerda + largCartaoMM + espacamentoH;
            pdf.addImage(canvasVerso.toDataURL('image/png'), 'PNG', xVerso, margemSuperior, largCartaoMM, altCartaoMM);
          }
        }
      } else {
        pdf = new jsPDF({
          orientation: orientacao === 'portrait' ? 'portrait' : 'landscape',
          unit: 'mm',
          format: [largCartaoMM, altCartaoMM],
        });

        pdf.addImage(canvasFrente.toDataURL('image/png'), 'PNG', 0, 0, largCartaoMM, altCartaoMM);

        if (temVerso) {
          const versoEl = printRef.current.querySelector('#print-verso') as HTMLElement;
          if (versoEl) {
            const bgVerso = versoEl.style.backgroundImage;
            const bgColorVerso = versoEl.style.backgroundColor;
            versoEl.style.backgroundImage = 'none';
            versoEl.style.backgroundColor = 'transparent';
            const captVerso = await html2canvas(versoEl, {
              scale: 4,
              useCORS: true,
              backgroundColor: null,
              logging: false,
            });
            versoEl.style.backgroundImage = bgVerso;
            versoEl.style.backgroundColor = bgColorVerso;

            const canvasVerso = await compositeWithBackground(captVerso, template.backgroundUrlVerso);
            pdf.addPage([largCartaoMM, altCartaoMM], orientacao === 'portrait' ? 'portrait' : 'landscape');
            pdf.addImage(canvasVerso.toDataURL('image/png'), 'PNG', 0, 0, largCartaoMM, altCartaoMM);
          }
        }
      }

      const nomeLimpo = (membro.nome || 'credencial').replace(/[^a-z0-9]/gi, '_').toLowerCase();
      pdf.save(`credencial_${nomeLimpo}.pdf`);

      // Registrar emissão/reimpressão
      try {
        const qrCodeData = buildUrl(
          getAppBaseUrl(),
          `/autentica_qrcode-05985642/${membro.uniqueId || membro.id}`
        );

        const regRes = await authenticatedFetch('/api/credenciais/emitidas', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: registroAction,
            items: [{
              memberId: membro.id,
              templateId: template?.id ?? null,
              qrCodeData,
            }],
          }),
        });
        if (!regRes.ok) {
          const errBody = await regRes.json().catch(() => null);
          console.warn('Falha ao registrar credencial emitida:', regRes.status, errBody);
        }
      } catch (err) {
        console.warn('Falha ao registrar credencial emitida:', err);
      }
    } catch (error) {
      console.error('Erro ao gerar PDF:', error);
      alert('Ocorreu um erro ao gerar o PDF. Consulte o console para mais detalhes.');
    } finally {
      setGerandoPDF(false);
    }
  };

  // Título dinâmico
  const getTituloModal = () => {
    switch (membro.tipoCadastro) {
      case 'ministro':
        return 'Credencial de Ministro — COMIEADEPA';
      case 'funcionario':
        return 'Credencial de Funcionário — COMIEADEPA';
      case 'congregado':
        return 'Cartão de Congregado — COMIEADEPA';
      case 'crianca':
        return 'Cartão de Criança — COMIEADEPA';
      default:
        return 'Credencial de Membro — COMIEADEPA';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full my-6 flex flex-col max-h-[94vh] border border-emerald-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header com gradiente em tons de verde */}
        <div className="flex justify-between items-center px-6 py-4 bg-gradient-to-r from-emerald-800 via-teal-700 to-green-800 text-white flex-shrink-0 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center shadow-inner">
              <CreditCard className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight">
                {getTituloModal()}
              </h2>
              <p className="text-xs text-emerald-100 flex items-center gap-1.5 mt-0.5">
                <Layers className="w-3.5 h-3.5 text-emerald-300" />
                <span>Modelo Ativo: <strong>{template?.nome || 'Carregando...'}</strong></span>
              </p>
            </div>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
              title="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Conteúdo com Scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-100">
          {/* Avisos Informativos */}
          {!membro.fotoUrl && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-amber-800 text-xs">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>Este membro ainda não possui foto cadastrada. A credencial será emitida sem fotografia.</span>
            </div>
          )}

          {loading || !template ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-emerald-600" />
              <span className="ml-3 text-sm text-gray-600 font-medium">Carregando credencial personalizada...</span>
            </div>
          ) : (
            /* Área de Visualização dos Cartões (Frente e Verso lado a lado) */
            <div className="flex flex-col xl:flex-row items-center justify-center gap-8 py-2">
              {/* ── CARTÃO FRENTE ── */}
              <div className="flex flex-col items-center gap-2">
                <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                  Frente da Credencial
                </span>
                <div
                  ref={frenteRef}
                  style={{
                    width: `${canvasWidth}px`,
                    height: `${canvasHeight}px`,
                    backgroundImage: template.backgroundUrl ? `url(${template.backgroundUrl})` : undefined,
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                  }}
                  className="relative rounded-2xl overflow-hidden shadow-2xl bg-white border border-gray-300 select-none box-border"
                >
                  {processarElementosComReflow(template.elementos, membro, orgNomenclaturas).map((elemento) =>
                    renderizarElemento(elemento, false)
                  )}
                </div>
              </div>

              {/* ── CARTÃO VERSO (se houver) ── */}
              {temVerso && (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Verso da Credencial
                  </span>
                  <div
                    ref={versoRef}
                    style={{
                      width: `${canvasWidth}px`,
                      height: `${canvasHeight}px`,
                      backgroundImage: template.backgroundUrlVerso ? `url(${template.backgroundUrlVerso})` : undefined,
                      backgroundSize: '100% 100%',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                    }}
                    className="relative rounded-2xl overflow-hidden shadow-2xl bg-white border border-gray-300 select-none box-border"
                  >
                    {processarElementosComReflow(template.elementosVerso || [], membro, orgNomenclaturas).map((elemento) =>
                      renderizarElemento(elemento, false)
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer com Ações */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-white flex-shrink-0">
          {onClose ? (
            <button
              onClick={onClose}
              disabled={gerandoPDF}
              className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold text-sm transition cursor-pointer disabled:opacity-50"
            >
              Fechar
            </button>
          ) : <div />}

          <div className="flex items-center gap-3">
            <button
              onClick={gerarPDF}
              disabled={gerandoPDF || loading || !template}
              className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-700 hover:from-emerald-700 hover:to-teal-800 text-white font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {gerandoPDF ? 'Gerando...' : 'Baixar PDF'}
            </button>
          </div>
        </div>
      </div>

      {/* ÁREA DE IMPRESSÃO OCULTA PARA PDF (Fora da tela visual com precisão de renderização) */}
      {template && (
        <div style={{ position: 'absolute', left: '-9999px', top: '-9999px' }} ref={printRef}>
          {/* FRENTE PARA PDF */}
          <div
            id="print-frente"
            style={{
              ...getDimensoesCSSCartao(template.orientacao),
              position: 'relative',
              fontFamily: 'Arial, sans-serif',
              backgroundImage: template.backgroundUrl ? `url(${template.backgroundUrl})` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundColor: resolvePrintBackgroundColor(template.backgroundUrl),
              overflow: 'hidden',
            }}
          >
            {processarElementosComReflow(template.elementos, membro, orgNomenclaturas).map((elemento) =>
              renderizarElemento(elemento, true)
            )}
          </div>

          {/* VERSO PARA PDF */}
          {temVerso && (
            <div
              id="print-verso"
              style={{
                ...getDimensoesCSSCartao(template.orientacao),
                position: 'relative',
                fontFamily: 'Arial, sans-serif',
                backgroundImage: template.backgroundUrlVerso ? `url(${template.backgroundUrlVerso})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundColor: resolvePrintBackgroundColor(template.backgroundUrlVerso),
                overflow: 'hidden',
              }}
            >
              {processarElementosComReflow(template.elementosVerso || [], membro, orgNomenclaturas).map((elemento) =>
                renderizarElemento(elemento, true)
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
