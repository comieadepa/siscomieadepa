const dotenv = require('dotenv');
dotenv.config({ path: '.env.local', quiet: true });

const { createClient } = require('@supabase/supabase-js');

const EVENTO_ID = '8940f4e1-f00b-4115-a4f5-0e912332174c';
const APP_URL = process.env.CARGA_APP_URL || 'http://localhost:3001';
const PREFIX = `[CARGA_AGO_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}]`;
const TOTAL = 100;

function norm(v) {
  return (v || '')
    .toString()
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function resolveGrupo({ sexo, tipo_inscricao }) {
  const tipo = norm(tipo_inscricao);
  const sx = (sexo || '').toString().toUpperCase();
  const ehEsposaOuViuva = tipo.includes('esposa') || tipo.includes('viuva');
  if (sx === 'F' || ehEsposaOuViuva) return 'Mulheres';
  if (tipo.includes('presidente') || tipo.includes('jubilado')) return 'Pastor Presidente / Pastor Jubilado';
  const ehJuventudeMasculina = sx === 'M' && (tipo.includes('juventude') || tipo.includes('jovem') || tipo.includes('jovens') || tipo.includes('umadepa'));
  if (ehJuventudeMasculina || tipo.includes('auxiliar') || tipo.includes('juventude') || sx === 'M') {
    return 'Pastor Auxiliar / Juventude';
  }
  return 'Misto';
}

function isPagamentoElegivel(status) {
  const s = norm(status);
  return s === 'pago' || s === 'isento';
}

function resolveStatusOperacional({ status, status_pagamento, alojamento_id, tipo_cama, numero_cama }) {
  const st = norm(status);
  if (st === 'checkin_realizado' || st === 'checkout_realizado') return 'checkin_realizado';
  if (st === 'confirmada') return 'confirmada';
  if (st === 'lista_espera') return 'lista_espera';
  if (!isPagamentoElegivel(status_pagamento)) return 'aguardando_pagamento';
  if (alojamento_id && tipo_cama && numero_cama) return 'alocada';
  return 'elegivel';
}

function calcularIdade(iso) {
  if (!iso) return null;
  const nasc = new Date(iso);
  if (Number.isNaN(nasc.getTime())) return null;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const m = hoje.getMonth() - nasc.getMonth();
  if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--;
  return idade;
}

function genCpfBase9(seed) {
  const out = [];
  let n = seed;
  for (let i = 0; i < 9; i++) {
    n = (n * 9301 + 49297) % 233280;
    out.push(n % 10);
  }
  return out;
}

function calcDv(nums) {
  const soma1 = nums.reduce((acc, d, i) => acc + d * (10 - i), 0);
  let dv1 = (soma1 * 10) % 11;
  if (dv1 === 10) dv1 = 0;
  const soma2 = [...nums, dv1].reduce((acc, d, i) => acc + d * (11 - i), 0);
  let dv2 = (soma2 * 10) % 11;
  if (dv2 === 10) dv2 = 0;
  return [dv1, dv2];
}

function gerarCpf(seed) {
  const b9 = genCpfBase9(seed);
  const [d1, d2] = calcDv(b9);
  return [...b9, d1, d2].join('');
}

function makeBirth(years) {
  const y = new Date().getFullYear() - years;
  return `${y}-06-15`;
}

function montarMassa() {
  const rows = [];
  const pushMany = (count, cfgFactory) => {
    for (let i = 0; i < count; i++) rows.push(cfgFactory(i));
  };

  pushMany(20, (i) => ({ sexo: 'M', tipo_inscricao: 'JUVENTUDE COMIEADEPA', idade: 22 + (i % 6), tag: 'homem_jovem' }));
  pushMany(20, (i) => ({ sexo: 'F', tipo_inscricao: 'JUVENTUDE COMIEADEPA', idade: 20 + (i % 8), tag: 'mulher_jovem' }));
  pushMany(10, () => ({ sexo: 'M', tipo_inscricao: 'PASTOR PRESIDENTE', idade: 45, tag: 'presidente' }));
  pushMany(10, () => ({ sexo: 'M', tipo_inscricao: 'PASTOR AUXILIAR', idade: 40, tag: 'auxiliar' }));
  pushMany(5, () => ({ sexo: 'M', tipo_inscricao: 'PASTOR JUBILADO', idade: 68, tag: 'jubilado' }));
  pushMany(5, (i) => ({ sexo: i % 2 === 0 ? 'M' : 'F', tipo_inscricao: i % 2 === 0 ? 'PASTOR AUXILIAR' : 'JUVENTUDE COMIEADEPA', idade: 63 + (i % 5), tag: 'idade_60_plus' }));
  pushMany(5, (i) => ({ sexo: i % 2 === 0 ? 'M' : 'F', tipo_inscricao: i % 2 === 0 ? 'PASTOR AUXILIAR' : 'JUVENTUDE COMIEADEPA', idade: 35, necessidade: true, tag: 'necessidade_especial' }));
  pushMany(5, (i) => ({ sexo: i % 2 === 0 ? 'M' : 'F', tipo_inscricao: i % 2 === 0 ? 'PASTOR AUXILIAR' : 'JUVENTUDE COMIEADEPA', idade: 37, comorbidade: true, tag: 'comorbidade' }));
  pushMany(10, (i) => ({ sexo: 'F', tipo_inscricao: i % 2 === 0 ? 'ESPOSA DE PASTOR' : 'VIUVA', idade: 42, tag: 'esposa_viuva' }));
  pushMany(10, (i) => ({ sexo: i % 2 === 0 ? 'M' : 'F', tipo_inscricao: i % 2 === 0 ? 'PASTOR AUXILIAR' : 'JUVENTUDE COMIEADEPA', idade: 30 + (i % 10), tag: 'extra' }));

  if (rows.length !== TOTAL) throw new Error(`Massa inválida: esperado ${TOTAL}, gerado ${rows.length}`);
  return rows.map((r, i) => ({ ...r, status_pagamento: i < 20 ? 'pendente' : i < 90 ? 'pago' : 'isento' }));
}

async function main() {
  const started = Date.now();
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: ref, error: errRef } = await sb
    .from('evento_inscricoes')
    .select('supervisao_id,campo_id')
    .eq('evento_id', EVENTO_ID)
    .not('supervisao_id', 'is', null)
    .not('campo_id', 'is', null)
    .limit(1)
    .maybeSingle();
  if (errRef || !ref) throw new Error(`Sem supervisao/campo de referência: ${errRef?.message || 'n/a'}`);

  const { data: oldRows } = await sb
    .from('evento_inscricoes')
    .select('id')
    .eq('evento_id', EVENTO_ID)
    .ilike('nome_inscrito', `${PREFIX}%`);
  const oldIds = (oldRows || []).map((r) => r.id);
  if (oldIds.length > 0) {
    await sb.from('evento_hospedagem_leitos').delete().eq('evento_id', EVENTO_ID).in('inscricao_id', oldIds);
    await sb.from('evento_hospedagens').delete().eq('evento_id', EVENTO_ID).in('inscricao_id', oldIds);
    await sb.from('evento_inscricoes').delete().eq('evento_id', EVENTO_ID).in('id', oldIds);
  }

  const base = montarMassa();
  const nowSeed = Date.now();
  const inserts = base.map((p, i) => {
    const id = crypto.randomUUID();
    const cpf = gerarCpf(100000 + i + (nowSeed % 1000));
    const data_nascimento = makeBirth(p.idade);
    const grupo = resolveGrupo({ sexo: p.sexo, tipo_inscricao: p.tipo_inscricao });
    const camaPrioritaria = (p.idade >= 60) || !!p.necessidade || !!p.comorbidade;

    return {
      id,
      evento_id: EVENTO_ID,
      nome_inscrito: `${PREFIX} ${String(i + 1).padStart(3, '0')} ${p.tag.toUpperCase()}`,
      cpf,
      sexo: p.sexo,
      data_nascimento,
      tipo_inscricao: p.tipo_inscricao,
      supervisao_id: ref.supervisao_id,
      campo_id: ref.campo_id,
      hospedagem: true,
      status_pagamento: p.status_pagamento,
      hosp_necessidade_especial: !!p.necessidade,
      hosp_descricao_necessidade: p.necessidade ? 'TESTE_CARGA_NECESSIDADE' : null,
      hosp_possui_comorbidade: !!p.comorbidade,
      hosp_descricao_comorbidade: p.comorbidade ? 'TESTE_CARGA_COMORBIDADE' : null,
      hosp_cama_inferior: camaPrioritaria,
      hosp_observacoes: 'TESTE_CARGA_CONTROLADA_AGO',
      grupo_hospedagem: grupo,
      qr_code: `CARGA-${nowSeed}-${i + 1}`,
      lgpd_aceito: true,
      lgpd_aceito_em: new Date().toISOString(),
      valor_original: 0,
      valor_final: 0,
      valor_pago: 0,
      forma_pagamento: isPagamentoElegivel(p.status_pagamento) ? 'pix' : null,
      alimentacao: false,
      brinde: false,
    };
  });

  const { error: insErr } = await sb.from('evento_inscricoes').insert(inserts);
  if (insErr) throw new Error(`Falha inserindo massa: ${insErr.message}`);

  const ids = inserts.map((r) => r.id);

  const loadSnapshot = async () => {
    const [{ data: insc, error: e1 }, { data: hosp, error: e2 }, { data: aloj, error: e3 }] = await Promise.all([
      sb
        .from('evento_inscricoes')
        .select('id,nome_inscrito,sexo,data_nascimento,tipo_inscricao,status_pagamento,grupo_hospedagem,hosp_cama_inferior,hosp_necessidade_especial,hosp_possui_comorbidade')
        .eq('evento_id', EVENTO_ID)
        .in('id', ids),
      sb
        .from('evento_hospedagens')
        .select('inscricao_id,status,alojamento_id,tipo_cama,numero_cama,grupo_hospedagem,observacoes,evento_alojamentos(id,nome,publico,total_vagas)')
        .eq('evento_id', EVENTO_ID)
        .in('inscricao_id', ids),
      sb
        .from('evento_alojamentos')
        .select('id,total_vagas,ativo')
        .eq('evento_id', EVENTO_ID)
        .eq('ativo', true),
    ]);

    if (e1) throw new Error(e1.message);
    if (e2) throw new Error(e2.message);
    if (e3) throw new Error(e3.message);

    const hospMap = new Map((hosp || []).map((h) => [h.inscricao_id, h]));

    const merged = (insc || []).map((i) => {
      const h = hospMap.get(i.id) || null;
      const grupo = h?.grupo_hospedagem || i.grupo_hospedagem || null;
      const status_operacional = resolveStatusOperacional({
        status: h?.status || 'solicitada',
        status_pagamento: i.status_pagamento,
        alojamento_id: h?.alojamento_id || null,
        tipo_cama: h?.tipo_cama || null,
        numero_cama: h?.numero_cama || null,
      });
      return {
        ...i,
        ...h,
        grupo,
        status_operacional,
        idade: calcularIdade(i.data_nascimento),
      };
    });

    const ocupadosPorAloj = new Map();
    for (const r of merged) {
      if (!r.alojamento_id) continue;
      if (!['alocada', 'confirmada', 'checkin_realizado'].includes(norm(r.status))) continue;
      ocupadosPorAloj.set(r.alojamento_id, (ocupadosPorAloj.get(r.alojamento_id) || 0) + 1);
    }

    let vagasLivres = 0;
    for (const a of (aloj || [])) {
      const ocup = ocupadosPorAloj.get(a.id) || 0;
      vagasLivres += Math.max(0, Number(a.total_vagas || 0) - ocup);
    }

    return {
      merged,
      resumo: {
        solicitacoes_totais: merged.length,
        aguardando_pagamento: merged.filter((r) => r.status_operacional === 'aguardando_pagamento').length,
        elegiveis: merged.filter((r) => r.status_operacional === 'elegivel').length,
        ja_alocados: merged.filter((r) => ['alocada', 'confirmada', 'checkin_realizado'].includes(r.status_operacional)).length,
        lista_espera: merged.filter((r) => r.status_operacional === 'lista_espera').length,
        vagas_livres: vagasLivres,
        prioridades_leito_inferior: merged.filter((r) => r.hosp_cama_inferior || r.hosp_necessidade_especial || r.hosp_possui_comorbidade || (r.idade || 0) >= 60).length,
        grupos_calculados: {
          mulheres: merged.filter((r) => r.grupo === 'Mulheres').length,
          pastor_auxiliar_juventude: merged.filter((r) => r.grupo === 'Pastor Auxiliar / Juventude').length,
          pastor_presidente_jubilado: merged.filter((r) => r.grupo === 'Pastor Presidente / Pastor Jubilado').length,
          sem_grupo: merged.filter((r) => !r.grupo).length,
        },
      },
    };
  };

  const antes = await loadSnapshot();

  const emailTmp = `tmp-carga-${Date.now()}@tmp.local`;
  const { data: equipeTmp, error: eqErr } = await sb
    .from('evento_equipe')
    .insert({
      evento_id: EVENTO_ID,
      email: emailTmp,
      tipo: 'hospedagem',
      ativo: true,
      nome: 'teste-carga-controlada-temp',
      convite_expira_em: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    })
    .select('id')
    .single();
  if (eqErr) throw new Error(`Falha equipe temp: ${eqErr.message}`);

  const t0 = Date.now();
  const resp = await fetch(`${APP_URL}/api/eventos/${EVENTO_ID}/hospedagens/alocar?equipe_id=${encodeURIComponent(equipeTmp.id)}`, { method: 'POST' });
  const auto = await resp.json();
  const tempoMs = Date.now() - t0;

  await sb.from('evento_equipe').delete().eq('id', equipeTmp.id).eq('evento_id', EVENTO_ID);

  const depois = await loadSnapshot();

  const { data: alojAll } = await sb
    .from('evento_alojamentos')
    .select('id,total_vagas')
    .eq('evento_id', EVENTO_ID)
    .eq('ativo', true);
  const { data: ocupAll } = await sb
    .from('evento_hospedagens')
    .select('alojamento_id,status')
    .eq('evento_id', EVENTO_ID)
    .in('status', ['alocada', 'confirmada', 'checkin_realizado'])
    .not('alojamento_id', 'is', null);

  const ocupMap = new Map();
  for (const o of (ocupAll || [])) ocupMap.set(o.alojamento_id, (ocupMap.get(o.alojamento_id) || 0) + 1);
  let acimaCap = 0;
  let saldoNeg = 0;
  for (const a of (alojAll || [])) {
    const ocup = ocupMap.get(a.id) || 0;
    const cap = Number(a.total_vagas || 0);
    if (ocup > cap) acimaCap++;
    if (cap - ocup < 0) saldoNeg++;
  }

  const integridade = {
    nenhum_pendente_ocupando_leito: depois.merged.filter((r) => !isPagamentoElegivel(r.status_pagamento) && r.alojamento_id && r.numero_cama).length,
    nenhum_alocado_sem_numero_leito: depois.merged.filter((r) => ['alocada', 'confirmada', 'checkin_realizado'].includes(r.status_operacional) && !r.numero_cama).length,
    nenhum_grupo_incompativel_alojamento: depois.merged.filter((r) => {
      if (!r.alojamento_id || !r.grupo || !r.evento_alojamentos) return false;
      const aloj = Array.isArray(r.evento_alojamentos) ? r.evento_alojamentos[0] : r.evento_alojamentos;
      if (!aloj) return false;
      const g = norm(r.grupo);
      const p = norm(aloj.publico);
      if (p === 'misto') return false;
      if (p === 'feminino') return !(g.includes('mulher') || g.includes('feminino'));
      if (p === 'masculino_geral') return !(g.includes('auxiliar') || g.includes('juventude') || g.includes('masculino'));
      if (p === 'presidentes' || p === 'jubilados') return !(g.includes('presidente') || g.includes('jubilad'));
      return false;
    }).length,
    nenhum_alojamento_acima_capacidade: acimaCap,
    nenhum_homem_no_grupo_mulheres: depois.merged.filter((r) => r.sexo === 'M' && norm(r.grupo).includes('mulher')).length,
    nenhuma_mulher_em_grupo_masculino: depois.merged.filter((r) => r.sexo === 'F' && (norm(r.grupo).includes('auxiliar') || norm(r.grupo).includes('juventude') || norm(r.grupo).includes('masculino'))).length,
    nenhum_saldo_negativo_vagas: saldoNeg,
  };

  const result = {
    evento_id: EVENTO_ID,
    app_url: APP_URL,
    prefixo_teste: PREFIX,
    total_inserido: inserts.length,
    composicao: {
      homens_jovens: 20,
      mulheres_jovens: 20,
      pastores_presidentes: 10,
      pastores_auxiliares: 10,
      jubilados: 5,
      pessoas_60_plus: 10,
      necessidade_especial: 5,
      comorbidade: 5,
      pendentes_pagamento: 20,
      pagos_ou_isentos: 80,
    },
    antes_autoalocacao: antes.resumo,
    execucao_autoalocacao: {
      status_http: resp.status,
      tempo_ms: tempoMs,
      retorno_endpoint: auto,
      total_processado: auto.processados ?? null,
      total_alocado: auto.confirmados ?? null,
      total_ignorado_pagamento: auto.aguardando_pagamento ?? null,
      total_lista_espera: auto.lista_espera ?? null,
      total_sem_vaga: auto.lista_espera ?? null,
      total_sem_grupo: depois.resumo.grupos_calculados.sem_grupo,
      total_prioridade_nao_atendida: auto.prioridade_sem_leito_inferior ?? null,
    },
    depois_autoalocacao: depois.resumo,
    regras_grupo: {
      homens_jovens_aux_juv: depois.merged.filter((r) => r.sexo === 'M' && norm(r.tipo_inscricao).includes('juventude') && r.grupo === 'Pastor Auxiliar / Juventude').length,
      mulheres_mulheres: depois.merged.filter((r) => r.sexo === 'F' && r.grupo === 'Mulheres').length,
      presidente_presjub: depois.merged.filter((r) => norm(r.tipo_inscricao).includes('presidente') && r.grupo === 'Pastor Presidente / Pastor Jubilado').length,
      jubilado_presjub: depois.merged.filter((r) => norm(r.tipo_inscricao).includes('jubilado') && r.grupo === 'Pastor Presidente / Pastor Jubilado').length,
      esposa_viuva_mulheres: depois.merged.filter((r) => (norm(r.tipo_inscricao).includes('esposa') || norm(r.tipo_inscricao).includes('viuva')) && r.grupo === 'Mulheres').length,
    },
    pendencias_remanescentes: {
      pagou_mas_nao_alocado: depois.merged.filter((r) => isPagamentoElegivel(r.status_pagamento) && !r.alojamento_id).length,
      solicitou_mas_nao_pagou: depois.merged.filter((r) => !isPagamentoElegivel(r.status_pagamento)).length,
      prioridade_sem_leito_inferior: depois.merged.filter((r) => (r.hosp_cama_inferior || r.hosp_necessidade_especial || r.hosp_possui_comorbidade || (r.idade || 0) >= 60) && r.tipo_cama && r.tipo_cama !== 'inferior').length,
      sem_grupo_calculado: depois.merged.filter((r) => !r.grupo).length,
      grupo_incompativel: integridade.nenhum_grupo_incompativel_alojamento,
      sem_numero_leito: depois.merged.filter((r) => r.alojamento_id && !r.numero_cama).length,
      alojamento_acima_capacidade: integridade.nenhum_alojamento_acima_capacidade,
    },
    integridade,
    tempo_total_execucao_ms: Date.now() - started,
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('ERRO_TESTE_CARGA_CONTROLADA:', e.message);
  process.exit(1);
});
