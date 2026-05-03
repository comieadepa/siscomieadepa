/**
 * migrate-fotos-bubble.cjs
 *
 * Migra fotos dos ministros do CDN do Bubble.io para o Supabase Storage.
 *
 * Uso:
 *   node scripts/migrate-fotos-bubble.cjs
 *
 * O que faz:
 *   1. Busca todos os members onde foto_url contém 'bubble.io'
 *   2. Baixa cada imagem via fetch
 *   3. Faz upload para o bucket 'member-photos' no Supabase Storage
 *   4. Atualiza foto_url com a nova URL pública do Supabase
 *
 * Pré-requisito: bucket 'member-photos' deve existir no Supabase Storage
 *   (crie em Storage → New bucket → nome: member-photos → Public: ON)
 */

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wtifljxpoinpbzyugrfc.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SERVICE_ROLE_KEY) { console.error('Defina a variável SUPABASE_SERVICE_ROLE_KEY'); process.exit(1); }
const BUCKET = 'member-photos';

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Pausa para não sobrecarregar a rede/Supabase
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function downloadImage(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar ${url}`);
  const arrayBuffer = await resp.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function getExtension(url, contentType) {
  if (contentType && contentType.includes('png')) return 'png';
  if (contentType && contentType.includes('webp')) return 'webp';
  // tenta extrair da URL
  const match = url.match(/\.(jpg|jpeg|png|webp|gif)(\?|$)/i);
  if (match) return match[1].toLowerCase();
  return 'jpg';
}

async function main() {
  console.log('🔍 Buscando ministros com foto do Bubble.io...');

  // Busca em páginas de 1000 (limite Supabase)
  let allMembers = [];
  let from = 0;
  const PAGE = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('members')
      .select('id, name, foto_url')
      .ilike('foto_url', '%bubble.io%')
      .range(from, from + PAGE - 1);

    if (error) { console.error('Erro ao buscar members:', error); process.exit(1); }
    if (!data || data.length === 0) break;
    allMembers = allMembers.concat(data);
    if (data.length < PAGE) break;
    from += PAGE;
  }

  console.log(`📋 Encontrados: ${allMembers.length} ministros com foto do Bubble.io\n`);

  if (allMembers.length === 0) {
    console.log('✅ Nenhuma foto para migrar.');
    return;
  }

  let ok = 0, erros = 0;

  for (let i = 0; i < allMembers.length; i++) {
    const m = allMembers[i];
    const prefix = `[${i + 1}/${allMembers.length}]`;

    try {
      console.log(`${prefix} Baixando foto de: ${m.name}`);

      // Corrige URL dupla (padrão que apareceu no CSV: url encoded dentro da url)
      let fotoUrl = m.foto_url;
      // Decodifica se vier encodada (%2F%2F etc)
      try { fotoUrl = decodeURIComponent(fotoUrl); } catch (_) {}
      // Se ainda tiver %, decodifica de novo
      if (fotoUrl.includes('%')) {
        try { fotoUrl = decodeURIComponent(fotoUrl); } catch (_) {}
      }
      // Remove prefixo lixo antes da URL (ex: "2103-//3edb...")
      // Tenta capturar a partir de https:// ou //
      const httpMatch = fotoUrl.match(/(https?:\/\/.+)/);
      if (httpMatch) {
        fotoUrl = httpMatch[1];
      } else {
        // protocol-relative: //dominio.com/...
        const prMatch = fotoUrl.match(/(\/\/[^/].+)/);
        if (prMatch) fotoUrl = 'https:' + prMatch[1];
      }
      // Remove segmentos duplicados: às vezes a URL contém outra URL encodada dentro dela
      // Pega apenas até o primeiro .jpg/.png/.webp/.gif
      const extMatch = fotoUrl.match(/^(.*?\.(jpg|jpeg|png|webp|gif))/i);
      if (extMatch) fotoUrl = extMatch[1];

      const resp = await fetch(fotoUrl, { signal: AbortSignal.timeout(15000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

      const contentType = resp.headers.get('content-type') || '';
      const ext = getExtension(fotoUrl, contentType);
      const buffer = Buffer.from(await resp.arrayBuffer());

      const storagePath = `${m.id}.${ext}`;

      // Upload para Supabase Storage (upsert caso já exista)
      const { error: uploadError } = await supabase.storage
        .from(BUCKET)
        .upload(storagePath, buffer, {
          contentType: contentType || `image/${ext}`,
          upsert: true,
        });

      if (uploadError) throw new Error(`Upload falhou: ${uploadError.message}`);

      // Pega URL pública
      const { data: publicData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      const novaUrl = publicData.publicUrl;

      // Atualiza no banco
      const { error: updateError } = await supabase
        .from('members')
        .update({ foto_url: novaUrl })
        .eq('id', m.id);

      if (updateError) throw new Error(`Update falhou: ${updateError.message}`);

      console.log(`  ✅ OK → ${novaUrl}`);
      ok++;
    } catch (err) {
      console.error(`  ❌ ERRO: ${err.message}`);
      erros++;
    }

    // 100ms entre cada para não sobrecarregar
    await sleep(100);
  }

  console.log(`\n==============================`);
  console.log(`✅ Migrados com sucesso: ${ok}`);
  console.log(`❌ Com erro:             ${erros}`);
  console.log(`==============================`);
  console.log('\nPróximos passos:');
  console.log('1. Verifique as fotos em: Supabase → Storage → member-photos');
  console.log('2. Confira alguns ministros na listagem para validar');
  console.log('3. Só então cancele o sistema Bubble.io antigo');
}

main().catch((e) => { console.error(e); process.exit(1); });
