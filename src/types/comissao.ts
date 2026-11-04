export type ComissaoTipo = 'permanente' | 'temporaria' | 'especial' | 'ago';
export type ComissaoStatus = 'ativa' | 'inativa' | 'concluida' | 'suspensa';
export type IntegranteStatus = 'ativo' | 'substituido' | 'licenciado' | 'desligado';

export interface Comissao {
  id: string;
  nome: string;
  sigla?: string | null;
  finalidade: string;
  tipo: ComissaoTipo;
  status: ComissaoStatus;
  ato_nomeacao?: string | null;
  data_inicio: string;
  data_fim?: string | null;
  ano_referencia?: number | null;
  evento_id?: string | null;
  observacoes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;

  // Relações opcionais expandidas
  evento?: {
    id: string;
    nome: string;
    data_inicio?: string;
  } | null;
  integrantes_count?: number;
  integrantes?: ComissaoIntegrante[];
}

export interface ComissaoIntegrante {
  id: string;
  comissao_id: string;
  ministro_id: string;
  cargo: string;
  ordem_hierarquia: number;
  status: IntegranteStatus;
  data_entrada: string;
  data_saida?: string | null;
  motivo_saida?: string | null;
  substituido_por_id?: string | null;
  observacoes?: string | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;

  // Dados do ministro oficial associado
  ministro?: {
    id: string;
    name: string;
    cpf?: string | null;
    cargo_ministerial?: string | null;
    numero_cgadb?: string | null;
    registro_comieadepa?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    foto_url?: string | null;
    campo_nome?: string | null;
  } | null;

  substituido_por?: {
    id: string;
    name: string;
  } | null;
}

export interface ComissaoInput {
  nome: string;
  sigla?: string;
  finalidade: string;
  tipo?: ComissaoTipo;
  status?: ComissaoStatus;
  ato_nomeacao?: string;
  data_inicio: string;
  data_fim?: string;
  ano_referencia?: number;
  evento_id?: string;
  observacoes?: string;
}

export interface IntegranteInput {
  comissao_id: string;
  ministro_id: string;
  cargo: string;
  ordem_hierarquia?: number;
  status?: IntegranteStatus;
  data_entrada: string;
  data_saida?: string;
  motivo_saida?: string;
  substituido_por_id?: string;
  observacoes?: string;
}

export interface ComissaoFiltros {
  status?: string;
  tipo?: string;
  ano?: number | string;
  search?: string;
}

export const CARGOS_COMISSAO_PADRAO = [
  { cargo: 'Presidente', ordem: 1 },
  { cargo: 'Vice-Presidente', ordem: 2 },
  { cargo: 'Relator', ordem: 3 },
  { cargo: '1º Secretário', ordem: 4 },
  { cargo: '2º Secretário', ordem: 5 },
  { cargo: 'Membro Vogal', ordem: 10 },
  { cargo: 'Membro', ordem: 20 },
  { cargo: 'Consultor Teológico', ordem: 30 },
  { cargo: 'Assessor Jurídico', ordem: 40 },
] as const;
