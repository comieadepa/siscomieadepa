'use client';

import { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { X, Download, ShieldCheck, AlertCircle, Loader2, QrCode } from 'lucide-react';
import { createClient } from '@/lib/supabase-client';

interface ConecSelosModalProps {
  isOpen: boolean;
  onClose: () => void;
  instituicao: {
    id: string;
    nome_instituicao: string;
    cnpj?: string;
    conec_credenciamentos?: any[];
  } | null;
}

export default function ConecSelosModal({ isOpen, onClose, instituicao }: ConecSelosModalProps) {
  const supabase = createClient();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [credenciamento, setCredenciamento] = useState<any>(null);
  const [isEligible, setIsEligible] = useState<boolean>(false);

  const [previewH, setPreviewH] = useState<string | null>(null);
  const [previewV, setPreviewV] = useState<string | null>(null);
  const [downloadingFormat, setDownloadingFormat] = useState<'h' | 'v' | null>(null);

  // Hidden offscreen canvases for rendering 2x high resolution
  const canvasHRef = useRef<HTMLCanvasElement | null>(null);
  const canvasVRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!isOpen || !instituicao) {
      setPreviewH(null);
      setPreviewV(null);
      setCredenciamento(null);
      setError(null);
      return;
    }

    let isMounted = true;

    async function loadDataAndGenerate() {
      setLoading(true);
      setError(null);

      try {
        // 1. Obter o credenciamento mais recente da instituição
        const { data: creds, error: credError } = await supabase
          .from('conec_credenciamentos')
          .select('*')
          .eq('instituicao_id', instituicao?.id)
          .is('deleted_at', null)
          .order('ano_referencia', { ascending: false })
          .limit(1);

        if (credError) throw credError;

        const latestCred = creds && creds.length > 0 ? creds[0] : null;

        if (!latestCred) {
          throw new Error('Nenhum credenciamento cadastrado para esta instituição.');
        }

        if (!isMounted) return;
        setCredenciamento(latestCred);

        // 2. Verificar se está ativo e pago
        const eligible = latestCred.status_credenciamento === 'ativo' && latestCred.status_pagamento === 'pago';
        setIsEligible(eligible);

        if (!eligible) {
          setLoading(false);
          return;
        }

        // 3. Obter ou gerar token de validação
        let currentToken = '';
        const { data: existingToken } = await supabase
          .from('document_tokens')
          .select('token')
          .eq('reference_id', latestCred.id)
          .eq('document_type', 'conec_credenciamento')
          .maybeSingle();

        if (existingToken?.token) {
          currentToken = existingToken.token;
        } else {
          // Criar novo token compatível com o padrão do CONEC
          const dadosPublicos = {
            nome_instituicao: instituicao?.nome_instituicao,
            cnpj: instituicao?.cnpj,
            numero_registro: latestCred.numero_registro,
            data_inicio: latestCred.data_inicio,
            data_fim: latestCred.data_fim,
            status: latestCred.status_credenciamento,
          };

          const { data: newToken, error: createError } = await supabase
            .from('document_tokens')
            .insert({
              template_id: '12345678-1234-1234-1234-123456789abc',
              document_type: 'conec_credenciamento',
              reference_id: latestCred.id,
              dados_publicos: dadosPublicos,
            })
            .select('token')
            .single();

          if (createError) throw createError;
          if (newToken?.token) currentToken = newToken.token;
        }

        if (!isMounted) return;

        // 4. Renderizar os dois selos nos canvases
        await renderSeals(currentToken);
      } catch (err: any) {
        console.error('Erro ao preparar selos CONEC:', err);
        if (isMounted) {
          setError(err.message || 'Falha ao processar credenciamento para geração dos selos.');
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadDataAndGenerate();

    return () => {
      isMounted = false;
    };
  }, [isOpen, instituicao]);

  // Função para desenhar retângulo arredondado no Canvas
  const drawRoundedRect = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
    fillColor: string,
    strokeColor: string,
    strokeWidth: number
  ) => {
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.arcTo(x + width, y, x + width, y + radius, radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.arcTo(x + width, y + height, x + width - radius, y + height, radius);
    ctx.lineTo(x + radius, y + height);
    ctx.arcTo(x, y + height, x, y + height - radius, radius);
    ctx.lineTo(x, y + radius);
    ctx.arcTo(x, y, x + radius, y, radius);
    ctx.closePath();

    ctx.fillStyle = fillColor;
    ctx.fill();

    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = strokeColor;
    ctx.stroke();
    ctx.restore();
  };

  // Garante o carregamento da fonte antes da pintura
  const ensureFontsLoaded = async () => {
    try {
      if (typeof document !== 'undefined' && 'fonts' in document) {
        await (document as any).fonts.ready;
      }
    } catch {
      // Ignora e usa fallback
    }
  };

  const renderSeals = async (valToken: string) => {
    await ensureFontsLoaded();

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://www.siscomieadepa.org';
    const validationUrl = `${baseUrl}/conec/credenciamento/validar/${valToken}`;

    // Gerar imagem do QR Code
    const qrDataUrl = await QRCode.toDataURL(validationUrl, {
      errorCorrectionLevel: 'M',
      margin: 0,
      width: 426,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
    });

    const qrImage = new Image();
    await new Promise((resolve, reject) => {
      qrImage.onload = resolve;
      qrImage.onerror = reject;
      qrImage.src = qrDataUrl;
    });

    const textColor = '#373435';
    const fontFamily = "'Berlin Sans FB', 'Segoe UI', Arial, sans-serif";

    // ==========================================
    // 1. RENDERIZAR SELO HORIZONTAL (1227 × 626)
    // ==========================================
    const widthH = 1227;
    const heightH = 626;
    const canvasH = document.createElement('canvas');
    canvasH.width = widthH;
    canvasH.height = heightH;
    const ctxH = canvasH.getContext('2d');

    if (ctxH) {
      ctxH.clearRect(0, 0, widthH, heightH);

      // Card com cantos arredondados e fundo branco
      drawRoundedRect(ctxH, 2, 2, widthH - 4, heightH - 4, 52, '#ffffff', textColor, 3);

      // Textos institucionais à esquerda (centro X = 345)
      const textCenterX = 345;
      ctxH.textAlign = 'center';
      ctxH.textBaseline = 'alphabetic';
      ctxH.fillStyle = textColor;

      // Linha 1
      ctxH.font = `34px ${fontFamily}`;
      ctxH.fillText('O Conselho de Educação Cristã', textCenterX, 122);

      // Linha 2: "CONEC, da COMIEADEPA" com "CONEC" em destaque
      const conecText = 'CONEC';
      const suffixText = ', da COMIEADEPA';
      ctxH.font = `bold 42px ${fontFamily}`;
      const conecMetrics = ctxH.measureText(conecText);
      ctxH.font = `bold 36px ${fontFamily}`;
      const suffixMetrics = ctxH.measureText(suffixText);
      const totalL2Width = conecMetrics.width + suffixMetrics.width;

      const l2StartX = textCenterX - totalL2Width / 2;
      ctxH.textAlign = 'left';
      ctxH.font = `bold 42px ${fontFamily}`;
      ctxH.fillText(conecText, l2StartX, 172);

      ctxH.font = `bold 36px ${fontFamily}`;
      ctxH.fillText(suffixText, l2StartX + conecMetrics.width, 172);

      // Demais linhas centralizadas
      ctxH.textAlign = 'center';
      ctxH.font = `34px ${fontFamily}`;
      ctxH.fillText('no uso de suas atribuições,', textCenterX, 222);
      ctxH.fillText('informa que esta instituição está', textCenterX, 270);
      ctxH.fillText('devidamente credenciada e', textCenterX, 318);
      ctxH.fillText('reconhecida pela nossa', textCenterX, 366);
      ctxH.fillText('estimada COMIEADEPA.', textCenterX, 414);
      ctxH.fillText('Confira a autenticidade', textCenterX, 462);
      ctxH.fillText('pelo QR Code abaixo:', textCenterX, 510);

      // QR Code à direita (X = 682, Y = 76, 426×426)
      ctxH.drawImage(qrImage, 682, 76, 426, 426);

      // Instrução inferior centralizada sob o QR Code (X = 682 + 213 = 895, Y = 556)
      ctxH.textAlign = 'center';
      ctxH.font = `bold 36px ${fontFamily}`;
      ctxH.fillText('Aponte a câmera do celular', 895, 558);

      const urlH = canvasH.toDataURL('image/png');
      setPreviewH(urlH);
      canvasHRef.current = canvasH;
    }

    // ==========================================
    // 2. RENDERIZAR SELO VERTICAL (604 × 979)
    // ==========================================
    const widthV = 604;
    const heightV = 979;
    const canvasV = document.createElement('canvas');
    canvasV.width = widthV;
    canvasV.height = heightV;
    const ctxV = canvasV.getContext('2d');

    if (ctxV) {
      ctxV.clearRect(0, 0, widthV, heightV);

      // Card com cantos arredondados e fundo branco
      drawRoundedRect(ctxV, 2, 2, widthV - 4, heightV - 4, 52, '#ffffff', textColor, 3);

      // Textos institucionais no topo (centro X = 302)
      const textCenterX = 302;
      ctxV.textAlign = 'center';
      ctxV.textBaseline = 'alphabetic';
      ctxV.fillStyle = textColor;

      // Linha 1
      ctxV.font = `29px ${fontFamily}`;
      ctxV.fillText('O Conselho de Educação Cristã', textCenterX, 66);

      // Linha 2
      const conecText = 'CONEC';
      const suffixText = ', da COMIEADEPA';
      ctxV.font = `bold 36px ${fontFamily}`;
      const conecMetrics = ctxV.measureText(conecText);
      ctxV.font = `bold 31px ${fontFamily}`;
      const suffixMetrics = ctxV.measureText(suffixText);
      const totalL2Width = conecMetrics.width + suffixMetrics.width;

      const l2StartX = textCenterX - totalL2Width / 2;
      ctxV.textAlign = 'left';
      ctxV.font = `bold 36px ${fontFamily}`;
      ctxV.fillText(conecText, l2StartX, 108);

      ctxV.font = `bold 31px ${fontFamily}`;
      ctxV.fillText(suffixText, l2StartX + conecMetrics.width, 108);

      // Linhas seguintes
      ctxV.textAlign = 'center';
      ctxV.font = `29px ${fontFamily}`;
      ctxV.fillText('no uso de suas atribuições,', textCenterX, 148);
      ctxV.fillText('informa que esta instituição está', textCenterX, 188);
      ctxV.fillText('devidamente credenciada e', textCenterX, 228);
      ctxV.fillText('reconhecida pela nossa', textCenterX, 268);
      ctxV.fillText('estimada COMIEADEPA.', textCenterX, 308);
      ctxV.fillText('Confira a autenticidade', textCenterX, 348);
      ctxV.fillText('pelo QR Code abaixo:', textCenterX, 388);

      // QR Code centralizado na base (X = 89, Y = 446, 426×426)
      ctxV.drawImage(qrImage, 89, 446, 426, 426);

      // Instrução inferior sob o QR Code (X = 302, Y = 942)
      ctxV.textAlign = 'center';
      ctxV.font = `bold 35px ${fontFamily}`;
      ctxV.fillText('Aponte a câmera do celular', textCenterX, 942);

      const urlV = canvasV.toDataURL('image/png');
      setPreviewV(urlV);
      canvasVRef.current = canvasV;
    }
  };

  const handleDownload = (format: 'horizontal' | 'vertical') => {
    const canvas = format === 'horizontal' ? canvasHRef.current : canvasVRef.current;
    if (!canvas) return;

    setDownloadingFormat(format === 'horizontal' ? 'h' : 'v');

    try {
      const slug = (instituicao?.nome_instituicao || 'instituicao')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

      const fileName = `selo-conec-${slug}-${format}.png`;

      const link = document.createElement('a');
      link.download = fileName;
      link.href = canvas.toDataURL('image/png');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error('Erro ao baixar selo:', err);
    } finally {
      setDownloadingFormat(null);
    }
  };

  if (!isOpen || !instituicao) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-gray-100 overflow-hidden my-8">
        
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-teal-800 to-teal-900 text-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-700/50 flex items-center justify-center border border-teal-500/30 shadow-inner">
              <QrCode className="w-5 h-5 text-teal-200" />
            </div>
            <div>
              <h2 className="text-lg font-bold leading-tight">Selos de Credenciamento — CONEC</h2>
              <p className="text-xs text-teal-200/80">Formatos oficiais para certificados e impressos teológicos</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-teal-200 hover:text-white hover:bg-teal-700/50 transition cursor-pointer"
            aria-label="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informações da Instituição */}
        <div className="px-6 py-3.5 bg-gray-50/80 border-b border-gray-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div>
            <span className="font-semibold text-gray-500 uppercase tracking-wider">Instituição: </span>
            <span className="font-bold text-gray-800 text-sm">{instituicao.nome_instituicao}</span>
            {instituicao.cnpj && (
              <span className="ml-2 text-gray-500 font-mono">({instituicao.cnpj})</span>
            )}
          </div>
          {credenciamento && (
            <div className="flex items-center gap-2">
              <span className="bg-teal-100 text-teal-800 font-bold px-2 py-0.5 rounded text-[11px]">
                Reg: {credenciamento.numero_registro || '—'}
              </span>
              <span className="bg-gray-200 text-gray-700 font-medium px-2 py-0.5 rounded text-[11px]">
                Ano: {credenciamento.ano_referencia || new Date().getFullYear()}
              </span>
            </div>
          )}
        </div>

        {/* Corpo do Modal */}
        <div className="p-6">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center text-gray-500 gap-3">
              <Loader2 className="w-8 h-8 text-teal-600 animate-spin" />
              <p className="text-sm font-medium">Renderizando selos digitais em alta definição...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 text-red-700">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div className="text-sm">
                <p className="font-bold">Não foi possível carregar os selos</p>
                <p className="text-xs text-red-600 mt-0.5">{error}</p>
              </div>
            </div>
          ) : !isEligible ? (
            <div className="p-6 bg-amber-50 border border-amber-200 rounded-xl text-center space-y-3">
              <div className="w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center mx-auto">
                <AlertCircle className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-amber-900">Emissão de Selos Bloqueada</h3>
              <p className="text-xs text-amber-700 max-w-lg mx-auto leading-relaxed">
                Os selos de autenticidade CONEC apenas podem ser gerados e baixados para instituições com credenciamento 
                <strong> ativo</strong> e <strong>pagamento devidamente quitado</strong>.
              </p>
              <div className="inline-flex gap-4 pt-2 text-xs text-gray-600 font-semibold">
                <span>Situação: <span className="uppercase text-amber-800">{credenciamento?.status_credenciamento || 'Pendente'}</span></span>
                <span>•</span>
                <span>Pagamento: <span className="uppercase text-amber-800">{credenciamento?.status_pagamento || 'Pendente'}</span></span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Formato 1: Selo Horizontal */}
              <div className="flex flex-col justify-between p-4 bg-gray-50/60 rounded-xl border border-gray-200 hover:border-teal-300 transition shadow-sm">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-teal-600" />
                      Selo Horizontal (1227 × 626 px)
                    </span>
                    <span className="text-[11px] font-semibold text-gray-500 bg-gray-200/80 px-2 py-0.5 rounded">
                      2× Alta Definição
                    </span>
                  </div>

                  {/* Prévia */}
                  <div className="p-3 bg-white rounded-lg border border-gray-200 flex items-center justify-center min-h-[190px]">
                    {previewH ? (
                      <img
                        src={previewH}
                        alt="Prévia Selo Horizontal"
                        className="max-h-44 w-auto object-contain rounded shadow-xs"
                      />
                    ) : (
                      <div className="text-xs text-gray-400">Carregando imagem...</div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-2 text-center">
                    Ideal para rodapés, cabeçalhos ou certificados em formato paisagem.
                  </p>
                </div>

                <div className="pt-4 mt-2 border-t border-gray-200/80">
                  <button
                    onClick={() => handleDownload('horizontal')}
                    disabled={!previewH || downloadingFormat !== null}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold transition shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    {downloadingFormat === 'h' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Baixar Horizontal (PNG)
                  </button>
                </div>
              </div>

              {/* Formato 2: Selo Vertical */}
              <div className="flex flex-col justify-between p-4 bg-gray-50/60 rounded-xl border border-gray-200 hover:border-teal-300 transition shadow-sm">
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-sm font-bold text-gray-800 flex items-center gap-1.5">
                      <span className="w-2 h-2 rounded-full bg-teal-600" />
                      Selo Vertical (604 × 979 px)
                    </span>
                    <span className="text-[11px] font-semibold text-gray-500 bg-gray-200/80 px-2 py-0.5 rounded">
                      2× Alta Definição
                    </span>
                  </div>

                  {/* Prévia */}
                  <div className="p-3 bg-white rounded-lg border border-gray-200 flex items-center justify-center min-h-[190px]">
                    {previewV ? (
                      <img
                        src={previewV}
                        alt="Prévia Selo Vertical"
                        className="max-h-44 w-auto object-contain rounded shadow-xs"
                      />
                    ) : (
                      <div className="text-xs text-gray-400">Carregando imagem...</div>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 mt-2 text-center">
                    Ideal para colunas laterais ou certificados em formato retrato.
                  </p>
                </div>

                <div className="pt-4 mt-2 border-t border-gray-200/80">
                  <button
                    onClick={() => handleDownload('vertical')}
                    disabled={!previewV || downloadingFormat !== null}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg text-xs font-bold transition shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    {downloadingFormat === 'v' ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Download className="w-4 h-4" />
                    )}
                    Baixar Vertical (PNG)
                  </button>
                </div>
              </div>

            </div>
          )}

          {/* Dica de Utilização */}
          <div className="mt-6 p-3 bg-teal-50/70 border border-teal-200/70 rounded-xl flex items-center gap-2.5 text-teal-900 text-xs">
            <ShieldCheck className="w-4 h-4 text-teal-700 flex-shrink-0" />
            <span>
              Ao escanear o QR Code dos selos, o aluno ou avaliador é direcionado à página pública oficial de verificação de autenticidade da COMIEADEPA.
            </span>
          </div>
        </div>

        {/* Rodapé */}
        <div className="px-6 py-3.5 bg-gray-50 border-t border-gray-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-white hover:bg-gray-100 text-gray-700 border border-gray-300 rounded-lg text-xs font-bold transition shadow-xs cursor-pointer"
          >
            Fechar
          </button>
        </div>

      </div>
    </div>
  );
}
