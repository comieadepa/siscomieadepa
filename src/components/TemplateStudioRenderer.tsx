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
  imagemUrl?: string;
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
  const isConec = typeof window !== 'undefined' && window.location.pathname.includes('/conec');
  const qrUrl = validationToken
    ? (isConec ? `${origin}/conec/credenciamento/validar/${validationToken}` : `${origin}/validar/${validationToken}`)
    : '';

  const baseWidth = template.largura || (template.orientacao === 'portrait' ? 794 : 1123);
  const baseHeight = template.altura || (template.orientacao === 'portrait' ? 1123 : 794);

  return (
    <div
      className="print-container relative select-none overflow-hidden bg-no-repeat bg-center"
      style={{
        width: `${baseWidth}px`,
        height: `${baseHeight}px`,
        backgroundImage: template.background_url ? `url('${template.background_url}')` : 'none',
        backgroundSize: 'cover',
      }}
    >
      {elementos.map((el: any) => {
        // Obter valor dinâmico ou fixo
        let contentText = el.conteudo || '';
        if ((el.tipo === 'text_dynamic' || el.tipo === 'texto') && el.placeholder) {
          contentText = dados[el.placeholder] !== undefined ? String(dados[el.placeholder]) : `[${el.placeholder}]`;
        } else if (el.tipo === 'texto') {
          contentText = el.conteudo || el.texto || '';
        }

        const debugStyle = debug ? 'border border-red-500 bg-red-100/10' : '';

        // Auto-detectar se as coordenadas vieram em porcentagem (<= 100) para compatibilidade reversa
        let absX = el.x;
        let absY = el.y;
        let absW = el.width !== undefined ? el.width : el.largura;
        let absH = el.height !== undefined ? el.height : el.altura;

        if (absX <= 100 && baseWidth > 300) {
          absX = (absX / 100) * baseWidth;
          absY = (absY / 100) * baseHeight;
          absW = (absW / 100) * baseWidth;
          absH = (absH / 100) * baseHeight;
        }

        // Estilos customizados inline
        const inlineStyles: React.CSSProperties = {
          position: 'absolute',
          top: `${absY}px`,
          left: `${absX}px`,
          width: `${absW}px`,
          height: `${absH}px`,
          opacity: el.opacity !== undefined ? el.opacity : (el.transparencia !== undefined ? (100 - el.transparencia) / 100 : 1),
          zIndex: el.zIndex || 1,
          transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
          boxSizing: 'border-box',
          overflow: 'hidden',
        };

        const isImage = el.tipo === 'image' || el.tipo === 'imagem' || el.tipo === 'logo' || el.tipo === 'signature' || el.tipo === 'assinatura';
        const imgUrl = el.imagemUrl || el.url || el.conteudo;

        const isChapa = el.tipo === 'chapa' || el.tipo === 'line' || el.tipo === 'rectangle';

        // Renderizador condicional baseado no tipo do elemento
        return (
          <div key={el.id} className={debugStyle} style={inlineStyles}>
            {el.tipo === 'qrcode' || el.tipo === 'qr_conec' ? (
              <div className="w-full h-full flex items-center justify-center">
                {qrUrl ? (
                  <QRCodeSVG value={qrUrl} size={Math.min(absW, absH) - 4} level="H" includeMargin={false} />
                ) : (
                  <div className="w-full h-full bg-gray-200 border border-gray-300 flex items-center justify-center text-[10px] text-gray-500 font-bold">
                    [QR CODE]
                  </div>
                )}
              </div>
            ) : isImage ? (
              imgUrl ? (
                <img
                  src={imgUrl}
                  alt={el.tipo}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                />
              ) : (
                <div className="w-full h-full bg-gray-200 border border-gray-300 flex items-center justify-center text-[10px] text-gray-500 font-bold">
                  [{el.tipo.toUpperCase()}]
                </div>
              )
            ) : isChapa ? (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  backgroundColor: el.styles?.color || el.cor || '#ff0000',
                  borderRadius: el.styles?.borderRadius ? `${el.styles.borderRadius}px` : '0px',
                }}
              />
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    width: '100%',
                    fontSize: el.styles?.fontSize || (el.fontSize ? `${el.fontSize}px` : '14px'),
                    fontFamily: el.styles?.fontFamily || (el.fonte || 'Arial').replace(' Semibold', ''),
                    fontWeight: el.styles?.fontWeight || ((el.fonte || '').endsWith(' Semibold') ? 600 : (el.negrito ? 'bold' : 'normal')),
                    fontStyle: el.styles?.fontStyle || (el.italico ? 'italic' : 'normal'),
                    textDecoration: el.sublinhado ? 'underline' : 'none',
                    color: el.styles?.color || el.cor || '#000000',
                    textAlign: el.styles?.textAlign || el.alinhamento || 'left',
                    lineHeight: '1.2',
                    wordBreak: 'break-word',
                    display: 'block',
                  }}
                >
                  {contentText}
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
