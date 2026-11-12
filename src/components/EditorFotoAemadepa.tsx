'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Check } from 'lucide-react';

interface EditorFotoAemadepaProps {
  isOpen: boolean;
  imagemOriginal: string | null;
  onConfirmar: (imagemRecortadaBase64: string) => void;
  onCancelar: () => void;
}

export default function EditorFotoAemadepa({
  isOpen,
  imagemOriginal,
  onConfirmar,
  onCancelar,
}: EditorFotoAemadepaProps) {
  // Dimensões do viewport de recorte (proporção 3:4 na tela)
  const VIEWPORT_WIDTH = 300;
  const VIEWPORT_HEIGHT = 400;

  // Dimensões finais da imagem recortada de alta resolução (3:4)
  const OUTPUT_WIDTH = 600;
  const OUTPUT_HEIGHT = 800;

  const [imageElement, setImageElement] = useState<HTMLImageElement | null>(null);
  const [naturalWidth, setNaturalWidth] = useState(0);
  const [naturalHeight, setNaturalHeight] = useState(0);

  // Escala mínima para a imagem cobrir completamente o viewport 3:4 sem bordas vazias
  const [minScale, setMinScale] = useState(1);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // Refs para controle de arrasto do mouse e toque
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const positionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const scaleRef = useRef(1);
  const minScaleRef = useRef(1);

  // Ref para pinça touch (distância inicial entre os dois dedos)
  const touchPinchStartDistRef = useRef<number | null>(null);
  const touchStartScaleRef = useRef(1);

  const containerRef = useRef<HTMLDivElement>(null);

  // Manter refs sincronizadas
  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  useEffect(() => {
    minScaleRef.current = minScale;
  }, [minScale]);

  // Função pura para travar a posição impedindo áreas vazias no viewport
  const clampPosition = useCallback(
    (x: number, y: number, currentScale: number, imgW: number, imgH: number) => {
      const renderedW = imgW * currentScale;
      const renderedH = imgH * currentScale;

      const maxOffsetX = Math.max(0, (renderedW - VIEWPORT_WIDTH) / 2);
      const maxOffsetY = Math.max(0, (renderedH - VIEWPORT_HEIGHT) / 2);

      const clampedX = Math.max(-maxOffsetX, Math.min(maxOffsetX, x));
      const clampedY = Math.max(-maxOffsetY, Math.min(maxOffsetY, y));

      return { x: clampedX, y: clampedY };
    },
    [VIEWPORT_WIDTH, VIEWPORT_HEIGHT]
  );

  // Carregar imagem e calcular enquadramento inicial
  useEffect(() => {
    if (!isOpen || !imagemOriginal) {
      setImageElement(null);
      return;
    }

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;
      setNaturalWidth(nw);
      setNaturalHeight(nh);
      setImageElement(img);

      // A escala mínima é aquela que faz a imagem cobrir totalmente o viewport 300x400
      const scaleW = VIEWPORT_WIDTH / nw;
      const scaleH = VIEWPORT_HEIGHT / nh;
      const baseScale = Math.max(scaleW, scaleH);

      setMinScale(baseScale);
      minScaleRef.current = baseScale;

      setScale(baseScale);
      scaleRef.current = baseScale;

      setPosition({ x: 0, y: 0 });
      positionRef.current = { x: 0, y: 0 };
    };
    img.src = imagemOriginal;
  }, [isOpen, imagemOriginal, VIEWPORT_WIDTH, VIEWPORT_HEIGHT]);

  // Zoom exclusivamente pela roda do mouse sobre o container
  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!naturalWidth || !naturalHeight) return;

    // Zoom suave
    const zoomFactor = e.deltaY < 0 ? 1.08 : 0.92;
    const currentScale = scaleRef.current;
    const baseMin = minScaleRef.current;
    const maxAllowedScale = baseMin * 5; // até 5x de ampliação máxima

    const targetScale = Math.max(baseMin, Math.min(maxAllowedScale, currentScale * zoomFactor));

    // Reajusta a posição para não vazar a borda com a nova escala
    const newPos = clampPosition(
      positionRef.current.x,
      positionRef.current.y,
      targetScale,
      naturalWidth,
      naturalHeight
    );

    setScale(targetScale);
    setPosition(newPos);
  };

  // Início de clique com mouse
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return; // apenas botão esquerdo
    isDraggingRef.current = true;
    dragStartRef.current = {
      x: e.clientX - positionRef.current.x,
      y: e.clientY - positionRef.current.y,
    };
  };

  // Movimento de arraste com mouse
  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || !naturalWidth || !naturalHeight) return;

    const newX = e.clientX - dragStartRef.current.x;
    const newY = e.clientY - dragStartRef.current.y;

    const clamped = clampPosition(
      newX,
      newY,
      scaleRef.current,
      naturalWidth,
      naturalHeight
    );

    setPosition(clamped);
  };

  // Fim do arraste com mouse
  const handleMouseUp = () => {
    isDraggingRef.current = false;
  };

  // Suporte Touch: Arrastar e Zoom por Pinça
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 1) {
      // 1 dedo: Pan/Arrastar
      isDraggingRef.current = true;
      const touch = e.touches[0];
      dragStartRef.current = {
        x: touch.clientX - positionRef.current.x,
        y: touch.clientY - positionRef.current.y,
      };
      touchPinchStartDistRef.current = null;
    } else if (e.touches.length === 2) {
      // 2 dedos: Pinça/Pinch Zoom
      isDraggingRef.current = false;
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      touchPinchStartDistRef.current = dist;
      touchStartScaleRef.current = scaleRef.current;
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!naturalWidth || !naturalHeight) return;

    if (e.touches.length === 1 && isDraggingRef.current) {
      // 1 dedo: Pan
      const touch = e.touches[0];
      const newX = touch.clientX - dragStartRef.current.x;
      const newY = touch.clientY - dragStartRef.current.y;

      const clamped = clampPosition(
        newX,
        newY,
        scaleRef.current,
        naturalWidth,
        naturalHeight
      );

      setPosition(clamped);
    } else if (e.touches.length === 2 && touchPinchStartDistRef.current) {
      // 2 dedos: Pinch zoom
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      const ratio = dist / touchPinchStartDistRef.current;
      const baseMin = minScaleRef.current;
      const maxAllowedScale = baseMin * 5;

      const targetScale = Math.max(
        baseMin,
        Math.min(maxAllowedScale, touchStartScaleRef.current * ratio)
      );

      const newPos = clampPosition(
        positionRef.current.x,
        positionRef.current.y,
        targetScale,
        naturalWidth,
        naturalHeight
      );

      setScale(targetScale);
      setPosition(newPos);
    }
  };

  const handleTouchEnd = () => {
    isDraggingRef.current = false;
    touchPinchStartDistRef.current = null;
  };

  // Gerar e salvar imagem recortada 600x800 sem distorção
  const handleAplicarRecorte = () => {
    if (!imageElement || !naturalWidth || !naturalHeight) return;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Fundo branco de segurança
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);

    const renderedW = naturalWidth * scale;
    const renderedH = naturalHeight * scale;

    // Posição do canto superior esquerdo da imagem dentro do viewport (300x400)
    const imgLeftInViewport = (VIEWPORT_WIDTH - renderedW) / 2 + position.x;
    const imgTopInViewport = (VIEWPORT_HEIGHT - renderedH) / 2 + position.y;

    // Converte para coordenadas da imagem natural (pixels reais do arquivo fonte)
    const sx = Math.max(0, -imgLeftInViewport / scale);
    const sy = Math.max(0, -imgTopInViewport / scale);
    const sWidth = Math.min(naturalWidth - sx, VIEWPORT_WIDTH / scale);
    const sHeight = Math.min(naturalHeight - sy, VIEWPORT_HEIGHT / scale);

    // Desenha no canvas final em alta resolução exatamente o retângulo recortado
    ctx.drawImage(
      imageElement,
      sx,
      sy,
      sWidth,
      sHeight,
      0,
      0,
      OUTPUT_WIDTH,
      OUTPUT_HEIGHT
    );

    // Gera JPEG de alta qualidade (0.92)
    const resultadoBase64 = canvas.toDataURL('image/jpeg', 0.92);
    onConfirmar(resultadoBase64);
  };

  if (!isOpen || !imagemOriginal) return null;

  return (
    <div
      className="fixed inset-0 z-[120] bg-black/80 flex items-center justify-center p-4 backdrop-blur-sm animate-fadeIn"
      onMouseUp={handleMouseUp}
    >
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col border border-gray-100">
        {/* Cabeçalho Limpo */}
        <div className="px-5 py-4 border-b border-gray-200 flex items-center justify-between bg-rose-50/50">
          <div>
            <h3 className="font-bold text-gray-900 text-base">Enquadrar Foto 3×4</h3>
            <p className="text-xs text-gray-500">
              Role a roda do mouse para zoom • Arraste para reposicionar
            </p>
          </div>
          <button
            type="button"
            onClick={onCancelar}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition"
            title="Cancelar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Viewport 3:4 com interação direta de mouse/touch */}
        <div className="p-6 bg-slate-900 flex flex-col items-center justify-center select-none">
          <div
            ref={containerRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="relative overflow-hidden cursor-grab active:cursor-grabbing rounded-lg shadow-2xl border-2 border-rose-500/80 bg-black"
            style={{
              width: `${VIEWPORT_WIDTH}px`,
              height: `${VIEWPORT_HEIGHT}px`,
              touchAction: 'none',
            }}
          >
            {imageElement && (
              <img
                src={imagemOriginal}
                alt="Enquadramento da Foto"
                draggable={false}
                className="pointer-events-none select-none max-w-none transition-none"
                style={{
                  width: `${naturalWidth * scale}px`,
                  height: `${naturalHeight * scale}px`,
                  transform: `translate(${
                    (VIEWPORT_WIDTH - naturalWidth * scale) / 2 + position.x
                  }px, ${
                    (VIEWPORT_HEIGHT - naturalHeight * scale) / 2 + position.y
                  }px)`,
                  transformOrigin: 'top left',
                }}
              />
            )}

            {/* Grid guia discreto de terços para enquadramento facial */}
            <div className="absolute inset-0 pointer-events-none grid grid-cols-3 grid-rows-3 border border-white/20">
              <div className="border-r border-b border-white/15" />
              <div className="border-r border-b border-white/15" />
              <div className="border-b border-white/15" />
              <div className="border-r border-b border-white/15" />
              <div className="border-r border-b border-white/15" />
              <div className="border-b border-white/15" />
              <div className="border-r border-white/15" />
              <div className="border-r border-white/15" />
              <div />
            </div>

            {/* Badge de proporção oficial 3×4 */}
            <div className="absolute bottom-2 right-2 bg-black/60 text-white text-[10px] font-semibold px-2 py-0.5 rounded backdrop-blur-sm pointer-events-none">
              3×4 (600×800)
            </div>
          </div>
        </div>

        {/* Somente as Ações Essenciais */}
        <div className="p-4 bg-gray-50 border-t border-gray-200 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onCancelar}
            className="px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200 rounded-lg transition"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleAplicarRecorte}
            className="px-5 py-2 text-sm font-bold text-white bg-rose-600 hover:bg-rose-700 active:bg-rose-800 rounded-lg shadow-sm flex items-center gap-1.5 transition"
          >
            <Check className="w-4 h-4" />
            Aplicar Recorte
          </button>
        </div>
      </div>
    </div>
  );
}
