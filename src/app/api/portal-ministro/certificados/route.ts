/**
 * GET /api/portal-ministro/certificados
 * Retorna exclusivamente os certificados de eventos elegíveis do ministro autenticado.
 * 
 * Regras de elegibilidade:
 * - Evento com gerar_certificado = true
 * - Inscrição com status_pagamento IN ('pago', 'isento')
 * - Inscrição com checkin_realizado = true
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { getMinistroSession, unauthorizedResponse } from '@/lib/ministro-session';
import { verificarElegibilidadeCertificado } from '@/services/certificado';

export async function GET(request: NextRequest) {
  const session = await getMinistroSession(request);
  if (!session) return unauthorizedResponse();

  const supabase = createServerClient();

  // 1. Busca dados do ministro autenticado
  const { data: ministro, error: mErr } = await supabase
    .from('members')
    .select('id, name, cpf, cargo_ministerial, custom_fields')
    .eq('id', session.ministroId)
    .maybeSingle();

  if (mErr || !ministro) {
    return NextResponse.json({ error: 'Ministro não encontrado.' }, { status: 404 });
  }

  const cpfLimpo = (ministro.cpf || '').replace(/\D/g, '');

  // 2. Busca inscrições do ministro em eventos que emitem certificado
  let query = supabase
    .from('evento_inscricoes')
    .select(`
      id,
      evento_id,
      ministro_id,
      nome_inscrito,
      cpf,
      status_pagamento,
      checkin_realizado,
      checkin_at,
      certificado_enviado,
      qr_code,
      supervisao_id,
      campo_id,
      created_at,
      eventos!inner (
        id,
        nome,
        slug,
        departamento,
        data_inicio,
        data_fim,
        local,
        cidade,
        gerar_certificado
      ),
      supervisoes (
        id,
        nome
      ),
      campos (
        id,
        nome
      )
    `)
    .eq('eventos.gerar_certificado', true)
    .order('created_at', { ascending: false });

  if (cpfLimpo) {
    query = query.or(`ministro_id.eq.${ministro.id},cpf.eq.${cpfLimpo}`);
  } else {
    query = query.eq('ministro_id', ministro.id);
  }

  const { data: inscricoes, error: inscErr } = await query;

  if (inscErr) {
    console.error('[portal-ministro/certificados] Erro ao buscar inscrições:', inscErr.message);
    return NextResponse.json({ error: 'Erro ao carregar certificados.' }, { status: 500 });
  }

  // 3. Filtra inscrições elegíveis usando a regra do serviço
  const elegiveis = (inscricoes || []).filter((insc: any) => {
    const ev = insc.eventos;
    const res = verificarElegibilidadeCertificado({
      statusPagamento: insc.status_pagamento || '',
      checkinRealizado: !!insc.checkin_realizado,
      gerarCertificado: !!ev?.gerar_certificado,
    });
    return res.elegivel && !!insc.qr_code;
  });

  if (elegiveis.length === 0) {
    return NextResponse.json({
      ministro: {
        id: ministro.id,
        nome: ministro.name,
      },
      total: 0,
      certificados: [],
    });
  }

  // 4. Busca as configurações de certificado dos eventos correspondentes
  const eventosIds = Array.from(new Set(elegiveis.map((i: any) => i.evento_id)));
  const { data: configs } = await supabase
    .from('evento_certificado_config')
    .select('*')
    .in('evento_id', eventosIds);

  const configMap = new Map<string, any>();
  if (configs) {
    for (const c of configs) {
      configMap.set(c.evento_id, c);
    }
  }

  // 5. Monta a lista tipada e segura de certificados
  const certificados = elegiveis.map((insc: any) => {
    const ev = insc.eventos || {};
    const cfg = configMap.get(insc.evento_id) || null;
    const sup = insc.supervisoes?.nome || null;
    const cam = insc.campos?.nome || null;

    const codigoValidacao = insc.qr_code as string;
    const urlValidacao = `/certificado/${codigoValidacao}`;

    return {
      id: insc.id,
      inscricaoId: insc.id,
      eventoId: ev.id,
      codigoValidacao,
      urlValidacao,
      nomeInscrito: insc.nome_inscrito || ministro.name,
      cargo: ministro.cargo_ministerial || null,
      campo: cam,
      supervisao: sup,

      // Dados do Evento
      evento: {
        id: ev.id,
        nome: ev.nome,
        slug: ev.slug,
        departamento: ev.departamento,
        dataInicio: ev.data_inicio,
        dataFim: ev.data_fim,
        local: ev.local,
        cidade: ev.cidade,
      },

      // Configuração visual para geração de PDF (certificado-pdf.ts)
      config: cfg
        ? {
            arteUrl: cfg.arte_url || null,
            textoCorpo: cfg.texto_corpo || null,
            rodapeTexto: cfg.rodape_texto || null,
            assinaturaNome: cfg.assinatura_nome || null,
            assinaturaCargo: cfg.assinatura_cargo || null,
            orientacao: (cfg.orientacao as 'landscape' | 'portrait') || 'landscape',
            fonteTamanho: cfg.fonte_tamanho || 16,
            elementosJson: cfg.elementos_json || null,
          }
        : null,

      // Metadados de emissão e presença
      checkinAt: insc.checkin_at || null,
      certificadoEnviado: !!insc.certificado_enviado,
      createdAt: insc.created_at,
    };
  });

  return NextResponse.json({
    ministro: {
      id: ministro.id,
      nome: ministro.name,
    },
    total: certificados.length,
    certificados,
  });
}
