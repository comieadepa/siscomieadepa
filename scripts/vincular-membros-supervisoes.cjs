/**
 * vincular-membros-supervisoes.cjs
 *
 * Após reimportar membros via CSV, este script:
 *   1. Lê custom_fields->>'supervisao' de cada membro
 *   2. Lê custom_fields->>'campo' de cada membro
 *   3. Busca o id correspondente nas tabelas supervisoes e campos (por nome, sem acento)
 *   4. Atualiza supervisao_id e campo_id no membro
 *
 * Uso:
 *   $env:SUPABASE_SERVICE_ROLE_KEY="sua_key"
 *   node scripts/vincular-membros-supervisoes.cjs
 *
 * Flags opcionais:
 *   --dry-run    Mostra o que seria atualizado sem gravar no banco
 *   --verbose    Mostra cada membro processado
 */

// Carrega .env.local automaticamente
try { require('dotenv').config({ path: require('path').resolve(__dirname, '../.env.local') }); } catch {}

const { createClient } = require('@supabase/supabase-js');

const DRY_RUN  = process.argv.includes('--dry-run');
const VERBOSE  = process.argv.includes('--verbose');

const SUPABASE_URL      = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wtifljxpoinpbzyugrfc.supabase.co';
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.error('❌ Defina a variável SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Remove acentos e normaliza para comparação
function norm(s) {
  return (String(s || ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

async function fetchAll(table, select) {
  let all = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + PAGE - 1);
    if (error) { console.error(`Erro ao buscar ${table}:`, error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    all = all.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  console.log(DRY_RUN ? '🔍 MODO DRY-RUN — nenhuma alteração será gravada\n' : '🔗 Vinculando membros a supervisões e campos...\n');

  // 1. Carregar supervisões e campos do banco
  console.log('📋 Carregando supervisões...');
  const supervisoes = await fetchAll('supervisoes', 'id, nome, codigo');
  console.log(`   ${supervisoes.length} supervisões encontradas`);

  console.log('📋 Carregando campos...');
  const campos = await fetchAll('campos', 'id, nome, codigo, supervisao_id');
  console.log(`   ${campos.length} campos encontrados\n`);

  // Índices por nome normalizado para busca rápida
  const supByNome  = new Map(); // nome_norm → supervisao
  const supByCod   = new Map(); // codigo_norm → supervisao

  // Aliases: nome no CSV → nome real no banco
  const ALIASES = {
    'araguaina / to':              'araguaina',
    'araguaina/to':                'araguaina',
    'comieadepa, araguaina':       'comieadepa',
    'igarape-miri':                'igarape- miri',
    'igarape - miri':              'igarape- miri',
    'santa izabel':                'santa izabel do para',
  };

  for (const s of supervisoes) {
    supByNome.set(norm(s.nome), s);
    if (s.codigo) supByCod.set(norm(s.codigo), s);
  }

  const campoByNome = new Map(); // nome_norm → campo
  const campoByCod  = new Map(); // codigo_norm → campo
  for (const c of campos) {
    campoByNome.set(norm(c.nome),   c);
    if (c.codigo) campoByCod.set(norm(c.codigo), c);
  }

  // 2. Carregar membros com custom_fields
  console.log('👥 Carregando membros...');
  const members = await fetchAll('members', 'id, name, supervisao_id, custom_fields');
  console.log(`   ${members.length} membros encontrados\n`);

  let vinculadosSup   = 0;
  let vinculadosCampo = 0;
  let naoEncontradoSup   = new Set();
  let naoEncontradoCampo = new Set();
  let semInfo = 0;
  const updates = [];

  for (const m of members) {
    const cf    = m.custom_fields || {};
    const supNome   = cf.supervisao || cf['supervisão'] || '';
    const campoNome = cf.campo || cf['campo atual'] || '';

    if (!supNome && !campoNome) { semInfo++; continue; }

    const payload = {};

    // Buscar supervisão
    if (supNome && !m.supervisao_id) {
      const key = norm(supNome);
      const resolvedKey = ALIASES[key] || key;
      const found = supByNome.get(resolvedKey) || supByCod.get(resolvedKey);
      if (found) {
        payload.supervisao_id = found.id;
        vinculadosSup++;
        if (VERBOSE) console.log(`  ✓ ${m.name} → Supervisão: ${found.nome}`);
      } else {
        naoEncontradoSup.add(supNome);
      }
    }

    // Buscar campo → herdar supervisao_id se não resolveu pelo nome
    if (campoNome && !payload.supervisao_id && !m.supervisao_id) {
      const found = campoByNome.get(norm(campoNome)) || campoByCod.get(norm(campoNome));
      if (found && found.supervisao_id) {
        payload.supervisao_id = found.supervisao_id;
        vinculadosCampo++;
        if (VERBOSE) console.log(`  ✓ ${m.name} → Supervisão via campo: ${found.nome}`);
      } else if (!found) {
        naoEncontradoCampo.add(campoNome);
      }
    }

    if (Object.keys(payload).length > 0) {
      updates.push({ id: m.id, ...payload });
    }
  }

  console.log(`\n📊 Resumo:`);
  console.log(`   Membros com supervisão a vincular (por nome)     : ${vinculadosSup}`);
  console.log(`   Membros com supervisão herdada do campo           : ${vinculadosCampo}`);
  console.log(`   Membros sem info de supervisão/campo              : ${semInfo}`);

  if (naoEncontradoSup.size > 0) {
    console.log(`\n⚠️  Supervisões no CSV não encontradas no banco (${naoEncontradoSup.size}):`);
    for (const n of [...naoEncontradoSup].sort()) console.log(`     - "${n}"`);
  }

  if (naoEncontradoCampo.size > 0) {
    console.log(`\n⚠️  Campos no CSV não encontrados no banco (${naoEncontradoCampo.size}):`);
    for (const n of [...naoEncontradoCampo].sort()) console.log(`     - "${n}"`);
  }

  if (updates.length === 0) {
    console.log('\n✅ Nenhuma atualização necessária.');
    return;
  }

  console.log(`\n🔄 ${updates.length} membros a atualizar...`);

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Primeiros 10 registros que seriam atualizados:');
    updates.slice(0, 10).forEach(u => console.log('  ', JSON.stringify(u)));
    console.log('\nRode sem --dry-run para aplicar as alterações.');
    return;
  }

  // 3. Atualizar em lotes de 100
  const BATCH = 100;
  let ok = 0;
  let erros = 0;

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    for (const u of batch) {
      const { id, ...fields } = u;
      const { error } = await supabase.from('members').update(fields).eq('id', id);
      if (error) { erros++; console.error(`  ❌ ${id}: ${error.message}`); }
      else ok++;
    }
    process.stdout.write(`\r   Progresso: ${Math.min(i + BATCH, updates.length)}/${updates.length}`);
  }

  console.log(`\n\n✅ Concluído: ${ok} atualizados, ${erros} erros.`);
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
