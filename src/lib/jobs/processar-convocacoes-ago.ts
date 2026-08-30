/**
 * Job de Convocação Oficial de AGO para o Portal do Ministro.
 * Processa convocações de forma incremental (máximo 100 por execução)
 * para suportar milhares de ministros com total tolerância a timeout serverless.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { criarNotificacaoMinistro } from '@/lib/notificacoes-ministro';

export interface ResumoConvocacoesAgo {
  totalAgosEncontradas: number;
  ministrosAvaliados: number;
  notificacoesCriadas: number;
  jaNotificados: number;
  erros: number;
}

const LIMITE_POR_EXECUCAO = 100;
const SCAN_CHUNK_SIZE = 200;

function fmtDataBr(dataStr: string): string {
  if (!dataStr) return '—';
  const d = new Date(dataStr.includes('T') ? dataStr : dataStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function processarConvocacoesAgo(
  supabase: SupabaseClient,
): Promise<ResumoConvocacoesAgo> {
  const resumo: ResumoConvocacoesAgo = {
    totalAgosEncontradas: 0,
    ministrosAvaliados: 0,
    notificacoesCriadas: 0,
    jaNotificados: 0,
    erros: 0,
  };

  const hojeStr = new Date().toISOString().slice(0, 10);

  // 1. Busca AGOs ativas com inscrições abertas e data de início futura ou atual
  const { data: agos, error: errAgos } = await supabase
    .from('eventos')
    .select('id, nome, slug, data_inicio, data_fim, local, cidade, inscricoes_abertas, status')
    .eq('departamento', 'AGO')
    .in('status', ['programado', 'aberto'])
    .eq('inscricoes_abertas', true)
    .gte('data_inicio', hojeStr);

  if (errAgos) {
    console.error('[job/convocacoes-ago] Erro ao buscar AGOs ativas:', errAgos.message);
    resumo.erros++;
    return resumo;
  }

  if (!agos || agos.length === 0) {
    return resumo;
  }

  resumo.totalAgosEncontradas = agos.length;

  // 2. Itera sobre cada AGO ativa encontrada
  for (const ago of agos) {
    if (resumo.notificacoesCriadas >= LIMITE_POR_EXECUCAO) {
      break;
    }

    const tituloConvocacao = `Convocação Oficial: ${ago.nome}`;
    const dataInicioFmt = fmtDataBr(ago.data_inicio);
    const dataFimFmt = ago.data_fim ? fmtDataBr(ago.data_fim) : dataInicioFmt;
    const periodoStr = dataInicioFmt === dataFimFmt ? dataInicioFmt : `de ${dataInicioFmt} a ${dataFimFmt}`;
    const localStr = ago.cidade ? `${ago.local ? `${ago.local} - ` : ''}${ago.cidade}` : (ago.local || 'Local a definir');

    const mensagemConvocacao = `Você está oficialmente convocado para a ${ago.nome}, que será realizada ${periodoStr} em ${localStr}. Acesse a área de Meus Eventos no Portal do Ministro para realizar sua inscrição estatutária, credenciamento e acompanhamento de alojamento.`;

    // 3. Recupera o conjunto de ministros que JÁ receberam a notificação desta AGO específica
    const { data: notificados, error: errNotif } = await supabase
      .from('ministro_portal_notificacoes')
      .select('ministro_id')
      .eq('tipo', 'evento')
      .eq('titulo', tituloConvocacao);

    if (errNotif) {
      console.error(`[job/convocacoes-ago] Erro ao consultar ministros já notificados para ${ago.nome}:`, errNotif.message);
      resumo.erros++;
      continue;
    }

    const idsJaNotificados = new Set<string>((notificados || []).map((n: any) => n.ministro_id));
    resumo.jaNotificados += idsJaNotificados.size;

    let page = 0;
    let hasMore = true;

    // 4. Varre os ministros ativos em blocos e processa incrementalmente até atingir o LIMITE_POR_EXECUCAO
    while (hasMore && resumo.notificacoesCriadas < LIMITE_POR_EXECUCAO) {
      const from = page * SCAN_CHUNK_SIZE;
      const to = from + SCAN_CHUNK_SIZE - 1;

      const { data: ministros, error: errM } = await supabase
        .from('members')
        .select('id, name')
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(from, to);

      if (errM) {
        console.error(`[job/convocacoes-ago] Erro ao buscar lote ${page} de ministros:`, errM.message);
        resumo.erros++;
        break;
      }

      if (!ministros || ministros.length === 0) {
        hasMore = false;
        break;
      }

      resumo.ministrosAvaliados += ministros.length;

      // Filtra apenas ministros que ainda não receberam a convocação desta AGO
      const pendentes = ministros.filter((m: any) => !idsJaNotificados.has(m.id));

      for (const m of pendentes) {
        if (resumo.notificacoesCriadas >= LIMITE_POR_EXECUCAO) {
          hasMore = false;
          break;
        }

        try {
          const res = await criarNotificacaoMinistro({
            ministroId: m.id,
            tipo: 'evento',
            titulo: tituloConvocacao,
            mensagem: mensagemConvocacao,
            linkAcao: '/portal-ministro/eventos',
            canal: 'ambos',
          });

          if (res.sucesso) {
            resumo.notificacoesCriadas++;
            idsJaNotificados.add(m.id);
          } else {
            resumo.erros++;
          }
        } catch (mErr: any) {
          console.error(`[job/convocacoes-ago] Erro ao notificar ministro (${m.id}) para ${ago.nome}:`, mErr?.message);
          resumo.erros++;
        }
      }

      if (ministros.length < SCAN_CHUNK_SIZE) {
        hasMore = false;
      }

      page++;
    }
  }

  return resumo;
}
