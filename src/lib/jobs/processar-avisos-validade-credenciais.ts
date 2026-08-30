/**
 * Job diário: Processamento de avisos de validade da Credencial Ministerial.
 * Identifica ministros com credenciais a vencer (<= 30 dias) e vencidas,
 * disparando notificações idempotentes via canal duplo (In-App + E-mail via Resend).
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { criarNotificacaoMinistro } from '@/lib/notificacoes-ministro';

export interface ResumoAvisosValidade {
  totalAvaliados: number;
  avisos30dEnviados: number;
  avisosVencidosEnviados: number;
  erros: number;
}

const TITULO_30D = 'Sua Credencial Está Próxima do Vencimento';
const TITULO_VENCIDA = 'Sua Credencial Está Vencida';

// Janela de retenção para evitar reenvios repetidos (45 dias)
const JANELA_ANTI_DUPLICIDADE_DIAS = 45;

function fmtDataBr(dataStr: string): string {
  if (!dataStr) return '—';
  const d = new Date(dataStr.includes('T') ? dataStr : dataStr + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export async function processarAvisosValidadeCredenciais(
  supabase: SupabaseClient,
): Promise<ResumoAvisosValidade> {
  const resumo: ResumoAvisosValidade = {
    totalAvaliados: 0,
    avisos30dEnviados: 0,
    avisosVencidosEnviados: 0,
    erros: 0,
  };

  const hoje = new Date();
  const hojeStr = hoje.toISOString().slice(0, 10);
  const em30d = new Date(Date.now() + 30 * 24 * 3600 * 1000);
  const em30dStr = em30d.toISOString().slice(0, 10);
  const dataCorteAntiDuplicidade = new Date(Date.now() - JANELA_ANTI_DUPLICIDADE_DIAS * 24 * 3600 * 1000).toISOString();

  // ── 1. Processar credenciais vencendo em até 30 dias (ativas e no intervalo hoje .. hoje+30d) ──
  try {
    const { data: ministros30d, error: err30d } = await supabase
      .from('members')
      .select('id, name, cred_validade, custom_fields')
      .eq('status', 'active')
      .gte('cred_validade', hojeStr)
      .lte('cred_validade', em30dStr);

    if (err30d) {
      console.error('[job/validade-credencial] Erro ao buscar ministros 30d:', err30d.message);
      resumo.erros++;
    } else if (ministros30d) {
      resumo.totalAvaliados += ministros30d.length;

      for (const m of ministros30d) {
        try {
          // Checagem de Idempotência: verifica se já notificamos nos últimos 45 dias
          const { data: jaNotificado } = await supabase
            .from('ministro_portal_notificacoes')
            .select('id')
            .eq('ministro_id', m.id)
            .eq('tipo', 'credencial')
            .eq('titulo', TITULO_30D)
            .gte('created_at', dataCorteAntiDuplicidade)
            .limit(1)
            .maybeSingle();

          if (!jaNotificado) {
            const dataFormatada = fmtDataBr(m.cred_validade);
            const res = await criarNotificacaoMinistro({
              ministroId: m.id,
              tipo: 'credencial',
              titulo: TITULO_30D,
              mensagem: `Sua credencial ministerial vencerá em ${dataFormatada}. Acesse a Central de Credencial para solicitar sua renovação antecipada e manter sua regularidade.`,
              linkAcao: '/portal-ministro/credencial',
              canal: 'ambos',
            });

            if (res.sucesso) {
              resumo.avisos30dEnviados++;
            } else {
              resumo.erros++;
            }
          }
        } catch (mErr: any) {
          console.error(`[job/validade-credencial] Erro ao processar ministro 30d (${m.id}):`, mErr?.message);
          resumo.erros++;
        }
      }
    }
  } catch (err: any) {
    console.error('[job/validade-credencial] Falha na etapa de 30 dias:', err?.message);
    resumo.erros++;
  }

  // ── 2. Processar credenciais vencidas (ativas e com cred_validade < hoje) ──
  try {
    const { data: ministrosVencidos, error: errVencidos } = await supabase
      .from('members')
      .select('id, name, cred_validade, custom_fields')
      .eq('status', 'active')
      .lt('cred_validade', hojeStr);

    if (errVencidos) {
      console.error('[job/validade-credencial] Erro ao buscar ministros vencidos:', errVencidos.message);
      resumo.erros++;
    } else if (ministrosVencidos) {
      resumo.totalAvaliados += ministrosVencidos.length;

      for (const m of ministrosVencidos) {
        try {
          // Checagem de Idempotência: verifica se já notificamos sobre vencimento nos últimos 45 dias
          const { data: jaNotificado } = await supabase
            .from('ministro_portal_notificacoes')
            .select('id')
            .eq('ministro_id', m.id)
            .eq('tipo', 'credencial')
            .eq('titulo', TITULO_VENCIDA)
            .gte('created_at', dataCorteAntiDuplicidade)
            .limit(1)
            .maybeSingle();

          if (!jaNotificado) {
            const dataFormatada = fmtDataBr(m.cred_validade);
            const res = await criarNotificacaoMinistro({
              ministroId: m.id,
              tipo: 'credencial',
              titulo: TITULO_VENCIDA,
              mensagem: `Sua credencial ministerial expirou em ${dataFormatada}. Por favor, solicite a renovação na Central de Credencial ou contate a Secretaria da sua Supervisão para regularização.`,
              linkAcao: '/portal-ministro/credencial',
              canal: 'ambos',
            });

            if (res.sucesso) {
              resumo.avisosVencidosEnviados++;
            } else {
              resumo.erros++;
            }
          }
        } catch (mErr: any) {
          console.error(`[job/validade-credencial] Erro ao processar ministro vencido (${m.id}):`, mErr?.message);
          resumo.erros++;
        }
      }
    }
  } catch (err: any) {
    console.error('[job/validade-credencial] Falha na etapa de vencidos:', err?.message);
    resumo.erros++;
  }

  return resumo;
}
