import crypto from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { gerarReciboAgoPdf, type DadosReciboAgo } from './recibo-ago-pdf';

// ── Conversor Numérico para Valor por Extenso ────────────────────────────────
function extensoAte999(n: number): string {
  const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
  const especiais = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  if (n === 0) return '';
  if (n === 100) return 'cem';

  const c = Math.floor(n / 100);
  const d = Math.floor((n % 100) / 10);
  const u = n % 10;

  const partes: string[] = [];
  if (c > 0) partes.push(centenas[c]);

  if (d === 1) {
    partes.push(especiais[u]);
  } else {
    if (d > 1) partes.push(dezenas[d]);
    if (u > 0) partes.push(unidades[u]);
  }

  return partes.join(' e ');
}

export function valorPorExtenso(valor: number): string {
  if (!valor || valor <= 0) return 'zero reais';

  const partes = Number(valor).toFixed(2).split('.');
  const inteira = parseInt(partes[0], 10);
  const centavos = parseInt(partes[1], 10);

  const milhares = Math.floor(inteira / 1000);
  const restoMil = inteira % 1000;

  const blocos: string[] = [];
  if (milhares > 0) {
    if (milhares === 1) {
      blocos.push('mil');
    } else {
      blocos.push(`${extensoAte999(milhares)} mil`);
    }
  }

  if (restoMil > 0) {
    blocos.push(extensoAte999(restoMil));
  }

  let textoReais = '';
  if (inteira > 0) {
    const nomeMoeda = inteira === 1 ? 'real' : 'reais';
    textoReais = `${blocos.join(' e ')} ${nomeMoeda}`;
  }

  let textoCentavos = '';
  if (centavos > 0) {
    const nomeCentavos = centavos === 1 ? 'centavo' : 'centavos';
    textoCentavos = `${extensoAte999(centavos)} ${nomeCentavos}`;
  }

  if (textoReais && textoCentavos) {
    return `${textoReais} e ${textoCentavos}`;
  }
  return textoReais || textoCentavos || 'zero reais';
}

// ── Gerador Determinístico do Protocolo de Autenticação (HMAC-SHA256) ────────
export function gerarProtocoloAutenticacao(inscricaoId: string, eventoId: string): string {
  const secret = process.env.RECIBO_AUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'AGO126_SECRET_AUTH_KEY_2026';
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(`${eventoId}:${inscricaoId}`);
  const hashHex = hmac.digest('hex').toUpperCase();

  const b1 = hashHex.substring(0, 4);
  const b2 = hashHex.substring(4, 8);
  const b3 = hashHex.substring(8, 12);
  const b4 = hashHex.substring(12, 16);

  return `AGO126-${b1}-${b2}-${b3}-${b4}`;
}

// ── Validação Estrita de Elegibilidade para Recibo ───────────────────────────
// Exclusivamente Pastor Presidente (com ou sem Campo Missionário)
export function isPastorPresidenteElegivel(tipoInscricao?: string | null, snapshot?: any): boolean {
  const tipoUpper = (tipoInscricao || '').toUpperCase().trim();
  if (tipoUpper.includes('PASTOR PRESIDENTE') || tipoUpper === 'PRESIDENTE') {
    return true;
  }
  if (snapshot && typeof snapshot === 'object') {
    if (snapshot.is_pastor_presidente === true || snapshot.cargo === 'PASTOR PRESIDENTE') {
      return true;
    }
  }
  return false;
}

// ── Montagem dos Dados e Emissão do Recibo ───────────────────────────────────
export async function obterDadosReciboAgo(
  supabase: SupabaseClient,
  inscricaoId: string
): Promise<{ dados?: DadosReciboAgo | null; erro?: string | null }> {
  const { data: ins, error: insErr } = await supabase
    .from('evento_inscricoes')
    .select(`
      id, evento_id, nome_inscrito, cpf, email, telefone,
      tipo_inscricao, status_pagamento, valor_final, valor_pago, valor_original,
      forma_pagamento, asaas_payment_id, lote_id, created_at, updated_at,
      ministro_snapshot, campo_id, supervisao_id
    `)
    .eq('id', inscricaoId)
    .single();

  if (insErr || !ins) {
    return { erro: 'Inscrição não encontrada.' };
  }

  if (ins.status_pagamento !== 'pago') {
    return { erro: `Recibo indisponível: pagamento não confirmado (status: ${ins.status_pagamento}).` };
  }

  const snapshot = ins.ministro_snapshot as any;
  if (!isPastorPresidenteElegivel(ins.tipo_inscricao, snapshot)) {
    return { erro: 'Emissão restrita exclusivamente à categoria de Pastor Presidente.' };
  }

  const { data: evento } = await supabase
    .from('eventos')
    .select('id, nome, departamento')
    .eq('id', ins.evento_id)
    .single();

  // Campo e Supervisão
  let campoNome = snapshot?.campo || null;
  let supervisaoNome = snapshot?.supervisao || null;

  if (!campoNome && ins.campo_id) {
    const { data: c } = await supabase.from('campos').select('nome').eq('id', ins.campo_id).maybeSingle();
    if (c) campoNome = c.nome;
  }

  if (!supervisaoNome && ins.supervisao_id) {
    const { data: s } = await supabase.from('supervisoes').select('nome').eq('id', ins.supervisao_id).maybeSingle();
    if (s) supervisaoNome = s.nome;
  }

  // Valor individual exato da inscrição do Pastor Presidente
  const valorNum = Number(ins.valor_final ?? ins.valor_pago ?? ins.valor_original ?? 0);
  const valorExt = valorPorExtenso(valorNum);
  const protocolo = gerarProtocoloAutenticacao(ins.id, ins.evento_id);

  const dados: DadosReciboAgo = {
    inscricaoId: ins.id,
    eventoId: ins.evento_id,
    eventoNome: evento?.nome || '126ª AGO DA COMIEADEPA',
    protocoloAutenticacao: protocolo,
    dataEmissao: new Date().toISOString(),
    dataPagamento: ins.updated_at || ins.created_at,
    valorNumerico: valorNum,
    valorExtenso: valorExt,
    formaPagamento: ins.forma_pagamento || 'pix',
    transacaoId: ins.asaas_payment_id || null,
    loteId: ins.lote_id || null,
    inscrito: {
      nome: ins.nome_inscrito,
      cpf: ins.cpf,
      email: ins.email,
      telefone: ins.telefone,
      categoria: ins.tipo_inscricao || 'PASTOR PRESIDENTE',
      matricula: snapshot?.matricula || null,
      cargo: snapshot?.cargo || 'PASTOR',
      campo: campoNome,
      supervisao: supervisaoNome,
      isCampoMissionario: snapshot?.is_campo_missionario === true,
    },
  };

  return { dados };
}

/**
 * Gera o anexo de e-mail do recibo para a inscrição se for Pastor Presidente
 * Retorna null silenciosamente se a inscrição não for elegível ou se houver erro
 */
export async function gerarAnexoReciboSeElegivel(
  supabase: SupabaseClient,
  inscricaoId: string
): Promise<{ filename: string; content: string } | null> {
  try {
    const { dados, erro } = await obterDadosReciboAgo(supabase, inscricaoId);
    if (erro || !dados) {
      return null;
    }
    const pdfResult = await gerarReciboAgoPdf(dados);
    return {
      filename: pdfResult.filename,
      content: pdfResult.base64,
    };
  } catch (err: any) {
    console.error('[RECIBO AGO] Falha segura ao gerar anexo de recibo (não bloqueia envio):', err?.message);
    return null;
  }
}
