/**
 * Materializa setores planejados (configuracoes_ago.setores) em evento_alojamentos.
 *
 * Idempotente: usa setor_key (= setor.id do JSON) como chave estável.
 * - Setores novos → INSERT
 * - Setores existentes → UPDATE (nunca apaga hospedagens associadas)
 * - Alojamentos manuais (setor_key IS NULL) → não são tocados
 */

import { SupabaseClient } from '@supabase/supabase-js';

interface SetorAgo {
  id: string;
  nome: string;
  grupo: string;
  tipos_leito: string[];
  quantidade_leitos: number;
  quantidade_leitos_inferiores: number;
  quantidade_leitos_superiores?: number;
  quantidade_colchonetes?: number;
  observacoes?: string;
  ativo: boolean;
}

type Publico = 'feminino' | 'presidentes' | 'jubilados' | 'masculino_geral' | 'misto';

function grupoToPublico(grupo: string): Publico {
  const g = grupo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (g.includes('mulher') || g.includes('feminino')) return 'feminino';
  if (g.includes('presidente') && g.includes('jubilad')) return 'jubilados';
  if (g.includes('presidente')) return 'presidentes';
  if (g.includes('jubilad')) return 'jubilados';
  if (g.includes('auxiliar') || g.includes('juventude') || g.includes('masculino')) return 'masculino_geral';
  return 'misto';
}

function publicoToSexo(publico: Publico): 'M' | 'F' | null {
  if (publico === 'feminino') return 'F';
  if (publico === 'misto') return null;
  return 'M';
}

export interface ResultadoMaterializacao {
  criados: number;
  atualizados: number;
  erro?: string;
}

export async function materializarSetoresHospedagemAGO(
  supabase: SupabaseClient,
  eventoId: string,
): Promise<ResultadoMaterializacao> {
  // 1. Lê configuracoes_ago do evento
  const { data: evento, error: errEvento } = await supabase
    .from('eventos')
    .select('configuracoes_ago')
    .eq('id', eventoId)
    .single();

  if (errEvento || !evento) {
    return { criados: 0, atualizados: 0, erro: errEvento?.message ?? 'Evento não encontrado' };
  }

  const cfg = evento.configuracoes_ago as Record<string, unknown> | null;
  const setores = (cfg?.setores as SetorAgo[] | undefined) ?? [];

  if (setores.length === 0) {
    return { criados: 0, atualizados: 0 };
  }

  // 2. Busca alojamentos com setor_key já presentes para distinguir create vs update
  const { data: existentes } = await supabase
    .from('evento_alojamentos')
    .select('id, setor_key')
    .eq('evento_id', eventoId)
    .not('setor_key', 'is', null) as unknown as {
      data: Array<{ id: string; setor_key: string }> | null;
    };

  const existingMap = new Map((existentes ?? []).map(a => [a.setor_key, a.id]));

  // 3. Upsert individual para cada setor
  let criados = 0;
  let atualizados = 0;

  for (const s of setores) {
    const publico = grupoToPublico(s.grupo);
    const sexo = publicoToSexo(publico);
    
    // Cálculo seguro de colchonetes e camas superiores:
    // 1. Se quantidade_colchonetes estiver explícito, usa diretamente.
    // 2. Caso contrário, tenta extrair de observações legadas (ex: "48 Leitos são colchonetes").
    let colchonetes = s.quantidade_colchonetes ?? 0;
    if (s.quantidade_colchonetes === undefined && s.observacoes) {
      const matchCol = s.observacoes.match(/(\d+)\s*(?:leitos são colchonetes|colchonetes)/i);
      if (matchCol) {
        colchonetes = parseInt(matchCol[1], 10) || 0;
      }
    }

    // Camas superiores:
    // Se fornecido explicitamente, usa. Caso contrário:
    // Se beliche: para beliches completos onde há inferiores, superiores = inferiores
    // garantindo que total_vagas = inferiores + superiores + colchonetes
    const temBeliche = (s.tipos_leito || []).includes('beliche');
    let camasSuperiores: number;
    if (s.quantidade_leitos_superiores !== undefined) {
      camasSuperiores = s.quantidade_leitos_superiores;
    } else if (temBeliche && s.quantidade_leitos_inferiores > 0) {
      // Se tiver colchonetes identificados, superiores = total - inferiores - colchonetes
      const resto = s.quantidade_leitos - s.quantidade_leitos_inferiores - colchonetes;
      camasSuperiores = Math.max(0, resto);
    } else {
      camasSuperiores = 0;
    }

    const camasInferiores = s.quantidade_leitos_inferiores ?? 0;
    const totalVagas = s.quantidade_leitos;

    const existingId = existingMap.get(s.id);

    if (existingId) {
      // 1. Verificar ocupação real antes de permitir alteração de capacidades (Regra 5)
      const { data: leitosOcupados } = await supabase
        .from('evento_hospedagem_leitos')
        .select('posicao')
        .eq('alojamento_id', existingId)
        .eq('ocupado', true)
        .not('inscricao_id', 'is', null);

      const { data: hospOcupadas } = await supabase
        .from('evento_hospedagens')
        .select('tipo_cama')
        .eq('alojamento_id', existingId)
        .in('status', ['alocada', 'confirmada', 'checkin_realizado']);

      let totalOcupados = 0;
      let inferioresOcupadas = 0;
      let superioresOcupadas = 0;

      if ((leitosOcupados ?? []).length > 0) {
        totalOcupados = leitosOcupados!.length;
        for (const l of leitosOcupados!) {
          if (l.posicao === 'inferior') inferioresOcupadas++;
          if (l.posicao === 'superior') superioresOcupadas++;
        }
      } else if ((hospOcupadas ?? []).length > 0) {
        totalOcupados = hospOcupadas!.length;
        for (const h of hospOcupadas!) {
          if (h.tipo_cama === 'inferior') inferioresOcupadas++;
          if (h.tipo_cama === 'superior') superioresOcupadas++;
        }
      }

      if (totalVagas < totalOcupados) {
        return {
          criados: 0,
          atualizados: 0,
          erro: `Não é possível reduzir a capacidade do setor "${s.nome}" para ${totalVagas} vagas, pois existem ${totalOcupados} participantes alocados nele.`,
        };
      }

      if (camasInferiores < inferioresOcupadas) {
        return {
          criados: 0,
          atualizados: 0,
          erro: `Não é possível reduzir as camas inferiores do setor "${s.nome}" para ${camasInferiores}, pois existem ${inferioresOcupadas} camas inferiores ocupadas.`,
        };
      }

      // Validação resiliente para leitos superiores: permite se a capacidade de superiores + colchonetes comportar a ocupação não-inferior
      if (camasSuperiores < superioresOcupadas && (camasSuperiores + colchonetes) < superioresOcupadas) {
        return {
          criados: 0,
          atualizados: 0,
          erro: `Não é possível reduzir as camas superiores do setor "${s.nome}" para ${camasSuperiores}, pois existem ${superioresOcupadas} camas superiores ocupadas.`,
        };
      }

      if (!s.ativo && totalOcupados > 0) {
        return {
          criados: 0,
          atualizados: 0,
          erro: `Não é possível desativar o setor "${s.nome}" pois existem ${totalOcupados} participantes alocados nele. Realoque os participantes antes de desativar.`,
        };
      }

      // Atualiza campos de capacidade/configuração sem tocar hospedagens associadas
      const { error } = await supabase
        .from('evento_alojamentos')
        .update({
          nome:              s.nome.toUpperCase(),
          publico,
          sexo,
          total_vagas:       totalVagas,
          camas_inferiores:  camasInferiores,
          camas_superiores:  camasSuperiores,
          colchonetes:       colchonetes,
          grupo_permitido:   s.grupo,
          tipos_leito:       s.tipos_leito,
          leitos_inferiores: camasInferiores,
          ativo:             s.ativo,
          origem:            'configuracoes_ago',
        })
        .eq('id', existingId);

      if (error) {
        return { criados, atualizados, erro: error.message };
      }
      atualizados++;
    } else {
      // Cria novo alojamento materializado a partir do setor planejado
      const { error } = await supabase
        .from('evento_alojamentos')
        .insert({
          evento_id:         eventoId,
          setor_key:         s.id,
          nome:              s.nome.toUpperCase(),
          publico,
          sexo,
          total_vagas:       totalVagas,
          camas_inferiores:  camasInferiores,
          camas_superiores:  camasSuperiores,
          colchonetes:       colchonetes,
          grupo_permitido:   s.grupo,
          tipos_leito:       s.tipos_leito,
          leitos_inferiores: camasInferiores,
          ativo:             s.ativo,
          origem:            'configuracoes_ago',
        });
      if (!error) criados++;
    }
  }

  return { criados, atualizados };
}

/**
 * Salva configuracoes_ago e materializa setores de forma estritamente atômica.
 * Executa exclusivamente via RPC PostgreSQL salvar_configuracoes_ago_atomica.
 * Em caso de falha ou ausência da RPC, aborta imediatamente sem persistência parcial.
 */
export async function salvarConfiguracoesAGOAtomica(
  supabase: SupabaseClient,
  eventoId: string,
  novaConfiguracaoAgo: Record<string, unknown>,
): Promise<ResultadoMaterializacao> {
  const { data: rpcData, error: rpcError } = await supabase.rpc('salvar_configuracoes_ago_atomica', {
    p_evento_id: eventoId,
    p_configuracoes_ago: novaConfiguracaoAgo,
  });

  if (rpcError) {
    return {
      criados: 0,
      atualizados: 0,
      erro: `Falha na transação atômica de configuração AGO: ${rpcError.message}`,
    };
  }

  const res = rpcData as { sucesso?: boolean; criados?: number; atualizados?: number; erro?: string } | null;
  if (res?.erro) {
    return { criados: 0, atualizados: 0, erro: res.erro };
  }

  return {
    criados: res?.criados ?? 0,
    atualizados: res?.atualizados ?? 0,
  };
}
