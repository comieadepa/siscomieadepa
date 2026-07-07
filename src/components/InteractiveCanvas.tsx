'use client';

import { useState, useRef, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { obterPreviewTexto } from '@/lib/cartoes-utils';
import { createClient } from '@/lib/supabase-client';
import { fetchConfiguracaoIgrejaFromSupabase } from '@/lib/igreja-config-utils';

// ─── Constantes da Safe Area ───────────────────────────────────────────────
const SAFE_AREA_MARGIN = 25; // px em todas as bordas
const SNAP_THRESHOLD   = 8;  // px para snap suave nas bordas da safe area

interface ElementoCartao {
    id: string;
    tipo: 'texto' | 'qrcode' | 'logo' | 'foto-membro' | 'chapa' | 'imagem' | 'caixa' | 'tabela';
    x: number;
    y: number;
    largura: number;
    altura: number;
    fontSize?: number;
    cor?: string;
    backgroundColor?: string;
    fonte?: string;
    transparencia?: number;
    borderRadius?: number;
    texto?: string;
    alinhamento?: 'left' | 'center' | 'right' | 'justify';
    negrito?: boolean;
    italico?: boolean;
    sublinhado?: boolean;
    sombreado?: boolean;
    imagemUrl?: string;
    foto?: string;
    visivel: boolean;
    borderWidth?: number;
    borderColor?: string;
    padding?: number;
    linhas?: string[][];
}

interface InteractiveCanvasProps<T extends ElementoCartao = ElementoCartao> {
    elementos: T[];
    elementoSelecionado: T | null;
    elementosSelecionados: T[];
    nomenclaturas?: any;
    getPreviewText?: (text: string) => string;
    backgroundUrl?: string;
    onElementoSelecionado: (elemento: T | null) => void;
    onElementosSelecionados: (elementos: T[]) => void;
    onElementoAtualizado: (elementoId: string, propriedades: Partial<T>) => void;
    onMultiplosElementosAtualizados?: (atualizacoes: Array<{ id: string; propriedades: Partial<T> }>) => void;
    onElementosAdicionados?: (novoElementos: T[]) => void;
    onElementoRemovido?: (elementoId: string) => void;
    larguraCanvas?: number;
    alturaCanvas?: number;
}

// ─── Utilitários ────────────────────────────────────────────────────────────

/** Clamp numérico */
const clamp = (val: number, min: number, max: number) => Math.max(min, Math.min(max, val));

/**
 * Aplica snap suave: se o valor estiver dentro do threshold da borda, encaixa nela.
 * Retorna o valor possivelmente "snapped".
 */
function snapTo(val: number, target: number): number {
    return Math.abs(val - target) <= SNAP_THRESHOLD ? target : val;
}

/**
 * Verifica se um elemento está fora da safe area.
 * Retorna true se estiver total ou parcialmente fora.
 */
function estaForaDaSafeArea(el: { x: number; y: number; largura: number; altura: number }, w: number, h: number): boolean {
    const sl = SAFE_AREA_MARGIN;
    const st = SAFE_AREA_MARGIN;
    const sr = w - SAFE_AREA_MARGIN;
    const sb = h - SAFE_AREA_MARGIN;
    return el.x < sl || el.y < st || el.x + el.largura > sr || el.y + el.altura > sb;
}

export default function InteractiveCanvas<T extends ElementoCartao = ElementoCartao>({
    elementos = [],
    elementoSelecionado,
    elementosSelecionados = [],
    nomenclaturas,
    getPreviewText,
    backgroundUrl,
    onElementoSelecionado,
    onElementosSelecionados,
    onElementoAtualizado,
    onMultiplosElementosAtualizados,
    onElementosAdicionados,
    onElementoRemovido,
    larguraCanvas = 465,
    alturaCanvas = 291
}: InteractiveCanvasProps<T>) {
    const [isDragging, setIsDragging] = useState(false);
    const [configIgreja, setConfigIgreja] = useState<any>(null);
    const [clipboard, setClipboard] = useState<T[]>([]);

    useEffect(() => {
        const supabase = createClient();
        fetchConfiguracaoIgrejaFromSupabase(supabase)
            .then(setConfigIgreja)
            .catch(() => setConfigIgreja(null));
    }, []);

    const [isResizing, setIsResizing] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0, elementX: 0, elementY: 0 });
    const [resizeStart, setResizeStart] = useState({ x: 0, y: 0, width: 0, height: 0, elementX: 0, elementY: 0 });
    const [resizeHandle, setResizeHandle] = useState<'tl' | 'tr' | 'bl' | 'br' | null>(null);
    const [multiDragStart, setMultiDragStart] = useState<Map<string, { x: number; y: number }>>(new Map());
    const [isBoxSelecting, setIsBoxSelecting] = useState(false);
    const [boxSelectionStart, setBoxSelectionStart] = useState({ x: 0, y: 0 });
    const [boxSelectionEnd, setBoxSelectionEnd] = useState({ x: 0, y: 0 });

    const canvasRef = useRef<HTMLDivElement>(null);

    // ─── Limites da Safe Area ──────────────────────────────────────────────
    const safeLeft   = SAFE_AREA_MARGIN;
    const safeTop    = SAFE_AREA_MARGIN;
    const safeRight  = larguraCanvas - SAFE_AREA_MARGIN;
    const safeBottom = alturaCanvas  - SAFE_AREA_MARGIN;

    /**
     * Aplica clamp + snap para a posição de um elemento durante drag.
     * Restringe dentro da safe area e encaixa nas bordas se perto o suficiente.
     */
    function aplicarClampESnap(rawX: number, rawY: number, elLargura: number, elAltura: number) {
        // Clamp dentro da safe area
        let x = clamp(rawX, safeLeft, safeRight  - elLargura);
        let y = clamp(rawY, safeTop,  safeBottom - elAltura);

        // Snap nas bordas da safe area
        x = snapTo(x, safeLeft);
        x = snapTo(x, safeRight  - elLargura);
        y = snapTo(y, safeTop);
        y = snapTo(y, safeBottom - elAltura);

        return { x, y };
    }

    // ─── Event Handlers ────────────────────────────────────────────────────

    const handleElementMouseDown = (e: React.MouseEvent, elemento: T) => {
        e.preventDefault();
        e.stopPropagation();
        canvasRef.current?.focus();

        if (e.ctrlKey || e.metaKey) {
            const jaEstaSelecionado = elementosSelecionados.some(el => el.id === elemento.id);
            if (jaEstaSelecionado) {
                onElementosSelecionados(elementosSelecionados.filter(el => el.id !== elemento.id));
            } else {
                onElementosSelecionados([...elementosSelecionados, elemento]);
            }
            return;
        }

        const elementoJaEstaSelecionado = elementosSelecionados.some(el => el.id === elemento.id);

        if (elementosSelecionados.length > 1 && elementoJaEstaSelecionado) {
            setIsDragging(true);
            const startPositions = new Map<string, { x: number; y: number }>();
            elementosSelecionados.forEach(el => {
                startPositions.set(el.id, { x: el.x, y: el.y });
            });
            setMultiDragStart(startPositions);
            setDragStart({ x: e.clientX, y: e.clientY, elementX: 0, elementY: 0 });
        } else {
            onElementoSelecionado(elemento);
            onElementosSelecionados([elemento]);
            setIsDragging(true);
            const startPositions = new Map<string, { x: number; y: number }>();
            startPositions.set(elemento.id, { x: elemento.x, y: elemento.y });
            setMultiDragStart(startPositions);
            setDragStart({ x: e.clientX, y: e.clientY, elementX: elemento.x, elementY: elemento.y });
        }
    };

    const handleResizeMouseDown = (e: React.MouseEvent, handle: 'tl' | 'tr' | 'bl' | 'br') => {
        e.preventDefault();
        e.stopPropagation();
        if (!elementoSelecionado) return;

        setIsResizing(true);
        setResizeHandle(handle);
        setResizeStart({
            x: e.clientX,
            y: e.clientY,
            width: elementoSelecionado.largura,
            height: elementoSelecionado.altura,
            elementX: elementoSelecionado.x,
            elementY: elementoSelecionado.y
        });
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isBoxSelecting) {
            const rect = e.currentTarget.getBoundingClientRect();
            setBoxSelectionEnd({
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            });
        } else if (isDragging && elementosSelecionados.length > 0) {
            const deltaX = e.clientX - dragStart.x;
            const deltaY = e.clientY - dragStart.y;

            if (onMultiplosElementosAtualizados && elementosSelecionados.length > 1) {
                const atualizacoes = elementosSelecionados.map(elemento => {
                    const startPos = multiDragStart.get(elemento.id);
                    if (startPos) {
                        const raw = { x: startPos.x + deltaX, y: startPos.y + deltaY };
                        const { x, y } = aplicarClampESnap(raw.x, raw.y, elemento.largura, elemento.altura);
                        return { id: elemento.id, propriedades: { x, y } as any };
                    }
                    return null;
                }).filter(Boolean) as Array<{ id: string; propriedades: Partial<T> }>;
                onMultiplosElementosAtualizados(atualizacoes);
            } else {
                elementosSelecionados.forEach(elemento => {
                    const startPos = multiDragStart.get(elemento.id);
                    if (startPos) {
                        const raw = { x: startPos.x + deltaX, y: startPos.y + deltaY };
                        const { x, y } = aplicarClampESnap(raw.x, raw.y, elemento.largura, elemento.altura);
                        onElementoAtualizado(elemento.id, { x, y } as any);
                    }
                });
            }
        } else if (isResizing && elementoSelecionado && resizeHandle) {
            const deltaX = e.clientX - resizeStart.x;
            const deltaY = e.clientY - resizeStart.y;

            let novaLargura = resizeStart.width;
            let novaAltura  = resizeStart.height;
            let novoX       = resizeStart.elementX;
            let novoY       = resizeStart.elementY;

            if (resizeHandle === 'br') {
                novaLargura = Math.max(20, resizeStart.width + deltaX);
                novaAltura  = Math.max(20, resizeStart.height + deltaY);
            } else if (resizeHandle === 'bl') {
                novaLargura = Math.max(20, resizeStart.width - deltaX);
                novaAltura  = Math.max(20, resizeStart.height + deltaY);
                novoX = resizeStart.elementX + (resizeStart.width - novaLargura);
            } else if (resizeHandle === 'tr') {
                novaLargura = Math.max(20, resizeStart.width + deltaX);
                novaAltura  = Math.max(20, resizeStart.height - deltaY);
                novoY = resizeStart.elementY + (resizeStart.height - novaAltura);
            } else if (resizeHandle === 'tl') {
                novaLargura = Math.max(20, resizeStart.width - deltaX);
                novaAltura  = Math.max(20, resizeStart.height - deltaY);
                novoX = resizeStart.elementX + (resizeStart.width - novaLargura);
                novoY = resizeStart.elementY + (resizeStart.height - novaAltura);
            }

            onElementoAtualizado(elementoSelecionado.id, {
                x: Math.max(0, novoX),
                y: Math.max(0, novoY),
                largura: novaLargura,
                altura:  novaAltura
            } as any);
        }
    };

    const handleMouseUp = () => {
        if (isBoxSelecting) {
            const minX = Math.min(boxSelectionStart.x, boxSelectionEnd.x);
            const maxX = Math.max(boxSelectionStart.x, boxSelectionEnd.x);
            const minY = Math.min(boxSelectionStart.y, boxSelectionEnd.y);
            const maxY = Math.max(boxSelectionStart.y, boxSelectionEnd.y);

            const elementosDentroDoBox = elementos.filter(elemento => {
                if (!elemento.visivel) return false;
                const cx = elemento.x + elemento.largura / 2;
                const cy = elemento.y + elemento.altura / 2;
                return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
            });

            if (elementosDentroDoBox.length > 0) {
                onElementosSelecionados(elementosDentroDoBox);
                onElementoSelecionado(elementosDentroDoBox[0]);
            }
            setIsBoxSelecting(false);
        }
        setIsDragging(false);
        setIsResizing(false);
        setResizeHandle(null);
    };

    const handleCanvasMouseDown = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget && !e.ctrlKey && !e.metaKey) {
            const rect = e.currentTarget.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const y = e.clientY - rect.top;
            setBoxSelectionStart({ x, y });
            setBoxSelectionEnd({ x, y });
            setIsBoxSelecting(true);
            onElementoSelecionado(null);
            onElementosSelecionados([]);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            if (elementosSelecionados.length > 0) {
                e.preventDefault();
                setClipboard(elementosSelecionados);
            }
            return;
        }

        if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
            if (clipboard.length > 0 && onElementosAdicionados) {
                e.preventDefault();
                const offset = 15;
                const elementosCopias: T[] = clipboard.map(el => {
                    const rawX = el.x + offset;
                    const rawY = el.y + offset;
                    const { x, y } = aplicarClampESnap(rawX, rawY, el.largura, el.altura);
                    return {
                        ...JSON.parse(JSON.stringify(el)),
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                        x,
                        y
                    };
                });
                onElementosAdicionados(elementosCopias);
                onElementosSelecionados(elementosCopias);
            }
            return;
        }

        if ((e.key === 'Delete' || e.key === 'Backspace') && elementosSelecionados.length > 0) {
            e.preventDefault();
            elementosSelecionados.forEach(el => {
                if (onElementoRemovido) onElementoRemovido(el.id);
            });
            return;
        }

        if (!elementoSelecionado && elementosSelecionados.length === 0) return;

        const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
        if (!arrows.includes(e.key)) return;
        e.preventDefault();

        const step = e.shiftKey ? 10 : 1;
        let deltaX = 0;
        let deltaY = 0;
        switch (e.key) {
            case 'ArrowUp':    deltaY = -step; break;
            case 'ArrowDown':  deltaY =  step; break;
            case 'ArrowLeft':  deltaX = -step; break;
            case 'ArrowRight': deltaX =  step; break;
        }

        if (elementosSelecionados.length > 1 && onMultiplosElementosAtualizados) {
            const atualizacoes = elementosSelecionados.map(elemento => {
                const { x, y } = aplicarClampESnap(
                    elemento.x + deltaX,
                    elemento.y + deltaY,
                    elemento.largura,
                    elemento.altura
                );
                return { id: elemento.id, propriedades: { x, y } as any };
            });
            onMultiplosElementosAtualizados(atualizacoes);
        } else {
            // Mover elemento individual ativo
            const target = elementoSelecionado || elementosSelecionados[0];
            if (target) {
                const { x, y } = aplicarClampESnap(
                    target.x + deltaX,
                    target.y + deltaY,
                    target.largura,
                    target.altura
                );
                onElementoAtualizado(target.id, { x, y } as any);
            }
        }
    };

    // ─── Renderização dos elementos ────────────────────────────────────────

    const renderElemento = (elemento: T) => {
        const isSelected    = elementoSelecionado?.id === elemento.id;
        const isInSelection = elementosSelecionados.some(el => el.id === elemento.id);
        const foraDoSafeArea = estaForaDaSafeArea(elemento, larguraCanvas, alturaCanvas);

        // Borda: azul se selecionado, laranja se fora da safe area, cinza dashed se normal
        let borderStyle = '1px dashed rgba(0,0,0,0.2)';
        if (isSelected) {
            borderStyle = '2px solid #3b82f6';
        } else if (isInSelection) {
            borderStyle = '2px solid #60a5fa';
        } else if (foraDoSafeArea) {
            borderStyle = '2px dashed #f97316'; // laranja — fora da safe area
        }

        const baseStyle: React.CSSProperties = {
            position: 'absolute',
            left: `${elemento.x}px`,
            top: `${elemento.y}px`,
            width: `${elemento.largura}px`,
            height: `${elemento.altura}px`,
            cursor: isDragging ? 'grabbing' : 'grab',
            border: borderStyle,
            outline: isInSelection && !isSelected ? '1px solid #93c5fd' : 'none',
            outlineOffset: '2px',
            boxSizing: 'border-box',
            userSelect: 'none'
        };

        let conteudo: React.ReactNode = null;

        switch (elemento.tipo) {
            case 'texto':
                conteudo = (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            backgroundColor: elemento.backgroundColor || 'transparent',
                            borderRadius: `${elemento.borderRadius || 0}px`,
                            padding: elemento.backgroundColor ? '0 10px' : '0',
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
                                fontSize: `${elemento.fontSize || 12}px`,
                                fontFamily: (elemento.fonte || 'Arial').replace(' Semibold', ''),
                                fontWeight: (elemento.fonte || '').endsWith(' Semibold') ? 600 : (elemento.negrito ? 'bold' : 'normal'),
                                fontStyle: elemento.italico ? 'italic' : 'normal',
                                textDecoration: elemento.sublinhado ? 'underline' : 'none',
                                textShadow: elemento.sombreado ? '2px 2px 2px rgba(0,0,0,0.5)' : 'none',
                                color: elemento.cor || '#000',
                                textAlign: elemento.alinhamento || 'left',
                                lineHeight: '1.2',
                                wordBreak: 'break-word',
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'break-word',
                                display: 'block'
                            }}
                            dangerouslySetInnerHTML={{ __html: (getPreviewText ? getPreviewText(elemento.texto || 'Texto') : obterPreviewTexto(elemento.texto || 'Texto', nomenclaturas)) || 'Texto' }}
                        />
                    </div>
                );
                break;

            case 'caixa':
                conteudo = (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            backgroundColor: elemento.backgroundColor || 'transparent',
                            borderWidth: `${elemento.borderWidth !== undefined ? elemento.borderWidth : 1}px`,
                            borderStyle: elemento.borderWidth ? 'solid' : 'none',
                            borderColor: elemento.borderColor || '#000000',
                            borderRadius: `${elemento.borderRadius || 0}px`,
                            padding: `${elemento.padding !== undefined ? elemento.padding : 8}px`,
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
                                fontSize: `${elemento.fontSize || 12}px`,
                                fontFamily: (elemento.fonte || 'Arial').replace(' Semibold', ''),
                                fontWeight: (elemento.fonte || '').endsWith(' Semibold') ? 600 : (elemento.negrito ? 'bold' : 'normal'),
                                fontStyle: elemento.italico ? 'italic' : 'normal',
                                textDecoration: elemento.sublinhado ? 'underline' : 'none',
                                color: elemento.cor || '#000',
                                textAlign: elemento.alinhamento || 'left',
                                lineHeight: '1.2',
                                wordBreak: 'break-word',
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'break-word',
                                display: 'block'
                            }}
                            dangerouslySetInnerHTML={{ __html: (getPreviewText ? getPreviewText(elemento.texto || 'Caixa de Texto') : obterPreviewTexto(elemento.texto || 'Caixa de Texto', nomenclaturas)) || 'Caixa de Texto' }}
                        />
                    </div>
                );
                break;

            case 'tabela': {
                const tableRows = elemento.linhas || [['Célula 1']];
                conteudo = (
                    <table
                        style={{
                            width: '100%',
                            height: '100%',
                            borderCollapse: 'collapse',
                            backgroundColor: elemento.backgroundColor || 'transparent',
                            borderWidth: `${elemento.borderWidth !== undefined ? elemento.borderWidth : 1}px`,
                            borderStyle: 'solid',
                            borderColor: elemento.borderColor || '#000000',
                            tableLayout: 'fixed',
                        }}
                    >
                        <tbody>
                            {tableRows.map((row, rIdx) => (
                                <tr key={rIdx}>
                                    {row.map((cell, cIdx) => {
                                        const parsedCell = getPreviewText ? getPreviewText(cell) : obterPreviewTexto(cell, nomenclaturas);
                                        return (
                                            <td
                                                key={cIdx}
                                                style={{
                                                    borderWidth: `${elemento.borderWidth !== undefined ? elemento.borderWidth : 1}px`,
                                                    borderStyle: 'solid',
                                                    borderColor: elemento.borderColor || '#000000',
                                                    padding: `${elemento.padding !== undefined ? elemento.padding : 4}px`,
                                                    fontSize: `${elemento.fontSize || 12}px`,
                                                    fontFamily: (elemento.fonte || 'Arial').replace(' Semibold', ''),
                                                    fontWeight: (elemento.fonte || '').endsWith(' Semibold') ? 600 : (elemento.negrito ? 'bold' : 'normal'),
                                                    fontStyle: elemento.italico ? 'italic' : 'normal',
                                                    color: elemento.cor || '#000000',
                                                    textAlign: elemento.alinhamento || 'left',
                                                    wordBreak: 'break-word',
                                                    overflowWrap: 'break-word',
                                                }}
                                                dangerouslySetInnerHTML={{ __html: parsedCell || '' }}
                                            />
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                );
                break;
            }

            case 'qrcode':
                conteudo = (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            backgroundColor: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                    >
                        <QRCodeSVG
                            value="https://siscomieadepa.org/autentica_qrcode-05985642/PREVIEW"
                            size={Math.min(elemento.largura, elemento.altura) - 4}
                            level="H"
                            includeMargin={false}
                        />
                    </div>
                );
                break;

            case 'logo': {
                const logoUrl = configIgreja?.logo || elemento.imagemUrl;
                conteudo = logoUrl ? (
                    <img src={logoUrl} alt="Logo da Igreja" style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: elemento.transparencia || 1 }} />
                ) : (
                    <div style={{ width: '100%', height: '100%', backgroundColor: 'rgba(200,200,200,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#666', opacity: elemento.transparencia || 1 }}>
                        🏛️ Logo
                    </div>
                );
                break;
            }

            case 'foto-membro': {
                const fotoUrl = elemento.foto || elemento.imagemUrl;
                conteudo = fotoUrl ? (
                    <img src={fotoUrl} alt="Foto do Membro" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} />
                ) : (
                    <div style={{ width: '100%', height: '100%', backgroundColor: 'rgba(200,200,200,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#666' }}>
                        📸 Foto
                    </div>
                );
                break;
            }

            case 'imagem':
                conteudo = elemento.imagemUrl ? (
                    <img src={elemento.imagemUrl} alt="Imagem" style={{ width: '100%', height: '100%', objectFit: 'contain', opacity: elemento.transparencia || 1 }} />
                ) : (
                    <div style={{ width: '100%', height: '100%', backgroundColor: 'rgba(200,200,200,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', color: '#666', opacity: elemento.transparencia || 1 }}>
                        🖼️ Imagem
                    </div>
                );
                break;

            case 'chapa':
                conteudo = (
                    <div
                        style={{
                            width: '100%',
                            height: '100%',
                            backgroundColor: elemento.cor || '#ff0000',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            fontWeight: 'bold',
                            fontSize: '12px',
                            borderRadius: `${elemento.borderRadius || 0}px`,
                            opacity: elemento.transparencia || 1
                        }}
                    >
                        {elemento.texto || 'CHAPA'}
                    </div>
                );
                break;
        }

        return (
            <div
                key={elemento.id}
                style={baseStyle}
                onMouseDown={(e) => handleElementMouseDown(e, elemento)}
            >
                {conteudo}

                {/* Tooltip de aviso fora da safe area */}
                {foraDoSafeArea && !isSelected && (
                    <div
                        style={{
                            position: 'absolute',
                            top: '-20px',
                            left: '0',
                            fontSize: '9px',
                            color: '#f97316',
                            fontWeight: 'bold',
                            whiteSpace: 'nowrap',
                            pointerEvents: 'none',
                            backgroundColor: 'rgba(255,255,255,0.9)',
                            padding: '1px 4px',
                            borderRadius: '3px',
                            border: '1px solid #f97316',
                        }}
                    >
                        ⚠ Fora da área segura
                    </div>
                )}

                {/* Handles de redimensionamento */}
                {isSelected && (
                    <>
                        {/* Top-left */}
                        <div onMouseDown={(e) => handleResizeMouseDown(e, 'tl')} style={{ position: 'absolute', left: '-4px', top: '-4px', width: '8px', height: '8px', backgroundColor: '#3b82f6', border: '1px solid #fff', cursor: 'nwse-resize', zIndex: 10 }} />
                        {/* Top-right */}
                        <div onMouseDown={(e) => handleResizeMouseDown(e, 'tr')} style={{ position: 'absolute', right: '-4px', top: '-4px', width: '8px', height: '8px', backgroundColor: '#3b82f6', border: '1px solid #fff', cursor: 'nesw-resize', zIndex: 10 }} />
                        {/* Bottom-left */}
                        <div onMouseDown={(e) => handleResizeMouseDown(e, 'bl')} style={{ position: 'absolute', left: '-4px', bottom: '-4px', width: '8px', height: '8px', backgroundColor: '#3b82f6', border: '1px solid #fff', cursor: 'nesw-resize', zIndex: 10 }} />
                        {/* Bottom-right */}
                        <div onMouseDown={(e) => handleResizeMouseDown(e, 'br')} style={{ position: 'absolute', right: '-4px', bottom: '-4px', width: '8px', height: '8px', backgroundColor: '#3b82f6', border: '1px solid #fff', cursor: 'nwse-resize', zIndex: 10 }} />
                    </>
                )}
            </div>
        );
    };

    // ─── Render Principal ──────────────────────────────────────────────────

    return (
        <div
            ref={canvasRef}
            tabIndex={0}
            style={{
                position: 'relative',
                width: `${larguraCanvas}px`,
                height: `${alturaCanvas}px`,
                backgroundColor: '#fff',
                backgroundImage: backgroundUrl ? `url(${backgroundUrl})` : 'none',
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                backgroundRepeat: 'no-repeat',
                border: 'none',
                overflow: 'hidden',
                cursor: isDragging || isResizing ? 'default' : 'auto',
                outline: 'none'
            }}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onMouseDown={handleCanvasMouseDown}
            onKeyDown={handleKeyDown}
            onClick={(e) => {
                if (e.target === e.currentTarget && !isBoxSelecting) {
                    onElementoSelecionado(null);
                    onElementosSelecionados([]);
                }
            }}
        >
            {/* ── Guias da Safe Area (nunca aparecem na impressão) ── */}
            <div
                className="safe-area-guides no-print"
                aria-hidden="true"
                style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    zIndex: 500,
                }}
            >
                {/* Linha superior */}
                <div style={{ position: 'absolute', top: `${safeTop}px`, left: `${safeLeft}px`, right: `${SAFE_AREA_MARGIN}px`, height: '1px', borderTop: '1px dashed rgba(99,102,241,0.45)' }} />
                {/* Linha inferior */}
                <div style={{ position: 'absolute', bottom: `${SAFE_AREA_MARGIN}px`, left: `${safeLeft}px`, right: `${SAFE_AREA_MARGIN}px`, height: '1px', borderTop: '1px dashed rgba(99,102,241,0.45)' }} />
                {/* Linha esquerda */}
                <div style={{ position: 'absolute', left: `${safeLeft}px`, top: `${safeTop}px`, bottom: `${SAFE_AREA_MARGIN}px`, width: '1px', borderLeft: '1px dashed rgba(99,102,241,0.45)' }} />
                {/* Linha direita */}
                <div style={{ position: 'absolute', right: `${SAFE_AREA_MARGIN}px`, top: `${safeTop}px`, bottom: `${SAFE_AREA_MARGIN}px`, width: '1px', borderLeft: '1px dashed rgba(99,102,241,0.45)' }} />

                {/* Rótulo discreto da safe area */}
                <span style={{ position: 'absolute', top: `${safeTop + 3}px`, left: `${safeLeft + 4}px`, fontSize: '8px', color: 'rgba(99,102,241,0.6)', fontFamily: 'monospace', letterSpacing: '0.05em', userSelect: 'none' }}>
                    ÁREA SEGURA
                </span>
            </div>

            {/* ── Elementos ── */}
            {elementos.filter(e => e.visivel).map(elemento => renderElemento(elemento))}

            {/* ── Box de seleção por área ── */}
            {isBoxSelecting && (
                <div
                    style={{
                        position: 'absolute',
                        left: `${Math.min(boxSelectionStart.x, boxSelectionEnd.x)}px`,
                        top: `${Math.min(boxSelectionStart.y, boxSelectionEnd.y)}px`,
                        width: `${Math.abs(boxSelectionEnd.x - boxSelectionStart.x)}px`,
                        height: `${Math.abs(boxSelectionEnd.y - boxSelectionStart.y)}px`,
                        border: '2px dashed #3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.1)',
                        pointerEvents: 'none',
                        zIndex: 1000
                    }}
                />
            )}
        </div>
    );
}
