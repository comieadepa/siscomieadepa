'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase-client';
import PrintLetterhead from '@/components/print/PrintLetterhead';

// ─── Interfaces ───────────────────────────────────────────────
interface Sessao {
  id: string;
  evento_id: string;
  operador_nome: string;
  status: string;
  data_abertura: string;
  data_fechamento: string | null;
  saldo_dinheiro_esperado: number | null;
  saldo_dinheiro_informado: number | null;
  divergencia_dinheiro: number | null;
  observacoes: string | null;
}

interface Sangria {
  id: string;
  valor: number;
  observacao: string | null;
  created_at: string;
}

interface Transacao {
  id: string;
  tipo: 'inscricao' | 'complemento';
  descricao: string;
  nome_inscrito: string;
  valor: number;
  forma_pagamento: string;
  created_at: string;
}

const fmtMoeda = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDT = (d: string | null) => {
  if (!d) return '-';
  return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
};

export default function CaixaPrintPage() {
  const params = useParams();
  const id = params?.id as string;
  const sessaoId = params?.sessaoId as string;

  const supabase = useMemo(() => createClient(), []);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [eventoNome, setEventoNome] = useState<string | null>(null);
  const [sangrias, setSangrias] = useState<Sangria[]>([]);
  const [transacoes, setTransacoes] = useState<Transacao[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id || !sessaoId) return;

    async function loadData() {
      try {
        // 1. Carregar Sessão
        const { data: sessaoData } = await supabase
          .from('evento_caixa_sessoes')
          .select('*')
          .eq('id', sessaoId)
          .single();

        if (sessaoData) {
          setSessao(sessaoData as Sessao);
        }

        // 2. Carregar Evento
        const { data: evData } = await supabase
          .from('eventos')
          .select('nome')
          .eq('id', id)
          .single();

        if (evData) {
          setEventoNome(evData.nome);
        }

        // 3. Carregar Sangrias
        const { data: sangriasData } = await supabase
          .from('evento_caixa_sangrias')
          .select('id, valor, observacao, created_at')
          .eq('caixa_sessao_id', sessaoId)
          .order('created_at', { ascending: true });

        if (sangriasData) {
          setSangrias(sangriasData as Sangria[]);
        }

        // 4. Carregar Inscrições
        const { data: inscricoesData } = await supabase
          .from('evento_inscricoes')
          .select('id, nome_inscrito, valor_pago, status_pagamento, forma_pagamento, created_at')
          .eq('caixa_sessao_id', sessaoId);

        // 5. Carregar Complementos (Se houver tabela/campo para caixa_sessao_id em ordens)
        // Como o caixa/resumo busca ordens_pagamento associadas ao caixa do operador, vamos buscar também:
        const { data: ordensData } = await supabase
          .from('evento_ordens_pagamento')
          .select(`
            id,
            valor,
            forma_pagamento,
            created_at,
            evento_inscricoes (
              nome_inscrito
            )
          `)
          .eq('caixa_sessao_id', sessaoId)
          .eq('status', 'pago');

        const listTrans: Transacao[] = [];

        if (inscricoesData) {
          inscricoesData.forEach((i: any) => {
            if (i.status_pagamento === 'pago') {
              listTrans.push({
                id: i.id,
                tipo: 'inscricao',
                descricao: 'Inscrição Efetivada',
                nome_inscrito: i.nome_inscrito,
                valor: Number(i.valor_pago || 0),
                forma_pagamento: i.forma_pagamento || 'Presencial',
                created_at: i.created_at
              });
            } else if (i.status_pagamento === 'isento') {
              listTrans.push({
                id: i.id,
                tipo: 'inscricao',
                descricao: 'Inscrição Isenta (Cortesia)',
                nome_inscrito: i.nome_inscrito,
                valor: 0,
                forma_pagamento: 'Cortesia',
                created_at: i.created_at
              });
            }
          });
        }

        if (ordensData) {
          ordensData.forEach((o: any) => {
            listTrans.push({
              id: o.id,
              tipo: 'complemento',
              descricao: 'Complemento de Pagamento',
              nome_inscrito: o.evento_inscricoes?.nome_inscrito || 'Inscrito',
              valor: Number(o.valor || 0),
              forma_pagamento: o.forma_pagamento || 'Presencial',
              created_at: o.created_at
            });
          });
        }

        // Ordenar transações por data/hora
        listTrans.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
        setTransacoes(listTrans);

      } catch (err) {
        console.error('Erro ao carregar dados do caixa:', err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [id, sessaoId, supabase]);

  // Cálculos consolidados da sessão
  const resumo = useMemo(() => {
    let totalRecebido = 0;
    let dinheiro = 0;
    let pix = 0;
    let cartao = 0;
    let cortesiaQtd = 0;

    transacoes.forEach(t => {
      totalRecebido += t.valor;
      const fp = String(t.forma_pagamento).toLowerCase();
      if (fp.includes('dinheiro')) {
        dinheiro += t.valor;
      } else if (fp.includes('pix')) {
        pix += t.valor;
      } else if (fp.includes('cartao') || fp.includes('cartão') || fp.includes('credito') || fp.includes('debito') || fp.includes('crédito') || fp.includes('débito')) {
        cartao += t.valor;
      } else if (fp.includes('cortesia') || fp.includes('isento')) {
        cortesiaQtd++;
      } else {
        // Fallback para outros métodos (ex: pix)
        pix += t.valor;
      }
    });

    const totalSangrias = sangrias.reduce((s, o) => s + Number(o.valor), 0);
    const saldoEsperadoDinheiro = dinheiro - totalSangrias;

    return {
      totalRecebido,
      dinheiro,
      pix,
      cartao,
      cortesiaQtd,
      totalSangrias,
      saldoEsperadoDinheiro
    };
  }, [transacoes, sangrias]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center font-sans">
        <p className="text-gray-500">Carregando fechamento de caixa...</p>
      </div>
    );
  }

  if (!sessao) {
    return (
      <div className="min-h-screen flex items-center justify-center font-sans">
        <p className="text-red-500 font-bold">Caixa não encontrado.</p>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-4xl mx-auto font-sans bg-white">
      {/* Barra superior de controle para impressão */}
      <div className="print:hidden mb-6 flex justify-between items-center bg-gray-50 p-4 rounded-xl border border-gray-200">
        <div>
          <h1 className="font-bold text-[#123b63] text-sm">Visualização de Fechamento de Caixa</h1>
          <p className="text-xs text-gray-500">Operador: {sessao.operador_nome} • Status: <span className="font-semibold uppercase">{sessao.status}</span></p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => window.close()}
            className="px-4 py-2 text-xs font-semibold rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 transition"
          >
            Fechar Janela
          </button>
          <button
            onClick={() => window.print()}
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[#123b63] text-white hover:bg-[#0f2a45] transition"
          >
            🖨️ Imprimir Fechamento
          </button>
        </div>
      </div>

      {/* Cabeçalho Oficial */}
      <PrintLetterhead
        reportTitle={`FECHAMENTO DE CAIXA OPERACIONAL`}
        eventName={eventoNome}
        periodText={`Geração: ${new Date().toLocaleDateString('pt-BR')}`}
        locationText={null}
        issuedAtText={new Date().toLocaleDateString('pt-BR')}
        totalRecords={transacoes.length}
        filtersText={`OPERADOR: ${sessao.operador_nome}`}
      />

      {/* Dados Gerais da Sessão */}
      <div className="border border-gray-200 rounded-lg p-4 mb-6 grid grid-cols-2 gap-4 text-xs bg-gray-50/50">
        <div>
          <p className="text-gray-500">Operador do Caixa</p>
          <p className="font-bold text-sm text-[#123b63]">{sessao.operador_nome}</p>
        </div>
        <div>
          <p className="text-gray-500">Código da Sessão</p>
          <p className="font-mono text-gray-700">{sessao.id.slice(0, 8).toUpperCase()}</p>
        </div>
        <div>
          <p className="text-gray-500">Data/Hora de Abertura</p>
          <p className="font-medium text-gray-700">{fmtDT(sessao.data_abertura)}</p>
        </div>
        <div>
          <p className="text-gray-500">Data/Hora de Fechamento</p>
          <p className="font-medium text-gray-700">{sessao.data_fechamento ? fmtDT(sessao.data_fechamento) : 'Sessão ainda aberta'}</p>
        </div>
      </div>

      {/* Resumo Financeiro Consolidado */}
      <h3 className="font-bold text-[#123b63] text-xs uppercase tracking-wider mb-2">Resumo de Valores</h3>
      <table className="w-full border-collapse border border-gray-200 text-xs mb-6">
        <tbody>
          <tr className="border-b border-gray-200">
            <td className="p-2 font-medium text-gray-600 bg-gray-50 w-1/2">Total Arrecadado (Inscrições + Complementos)</td>
            <td className="p-2 font-bold text-gray-800 text-right">{fmtMoeda(resumo.totalRecebido)}</td>
          </tr>
          <tr className="border-b border-gray-200">
            <td className="p-2 font-medium text-gray-600 bg-gray-50">Recebido em PIX / Transferência</td>
            <td className="p-2 font-bold text-gray-800 text-right">{fmtMoeda(resumo.pix)}</td>
          </tr>
          <tr className="border-b border-gray-200">
            <td className="p-2 font-medium text-gray-600 bg-gray-50">Recebido em Cartões</td>
            <td className="p-2 font-bold text-gray-800 text-right">{fmtMoeda(resumo.cartao)}</td>
          </tr>
          <tr className="border-b border-gray-200">
            <td className="p-2 font-medium text-gray-600 bg-gray-50">Recebido em Dinheiro (Bruto)</td>
            <td className="p-2 font-bold text-gray-800 text-right">{fmtMoeda(resumo.dinheiro)}</td>
          </tr>
          <tr className="border-b border-gray-200">
            <td className="p-2 font-medium text-gray-600 bg-gray-50">(-) Total de Sangrias (Dinheiro retirado)</td>
            <td className="p-2 font-bold text-red-600 text-right">-{fmtMoeda(resumo.totalSangrias)}</td>
          </tr>
          <tr className="border-b border-gray-200 font-bold bg-[#eff6ff]">
            <td className="p-2 text-[#1e40af]">Saldo Esperado em Dinheiro</td>
            <td className="p-2 text-[#1e40af] text-right">{fmtMoeda(resumo.saldoEsperadoDinheiro)}</td>
          </tr>
          <tr className="border-b border-gray-200 font-bold bg-gray-50">
            <td className="p-2 text-gray-700">Saldo Informado pelo Operador</td>
            <td className="p-2 text-gray-800 text-right">{sessao.saldo_dinheiro_informado !== null ? fmtMoeda(sessao.saldo_dinheiro_informado) : '—'}</td>
          </tr>
          <tr className={`font-bold ${Number(sessao.divergencia_dinheiro ?? 0) < 0 ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
            <td className="p-2">Divergência de Caixa (Falta/Sobra)</td>
            <td className="p-2 text-right">
              {sessao.divergencia_dinheiro !== null ? (
                <>
                  {Number(sessao.divergencia_dinheiro) > 0 ? '+' : ''}
                  {fmtMoeda(sessao.divergencia_dinheiro)}
                </>
              ) : '—'}
            </td>
          </tr>
        </tbody>
      </table>

      {/* Relação de Sangrias Realizadas */}
      {sangrias.length > 0 && (
        <>
          <h3 className="font-bold text-[#123b63] text-xs uppercase tracking-wider mb-2">Sangrias Realizadas</h3>
          <table className="w-full border-collapse border border-gray-200 text-xs mb-6">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 font-bold text-gray-600 text-left">
                <th className="p-2">Horário</th>
                <th className="p-2">Observação</th>
                <th className="p-2 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {sangrias.map(s => (
                <tr key={s.id} className="border-b border-gray-200">
                  <td className="p-2 text-gray-500">{new Date(s.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="p-2 text-gray-700">{s.observacao || 'Sangria operacional'}</td>
                  <td className="p-2 text-right font-semibold text-red-600">-{fmtMoeda(s.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* Relação de Transações efetuadas */}
      <h3 className="font-bold text-[#123b63] text-xs uppercase tracking-wider mb-2">Transações efetuadas</h3>
      <table className="w-full border-collapse border border-gray-200 text-xs mb-8">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200 font-bold text-gray-600 text-left">
            <th className="p-2 w-10">#</th>
            <th className="p-2">Inscrito</th>
            <th className="p-2">Descrição</th>
            <th className="p-2">Forma Pgto</th>
            <th className="p-2 text-right">Valor</th>
          </tr>
        </thead>
        <tbody>
          {transacoes.map((t, idx) => (
            <tr key={t.id} className="border-b border-gray-200 hover:bg-gray-50/50">
              <td className="p-2 text-gray-400">{idx + 1}</td>
              <td className="p-2 font-semibold text-gray-800">{t.nome_inscrito}</td>
              <td className="p-2 text-gray-500">{t.descricao}</td>
              <td className="p-2 text-gray-600 uppercase font-medium">{t.forma_pagamento}</td>
              <td className="p-2 text-right font-medium text-gray-800">{fmtMoeda(t.valor)}</td>
            </tr>
          ))}
          {transacoes.length === 0 && (
            <tr>
              <td colSpan={5} className="p-4 text-center text-gray-400">Nenhuma transação financeira registrada nesta sessão.</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Termos de Conferência e Assinaturas */}
      <div className="mt-12 grid grid-cols-2 gap-12 text-xs pt-8 border-t border-dashed border-gray-300">
        <div className="flex flex-col items-center">
          <div className="w-48 border-b border-gray-400 h-10 mb-2" />
          <p className="font-bold text-gray-700">{sessao.operador_nome}</p>
          <p className="text-gray-400">Operador Responsável</p>
        </div>
        <div className="flex flex-col items-center">
          <div className="w-48 border-b border-gray-400 h-10 mb-2" />
          <p className="font-bold text-gray-700">__________________________________</p>
          <p className="text-gray-400">Conferente / Financeiro</p>
        </div>
      </div>
    </div>
  );
}
