require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const EVENTO_ID = '4307ecd3-e74a-4855-9de7-c4e29216a190';

// Configuração oficial homologada:
// - Azul: beliches 001–258; colchonetes 259–306 (Total: 306)
// - Prédio Novo: beliches 001–276 (Total: 276)
// - AAME: beliches 001–124; colchonetes 125–155 (Total: 155)
// - Mário Covas: beliches 001–490; colchonetes 491–540 (Total: 540)
// Beliches: ímpares superiores e pares inferiores.

const SETORES = [
  {
    nome: 'ALOJAMENTO AZUL',
    id: 'b11eb773-384e-4e44-b605-0b9a6b861d57',
    belicheMin: 1,
    belicheMax: 258,
    colchMin: 259,
    colchMax: 306,
    totalVagas: 306
  },
  {
    nome: 'ALOJAMENTO PRÉDIO NOVO',
    id: 'bd540db2-284b-4176-915e-776cf1de8b09',
    belicheMin: 1,
    belicheMax: 276,
    colchMin: 0,
    colchMax: 0,
    totalVagas: 276
  },
  {
    nome: 'ALOJAMENTO PRÉDIO AAME',
    id: 'c6998495-cfa5-4fea-8354-3dc32eb27759',
    belicheMin: 1,
    belicheMax: 124,
    colchMin: 125,
    colchMax: 155,
    totalVagas: 155
  },
  {
    nome: 'PRÉDIO MÁRIO COVAS',
    id: 'c8449108-6920-4642-83dd-66792752e138',
    belicheMin: 1,
    belicheMax: 490,
    colchMin: 491,
    colchMax: 540,
    totalVagas: 540
  }
];

function pad3(num) {
  return String(num).padStart(3, '0');
}

async function main() {
  console.log('=== MATERIALIZAÇÃO DE LEITOS FALTANTES ===');
  let totalCriados = 0;

  for (const setor of SETORES) {
    console.log(`\nProcessando setor: ${setor.nome}...`);
    // 1. Busca leitos já existentes para não duplicar
    const { data: existentes, error: errExistentes } = await supabase
      .from('evento_hospedagem_leitos')
      .select('numero')
      .eq('alojamento_id', setor.id);

    if (errExistentes) {
      console.error(`Erro ao buscar existentes no setor ${setor.nome}:`, errExistentes);
      continue;
    }

    const setExistentes = new Set((existentes || []).map(l => l.numero));
    const novosLeitos = [];

    // Gerar beliches
    if (setor.belicheMax > 0) {
      for (let n = setor.belicheMin; n <= setor.belicheMax; n++) {
        const numStr = pad3(n);
        if (!setExistentes.has(numStr)) {
          const isPar = n % 2 === 0;
          novosLeitos.push({
            evento_id: EVENTO_ID,
            alojamento_id: setor.id,
            numero: numStr,
            tipo_leito: 'beliche',
            posicao: isPar ? 'inferior' : 'superior',
            ocupado: false
          });
        }
      }
    }

    // Gerar colchonetes
    if (setor.colchMax > 0) {
      for (let n = setor.colchMin; n <= setor.colchMax; n++) {
        const numStr = pad3(n);
        if (!setExistentes.has(numStr)) {
          novosLeitos.push({
            evento_id: EVENTO_ID,
            alojamento_id: setor.id,
            numero: numStr,
            tipo_leito: 'colchonete',
            posicao: 'unico',
            ocupado: false
          });
        }
      }
    }

    console.log(`Leitos a inserir para ${setor.nome}: ${novosLeitos.length} (Existentes: ${setExistentes.size})`);

    // Inserir em chunks de 100
    for (let i = 0; i < novosLeitos.length; i += 100) {
      const chunk = novosLeitos.slice(i, i + 100);
      const { error: insertErr } = await supabase
        .from('evento_hospedagem_leitos')
        .insert(chunk);

      if (insertErr) {
        console.error(`Erro ao inserir chunk em ${setor.nome}:`, insertErr);
      } else {
        totalCriados += chunk.length;
      }
    }
  }

  console.log(`\n=== CONCLUÍDO: ${totalCriados} novos leitos físicos cadastrados no banco! ===`);
}

main();
