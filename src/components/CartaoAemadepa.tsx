'use client';

import { useState, useRef, useEffect } from 'react';
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
import { buildUrl, getAppBaseUrl } from '@/lib/urls';
import { substituirPlaceholders } from '@/lib/cartoes-utils';
import { createClient } from '@/lib/supabase-client';
import { loadTemplatesForCurrentUser } from '@/lib/cartoes-templates-sync';
import { loadOrgNomenclaturasFromSupabaseOrMigrate } from '@/lib/org-nomenclaturas';

export interface CartaoAemadepaProps {
  associada: {
    id: string; // id do ministro
    uniqueId?: string;
    nomeEsposa: string;
    cpfEsposa?: string;
    rgEsposa?: string;
    orgaoEmissorEsposa?: string;
    dataNascimentoEsposa?: string;
    nacionalidadeEsposa?: string;
    naturalidadeEsposa?: string;
    nomePaiEsposa?: string;
    nomeMaeEsposa?: string;
    tituloEleitoralEsposa?: string;
    foneEsposa?: string;
    emailEsposa?: string;
    tipoSanguineoEsposa?: string;
    fotoEsposaUrl?: string | null;
    numeroAemadepa?: string;
    ministroNome?: string;
    ministroMatricula?: string;
    cargoMinisterial?: string;
    campo?: string;
    supervisao?: string;
  };
  onClose: () => void;
}

export default function CartaoAemadepa({ associada, onClose }: CartaoAemadepaProps) {
  const [gerandoPDF, setGerandoPDF] = useState(false);
  const [erroValidacao, setErroValidacao] = useState<string | null>(null);
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [orgNomenclaturas, setOrgNomenclaturas] = useState<any>(null);

  const frenteRef = useRef<HTMLDivElement>(null);
  const versoRef = useRef<HTMLDivElement>(null);
  const supabase = createClient();

  // Carregar Template Ativo da AEMADEPA
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const nom = await loadOrgNomenclaturasFromSupabaseOrMigrate(supabase);
        setOrgNomenclaturas(nom);

        const { templates: loadedTemplates } = await loadTemplatesForCurrentUser(supabase);
        let templateCarregado: any = null;

        const ativo = (loadedTemplates || []).find(
          (t: any) => t.ativo && (t.tipoCadastro === 'aemadepa' || t.tipo === 'aemadepa')
        );

        if (ativo) {
          templateCarregado = ativo;
        } else {
          const { getTemplatesPorTipo, converterParaTemplateEditavel } = require('@/lib/card-templates');
          const padroes = getTemplatesPorTipo('aemadepa');
          const fallback = padroes.length > 0 ? padroes[0] : null;
          templateCarregado = fallback ? converterParaTemplateEditavel(fallback) : null;
        }

        setTemplate(templateCarregado);
      } catch (err) {
        console.error('Erro ao carregar template AEMADEPA:', err);
        const { getTemplatesPorTipo, converterParaTemplateEditavel } = require('@/lib/card-templates');
        const padroes = getTemplatesPorTipo('aemadepa');
        const fallback = padroes.length > 0 ? padroes[0] : null;
        setTemplate(fallback ? converterParaTemplateEditavel(fallback) : null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Validação de dados essenciais
  useEffect(() => {
    if (!associada.nomeEsposa || associada.nomeEsposa === 'Não cadastrada') {
      setErroValidacao('Nome da esposa não cadastrado.');
    } else if (!associada.ministroNome) {
      setErroValidacao('Ministro vinculado não identificado.');
    } else {
      setErroValidacao(null);
    }
  }, [associada]);

  // QR Code URL seguro para autenticação pública de associada
  const qrCodeUrl = buildUrl(
    getAppBaseUrl(),
    `/autentica_qrcode-05985642/${associada.uniqueId || associada.id}?tipo=aemadepa`
  );

  // Mapeamento dos dados da esposa/ministro para preenchimento dos placeholders
  const membroDados = {
    id: associada.id,
    uniqueId: associada.uniqueId || associada.id,
    nome: associada.nomeEsposa,
    nomeEsposa: associada.nomeEsposa,
    cpf: associada.cpfEsposa,
    cpfEsposa: associada.cpfEsposa,
    rg: associada.rgEsposa,
    rgEsposa: associada.rgEsposa,
    dataNascimento: associada.dataNascimentoEsposa,
    dataNascimentoEsposa: associada.dataNascimentoEsposa,
    tipoSanguineo: associada.tipoSanguineoEsposa,
    tipoSanguineoEsposa: associada.tipoSanguineoEsposa,
    nacionalidade: associada.nacionalidadeEsposa || 'BRASILEIRA',
    naturalidade: associada.naturalidadeEsposa,
    nomePai: associada.nomePaiEsposa,
    nomeMae: associada.nomeMaeEsposa,
    tituloEleitor: associada.tituloEleitoralEsposa,
    orgaoEmissor: associada.orgaoEmissorEsposa,
    orgao_emissor: associada.orgaoEmissorEsposa,
    telefone: associada.foneEsposa,
    whatsapp: associada.foneEsposa,
    email: associada.emailEsposa,
    fotoUrl: associada.fotoEsposaUrl,
    fotoEsposaUrl: associada.fotoEsposaUrl,
    matricula: associada.numeroAemadepa,
    numeroAemadepa: associada.numeroAemadepa,
    ministroNome: associada.ministroNome,
    ministroMatricula: associada.ministroMatricula,
    cargoMinisterial: associada.cargoMinisterial,
    cargo_ministerial: associada.cargoMinisterial,
    campo: associada.campo,
    supervisao: associada.supervisao,
    validadeAnos: template?.validadeAnos || 1,
    dataEmissao: template?.dataEmissao,
  };

  // Compõe background em alta resolução com os elementos do canvas
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
        ctx.drawImage(img, 0, 0, out.width, out.height);
        ctx.drawImage(foreground, 0, 0);
        resolve(out);
      };
      img.onerror = () => resolve(foreground);
      img.src = bgUrl;
    });
  };

  // Geração de PDF de Alta Resolução
  const handleGerarPDF = async () => {
    if (!frenteRef.current || gerandoPDF) return;
    setGerandoPDF(true);

    try {
      // 1. Renderiza Frente
      const captFrente = await html2canvas(frenteRef.current, {
        scale: 4,
        useCORS: true,
        allowTaint: true,
        backgroundColor: null,
        logging: false,
      });
      const canvasFrente = await compositeWithBackground(captFrente, template?.backgroundUrl);

      // Dimensões do cartão
      const orientacao = template?.orientacao || 'landscape';
      const isPortrait = orientacao === 'portrait';
      const largMM = isPortrait ? 54 : 85.6;
      const altMM = isPortrait ? 85.6 : 54;

      const pdf = new jsPDF({
        orientation: isPortrait ? 'portrait' : 'landscape',
        unit: 'mm',
        format: [largMM, altMM],
      });

      const imgFrente = canvasFrente.toDataURL('image/jpeg', 0.98);
      pdf.addImage(imgFrente, 'JPEG', 0, 0, largMM, altMM);

      // 2. Renderiza Verso se existir
      if (template?.temVerso && versoRef.current) {
        const captVerso = await html2canvas(versoRef.current, {
          scale: 4,
          useCORS: true,
          allowTaint: true,
          backgroundColor: null,
          logging: false,
        });
        const canvasVerso = await compositeWithBackground(captVerso, template?.backgroundUrlVerso);

        pdf.addPage([largMM, altMM], isPortrait ? 'portrait' : 'landscape');
        const imgVerso = canvasVerso.toDataURL('image/jpeg', 0.98);
        pdf.addImage(imgVerso, 'JPEG', 0, 0, largMM, altMM);
      }

      const nomeArquivo = `credencial_aemadepa_${associada.nomeEsposa.replace(/\s+/g, '_').toLowerCase()}.pdf`;
      pdf.save(nomeArquivo);
    } catch (err) {
      console.error('Erro ao gerar PDF da carteirinha AEMADEPA:', err);
      alert('Erro ao gerar PDF da carteirinha. Tente novamente.');
    } finally {
      setGerandoPDF(false);
    }
  };

  // Renderizador de Elementos do Canvas Customizado
  const renderizarElemento = (el: any) => {
    if (!el || el.visivel === false) return null;

    const estilo: React.CSSProperties = {
      position: 'absolute',
      left: `${el.x}px`,
      top: `${el.y}px`,
      width: `${el.largura}px`,
      height: `${el.altura}px`,
      overflow: 'hidden',
      display: 'flex',
      alignItems: 'center',
      justifyContent:
        el.alinhamento === 'right'
          ? 'flex-end'
          : el.alinhamento === 'center'
          ? 'center'
          : 'flex-start',
      fontFamily: (el.fonte || 'Arial').replace(' Semibold', ''),
      fontSize: el.fontSize ? `${el.fontSize}px` : 'inherit',
      color: el.cor || '#000',
      fontWeight: (el.fonte || '').endsWith(' Semibold')
        ? 600
        : el.negrito
        ? 'bold'
        : 'normal',
      fontStyle: el.italico ? 'italic' : 'normal',
      textDecoration: el.sublinhado ? 'underline' : 'none',
      textAlign: (el.alinhamento || 'left') as any,
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-word',
    };

    switch (el.tipo) {
      case 'texto': {
        const textoSubstituido = substituirPlaceholders(
          el.texto || '',
          membroDados,
          orgNomenclaturas
        );

        return (
          <div
            key={el.id}
            style={{
              ...estilo,
              backgroundColor: el.backgroundColor || 'transparent',
              borderRadius: `${el.borderRadius || 0}px`,
              padding: '0',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'stretch',
              overflow: 'visible',
            }}
          >
            <div
              style={{
                width: '100%',
                paddingLeft: el.backgroundColor ? '10px' : '0',
                paddingRight: el.backgroundColor ? '5px' : '0',
                boxSizing: 'border-box',
                lineHeight: '1.2',
                textAlign: (el.alinhamento || 'left') as any,
                display: 'block',
              }}
              dangerouslySetInnerHTML={{ __html: textoSubstituido }}
            />
          </div>
        );
      }

      case 'qrcode':
        return (
          <div
            key={el.id}
            style={{
              ...estilo,
              backgroundColor: el.backgroundColor || '#ffffff',
              padding: '4px',
              boxSizing: 'border-box',
              borderRadius: `${el.borderRadius || 6}px`,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <QRCode
              value={qrCodeUrl}
              size={Math.min(el.largura, el.altura) - 8}
              level="H"
              includeMargin={false}
            />
          </div>
        );

      case 'logo':
        return (
          <div
            key={el.id}
            style={{
              ...estilo,
              opacity: el.transparencia || 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src="/img/logo_menu.png"
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
            key={el.id}
            style={{
              ...estilo,
              background: associada.fotoEsposaUrl
                ? '#fff'
                : 'linear-gradient(to bottom, #fdf2f8, #fce7f3)',
              color: '#be123c',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              borderRadius: `${el.borderRadius || 6}px`,
              border: associada.fotoEsposaUrl ? '1px solid #fda4af' : '1px solid #f43f5e',
            }}
          >
            {associada.fotoEsposaUrl ? (
              <img
                src={associada.fotoEsposaUrl}
                alt="Foto"
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'cover',
                }}
              />
            ) : (
              <span style={{ fontSize: `${Math.min(el.largura, el.altura) * 0.4}px` }}>👤</span>
            )}
          </div>
        );

      case 'imagem':
        if (!el.imagemUrl) return null;
        return (
          <div
            key={el.id}
            style={{
              ...estilo,
              overflow: 'hidden',
              borderRadius: `${el.borderRadius || 0}px`,
              opacity: el.transparencia ?? 1,
              backgroundColor: el.backgroundColor || 'transparent',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <img
              src={el.imagemUrl}
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

      case 'chapa':
        return (
          <div
            key={el.id}
            style={{
              ...estilo,
              backgroundColor: el.cor || '#be123c',
              borderRadius: `${el.borderRadius || 4}px`,
              opacity: el.transparencia || 1,
            }}
          />
        );

      default:
        return null;
    }
  };

  const isPortrait = template?.orientacao === 'portrait';
  const canvasWidth = isPortrait ? 291 : 465;
  const canvasHeight = isPortrait ? 465 : 291;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full my-6 flex flex-col max-h-[94vh] border border-rose-100 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 bg-gradient-to-r from-rose-700 via-pink-700 to-purple-800 text-white flex-shrink-0 shadow-md">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 backdrop-blur-md rounded-xl flex items-center justify-center shadow-inner">
              <CreditCard className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight">
                Credencial da Esposa — AEMADEPA
              </h2>
              <p className="text-xs text-rose-100 flex items-center gap-1.5 mt-0.5">
                <Layers className="w-3.5 h-3.5 text-rose-300" />
                <span>Modelo Ativo: <strong>{template?.nome || 'Carregando...'}</strong></span>
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Conteúdo com Scroll */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6 bg-slate-100">
          {/* Mensagem de Erro se houver */}
          {erroValidacao && (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-3 text-amber-900 text-sm">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0" />
              <span>{erroValidacao}</span>
            </div>
          )}

          {/* Avisos Informativos */}
          {!associada.fotoEsposaUrl && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-center gap-2 text-rose-800 text-xs">
              <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Esta esposa ainda não possui foto cadastrada. A credencial será emitida sem fotografia.</span>
            </div>
          )}

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-rose-600" />
              <span className="ml-3 text-sm text-gray-600 font-medium">Carregando credencial personalizada...</span>
            </div>
          ) : (
            /* Área de Visualização dos Cartões (Frente e Verso) */
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
                    backgroundImage: template?.backgroundUrl ? `url(${template.backgroundUrl})` : undefined,
                    backgroundSize: '100% 100%',
                    backgroundPosition: 'center',
                    backgroundRepeat: 'no-repeat',
                  }}
                  className="relative rounded-2xl overflow-hidden shadow-2xl bg-white border border-gray-300 select-none box-border"
                >
                  {(template?.elementos || []).map((el: any) => renderizarElemento(el))}
                </div>
              </div>

              {/* ── CARTÃO VERSO (se houver) ── */}
              {template?.temVerso && (
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs font-bold text-gray-600 uppercase tracking-wider">
                    Verso da Credencial
                  </span>
                  <div
                    ref={versoRef}
                    style={{
                      width: `${canvasWidth}px`,
                      height: `${canvasHeight}px`,
                      backgroundImage: template?.backgroundUrlVerso ? `url(${template.backgroundUrlVerso})` : undefined,
                      backgroundSize: '100% 100%',
                      backgroundPosition: 'center',
                      backgroundRepeat: 'no-repeat',
                    }}
                    className="relative rounded-2xl overflow-hidden shadow-2xl bg-white border border-gray-300 select-none box-border"
                  >
                    {(template?.elementosVerso || []).map((el: any) => renderizarElemento(el))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer com Ações */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200 bg-white flex-shrink-0">
          <button
            onClick={onClose}
            disabled={gerandoPDF}
            className="px-5 py-2.5 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-100 font-semibold text-sm transition cursor-pointer disabled:opacity-50"
          >
            Fechar
          </button>

          <div className="flex items-center gap-3">
            <button
              onClick={handleGerarPDF}
              disabled={gerandoPDF || Boolean(erroValidacao) || loading}
              className="px-6 py-2.5 bg-gradient-to-r from-rose-700 to-purple-800 hover:from-rose-800 hover:to-purple-900 text-white font-bold text-sm rounded-xl shadow-md hover:shadow-lg transition flex items-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <Download className="w-4 h-4" />
              {gerandoPDF ? 'Gerando...' : 'Baixar PDF'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
