'use client';

import React from 'react';
import { QRCodeSVG } from 'qrcode.react';

interface ElementStyles {
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  fontStyle?: 'normal' | 'italic';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
  color?: string;
  borderColor?: string;
  borderWidth?: number;
  backgroundColor?: string;
}

interface TemplateElement {
  id: string;
  tipo: 'text_fixed' | 'text_dynamic' | 'image' | 'logo' | 'qrcode' | 'line' | 'rectangle' | 'signature' | 'date' | 'custom_field';
  placeholder?: string;
  conteudo?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
  opacity?: number;
  zIndex?: number;
  styles?: ElementStyles;
}

interface Template {
  background_url?: string;
  largura: number;
  altura: number;
  orientacao: 'landscape' | 'portrait';
  elementos: TemplateElement[] | string;
}

interface TemplateStudioRendererProps {
  template: Template;
  dados: Record<string, string | number>;
  validationToken?: string;
  debug?: boolean;
}

export default function TemplateStudioRenderer({
  template,
  dados,
  validationToken,
  debug = false
}: TemplateStudioRendererProps) {
  const elementos = typeof template.elementos === 'string'
    ? JSON.parse(template.elementos) as TemplateElement[]
    : template.elementos || [];

  const origin = typeof window !== 'undefined' ? window.location.origin : 'https://siscomieadepa.com.br';
  const qrUrl = validationToken ? `${origin}/validar/${validationToken}` : '';

  return (
    <div
      className="print-container relative select-none overflow-hidden bg-no-repeat bg-center"
      style={{
        width: `${template.largura}px`,
        height: `${template.altura}px`,
        backgroundImage: template.background_url ? `url('${template.background_url}')` : 'none',
        backgroundSize: '100% 100%',
      }}
    >
      {elementos.map((el) => {
        // Obter valor dinâmico ou fixo
        let contentText = el.conteudo || '';
        if (el.tipo === 'text_dynamic' && el.placeholder) {
          contentText = dados[el.placeholder] !== undefined ? String(dados[el.placeholder]) : `[${el.placeholder}]`;
        }

        const debugStyle = debug ? 'border-2 border-red-500 bg-red-100/10' : '';

        // Estilos customizados inline
        const inlineStyles: React.CSSProperties = {
          position: 'absolute',
          top: `${el.y}%`,
          left: `${el.x}%`,
          width: `${el.width}%`,
          height: `${el.height}%`,
          fontSize: el.styles?.fontSize || '14px',
          fontFamily: el.styles?.fontFamily || 'sans-serif',
          fontWeight: el.styles?.fontWeight || 'normal',
          fontStyle: el.styles?.fontStyle || 'normal',
          textAlign: el.styles?.textAlign || 'left',
          color: el.styles?.color || '#000000',
          opacity: el.opacity !== undefined ? el.opacity : 1,
          zIndex: el.zIndex || 1,
          transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        };

        // Renderizador condicional baseado no tipo do elemento
        return (
          <div key={el.id} className={`${debugStyle} flex items-center`} style={inlineStyles}>
            {el.tipo === 'qrcode' ? (
              <div className="w-full h-full flex items-center justify-center">
                {qrUrl ? (
                  <QRCodeSVG value={qrUrl} size={64} style={{ width: '100%', height: '105%' }} />
                ) : (
                  <div className="w-full h-full bg-gray-200 border border-gray-300 flex items-center justify-center text-[10px] text-gray-500 font-bold">
                    [QR CODE]
                  </div>
                )}
              </div>
            ) : (
              <span className="w-full leading-none truncate">
                {contentText}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
