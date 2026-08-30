/**
 * Job de Processamento Assíncrono de Comunicados Oficiais.
 * Identifica comunicados cadastrados e distribui notificações de forma incremental
 * para ministros elegíveis com base na segmentação (todos, pastores presidentes, supervisão, campo ou cargo).
 * Utiliza idempotência estrita baseada na chave relacional: ministro_id + comunicado_id.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { criarNotificacaoMinistro, CanalNotificacaoMinistro } from '@/lib/notificacoes-ministro';

export interface ResumoProcessamentoComunicados {
  totalComunicadosAvaliados: number;
  ministrosAvaliados: number;
  notificacoesCriadas: number;
  jaNotificados: number;
  erros: number;
}

const LIMITE_POR_EXECUCAO = 100;
const SCAN_CHUNK_SIZE = 200;

export async function processarComunicados(
  supabase: SupabaseClient,
): Promise<ResumoProcessamentoComunicados> {
  const resumo: ResumoProcessamentoComunicados = {
    totalComunicadosAvaliados: 0,
    ministrosAvaliados: 0,
    notificacoesCriadas: 0,
    jaNotificados: 0,
    erros: 0,
  };

  // 1. Busca comunicados ordenados do mais recente para o mais antigo
  const { data: comunicados, error: errC } = await supabase
    .from('comunicados')
    .select('id, titulo, mensagem, link_acao, canal, publico_tipo, supervisao_id, campo_id, cargo_alvo, total_alvos, enviado_em')
    .order('enviado_em', { ascending: false })
    .limit(20);

  if (errC) {
    console.error('[job/processar-comunicados] Erro ao buscar comunicados:', errC.message);
    resumo.erros++;
    return resumo;
  }

  if (!comunicados || comunicados.length === 0) {
    return resumo;
  }

  resumo.totalComunicadosAvaliados = comunicados.length;

  for (const c of comunicados) {
    if (resumo.notificacoesCriadas >= LIMITE_POR_EXECUCAO) {
      break;
    }

    // 2. Idempotência Relacional: busca ministros que JÁ receberam ESTE comunicado específico pelo seu ID
    const { data: notificados, error: errN } = await supabase
      .from('ministro_portal_notificacoes')
      .select('ministro_id')
      .eq('tipo', 'comunicado')
      .eq('comunicado_id', c.id);

    if (errN) {
      console.error(`[job/processar-comunicados] Erro ao consultar já notificados para comunicado ${c.id}:`, errN.message);
      resumo.erros++;
      continue;
    }

    const idsJaNotificados = new Set<string>((notificados || []).map((n: any) => n.ministro_id));
    resumo.jaNotificados += idsJaNotificados.size;

    let page = 0;
    let hasMore = true;
    let novosNotificadosNesteComunicado = 0;

    // 3. Monta query base com filtros de segmentação de público
    while (hasMore && resumo.notificacoesCriadas < LIMITE_POR_EXECUCAO) {
      const from = page * SCAN_CHUNK_SIZE;
      const to = from + SCAN_CHUNK_SIZE - 1;

      let query = supabase
        .from('members')
        .select('id, name, status, pastor_presidente, supervisao_id, campo_id, cargo_ministerial, custom_fields')
        .eq('status', 'active')
        .order('id', { ascending: true })
        .range(from, to);

      if (c.publico_tipo === 'pastores_presidentes') {
        query = query.eq('pastor_presidente', true);
      } else if (c.publico_tipo === 'supervisao' && c.supervisao_id) {
        query = query.eq('supervisao_id', c.supervisao_id);
      } else if (c.publico_tipo === 'campo' && c.campo_id) {
        query = query.eq('campo_id', c.campo_id);
      } else if (c.publico_tipo === 'cargo' && c.cargo_alvo) {
        query = query.eq('cargo_ministerial', c.cargo_alvo);
      }

      const { data: ministros, error: errM } = await query;

      if (errM) {
        console.error(`[job/processar-comunicados] Erro ao buscar página ${page} de ministros:`, errM.message);
        resumo.erros++;
        break;
      }

      if (!ministros || ministros.length === 0) {
        hasMore = false;
        break;
      }

      resumo.ministrosAvaliados += ministros.length;

      // Filtra apenas os ministros elegíveis que ainda não foram notificados deste comunicado específico
      const pendentes = ministros.filter((m: any) => !idsJaNotificados.has(m.id));

      for (const m of pendentes) {
        if (resumo.notificacoesCriadas >= LIMITE_POR_EXECUCAO) {
          hasMore = false;
          break;
        }

        try {
          const res = await criarNotificacaoMinistro({
            ministroId: m.id,
            comunicadoId: c.id,
            tipo: 'comunicado',
            titulo: c.titulo,
            mensagem: c.mensagem,
            linkAcao: c.link_acao,
            canal: (c.canal as CanalNotificacaoMinistro) || 'in_app',
          });

          if (res.sucesso) {
            resumo.notificacoesCriadas++;
            novosNotificadosNesteComunicado++;
            idsJaNotificados.add(m.id);
          } else {
            resumo.erros++;
          }
        } catch (mErr: any) {
          console.error(`[job/processar-comunicados] Erro ao notificar ministro ${m.id} no comunicado ${c.id}:`, mErr?.message);
          resumo.erros++;
        }
      }

      if (ministros.length < SCAN_CHUNK_SIZE) {
        hasMore = false;
      }

      page++;
    }

    // 4. Atualiza o contador total_alvos no comunicado com a contagem real de destinatários
    if (novosNotificadosNesteComunicado > 0 || c.total_alvos !== idsJaNotificados.size) {
      await supabase
        .from('comunicados')
        .update({ total_alvos: idsJaNotificados.size })
        .eq('id', c.id);
    }
  }

  return resumo;
}
