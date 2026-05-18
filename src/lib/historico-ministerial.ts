/**
 * registrarHistoricoMinisterial — helper server-side centralizado.
 *
 * Deve ser chamado APENAS de API routes (server-side).
 * Nunca expõe o service-role client no browser.
 *
 * Falhas são silenciosas (warn) para não interromper o fluxo principal.
 */
import { createServerClient } from '@/lib/supabase-server';

export interface HistoricoMinisterialPayload {
  /** UUID do ministro (member_id) */
  ministroId: string;
  /** Tipo canônico do evento (ex: 'credencial_emitida', 'carta_emitida') */
  tipo: string;
  /** Título curto legível */
  titulo: string;
  /** Descrição detalhada */
  descricao: string;
  /** Fonte do registro para badge automático/manual e deduplicação */
  origem?: string | null;
  /**
   * ID externo usado para deduplicação.
   * Quando definido junto com `origem`, impede registro duplicado
   * para o mesmo evento (ex: mesmo id de cartao_gerado ou carta).
   */
  referenciaId?: string | null;
  /** Data ISO do fato (YYYY-MM-DD). Padrão: hoje. */
  ocorrencia?: string;
  /** UUID do usuário que desencadeou a ação */
  criadoPor?: string | null;
  /** Nome legível do usuário */
  nomeUsuario?: string | null;
}

export async function registrarHistoricoMinisterial(
  payload: HistoricoMinisterialPayload,
): Promise<void> {
  try {
    const {
      ministroId,
      tipo,
      titulo,
      descricao,
      origem = null,
      referenciaId = null,
      ocorrencia = new Date().toISOString().split('T')[0],
      criadoPor = null,
      nomeUsuario = null,
    } = payload;

    if (!ministroId || !tipo || !descricao) return;

    const supabase = createServerClient();

    // Verificação antecipada de duplicata antes do insert
    if (origem && referenciaId) {
      const { data: existing } = await supabase
        .from('member_history')
        .select('id')
        .eq('member_id', ministroId)
        .eq('origem', origem)
        .eq('referencia_id', referenciaId)
        .maybeSingle();

      if (existing?.id) return; // já existe, ignora
    }

    await supabase.from('member_history').insert({
      member_id: ministroId,
      tipo,
      titulo: titulo || tipo,
      descricao,
      origem: origem ?? null,
      referencia_id: referenciaId ?? null,
      usuario_id: criadoPor ?? null,
      usuario_nome: nomeUsuario ?? null,
      ocorrencia,
    });
  } catch (err) {
    // Nunca deixar o histórico derrubar o fluxo principal
    console.warn('[registrarHistoricoMinisterial] falha silenciosa:', err);
  }
}
