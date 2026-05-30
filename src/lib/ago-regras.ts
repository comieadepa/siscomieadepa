/**
 * Regras compartilhadas para o AGO (Assembleia Geral Ordinária).
 * Usado pelo Portal público, pelo Balcão e pelos endpoints de API.
 */

// ─── Tipos ────────────────────────────────────────────────────

export interface ConfigCampoMissionario {
  enabled: boolean;
  valor_pastor_presidente: number; // em reais (float)
  valor_esposa: number;            // em reais (float)
}

/** Estrutura salva no JSONB configuracoes_ago */
export interface ConfiguracoesAgo {
  enabled?: boolean;
  grupos?: string[];
  leitos_inferiores_preferenciais?: boolean;
  preferencia_60_mais?: boolean;
  preferencia_necessidade_especial?: boolean;
  observacoes?: string;
  habilitar_controle_plenarias?: boolean;
  plenarias_datas?: string[];
  // Campo Missionário — versão legada (mantida para retrocompat)
  habilitar_desconto_campo_missionario?: boolean;
  valor_pastor_presidente_campo_missionario?: number | string;
  // Campo Missionário — versão nova
  campo_missionario?: {
    enabled?: boolean;
    valor_pastor_presidente?: number | string;
    valor_esposa?: number | string;
  } | null;
  setores?: unknown[];
}

// ─── Parsers ──────────────────────────────────────────────────

/**
 * Extrai a configuração normalizada de Campo Missionário a partir do JSONB.
 * Prioriza a nova estrutura `campo_missionario.*`; usa fallback para a legada.
 */
export function parseCampoMissionarioConfig(
  configuracoes_ago: ConfiguracoesAgo | null | undefined
): ConfigCampoMissionario | null {
  if (!configuracoes_ago) return null;

  const novo = configuracoes_ago.campo_missionario;
  if (novo?.enabled) {
    const valorPP = parseFloat(String(novo.valor_pastor_presidente ?? '0')) || 0;
    const valorEsposa = parseFloat(String(novo.valor_esposa ?? '0')) || 0;
    if (valorPP > 0 || valorEsposa > 0) {
      return { enabled: true, valor_pastor_presidente: valorPP, valor_esposa: valorEsposa };
    }
  }

  // Fallback legado
  if (configuracoes_ago.habilitar_desconto_campo_missionario) {
    const valorPP = parseFloat(String(configuracoes_ago.valor_pastor_presidente_campo_missionario ?? '0')) || 0;
    if (valorPP > 0) {
      return { enabled: true, valor_pastor_presidente: valorPP, valor_esposa: valorPP };
    }
  }

  return null;
}

// ─── Helpers de valor ─────────────────────────────────────────

/**
 * Retorna o valor a cobrar do Pastor Presidente de campo missionário.
 * Retorna 0 se a config não existir ou não estiver habilitada.
 */
export function resolveValorPastorMissionario(config: ConfigCampoMissionario | null): number {
  return config?.enabled ? config.valor_pastor_presidente : 0;
}

/**
 * Retorna o valor a cobrar da Esposa de Pastor Presidente de campo missionário.
 * Retorna 0 se a config não existir ou não estiver habilitada.
 */
export function resolveValorEsposa(config: ConfigCampoMissionario | null): number {
  return config?.enabled ? config.valor_esposa : 0;
}

// ─── Helpers de elegibilidade ─────────────────────────────────

/**
 * Verifica se um inscrito é elegível ao valor especial de campo missionário.
 * @param isPastorPresidente - flag do banco (pastor_presidente = true)
 * @param isCampoMissionario - flag do campo (is_campo_missionario = true)
 * @param status - status ministerial (deve ser 'active' ou 'ativo')
 */
export function elegivelaoCampoMissionario(
  isPastorPresidente: boolean,
  isCampoMissionario: boolean,
  status: string | null
): boolean {
  const ativo = ['active', 'ativo'].includes((status ?? '').toLowerCase());
  return ativo && isPastorPresidente && isCampoMissionario;
}
