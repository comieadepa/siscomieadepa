import { NextRequest, NextResponse } from 'next/server';
import { requireEventoPermission } from '@/lib/evento-guard';

export const dynamic = 'force-dynamic';



function cleanCpf(cpf: string | null | undefined): string {
  return String(cpf ?? '').replace(/\D/g, '');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> }
) {
  const { eventoId } = await params;
  const guard = await requireEventoPermission(request, eventoId, 'relatorios_ago');
  if (!guard.ok) return guard.response;

  const supabase = guard.ctx.supabaseAdmin;

  try {
    // 1. Busca dados do evento
    const { data: evento, error: evErr } = await supabase
      .from('eventos')
      .select('id, configuracoes_ago')
      .eq('id', eventoId)
      .single();

    if (evErr || !evento) {
      return NextResponse.json({ error: 'Evento não encontrado.' }, { status: 404 });
    }

    // Função auxiliar para carregar todos os registros paginados
    const loadPaged = async <T>(
      fetchFn: (from: number, to: number) => Promise<{ data: T[] | null; error: any }>
    ): Promise<T[]> => {
      let allData: T[] = [];
      let from = 0;
      const size = 1000;
      while (true) {
        const to = from + size - 1;
        const { data, error } = await fetchFn(from, to);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData = allData.concat(data);
        if (data.length < size) break;
        from += size;
      }
      return allData;
    };

    // 2. Busca todos os ministros ativos da Convenção (paginado)
    const members = await loadPaged(async (from, to) => {
      return supabase
        .from('members')
        .select('id, name, cpf, matricula, cargo_ministerial, status')
        .in('status', ['active', 'ativo'])
        .range(from, to);
    });

    // 3. Busca inscrições ativas no evento (paginado)
    const inscricoes = await loadPaged(async (from, to) => {
      return supabase
        .from('evento_inscricoes')
        .select('id, nome_inscrito, cpf, ministro_id, tipo_inscricao, status_pagamento')
        .eq('evento_id', eventoId)
        .neq('status_pagamento', 'cancelado')
        .range(from, to);
    });

    // 4. Busca todos os check-ins de plenária para este evento (paginado)
    const checkins = await loadPaged(async (from, to) => {
      return supabase
        .from('evento_checkins')
        .select('inscricao_id, data_plenaria, tipo_checkin')
        .eq('evento_id', eventoId)
        .eq('tipo_checkin', 'plenaria')
        .not('data_plenaria', 'is', null)
        .range(from, to);
    });

    // 5. Configurar datas das plenárias (Com fallback dinâmico das presenças se vazio)
    const cfg = (evento.configuracoes_ago ?? {}) as Record<string, unknown>;
    const configPlenarias = Array.isArray(cfg.plenarias_datas) ? (cfg.plenarias_datas as string[]) : [];

    let plenariasDatas = configPlenarias;
    if (plenariasDatas.length === 0) {
      const datasUnicas = new Set<string>();
      for (const ck of checkins) {
        if (ck.data_plenaria) datasUnicas.add(ck.data_plenaria);
      }
      plenariasDatas = Array.from(datasUnicas).sort();
    }
    const totalPlenarias = plenariasDatas.length;

    // 6. Indexar inscrições por ministro_id e por CPF limpo
    const inscByMinistroId = new Map<string, any>();
    const inscByCpf = new Map<string, any>();

    for (const ins of inscricoes) {
      if (ins.ministro_id) {
        inscByMinistroId.set(ins.ministro_id, ins);
      }
      const c = cleanCpf(ins.cpf);
      if (c) {
        inscByCpf.set(c, ins);
      }
    }

    // 7. Indexar check-ins por inscricao_id
    const presencasPorInscricao = new Map<string, Set<string>>();
    for (const ck of checkins) {
      if (!ck.inscricao_id || !ck.data_plenaria) continue;
      if (!presencasPorInscricao.has(ck.inscricao_id)) {
        presencasPorInscricao.set(ck.inscricao_id, new Set());
      }
      presencasPorInscricao.get(ck.inscricao_id)!.add(ck.data_plenaria);
    }

    // 8. Cruzamento e Consolidação dos Ministros
    const resultado = members.map(m => {
      // Cruzamento principal por ministro_id, fallback por CPF limpo
      let ins = inscByMinistroId.get(m.id);
      if (!ins) {
        const cpfLimpo = cleanCpf(m.cpf);
        if (cpfLimpo) {
          ins = inscByCpf.get(cpfLimpo);
        }
      }

      const estaInscrito = !!ins;
      const inscricaoId = ins?.id ?? null;
      
      const diasPresentesSet = ins ? (presencasPorInscricao.get(ins.id) ?? new Set<string>()) : new Set<string>();
      const diasPresentes = diasPresentesSet.size;
      const possuiCheckinPlenaria = diasPresentes > 0;
      const diasAusentes = Math.max(0, totalPlenarias - diasPresentes);

      const percentualPresenca = totalPlenarias > 0
        ? Math.round((diasPresentes / totalPlenarias) * 100)
        : null;

      // Classificação do status de frequência
      let statusFrequencia = 'NAO_INSCRITO';
      if (estaInscrito) {
        if (!possuiCheckinPlenaria) {
          statusFrequencia = 'INSCRITO_SEM_CHECKIN';
        } else if (percentualPresenca !== null) {
          if (percentualPresenca >= 75) {
            statusFrequencia = 'REGULAR';
          } else if (percentualPresenca >= 50) {
            statusFrequencia = 'CINQUENTA_POR_CENTO';
          } else {
            statusFrequencia = 'FALTOSO';
          }
        }
      }

      // Detalhar a presença dia a dia
      const diasDetalhes = plenariasDatas.map((data, index) => {
        const presente = diasPresentesSet.has(data);
        return {
          dia: index + 1,
          data,
          presente,
        };
      });

      return {
        ministro_id: m.id,
        nome: m.name,
        cpf: m.cpf,
        matricula: m.matricula,
        cargo_ministerial: m.cargo_ministerial,
        esta_inscrito: estaInscrito,
        inscricao_id: inscricaoId,
        possui_checkin_plenaria: possuiCheckinPlenaria,
        dias_presentes: diasPresentes,
        dias_ausentes: diasAusentes,
        percentual_presenca: percentualPresenca,
        status_frequencia: statusFrequencia,
        dias_detalhes: diasDetalhes,
      };
    });

    // Ordenar por nome por padrão
    resultado.sort((a, b) => String(a.nome).localeCompare(String(b.nome)));

    return NextResponse.json({
      evento_id: eventoId,
      total_ministros: members.length,
      plenarias_datas: plenariasDatas,
      ministros: resultado,
    });

  } catch (error: any) {
    console.error('Erro na API de preview de frequência:', error);
    return NextResponse.json({ error: error?.message || 'Erro interno do servidor.' }, { status: 500 });
  }
}
