'use client';

import { useState, useEffect, useCallback } from 'react';
import { gerarCertificadoPDF, CertConfig, CertDados } from '@/lib/certificado-pdf';

// ─── Tipos ────────────────────────────────────────────────────
interface Supervisao { id: string; nome: string; }
interface Campo      { id: string; nome: string; }

interface InscricaoElegivel {
  id:                  string;
  nome_inscrito:       string;
  cpf:                 string | null;
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

interface FormConfig {
  arte_url:         string;
  texto_corpo:      string;
  rodape_texto:     string;
  assinatura_nome:  string;
  assinatura_cargo: string;
  orientacao:       'landscape' | 'portrait';
  fonte_tamanho:    string;
}

const DEFAULT_TEXTO = 'Certificamos que {NOME} participou do evento {EVENTO}, realizado em {DATA_EVENTO}.';
const DEFAULT_FORM: FormConfig = {
  arte_url:         '',
  texto_corpo:      DEFAULT_TEXTO,
  rodape_texto:     'Belém, {DATA_EMISSAO}',
  assinatura_nome:  '',
  assinatura_cargo: '',
  orientacao:       'landscape',
  fonte_tamanho:    '14',
};

// ─── Componente ───────────────────────────────────────────────
export default function TabCertificados({
  eventoId,
  eventoNome,
  eventoDataInicio,
  eventoDataFim,
  gerarCertificado,
  podeEditar,
  supervisoes,
  campos,
}: {
  eventoId:         string;
  eventoNome:       string;
  eventoDataInicio: string;
  eventoDataFim:    string;
  gerarCertificado: boolean;
  podeEditar:       boolean;
  supervisoes:      Supervisao[];
  campos:           Campo[];
}) {
  const [config,      setConfig]      = useState<CertConfig | null>(null);
  const [form,        setForm]        = useState<FormConfig>(DEFAULT_FORM);
  const [inscricoes,  setInscricoes]  = useState<InscricaoElegivel[]>([]);
  const [semCheckin,  setSemCheckin]  = useState<InscricaoElegivel[]>([]);
  const [stats,       setStats]       = useState<Stats | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [salvando,    setSalvando]    = useState(false);
  const [msg,         setMsg]         = useState('');
  const [filtro,      setFiltro]      = useState<'todos' | 'pendentes' | 'gerados'>('todos');
  const [baixando,    setBaixando]    = useState<Record<string, boolean>>({});
  const [marcando,    setMarcando]    = useState<Record<string, boolean>>({});
  const [loteAtivo,   setLoteAtivo]   = useState(false);

  // ── Helpers ─────────────────────────────────────────────────
  const nomeSup   = (id: string | null) => supervisoes.find(s => s.id === id)?.nome ?? '';
  const nomeCampo = (id: string | null) => campos.find(c => c.id === id)?.nome ?? '';

  const fmtData = (d: string) => {
    const [y, m, day] = d.split('-');
    return `${day}/${m}/${y}`;
  };

  const dataEvento = eventoDataInicio === eventoDataFim
    ? fmtData(eventoDataInicio)
    : `${fmtData(eventoDataInicio)} a ${fmtData(eventoDataFim)}`;

  // ── Carrega dados ────────────────────────────────────────────
  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, listRes] = await Promise.all([
        fetch(`/api/eventos/${eventoId}/certificado-config`).then(r => r.json()),
        fetch(`/api/eventos/${eventoId}/certificados`).then(r => r.json()),
      ]);

      if (cfgRes.config) {
        setConfig(cfgRes.config as CertConfig);
        setForm({
          arte_url:         cfgRes.config.arte_url        ?? '',
          texto_corpo:      cfgRes.config.texto_corpo     ?? DEFAULT_TEXTO,
          rodape_texto:     cfgRes.config.rodape_texto    ?? 'Belém, {DATA_EMISSAO}',
          assinatura_nome:  cfgRes.config.assinatura_nome  ?? '',
          assinatura_cargo: cfgRes.config.assinatura_cargo ?? '',
          orientacao:       cfgRes.config.orientacao      ?? 'landscape',
          fonte_tamanho:    String(cfgRes.config.fonte_tamanho ?? 14),
        });
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

  // ── Salvar configuração ──────────────────────────────────────
  async function salvarConfig(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setMsg('');
    try {
      const res = await fetch(`/api/eventos/${eventoId}/certificado-config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          fonte_tamanho: parseInt(form.fonte_tamanho) || 14,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setMsg('❌ ' + (json.error ?? 'Erro ao salvar.'));
      } else {
        setConfig(json.config);
        setMsg('✅ Configuração salva!');
        setTimeout(() => setMsg(''), 3000);
      }
    } catch {
      setMsg('❌ Erro de conexão.');
    } finally {
      setSalvando(false);
    }
  }

  // ── Monta dados para PDF ─────────────────────────────────────
  function montarDados(ins: InscricaoElegivel): CertDados {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    return {
      nome:          ins.nome_inscrito,
      evento:        eventoNome,
      data_evento:   dataEvento,
      cargo:         ins.tipo_inscricao ?? null,
      supervisao:    nomeSup(ins.supervisao_id),
      campo:         nomeCampo(ins.campo_id),
      codigo:        ins.qr_code ?? ins.id.slice(0, 8).toUpperCase(),
      validacao_url: `${baseUrl}/certificado/${ins.qr_code ?? ins.id}`,
    };
  }

  // ── Config efetiva para PDF ──────────────────────────────────
  function configParaPDF(): CertConfig {
    return config ?? {
      arte_url:         form.arte_url || null,
      texto_corpo:      form.texto_corpo,
      rodape_texto:     form.rodape_texto || null,
      assinatura_nome:  form.assinatura_nome || null,
      assinatura_cargo: form.assinatura_cargo || null,
      orientacao:       form.orientacao,
      fonte_tamanho:    parseInt(form.fonte_tamanho) || 14,
    };
  }

  // ── Baixar certificado individual ────────────────────────────
  async function baixarCertificado(ins: InscricaoElegivel) {
    setBaixando(b => ({ ...b, [ins.id]: true }));
    try {
      await gerarCertificadoPDF(configParaPDF(), montarDados(ins), 'save');
    } catch (err) {
      alert('Erro ao gerar PDF: ' + String(err));
    } finally {
      setBaixando(b => ({ ...b, [ins.id]: false }));
    }
  }

  // ── Marcar como enviado ──────────────────────────────────────
  async function marcarEnviado(ins: InscricaoElegivel) {
    setMarcando(m => ({ ...m, [ins.id]: true }));
    try {
      const res = await fetch(`/api/eventos/${eventoId}/certificados/${ins.id}`, { method: 'PATCH' });
      if (res.ok) {
        setInscricoes(prev => prev.map(i => i.id === ins.id ? { ...i, certificado_enviado: true } : i));
        setStats(s => s ? { ...s, pendentes: s.pendentes - 1, gerados: s.gerados + 1 } : s);
      }
    } catch {
      alert('Erro ao marcar como enviado.');
    } finally {
      setMarcando(m => ({ ...m, [ins.id]: false }));
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

  // ── Baixar em lote ──────────────────────────────────────────
  async function baixarLote() {
    if (loteAtivo) return;
    const alvo = filtroLista;
    if (alvo.length === 0) return;
    setLoteAtivo(true);
    for (const ins of alvo) {
      try {
        await gerarCertificadoPDF(configParaPDF(), montarDados(ins), 'save');
        await new Promise(r => setTimeout(r, 600)); // delay entre downloads
      } catch {
        // continua para o próximo
      }
    }
    setLoteAtivo(false);
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

      {/* ── Configuração ────────────────────────────────────── */}
      {podeEditar && (
        <details className="bg-blue-50 border border-blue-200 rounded-2xl overflow-hidden" open={!config}>
          <summary className="px-5 py-4 cursor-pointer select-none font-bold text-[#123b63] flex items-center gap-2">
            <span>⚙️ Configurar arte do certificado</span>
            <span className="text-xs text-blue-500 font-normal ml-auto">Clique para {!config ? 'fechar' : 'expandir'}</span>
          </summary>
          <form onSubmit={salvarConfig} className="px-5 pb-5 space-y-4 border-t border-blue-200 pt-4">

            {/* Arte de fundo */}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">URL da arte de fundo</label>
              <input
                type="url"
                value={form.arte_url}
                onChange={e => setForm(f => ({ ...f, arte_url: e.target.value }))}
                placeholder="https://... (imagem JPG ou PNG)"
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
              />
              {form.arte_url && (
                <div className="mt-2 relative h-24 bg-gray-100 rounded-lg overflow-hidden border border-gray-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.arte_url} alt="Preview" className="w-full h-full object-cover" />
                </div>
              )}
              <p className="text-xs text-gray-400 mt-1">Faça upload no Supabase Storage ou use qualquer URL pública acessível.</p>
            </div>

            {/* Texto do certificado */}
            <div>
              <label className="block text-xs font-bold text-gray-600 mb-1">Texto do certificado</label>
              <textarea
                value={form.texto_corpo}
                onChange={e => setForm(f => ({ ...f, texto_corpo: e.target.value }))}
                rows={3}
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30 resize-none font-mono"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {['{NOME}', '{EVENTO}', '{DATA_EVENTO}', '{CARGO}', '{SUPERVISAO}', '{CAMPO}', '{CODIGO}'].map(ph => (
                  <button
                    key={ph}
                    type="button"
                    onClick={() => setForm(f => ({ ...f, texto_corpo: f.texto_corpo + ph }))}
                    className="text-[11px] bg-white border border-gray-300 hover:border-[#123b63] px-2 py-0.5 rounded font-mono text-gray-600 hover:text-[#123b63] transition"
                  >
                    {ph}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Rodapé */}
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Rodapé / Data de emissão</label>
                <input
                  type="text"
                  value={form.rodape_texto}
                  onChange={e => setForm(f => ({ ...f, rodape_texto: e.target.value }))}
                  placeholder="Belém, {DATA_EMISSAO}"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
                />
              </div>
              {/* Orientação */}
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Orientação</label>
                <select
                  value={form.orientacao}
                  onChange={e => setForm(f => ({ ...f, orientacao: e.target.value as 'landscape' | 'portrait' }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
                >
                  <option value="landscape">Paisagem (A4 horizontal) — recomendado</option>
                  <option value="portrait">Retrato (A4 vertical)</option>
                </select>
              </div>
              {/* Assinatura */}
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Nome do signatário</label>
                <input
                  type="text"
                  value={form.assinatura_nome}
                  onChange={e => setForm(f => ({ ...f, assinatura_nome: e.target.value }))}
                  placeholder="Ex: Pr. João Silva"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Cargo do signatário</label>
                <input
                  type="text"
                  value={form.assinatura_cargo}
                  onChange={e => setForm(f => ({ ...f, assinatura_cargo: e.target.value }))}
                  placeholder="Ex: Presidente da ADESPA"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
                />
              </div>
              {/* Tamanho da fonte */}
              <div>
                <label className="block text-xs font-bold text-gray-600 mb-1">Tamanho da fonte</label>
                <select
                  value={form.fonte_tamanho}
                  onChange={e => setForm(f => ({ ...f, fonte_tamanho: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#123b63]/30"
                >
                  {[10, 12, 13, 14, 15, 16, 18, 20].map(v => (
                    <option key={v} value={v}>{v}pt</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex gap-3 pt-1">
              <button
                type="submit"
                disabled={salvando}
                className="bg-[#123b63] hover:bg-[#0f2a45] text-white px-6 py-2.5 rounded-xl text-sm font-bold transition disabled:opacity-50"
              >
                {salvando ? 'Salvando...' : '✅ Salvar configuração'}
              </button>
            </div>
          </form>
        </details>
      )}

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
              onClick={baixarLote}
              disabled={loteAtivo || filtroLista.length === 0 || !config}
              title={!config ? 'Salve a configuração antes de gerar em lote' : ''}
              className="text-xs bg-amber-500 hover:bg-amber-400 text-white px-3 py-1.5 rounded-lg font-bold transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {loteAtivo ? '⏳ Gerando...' : `📥 Baixar ${filtroLista.length} em lote`}
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
                  <button
                    onClick={() => baixarCertificado(ins)}
                    disabled={baixando[ins.id] || !config}
                    title={!config ? 'Configure o certificado antes de gerar' : 'Baixar PDF'}
                    className="text-xs bg-[#123b63] hover:bg-[#0f2a45] text-white px-3 py-1.5 rounded-lg font-bold transition disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {baixando[ins.id] ? '⏳' : '📄 PDF'}
                  </button>

                  {!ins.certificado_enviado ? (
                    <button
                      onClick={() => marcarEnviado(ins)}
                      disabled={marcando[ins.id]}
                      className="text-xs border border-emerald-300 text-emerald-600 hover:bg-emerald-50 px-3 py-1.5 rounded-lg font-bold transition disabled:opacity-50"
                    >
                      {marcando[ins.id] ? '...' : '✓ Marcar'}
                    </button>
                  ) : (
                    <button
                      onClick={() => desfazerEnviado(ins)}
                      className="text-xs border border-gray-200 text-gray-400 hover:border-gray-300 hover:text-gray-500 px-2 py-1.5 rounded-lg transition"
                      title="Desfazer marcação"
                    >
                      ↩
                    </button>
                  )}
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
          💡 Configure a arte do certificado acima antes de gerar os PDFs.
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
