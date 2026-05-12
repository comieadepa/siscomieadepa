'use client';

import { useState, useRef, useCallback } from 'react';

// ─── Tipos ────────────────────────────────────────────────────
export interface Elemento {
  id:         string;
  tipo:       'texto';
  placeholder: string;
  x:          number;   // px no espaço 1400×990
  y:          number;
  fontSize:   number;
  fontWeight: 'normal' | 'bold';
  color:      string;
  align:      'left' | 'center' | 'right';
  fontFamily: string;
  maxWidth?:  number;   // px, largura máxima opcional
}

// ─── Constantes ───────────────────────────────────────────────
const CANVAS_W = 1400;
const CANVAS_H = 990;

const FONTES = ['Inter', 'serif', 'Georgia', 'Arial', 'Courier New', 'Times New Roman'];

const PLACEHOLDERS: { label: string; value: string }[] = [
  { label: 'Nome',         value: '{NOME}' },
  { label: 'Evento',       value: '{EVENTO}' },
  { label: 'Data Evento',  value: '{DATA_EVENTO}' },
  { label: 'Supervisão',   value: '{SUPERVISAO}' },
  { label: 'Campo',        value: '{CAMPO}' },
  { label: 'CPF',          value: '{CPF}' },
  { label: 'Código',       value: '{CODIGO}' },
  { label: 'Data Emissão', value: '{DATA_EMISSAO}' },
];

const NOVO_ELEMENTO = (placeholder: string): Elemento => ({
  id:          crypto.randomUUID(),
  tipo:        'texto',
  placeholder,
  x:           CANVAS_W / 2,
  y:           CANVAS_H / 2,
  fontSize:    36,
  fontWeight:  'normal',
  color:       '#000000',
  align:       'center',
  fontFamily:  'Inter',
  maxWidth:    800,
});

// ─── Props ────────────────────────────────────────────────────
interface CertificadoEditorProps {
  eventoId:     string;
  podeEditar:   boolean;
  initElementos: Elemento[];
  initBackground: string | null;
  onSaved?: (elementos: Elemento[], backgroundUrl: string | null) => void;
}

// ─── Componente ───────────────────────────────────────────────
export default function CertificadoEditor({
  eventoId,
  podeEditar,
  initElementos,
  initBackground,
  onSaved,
}: CertificadoEditorProps) {
  const [elementos,   setElementos]   = useState<Elemento[]>(initElementos);
  const [background,  setBackground]  = useState<string | null>(initBackground);
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [salvando,    setSalvando]    = useState(false);
  const [msg,         setMsg]         = useState('');
  const [uploading,   setUploading]   = useState(false);

  const canvasRef  = useRef<HTMLDivElement>(null);
  const dragRef    = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);
  const uploadRef  = useRef<HTMLInputElement>(null);

  const selected = elementos.find(e => e.id === selectedId) ?? null;

  // ── Escala canvas → display ──────────────────────────────────
  const getScale = useCallback((): number => {
    if (!canvasRef.current) return 1;
    return canvasRef.current.getBoundingClientRect().width / CANVAS_W;
  }, []);

  // ── Drag ─────────────────────────────────────────────────────
  const onMouseDown = useCallback((e: React.MouseEvent, id: string) => {
    if (!podeEditar) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedId(id);
    const el = elementos.find(x => x.id === id);
    if (!el) return;
    dragRef.current = { id, startX: e.clientX, startY: e.clientY, origX: el.x, origY: el.y };

    const onMove = (mv: MouseEvent) => {
      if (!dragRef.current) return;
      const scale = getScale();
      const dx = (mv.clientX - dragRef.current.startX) / scale;
      const dy = (mv.clientY - dragRef.current.startY) / scale;
      setElementos(prev => prev.map(x => x.id === dragRef.current!.id
        ? { ...x, x: Math.round(dragRef.current!.origX + dx), y: Math.round(dragRef.current!.origY + dy) }
        : x));
    };
    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [elementos, getScale, podeEditar]);

  // ── Adicionar elemento ───────────────────────────────────────
  function adicionarElemento(placeholder: string) {
    const novo = NOVO_ELEMENTO(placeholder);
    // Offset para não empilhar
    const count = elementos.filter(e => e.placeholder === placeholder).length;
    novo.y += count * 60;
    setElementos(prev => [...prev, novo]);
    setSelectedId(novo.id);
  }

  // ── Remover selecionado ───────────────────────────────────────
  function removerSelecionado() {
    if (!selectedId) return;
    setElementos(prev => prev.filter(e => e.id !== selectedId));
    setSelectedId(null);
  }

  // ── Atualizar propriedade ─────────────────────────────────────
  function updateProp<K extends keyof Elemento>(key: K, value: Elemento[K]) {
    if (!selectedId) return;
    setElementos(prev => prev.map(e => e.id === selectedId ? { ...e, [key]: value } : e));
  }

  // ── Upload de imagem de fundo ─────────────────────────────────
  async function uploadBackground(file: File) {
    setUploading(true);
    setMsg('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/eventos/${eventoId}/certificados/upload-background`, {
        method: 'POST',
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) { setMsg('❌ ' + (json.error ?? 'Erro no upload')); return; }
      setBackground(json.url);
      setMsg('✅ Imagem de fundo atualizada!');
      setTimeout(() => setMsg(''), 3000);
    } catch {
      setMsg('❌ Erro de conexão no upload.');
    } finally {
      setUploading(false);
    }
  }

  // ── Salvar config ─────────────────────────────────────────────
  async function salvar() {
    setSalvando(true);
    setMsg('');
    try {
      const res = await fetch(`/api/eventos/${eventoId}/certificado-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          background_url: background,
          arte_url:       background,
          elementos_json: elementos,
          // valores legados obrigatórios (mantemos compatibilidade)
          texto_corpo:    '{NOME}',
        }),
      });
      const json = await res.json();
      if (!res.ok) { setMsg('❌ ' + (json.error ?? 'Erro ao salvar.')); return; }
      setMsg('✅ Configuração salva!');
      onSaved?.(elementos, background);
      setTimeout(() => setMsg(''), 3000);
    } catch {
      setMsg('❌ Erro de conexão.');
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* ── Barra superior ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-bold text-gray-800 text-base flex items-center gap-2">
          🎨 Editor Visual do Certificado
          <span className="text-xs font-normal text-gray-400">({CANVAS_W}×{CANVAS_H}px)</span>
        </h3>
        <div className="flex gap-2 flex-wrap">
          {podeEditar && (
            <>
              <button
                onClick={() => uploadRef.current?.click()}
                disabled={uploading}
                className="text-xs px-3 py-1.5 bg-white border border-gray-300 rounded-lg font-semibold hover:bg-gray-50 transition disabled:opacity-50 flex items-center gap-1"
              >
                {uploading ? '⏳' : '🖼️'} {uploading ? 'Enviando...' : 'Fundo'}
              </button>
              <input
                ref={uploadRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) uploadBackground(f); }}
              />
              <button
                onClick={salvar}
                disabled={salvando}
                className="text-xs px-3 py-1.5 bg-[#123b63] text-white rounded-lg font-bold hover:bg-[#0f2a45] transition disabled:opacity-50"
              >
                {salvando ? '⏳ Salvando...' : '✅ Salvar'}
              </button>
            </>
          )}
        </div>
      </div>

      {msg && (
        <p className={`text-xs px-3 py-2 rounded-lg ${msg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
          {msg}
        </p>
      )}

      <div className="flex gap-4 items-start">

        {/* ── Canvas ──────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {/* Aspect-ratio wrapper para A4 landscape */}
          <div className="relative w-full" style={{ paddingBottom: `${(CANVAS_H / CANVAS_W) * 100}%` }}>
            <div
              ref={canvasRef}
              className="absolute inset-0 overflow-hidden border-2 border-dashed border-gray-300 rounded-xl bg-gray-100 cursor-crosshair select-none"
              style={{
                backgroundImage:   background ? `url(${background})` : undefined,
                backgroundSize:    'cover',
                backgroundPosition: 'center',
              }}
              onClick={() => setSelectedId(null)}
            >
              {/* Placeholder quando sem fundo */}
              {!background && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-gray-400 pointer-events-none">
                  <span className="text-4xl">🖼️</span>
                  <p className="text-sm font-semibold">Clique em "Fundo" para adicionar a arte</p>
                  <p className="text-xs">PNG, JPG ou WebP (máx 5MB)</p>
                </div>
              )}

              {/* Elementos */}
              {elementos.map(el => {
                const isSelected = el.id === selectedId;
                // Posição em % para ficar responsivo ao tamanho do canvas
                const leftPct  = (el.x / CANVAS_W) * 100;
                const topPct   = (el.y / CANVAS_H) * 100;
                const maxWPct  = el.maxWidth ? `${(el.maxWidth / CANVAS_W) * 100}%` : '80%';

                return (
                  <div
                    key={el.id}
                    onMouseDown={e => onMouseDown(e, el.id)}
                    onClick={e => { e.stopPropagation(); setSelectedId(el.id); }}
                    style={{
                      position:    'absolute',
                      left:        `${leftPct}%`,
                      top:         `${topPct}%`,
                      transform:   'translate(-50%, -50%)',
                      fontSize:    `${(el.fontSize / CANVAS_H) * 100}cqmin`,
                      fontWeight:  el.fontWeight,
                      color:       el.color,
                      textAlign:   el.align,
                      fontFamily:  el.fontFamily,
                      maxWidth:    maxWPct,
                      width:       maxWPct,
                      cursor:      podeEditar ? 'move' : 'default',
                      userSelect:  'none',
                      padding:     '2px 4px',
                      borderRadius: '2px',
                      outline:     isSelected ? '2px solid #3b82f6' : '1px dashed rgba(0,0,0,0.25)',
                      background:  isSelected ? 'rgba(59,130,246,0.08)' : 'transparent',
                      whiteSpace:  'nowrap',
                      overflow:    'visible',
                    }}
                  >
                    {el.placeholder}
                  </div>
                );
              })}
            </div>
          </div>
          <p className="text-[11px] text-gray-400 mt-1 text-center">
            Arraste os elementos para posicioná-los. Clique para selecionar e editar propriedades.
          </p>
        </div>

        {/* ── Painel direito ──────────────────────────────────── */}
        <div className="w-56 flex-shrink-0 space-y-3">

          {/* Adicionar placeholders */}
          <div className="bg-white border border-gray-200 rounded-xl p-3">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-2">
              + Adicionar texto
            </p>
            <div className="flex flex-wrap gap-1">
              {PLACEHOLDERS.map(ph => (
                <button
                  key={ph.value}
                  onClick={() => adicionarElemento(ph.value)}
                  disabled={!podeEditar}
                  title={`Adicionar campo ${ph.value}`}
                  className="text-[11px] px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 rounded font-semibold hover:bg-blue-100 transition disabled:opacity-50"
                >
                  {ph.label}
                </button>
              ))}
            </div>
          </div>

          {/* Propriedades do elemento selecionado */}
          {selected ? (
            <div className="bg-white border border-blue-200 rounded-xl p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-blue-600">Propriedades</p>
                <button
                  onClick={removerSelecionado}
                  disabled={!podeEditar}
                  className="text-[11px] text-red-500 hover:text-red-700 font-semibold disabled:opacity-40"
                  title="Remover elemento"
                >
                  🗑 Remover
                </button>
              </div>

              <div className="text-[11px] font-mono text-gray-500 bg-gray-50 px-2 py-1 rounded break-all">
                {selected.placeholder}
              </div>

              {/* Posição X/Y */}
              <div className="grid grid-cols-2 gap-1.5">
                <Label label="X">
                  <input type="number" value={selected.x}
                    onChange={e => updateProp('x', Number(e.target.value))}
                    disabled={!podeEditar}
                    className="w-full text-xs border rounded px-1.5 py-1 disabled:bg-gray-50" />
                </Label>
                <Label label="Y">
                  <input type="number" value={selected.y}
                    onChange={e => updateProp('y', Number(e.target.value))}
                    disabled={!podeEditar}
                    className="w-full text-xs border rounded px-1.5 py-1 disabled:bg-gray-50" />
                </Label>
              </div>

              {/* Tamanho da fonte */}
              <Label label="Tamanho">
                <div className="flex items-center gap-1">
                  <input type="range" min={8} max={120} value={selected.fontSize}
                    onChange={e => updateProp('fontSize', Number(e.target.value))}
                    disabled={!podeEditar}
                    className="flex-1" />
                  <span className="text-xs w-7 text-right">{selected.fontSize}</span>
                </div>
              </Label>

              {/* Cor */}
              <Label label="Cor">
                <div className="flex items-center gap-1.5">
                  <input type="color" value={selected.color}
                    onChange={e => updateProp('color', e.target.value)}
                    disabled={!podeEditar}
                    className="w-8 h-6 rounded cursor-pointer border border-gray-200" />
                  <input type="text" value={selected.color}
                    onChange={e => updateProp('color', e.target.value)}
                    disabled={!podeEditar}
                    className="flex-1 text-xs border rounded px-1.5 py-1 font-mono disabled:bg-gray-50" />
                </div>
              </Label>

              {/* Negrito */}
              <Label label="Estilo">
                <div className="flex gap-1">
                  <ToggleBtn
                    active={selected.fontWeight === 'bold'}
                    disabled={!podeEditar}
                    onClick={() => updateProp('fontWeight', selected.fontWeight === 'bold' ? 'normal' : 'bold')}
                  >
                    <strong>N</strong>
                  </ToggleBtn>
                </div>
              </Label>

              {/* Alinhamento */}
              <Label label="Alinhamento">
                <div className="flex gap-1">
                  {(['left', 'center', 'right'] as const).map(al => (
                    <ToggleBtn key={al} active={selected.align === al} disabled={!podeEditar}
                      onClick={() => updateProp('align', al)}>
                      {al === 'left' ? '⬅' : al === 'center' ? '↔' : '➡'}
                    </ToggleBtn>
                  ))}
                </div>
              </Label>

              {/* Fonte */}
              <Label label="Fonte">
                <select value={selected.fontFamily}
                  onChange={e => updateProp('fontFamily', e.target.value)}
                  disabled={!podeEditar}
                  className="w-full text-xs border rounded px-1.5 py-1 disabled:bg-gray-50">
                  {FONTES.map(f => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
                </select>
              </Label>

              {/* Largura máxima */}
              <Label label="Larg. máx.">
                <input type="number" value={selected.maxWidth ?? ''}
                  placeholder="auto"
                  onChange={e => updateProp('maxWidth', e.target.value ? Number(e.target.value) : undefined)}
                  disabled={!podeEditar}
                  className="w-full text-xs border rounded px-1.5 py-1 disabled:bg-gray-50" />
              </Label>
            </div>
          ) : (
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 text-center text-xs text-gray-400">
              Clique em um elemento para editar suas propriedades
            </div>
          )}

          {/* Resumo dos elementos */}
          {elementos.length > 0 && (
            <div className="bg-white border border-gray-200 rounded-xl p-3">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wide mb-1.5">
                Elementos ({elementos.length})
              </p>
              <div className="space-y-0.5">
                {elementos.map(el => (
                  <button
                    key={el.id}
                    onClick={() => setSelectedId(el.id)}
                    className={`w-full text-left text-[11px] px-2 py-1 rounded transition ${
                      el.id === selectedId ? 'bg-blue-50 text-blue-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {el.placeholder}
                    <span className="text-gray-400 ml-1">({el.x},{el.y})</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────
function Label({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      {children}
    </div>
  );
}

function ToggleBtn({ active, disabled, onClick, children }: {
  active: boolean; disabled: boolean;
  onClick: () => void; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`px-2 py-0.5 text-xs rounded border transition disabled:opacity-40 ${
        active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
      }`}
    >
      {children}
    </button>
  );
}
