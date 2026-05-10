'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { EventBadge, BadgeInscricao, BadgeEvento, BadgeSize } from '@/components/EventBadge';

interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; }

// Grid de impressão por tamanho
const GRID_COLS: Record<BadgeSize, string> = {
  small:  'grid-cols-3',
  medium: 'grid-cols-2',
  large:  'grid-cols-2',
};

export default function EtiquetasPrintPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const id = params?.id as string;

  const size    = (searchParams?.get('size')  ?? 'medium') as BadgeSize;
  const ids     = searchParams?.get('ids');   // csv de IDs; null = todos
  const apenas  = searchParams?.get('apenas'); // 'pendentes' | null

  const supabase = useMemo(() => createClient(), []);
  const [evento,      setEvento]      = useState<BadgeEvento | null>(null);
  const [inscricoes,  setInscricoes]  = useState<BadgeInscricao[]>([]);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [marcando,    setMarcando]    = useState(false);

  useEffect(() => {
    async function load() {
      const [evRes, supRes, camRes] = await Promise.all([
        supabase.from('eventos').select('id,nome,departamento,data_inicio,data_fim,local,cidade,banner_url').eq('id', id).single(),
        supabase.from('supervisoes').select('id,nome'),
        supabase.from('campos').select('id,nome'),
      ]);
      if (evRes.data) setEvento(evRes.data as BadgeEvento);
      if (supRes.data) setSupervisoes(supRes.data as Supervisao[]);
      if (camRes.data) setCampos(camRes.data as Campo[]);

      // Busca inscrições conforme filtros da URL
      let query = supabase
        .from('evento_inscricoes')
        .select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,hospedagem,alimentacao,brinde,qr_code,checkin_realizado,etiqueta_impressa')
        .eq('evento_id', id)
        .order('nome_inscrito');

      if (ids) {
        query = query.in('id', ids.split(','));
      } else if (apenas === 'pendentes') {
        query = query.eq('etiqueta_impressa', false);
      }

      const { data } = await query;
      setInscricoes((data ?? []) as (BadgeInscricao & { etiqueta_impressa: boolean })[]);
      setLoading(false);
    }
    load();
  }, [id, ids, apenas, supabase]);

  // Marca todas como impressas após imprimir
  async function marcarTodasImpressas() {
    if (!inscricoes.length) return;
    setMarcando(true);
    const idsParaMarcar = inscricoes.map(i => i.id);
    await supabase
      .from('evento_inscricoes')
      .update({ etiqueta_impressa: true })
      .in('id', idsParaMarcar);
    setMarcando(false);
  }

  function handlePrint() {
    marcarTodasImpressas();
    window.print();
  }

  const nomeSup   = (sid: string | null) => supervisoes.find(s => s.id === sid)?.nome ?? '-';
  const nomeCampo = (cid: string | null) => campos.find(c => c.id === cid)?.nome ?? '-';

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Carregando crachás...</p>
      </div>
    );
  }

  if (!evento) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-red-500">Evento não encontrado.</p>
      </div>
    );
  }

  return (
    <>
      {/* ── Barra de controle (só na tela, não imprime) ─────── */}
      <div className="print:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 shadow-sm px-6 py-3 flex items-center justify-between gap-4">
        <div>
          <p className="font-bold text-[#123b63] text-sm">{evento.nome}</p>
          <p className="text-xs text-gray-500">
            {inscricoes.length} crachá{inscricoes.length !== 1 ? 's' : ''} •{' '}
            Tamanho: <span className="font-semibold capitalize">{size}</span>
            {apenas === 'pendentes' ? ' • Somente não impressos' : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.history.back()}
            className="px-4 py-2 rounded-lg text-sm border border-gray-300 text-gray-600 hover:bg-gray-50 transition">
            ← Voltar
          </button>
          <button
            onClick={handlePrint}
            disabled={marcando}
            className="px-5 py-2 rounded-lg text-sm font-semibold bg-[#123b63] text-white hover:bg-[#0f2a45] transition disabled:opacity-50">
            {marcando ? 'Marcando...' : '🖨️ Imprimir'}
          </button>
        </div>
      </div>

      {/* ── Área de impressão ────────────────────────────────── */}
      <div className="print:pt-0 pt-16 p-6 print:p-0 bg-gray-100 print:bg-white min-h-screen">
        <div className={`grid ${GRID_COLS[size]} gap-4 print:gap-3`}
          style={size === 'small' ? { gridTemplateColumns: 'repeat(3, 8cm)' } : { gridTemplateColumns: 'repeat(2, 9cm)' }}>
          {inscricoes.map(ins => (
            <EventBadge
              key={ins.id}
              inscricao={ins}
              evento={evento}
              nomeSup={nomeSup(ins.supervisao_id)}
              nomeCampo={nomeCampo(ins.campo_id)}
              size={size}
              printMode={true}
            />
          ))}
        </div>

        {inscricoes.length === 0 && (
          <div className="flex items-center justify-center min-h-[50vh]">
            <p className="text-gray-400 text-center">Nenhum crachá para imprimir.</p>
          </div>
        )}
      </div>

      {/* ── Estilos de impressão ────────────────────────────── */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4;
            margin: 0.8cm;
          }
          body {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      `}</style>
    </>
  );
}
