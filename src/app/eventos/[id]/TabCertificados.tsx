'use client';

import { useState, useEffect, useCallback } from 'react';
import CertificadoEditor, { Elemento } from './CertificadoEditor';

// ─── Tipos ────────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; }

interface InscricaoElegivel {
  id:                  string;
  nome_inscrito:       string;
  cpf:                 string | null;
  email:               string | null;
  supervisao_id:       string | null;
  campo_id:            string | null;
  tipo_inscricao:      string | null;
  status_pagamento:    string;
  checkin_realizado:   boolean;
  certificado_enviado: boolean;
  qr_code:             string | null;
}

interface Stats {
  total_pago_isento: number;
  elegiveis:  number;
  pendentes:  number;
  gerados:    number;
  sem_checkin: number;
}

// ─── Componente ───────────────────────────────────────────────
export default function TabCertificados({
  eventoId,
  gerarCertificado,
  podeEditar,
  supervisoes,
  campos,
}: {
  eventoId:         string;

  gerarCertificado: boolean;
  podeEditar:       boolean;
  supervisoes:      Supervisao[];
  campos:           Campo[];
}) {
  const [config,      setConfig]      = useState<Record<string, unknown> | null>(null);
  const [initElementos,  setInitElementos]  = useState<Elemento[]>([]);
  const [initBackground, setInitBackground] = useState<string | null>(null);
  const [inscricoes,  setInscricoes]  = useState<InscricaoElegivel[]>([]);
  const [semCheckin,  setSemCheckin]  = useState<InscricaoElegivel[]>([]);
  const [stats,       setStats]       = useState<Stats | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [msg,         setMsg]         = useState('');
  const [filtro,      setFiltro]      = useState<'todos' | 'pendentes' | 'gerados'>('todos');
  const [enviando,    setEnviando]    = useState<Record<string, boolean>>({});
  const [loteAtivo,   setLoteAtivo]   = useState(false);

  // ── Helpers ─────────────────────────────────────────────────
  const nomeSup   = (id: string | null) => supervisoes.find(s => s.id === id)?.nome ?? '';
  const nomeCampo = (id: string | null) => campos.find(c => c.id === id)?.nome ?? '';

  // ── Carrega dados ────────────────────────────────────────────
  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, listRes] = await Promise.all([
        fetch(`/api/eventos/${eventoId}/certificado-config`).then(r => r.json()),
        fetch(`/api/eventos/${eventoId}/certificados`).then(r => r.json()),
      ]);

      if (cfgRes.config) {
        const cfg = cfgRes.config as Record<string, unknown>;
        setConfig(cfg);
        const rawBg = (cfg.background_url ?? cfg.arte_url) as string | null;
        setInitBackground(rawBg || null);
        const rawElem = cfg.elementos_json;
        setInitElementos(Array.isArray(rawElem) ? (rawElem as Elemento[]) : []);
      }

      setStats(listRes.stats ?? null);
      setInscricoes(listRes.inscricoes ?? []);
      setSemCheckin(listRes.sem_checkin ?? []);
    } catch {
      setMsg('❌ Erro ao carregar dados.');
    } finally {
      setLoading(false);
    }
  }, [eventoId]);

  useEffect(() => { carregar(); }, [carregar]);

  // ── Enviar link do certificado individual ────────────────────
  async function enviarLink(ins: InscricaoElegivel, reenviar = false) {
    setEnviando(e => ({ ...e, [ins.id]: true }));
    try {
      const res = await fetch(`/api/eventos/${eventoId}/certificados/enviar-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inscricao_id: ins.id, reenviar }),
      });
      const json = await res.json();
      if (json.jaEnviado) {
        setMsg('⚠️ Já enviado anteriormente. Use "Reenviar" para enviar novamente.');
      } else if (res.ok) {
        setMsg('✅ Link enviado para ' + ins.nome_inscrito);
        setTimeout(() => setMsg(''), 3000);
        await carregar();
      } else {
        setMsg('❌ ' + (json.error ?? 'Erro ao enviar.'));
      }
    } catch {
      setMsg('❌ Erro de conexão.');
    } finally {
      setEnviando(e => ({ ...e, [ins.id]: false }));
    }
  }

  // ── Desfazer marcação ────────────────────────────────────────
  async function desfazerEnviado(ins: InscricaoElegivel) {
    const res = await fetch(`/api/eventos/${eventoId}/certificados/${ins.id}`, { method: 'DELETE' });
    if (res.ok) {
      setInscricoes(prev => prev.map(i => i.id === ins.id ? { ...i, certificado_enviado: false } : i));
      setStats(s => s ? { ...s, pendentes: s.pendentes + 1, gerados: s.gerados - 1 } : s);
    }
  }

  // ── Enviar links em lote ─────────────────────────────────────
  async function enviarLote() {
    if (loteAtivo) return;
    const alvo = filtroLista.filter(i => !i.certificado_enviado);
    if (alvo.length === 0) return;
    setLoteAtivo(true);
    let ok = 0; let fail = 0;
    for (const ins of alvo) {
      try {
        const res = await fetch(`/api/eventos/${eventoId}/certificados/enviar-link`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inscricao_id: ins.id }),
        });
        if ((await res.json()).ok) ok++; else fail++;
      } catch { fail++; }
      await new Promise(r => setTimeout(r, 300));
    }
    setLoteAtivo(false);
    setMsg(`✅ ${ok} links enviados${fail > 0 ? ` · ❌ ${fail} erros` : ''}`);
    await carregar();
  }

  // ── Lista filtrada ───────────────────────────────────────────
  const filtroLista = inscricoes.filter(i => {
    if (filtro === 'pendentes') return !i.certificado_enviado;
    if (filtro === 'gerados')   return i.certificado_enviado;
    return true;
  });

  // ─── Se evento não emite certificado ─────────────────────────
  if (!gerarCertificado) {
    return (
      <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
        <p className="text-4xl mb-3">🎓</p>
        <p className="font-bold text-gray-500 text-lg">Certificados desabilitados</p>
        <p className="text-gray-400 text-sm mt-1">
          Ative a opção &ldquo;Gerar certificado&rdquo; nas Configurações do evento para usar este recurso.
        </p>
      </div>
    );
  }

  if (loading) {
    return <div className="text-center py-16 text-gray-400 text-sm">Carregando...</div>;
  }

  // ─── Render principal ─────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* ── Stats ───────────────────────────────────────────── */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label="Elegíveis"   valor={stats.elegiveis}   cor="blue"    />
          <StatCard label="Pendentes"   valor={stats.pendentes}   cor="amber"   />
          <StatCard label="Gerados"     valor={stats.gerados}     cor="emerald" />
          <StatCard label="Sem check-in" valor={stats.sem_checkin} cor="gray"   />
        </div>
      )}

      {/* Feedback */}
      {msg && (
        <div className={`px-4 py-3 rounded-xl text-sm font-semibold ${msg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
          {msg}
        </div>
      )}

      {/* ── Editor Visual do Certificado ────────────────────── */}
      <div className="bg-blue-50 border border-blue-200 rounded-2xl overflow-hidden">
        <details open={!config}>
          <summary className="px-5 py-4 cursor-pointer select-none font-bold text-[#123b63] flex items-center gap-2 hover:bg-blue-100/50 transition">
            <span>🎨 Editor Visual do Certificado</span>
            <span className="text-xs text-blue-500 font-normal ml-auto">
              {config ? 'Configurado ✓' : 'Clique para configurar'}
            </span>
          </summary>
          <div className="px-5 pb-5 border-t border-blue-200 pt-4">
            <CertificadoEditor
              eventoId={eventoId}
              podeEditar={podeEditar}
              initElementos={initElementos}
              initBackground={initBackground}
              onSaved={(elems, bg) => {
                setInitElementos(elems);
                setInitBackground(bg);
                setConfig(c => ({ ...(c ?? {}), background_url: bg, elementos_json: elems }));
              }}
            />
          </div>
        </details>
      </div>

      {/* ── Lista de elegíveis ──────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
          <h3 className="font-bold text-[#123b63] text-base">🎓 Inscrições elegíveis</h3>
          <div className="flex gap-2 flex-wrap">
            {/* Filtros */}
            {(['todos', 'pendentes', 'gerados'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                  filtro === f
                    ? 'bg-[#123b63] text-white'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
              >
                {f === 'todos' ? 'Todos' : f === 'pendentes' ? 'Pendentes' : 'Gerados'}
              </button>
            ))}
            {/* Botão lote */}
            <button
              onClick={enviarLote}
              disabled={loteAtivo || filtroLista.filter(i => !i.certificado_enviado).length === 0}
              className="text-xs bg-amber-500 hover:bg-amber-400 text-white px-3 py-1.5 rounded-lg font-bold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {loteAtivo ? '⏳ Enviando...' : `📤 Enviar ${filtroLista.filter(i => !i.certificado_enviado).length} links`}
            </button>
          </div>
        </div>

        {filtroLista.length === 0 ? (
          <div className="text-center py-10 border-2 border-dashed border-gray-200 rounded-2xl">
            <p className="text-gray-400 text-sm">
              {filtro === 'pendentes'
                ? 'Nenhum certificado pendente.'
                : filtro === 'gerados'
                  ? 'Nenhum certificado marcado como gerado ainda.'
                  : inscricoes.length === 0
                    ? 'Nenhuma inscrição elegível. Participantes precisam de pagamento confirmado + check-in.'
                    : 'Nenhum resultado.'
              }
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtroLista.map(ins => (
              <div
                key={ins.id}
                className={`flex items-center gap-3 bg-white border rounded-xl px-4 py-3 transition ${
                  ins.certificado_enviado ? 'border-emerald-200 bg-emerald-50/30' : 'border-gray-200'
                }`}
              >
                {/* Status */}
                <div className="flex-shrink-0 w-6 text-center">
                  {ins.certificado_enviado ? (
                    <span title="Certificado gerado" className="text-emerald-500">✅</span>
                  ) : (
                    <span title="Pendente" className="text-amber-400">⏳</span>
                  )}
                </div>

                {/* Dados */}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-800 text-sm truncate">{ins.nome_inscrito}</p>
                  <p className="text-xs text-gray-400">
                    {[ins.tipo_inscricao, nomeSup(ins.supervisao_id), nomeCampo(ins.campo_id)].filter(Boolean).join(' • ')}
                  </p>
                </div>

                {/* Ações */}
                <div className="flex gap-2 flex-shrink-0">
                  {!ins.certificado_enviado ? (
                    <button
                      onClick={() => enviarLink(ins)}
                      disabled={enviando[ins.id]}
                      title="Enviar link do certificado por e-mail"
                      className="text-xs bg-[#123b63] hover:bg-[#0f2a45] text-white px-3 py-1.5 rounded-lg font-bold transition disabled:opacity-40"
                    >
                      {enviando[ins.id] ? '⏳' : '📤 Enviar'}
                    </button>
                  ) : (
                    <>
                      <span className="text-xs text-emerald-600 font-semibold flex items-center gap-1">✅ Enviado</span>
                      <button
                        onClick={() => enviarLink(ins, true)}
                        disabled={enviando[ins.id]}
                        title="Reenviar link do certificado"
                        className="text-xs border border-gray-200 text-gray-500 hover:border-gray-400 px-2 py-1.5 rounded-lg transition"
                      >
                        {enviando[ins.id] ? '⏳' : '↩ Reenviar'}
                      </button>
                    </>
                  )}
                  <button
                    onClick={() => desfazerEnviado(ins)}
                    className="text-xs border border-gray-200 text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded-lg transition"
                    title="Desfazer marcação"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Sem check-in ────────────────────────────────────── */}
      {semCheckin.length > 0 && (
        <details className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
          <summary className="px-4 py-3 cursor-pointer text-sm font-semibold text-amber-700">
            ⚠️ {semCheckin.length} inscrição(ões) sem check-in — não elegíveis para certificado
          </summary>
          <div className="px-4 pb-4 space-y-1 pt-2">
            {semCheckin.map(ins => (
              <div key={ins.id} className="text-xs text-amber-700 flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                {ins.nome_inscrito} — {ins.status_pagamento}
              </div>
            ))}
          </div>
        </details>
      )}

      {/* ── Dica: sem config ────────────────────────────────── */}
      {!config && inscricoes.length > 0 && podeEditar && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 text-sm text-blue-700">
          💡 Configure o editor visual acima para personalizar o certificado dos participantes.
        </div>
      )}
    </div>
  );
}

// ─── Subcomponente: card de estatística ───────────────────────
function StatCard({ label, valor, cor }: { label: string; valor: number; cor: string }) {
  const colors: Record<string, string> = {
    blue:    'bg-blue-50 border-blue-200 text-blue-700',
    amber:   'bg-amber-50 border-amber-200 text-amber-700',
    emerald: 'bg-emerald-50 border-emerald-200 text-emerald-700',
    gray:    'bg-gray-50 border-gray-200 text-gray-600',
  };
  return (
    <div className={`border rounded-xl p-4 text-center ${colors[cor] ?? colors.gray}`}>
      <p className="text-2xl font-black">{valor}</p>
      <p className="text-xs font-semibold mt-0.5 opacity-80">{label}</p>
    </div>
  );
}
