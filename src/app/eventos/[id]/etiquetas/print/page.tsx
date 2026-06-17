'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import { EtiquetaDepartamento, EtiquetaAGO } from '@/components/EtiquetaLabels';
import type { EtiquetaEvento, EtiquetaInscricaoAGO } from '@/components/EtiquetaLabels';
import { authenticatedFetch } from '@/lib/api-client';

// ─── Tipos ────────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; }

interface InscricaoLabel {
  id: string;
  nome_inscrito: string;
  cpf: string | null;
  supervisao_id: string | null;
  campo_id: string | null;
  status_pagamento: string;
  tipo_inscricao: string | null;
  hospedagem: boolean;
  alimentacao: boolean;
  brinde: boolean;
  qr_code: string | null;
  checkin_realizado: boolean;
  etiqueta_impressa: boolean;
  // AGO-specific (populated only for AGO events)
  ministro_id?: string | null;
  matricula?: string | null;
  numero_cama?: string | null;
  tipo_cama?: string | null;
  hosp_status?: string | null;
  nome_alojamento?: string | null;
}

interface EventoData extends EtiquetaEvento {
  id: string;
  data_inicio: string;
  data_fim: string;
  local: string | null;
  cidade: string | null;
}

// ─── Página principal ─────────────────────────────────────────
export default function EtiquetasPrintPage() {
  const params      = useParams();
  const searchParams = useSearchParams();
  const id    = params?.id as string;
  // mode: 'a4' (default, batch A4 portrait 2-col) | 'thermal' (individual Zebra/termica)
  const mode  = (searchParams?.get('mode') ?? 'a4') as 'a4' | 'thermal';
  const ids   = searchParams?.get('ids');    // CSV de IDs; null = todos
  const apenas = searchParams?.get('apenas'); // 'pendentes'

  const supabase = useMemo(() => createClient(), []);
  const [evento,      setEvento]      = useState<EventoData | null>(null);
  const [inscricoes,  setInscricoes]  = useState<InscricaoLabel[]>([]);
  const [supervisoes, setSupervisoes] = useState<Supervisao[]>([]);
  const [campos,      setCampos]      = useState<Campo[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [marcando,    setMarcando]    = useState(false);

  useEffect(() => {
    async function load() {
      let inscrQuery = supabase
        .from('evento_inscricoes')
        .select('id,nome_inscrito,cpf,supervisao_id,campo_id,status_pagamento,tipo_inscricao,hospedagem,alimentacao,brinde,qr_code,checkin_realizado,etiqueta_impressa,ministro_id')
        .eq('evento_id', id);

      if (ids) {
        inscrQuery = inscrQuery.in('id', ids.split(','));
      } else {
        inscrQuery = inscrQuery.in('status_pagamento', ['pago', 'isento']);
        if (apenas === 'pendentes') {
          inscrQuery = inscrQuery.eq('etiqueta_impressa', false);
        }
      }
      inscrQuery = inscrQuery.order('nome_inscrito');

      const [evRes, estruturaRes, inscRes] = await Promise.all([
        supabase.from('eventos').select('id,nome,departamento,data_inicio,data_fim,local,cidade').eq('id', id).single(),
        authenticatedFetch('/api/v1/estrutura'),
        inscrQuery,
      ]);

      if (evRes.data)  setEvento(evRes.data as EventoData);
      if (estruturaRes.ok) {
        const estrutura = await estruturaRes.json().catch(() => null as any);
        setSupervisoes((estrutura?.supervisoes as Supervisao[]) || []);
        setCampos((estrutura?.campos as Campo[]) || []);
      }

      const inscBase = (inscRes.data ?? []) as InscricaoLabel[];
      const dept = (evRes.data as EventoData | null)?.departamento;

      if (dept === 'AGO' && inscBase.length > 0) {
        // Enriquecer com dados hospedagem + matrícula
        const inscIds    = inscBase.map(i => i.id);
        const ministroIds = [...new Set(inscBase.map(i => i.ministro_id).filter((x): x is string => !!x))];

        const [hospRes, membersRes] = await Promise.all([
          supabase.from('evento_hospedagens')
            .select('inscricao_id,numero_cama,tipo_cama,status,alojamento_id')
            .in('inscricao_id', inscIds),
          ministroIds.length > 0
            ? authenticatedFetch(`/api/v1/members/lookup?ids=${encodeURIComponent(ministroIds.join(','))}&limit=${ministroIds.length}`)
            : Promise.resolve(null),
        ]);

        type HospRow = { inscricao_id: string; numero_cama: string | null; tipo_cama: string | null; status: string; alojamento_id: string | null };
        const hospRows = (hospRes.data ?? []) as HospRow[];

        const aloIds = [...new Set(
          hospRows.map(h => h.alojamento_id).filter((x): x is string => x !== null)
        )];
        const aloRes = aloIds.length > 0
          ? await supabase.from('evento_alojamentos').select('id,nome').in('id', aloIds)
          : { data: [] as { id: string; nome: string }[] };

        const hospMap   = new Map(hospRows.map(h => [h.inscricao_id, h]));
        const aloMap    = new Map(((aloRes.data ?? []) as { id: string; nome: string }[]).map(a => [a.id, a.nome]));
        const membersJson = membersRes && 'ok' in membersRes && membersRes.ok
          ? await membersRes.json().catch(() => null as any)
          : null;
        const memberList = (membersJson?.data ?? []) as { id: string; matricula: string | null }[];
        const memberMap = new Map(memberList.map(m => [m.id, m.matricula]));

        const merged = inscBase.map(ins => {
          const hosp = ins.id ? hospMap.get(ins.id) : undefined;
          return {
            ...ins,
            matricula:       ins.ministro_id ? (memberMap.get(ins.ministro_id) ?? null) : null,
            numero_cama:     hosp?.numero_cama     ?? null,
            tipo_cama:       hosp?.tipo_cama       ?? null,
            hosp_status:     hosp?.status          ?? null,
            nome_alojamento: hosp?.alojamento_id   ? (aloMap.get(hosp.alojamento_id) ?? null) : null,
          };
        });
        setInscricoes(merged as InscricaoLabel[]);
      } else {
        setInscricoes(inscBase);
      }

      setLoading(false);
    }
    load();
  }, [id, ids, apenas, supabase]);

  async function marcarImpressas() {
    const pagasEIsentas = inscricoes.filter(i => i.status_pagamento === 'pago' || i.status_pagamento === 'isento');
    if (!pagasEIsentas.length) return;
    setMarcando(true);
    await supabase.from('evento_inscricoes').update({ etiqueta_impressa: true }).in('id', pagasEIsentas.map(i => i.id));
    setMarcando(false);
  }

  function handlePrint() {
    marcarImpressas();
    window.print();
  }

  const nomeSup   = (sid: string | null) => supervisoes.find(s => s.id === sid)?.nome ?? '-';
  const nomeCampo = (cid: string | null) => campos.find(c => c.id === cid)?.nome ?? '-';

  // ── CSS de impressão dinâmico ─────────────────────────────
  const printCSS = mode === 'thermal'
    ? `
      @media print {
        @page {
          size: 100mm 30mm;
          margin: 0;
        }
        html, body {
          margin: 0 !important;
          padding: 0 !important;
          width: 100mm !important;
          height: 30mm !important;
          overflow: hidden !important;
          background: #fff !important;
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        .no-print { display: none !important; }
        .print-area {
          padding: 0 !important;
          margin: 0 !important;
          background: none !important;
          min-height: 0 !important;
          display: block !important;
        }
        .label-grid {
          display: block !important;
          padding: 0 !important;
          margin: 0 !important;
          width: 100mm !important;
          height: 30mm !important;
        }
        .label-item {
          display: block !important;
          width: 100mm !important;
          height: 30mm !important;
          overflow: hidden !important;
          margin: 0 !important;
          padding: 0 !important;
          box-shadow: none !important;
          transform: none !important;
          break-after: page;
          page-break-after: always;
        }
        .label-item:last-child {
          break-after: avoid;
          page-break-after: avoid;
        }
      }
    `
    : `
      @media print {
        @page { size: A4 portrait; margin: 12.5mm 5.9mm; }
        body   { margin: 0; padding: 0; background: #fff !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        .no-print { display: none !important; }
        .print-area { padding: 0 !important; margin: 0 !important; background: none !important; min-height: 0 !important; }
        .label-grid {
          display: grid !important;
          grid-template-columns: repeat(2, 99.1mm) !important;
          grid-auto-rows: 34mm !important;
          gap: 0 !important;
          padding: 0 !important;
          margin: 0 !important;
          width: 198.2mm !important;
        }
        .label-item {
          width: 99.1mm !important;
          height: 34mm !important;
          overflow: hidden !important;
          box-shadow: none !important;
          break-inside: avoid;
          page-break-inside: avoid;
        }
      }
    `;

  if (loading) return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#6b7280', fontFamily: 'Arial' }}>Carregando etiquetas...</p>
    </div>
  );

  if (!evento) return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center' }}>
      <p style={{ color: '#ef4444', fontFamily: 'Arial' }}>Evento não encontrado.</p>
    </div>
  );

  const isThermal = mode === 'thermal';

  return (
    <>
      {/* ── CSS injetado ── */}
      <style dangerouslySetInnerHTML={{ __html: printCSS }} />

      {/* ── Barra de controle (não imprime) ── */}
      <div className="no-print" style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 50,
        backgroundColor: '#fff', borderBottom: '1px solid #e5e7eb',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)', padding: '12px 24px',
        display: 'flex', flexDirection: 'column', gap: '8px',
        fontFamily: 'Arial, sans-serif',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' }}>
          <div>
            <p style={{ fontWeight: 700, color: '#123b63', fontSize: '14px', margin: 0 }}>{evento.nome}</p>
            <p style={{ fontSize: '12px', color: '#6b7280', margin: '2px 0 0' }}>
              {inscricoes.filter(i => i.status_pagamento === 'pago' || i.status_pagamento === 'isento').length} etiqueta{inscricoes.filter(i => i.status_pagamento === 'pago' || i.status_pagamento === 'isento').length !== 1 ? 's' : ''} liberada{inscricoes.filter(i => i.status_pagamento === 'pago' || i.status_pagamento === 'isento').length !== 1 ? 's' : ''}
              {' • '}{isThermal ? 'Térmica 100 × 30 mm (individual)' : 'A4 retrato • CA4362 • 99,1 × 34 mm • 2 col × 8 lin'}
              {apenas === 'pendentes' ? ' • Somente não impressas' : ''}
            </p>
            {!isThermal && (
              <p style={{ fontSize: '11px', color: '#9ca3af', margin: '1px 0 0' }}>
                16 etiquetas por página (2 colunas × 8 linhas)
              </p>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={() => window.history.back()}
              style={{ padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: '8px', fontSize: '13px', color: '#374151', backgroundColor: '#fff', cursor: 'pointer', fontFamily: 'Arial' }}>
              ← Voltar
            </button>
            <button onClick={handlePrint} disabled={marcando || !inscricoes.some(i => i.status_pagamento === 'pago' || i.status_pagamento === 'isento')}
              style={{ padding: '8px 20px', borderRadius: '8px', fontSize: '13px', fontWeight: 700, backgroundColor: '#123b63', color: '#fff', border: 'none', cursor: 'pointer', opacity: (marcando || !inscricoes.some(i => i.status_pagamento === 'pago' || i.status_pagamento === 'isento')) ? 0.5 : 1, fontFamily: 'Arial' }}>
              {marcando ? 'Marcando...' : '🖨️ Imprimir e marcar como impressas'}
            </button>
          </div>
        </div>

        {/* Alertas sobre pendentes de pagamento (não imprime) */}
        {(() => {
          const totalInscricoes = inscricoes.length;
          const validas = inscricoes.filter(i => i.status_pagamento === 'pago' || i.status_pagamento === 'isento').length;
          const pendentes = totalInscricoes - validas;

          if (pendentes > 0) {
            return (
              <div style={{
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: '6px',
                padding: '8px 12px',
                fontSize: '12px',
                color: '#991b1b',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <span>⚠️</span>
                <span>
                  {validas === 0
                    ? 'Nenhuma etiqueta liberada para impressão. As inscrições selecionadas ainda estão pendentes de pagamento.'
                    : `${pendentes} inscrição(ões) ignorada(s) por estarem pendentes de pagamento.`}
                </span>
              </div>
            );
          }
          return null;
        })()}
      </div>

      {/* ── Área com etiquetas ── */}
      <div
        className="print-area"
        style={isThermal
          ? { paddingTop: '120px', backgroundColor: '#e5e7eb', minHeight: '100vh', display: 'flex', flexWrap: 'wrap', gap: '16px', padding: '130px 24px 24px' }
          : { paddingTop: '120px', backgroundColor: '#f3f4f6', minHeight: '100vh' }
        }
      >
        {inscricoes.filter(i => i.status_pagamento === 'pago' || i.status_pagamento === 'isento').length === 0 ? (
          <div style={{ display: 'flex', minHeight: '60vh', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            <p style={{ color: '#9ca3af', fontFamily: 'Arial', fontWeight: 'bold' }}>Nenhuma etiqueta liberada para impressão.</p>
          </div>
        ) : (
          <div
            className="label-grid"
            style={isThermal
              ? {
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '22px',
                  padding: '0',
                  justifyContent: 'flex-start',
                  alignItems: 'flex-start',
                }
              : {
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 99.1mm)',
                  gridAutoRows: '34mm',
                  gap: '1px',
                  padding: '24px',
                  justifyContent: 'start',
                  alignItems: 'start',
                }
            }
          >
            {inscricoes
              .filter(ins => ins.status_pagamento === 'pago' || ins.status_pagamento === 'isento')
              .map(ins => (
                <div
                  key={ins.id}
                  className="label-item"
                  style={isThermal
                    ? { boxShadow: '0 2px 8px rgba(0,0,0,0.18)', borderRadius: '1px', flexShrink: 0, transform: 'scale(1.2)', transformOrigin: 'top left' }
                    : { boxShadow: '0 1px 4px rgba(0,0,0,0.12)' }
                  }
                >
                  {evento.departamento === 'AGO'
                    ? <EtiquetaAGO
                        inscricao={ins as EtiquetaInscricaoAGO}
                        evento={evento}
                        nomeSup={nomeSup(ins.supervisao_id)}
                        nomeCampo={nomeCampo(ins.campo_id)}
                        variant={isThermal ? 'thermal' : 'a4'}
                      />
                    : <EtiquetaDepartamento
                        inscricao={ins}
                        evento={evento}
                        nomeSup={nomeSup(ins.supervisao_id)}
                        nomeCampo={nomeCampo(ins.campo_id)}
                        variant={isThermal ? 'thermal' : 'a4'}
                      />
                  }
                </div>
              ))}
          </div>
        )}
      </div>
    </>
  );
}
