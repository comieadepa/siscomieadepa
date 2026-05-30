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
    const camasSuperiores = Math.max(0, s.quantidade_leitos - s.quantidade_leitos_inferiores);

    const existingId = existingMap.get(s.id);

    if (existingId) {
      // Atualiza campos de capacidade/configuração sem tocar hospedagens associadas
      const { error } = await supabase
        .from('evento_alojamentos')
        .update({
          nome:              s.nome.toUpperCase(),
          publico,
          sexo,
          total_vagas:       s.quantidade_leitos,
          camas_inferiores:  s.quantidade_leitos_inferiores,
          camas_superiores:  camasSuperiores,
          grupo_permitido:   s.grupo,
          tipos_leito:       s.tipos_leito,
          leitos_inferiores: s.quantidade_leitos_inferiores,
          ativo:             s.ativo,
        })
        .eq('id', existingId);
      if (!error) atualizados++;
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
          total_vagas:       s.quantidade_leitos,
          camas_inferiores:  s.quantidade_leitos_inferiores,
          camas_superiores:  camasSuperiores,
          grupo_permitido:   s.grupo,
          tipos_leito:       s.tipos_leito,
          leitos_inferiores: s.quantidade_leitos_inferiores,
          ativo:             s.ativo,
          origem:            'configuracoes_ago',
        });
      if (!error) criados++;
    }
  }

  return { criados, atualizados };
}
