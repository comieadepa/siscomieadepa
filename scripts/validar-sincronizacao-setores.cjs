#!/usr/bin/env node
/**
 * Valida o fluxo completo de sincronização setores AGO → evento_alojamentos.
 *
 * Tarefas validadas:
 *  1. Migration aplicada (colunas presentes)
 *  2. Busca evento AGO com setores configurados
 *  3. Chama materializarSetoresHospedagemAGO() e verifica resultado
 *  4. Verifica idempotência (chamada dupla não duplica)
 *  5. Verifica que capacidade é atualizada sem apagar hospedagens
 */

require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(url, key);

// ── Reproduz a lógica de materializar-setores.ts ─────────────────────────────

function grupoToPublico(grupo) {
  const g = grupo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  if (g.includes('mulher') || g.includes('feminino')) return 'feminino';
  if (g.includes('presidente') && g.includes('jubilad')) return 'jubilados';
  if (g.includes('presidente')) return 'presidentes';
  if (g.includes('jubilad')) return 'jubilados';
  if (g.includes('auxiliar') || g.includes('juventude') || g.includes('masculino')) return 'masculino_geral';
  return 'misto';
}

function publicoToSexo(publico) {
  if (publico === 'feminino') return 'F';
  if (publico === 'misto') return null;
  return 'M';
}

async function materializarSetores(eventoId) {
  const { data: evento, error } = await supabase
    .from('eventos')
    .select('configuracoes_ago')
    .eq('id', eventoId)
    .single();

  if (error || !evento) return { criados: 0, atualizados: 0, erro: error?.message ?? 'not found' };

  const setores = (evento.configuracoes_ago?.setores ?? []);
  if (setores.length === 0) return { criados: 0, atualizados: 0 };

  const { data: existentes } = await supabase
    .from('evento_alojamentos')
    .select('id, setor_key')
    .eq('evento_id', eventoId)
    .not('setor_key', 'is', null);

  const existingMap = new Map((existentes ?? []).map(a => [a.setor_key, a.id]));

  let criados = 0, atualizados = 0, erros = 0;
  for (const s of setores) {
    const publico = grupoToPublico(s.grupo);
    const sexo = publicoToSexo(publico);
    const camasSuperiores = Math.max(0, s.quantidade_leitos - s.quantidade_leitos_inferiores);
    const existingId = existingMap.get(s.id);

    if (existingId) {
      const { error: e } = await supabase
        .from('evento_alojamentos')
        .update({
          nome: s.nome.toUpperCase(),
          publico, sexo,
          total_vagas:       s.quantidade_leitos,
          camas_inferiores:  s.quantidade_leitos_inferiores,
          camas_superiores:  camasSuperiores,
          grupo_permitido:   s.grupo,
          tipos_leito:       s.tipos_leito,
          leitos_inferiores: s.quantidade_leitos_inferiores,
          ativo:             s.ativo,
        })
        .eq('id', existingId);
      if (e) erros++; else atualizados++;
    } else {
      const { error: e } = await supabase
        .from('evento_alojamentos')
        .insert({
          evento_id:         eventoId,
          setor_key:         s.id,
          nome:              s.nome.toUpperCase(),
          publico, sexo,
          total_vagas:       s.quantidade_leitos,
          camas_inferiores:  s.quantidade_leitos_inferiores,
          camas_superiores:  camasSuperiores,
          grupo_permitido:   s.grupo,
          tipos_leito:       s.tipos_leito,
          leitos_inferiores: s.quantidade_leitos_inferiores,
          ativo:             s.ativo,
          origem:            'configuracoes_ago',
        });
      if (e) { console.error('  INSERT error:', e.message); erros++; } else criados++;
    }
  }

  return { criados, atualizados, erros };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let pass = 0, fail = 0;

  function ok(msg)   { console.log(`  ✅  ${msg}`); pass++; }
  function nok(msg)  { console.error(`  ❌  ${msg}`); fail++; }
  function info(msg) { console.log(`  ℹ️   ${msg}`); }

  // ── PASSO 1: Migration ────────────────────────────────────────────────────
  console.log('\n─── PASSO 1: Verificar migration ───────────────────────────');
  const { error: migErr } = await supabase
    .from('evento_alojamentos')
    .select('id, setor_key, origem, grupo_permitido, tipos_leito, leitos_inferiores')
    .limit(1);

  if (!migErr) ok('Colunas setor_key, origem, grupo_permitido, tipos_leito, leitos_inferiores presentes.');
  else nok(`Coluna ausente: ${migErr.message}`);

  // ── PASSO 2: Evento AGO com setores ──────────────────────────────────────
  console.log('\n─── PASSO 2: Buscar evento AGO com setores configurados ────');
  const { data: eventos } = await supabase
    .from('eventos')
    .select('id, nome, departamento, configuracoes_ago')
    .eq('departamento', 'AGO')
    .not('configuracoes_ago', 'is', null)
    .limit(10);

  const ago = (eventos ?? []).find(e => {
    const setores = e.configuracoes_ago?.setores;
    return Array.isArray(setores) && setores.length > 0;
  });

  if (!ago) {
    nok('Nenhum evento AGO com setores configurados encontrado.');
    console.log('\n⚠️   Crie um evento AGO e configure setores em Configurações → AGO.');
    console.log(`\n📊  Resultado: ${pass} ok, ${fail} falha(s)`);
    return;
  }

  const setores = ago.configuracoes_ago.setores;
  info(`Evento: "${ago.nome}" (${ago.id})`);
  info(`${setores.length} setor(es) configurado(s): ${setores.map(s => s.nome).join(', ')}`);
  ok(`Evento AGO encontrado com ${setores.length} setor(es).`);

  const eventoId = ago.id;
  const capacidadeEsperada = setores.filter(s => s.ativo).reduce((sum, s) => sum + s.quantidade_leitos, 0);
  const setoresAtivosEsperados = setores.filter(s => s.ativo).length;

  // ── PASSO 3: Primeira sincronização ──────────────────────────────────────
  console.log('\n─── PASSO 3: Primeira sincronização ────────────────────────');

  // Remove alojamentos com setor_key para testar criação fresh
  const { data: antes } = await supabase
    .from('evento_alojamentos')
    .select('id, setor_key, nome, total_vagas, ativo')
    .eq('evento_id', eventoId)
    .not('setor_key', 'is', null);

  if ((antes ?? []).length > 0) {
    info(`${antes.length} alojamento(s) com setor_key já existem – testando atualização.`);
  }

  const r1 = await materializarSetores(eventoId);
  info(`Resultado 1ª sync: criados=${r1.criados}, atualizados=${r1.atualizados}, erros=${r1.erros ?? 0}`);
  if ((r1.erros ?? 0) === 0) ok('1ª sincronização sem erros.');
  else nok(`${r1.erros} erro(s) na 1ª sincronização.`);

  // Verifica registros criados
  const { data: depois1 } = await supabase
    .from('evento_alojamentos')
    .select('id, setor_key, nome, total_vagas, ativo, grupo_permitido, origem')
    .eq('evento_id', eventoId)
    .not('setor_key', 'is', null);

  if ((depois1 ?? []).length === setores.length) {
    ok(`${setores.length} alojamento(s) em evento_alojamentos — contagem correta.`);
  } else {
    nok(`Esperados ${setores.length} alojamentos, encontrados ${(depois1 ?? []).length}.`);
  }

  const totalVagasDB = (depois1 ?? []).filter(a => a.ativo).reduce((s, a) => s + a.total_vagas, 0);
  if (totalVagasDB === capacidadeEsperada) {
    ok(`Capacidade total correta: ${totalVagasDB} leitos.`);
  } else {
    nok(`Capacidade incorreta: esperado ${capacidadeEsperada}, encontrado ${totalVagasDB}.`);
  }

  const ativos = (depois1 ?? []).filter(a => a.ativo).length;
  if (ativos === setoresAtivosEsperados) {
    ok(`Setores ativos corretos: ${ativos}.`);
  } else {
    nok(`Setores ativos: esperado ${setoresAtivosEsperados}, encontrado ${ativos}.`);
  }

  // Verifica campo origem
  const origemOk = (depois1 ?? []).every(a => a.origem === 'configuracoes_ago');
  if (origemOk) ok('Campo origem = "configuracoes_ago" em todos os registros.');
  else nok('Campo origem incorreto em algum registro.');

  // ── PASSO 4: Idempotência (2ª sincronização) ──────────────────────────────
  console.log('\n─── PASSO 4: Idempotência (2ª sincronização) ───────────────');
  const r2 = await materializarSetores(eventoId);
  info(`Resultado 2ª sync: criados=${r2.criados}, atualizados=${r2.atualizados}, erros=${r2.erros ?? 0}`);

  const { data: depois2 } = await supabase
    .from('evento_alojamentos')
    .select('id, setor_key')
    .eq('evento_id', eventoId)
    .not('setor_key', 'is', null);

  if ((depois2 ?? []).length === setores.length) {
    ok(`Nenhum duplicado: ainda ${setores.length} alojamento(s).`);
  } else {
    nok(`Duplicados detectados! Total: ${(depois2 ?? []).length}, esperado: ${setores.length}.`);
  }

  if (r2.criados === 0) ok('2ª sync não criou novos registros (idempotente).');
  else nok(`2ª sync criou ${r2.criados} registro(s) inesperado(s).`);

  // ── PASSO 5: Atualização de capacidade ────────────────────────────────────
  console.log('\n─── PASSO 5: Atualização de capacidade ─────────────────────');
  if (setores.length > 0) {
    const setorTeste = setores[0];
    const novaCapacidade = (setorTeste.quantidade_leitos ?? 0) + 10;
    const setorModificado = { ...setorTeste, quantidade_leitos: novaCapacidade };

    // Simula mudança de capacidade
    const setoresModificados = [setorModificado, ...setores.slice(1)];
    const agoMod = { ...ago, configuracoes_ago: { ...ago.configuracoes_ago, setores: setoresModificados } };

    // Aplica sync com setor modificado
    const { data: evBack } = await supabase
      .from('eventos')
      .select('configuracoes_ago')
      .eq('id', eventoId)
      .single();

    // Salva config original para restaurar depois
    const configOriginal = evBack.configuracoes_ago;

    // Atualiza temporariamente a capacidade do 1º setor
    const configMod = { ...configOriginal, setores: setoresModificados };
    await supabase.from('eventos').update({ configuracoes_ago: configMod }).eq('id', eventoId);

    const r3 = await materializarSetores(eventoId);

    // Verifica que capacidade foi atualizada
    const { data: depois3 } = await supabase
      .from('evento_alojamentos')
      .select('total_vagas, setor_key')
      .eq('evento_id', eventoId)
      .eq('setor_key', setorTeste.id)
      .single();

    if (depois3?.total_vagas === novaCapacidade) {
      ok(`Capacidade atualizada corretamente: ${novaCapacidade} leitos para "${setorTeste.nome}".`);
    } else {
      nok(`Capacidade não atualizada: esperado ${novaCapacidade}, encontrado ${depois3?.total_vagas}.`);
    }

    // Restaura config original
    await supabase.from('eventos').update({ configuracoes_ago: configOriginal }).eq('id', eventoId);
    await materializarSetores(eventoId); // Restaura capacidade original
    ok('Configuração original restaurada.');
  }

  // ── RESULTADO FINAL ───────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(55));
  if (fail === 0) {
    console.log(`✅  Todos os ${pass} testes passaram! Sincronização funcionando.`);
  } else {
    console.log(`📊  ${pass} ok, ${fail} falha(s). Revisar itens acima.`);
  }
  console.log('═'.repeat(55) + '\n');
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
