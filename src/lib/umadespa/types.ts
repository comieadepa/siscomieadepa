export interface UmadespaConfiguracao {
  id: string;
  ano_exercicio: number;
  taxa_primeira_via: number;
  taxa_segunda_via: number;
  meses_validade_carteirinha: number;
  idade_maxima_cadastro_publico: number;
  permite_cadastro_publico: boolean;
  chave_pix_manual?: string | null;
  instrucoes_pagamento?: string | null;
  created_at: string;
  updated_at: string;
}

export interface UmadespaAssociado {
  id: string;
  numero_umadespa?: string | null;
  matricula?: string | null;
  supervisao_id: string;
  campo_id: string;
  congregacao_id?: string | null;

  // Hierarquia enriquecida (joins)
  supervisao_nome?: string;
  campo_nome?: string;
  congregacao_nome?: string;

  // Dados Pessoais
  nome: string;
  cpf: string;
  rg?: string | null;
  orgao_emissor?: string | null;
  data_nascimento: string;
  sexo: 'MASCULINO' | 'FEMININO';
  nacionalidade: string;
  naturalidade?: string | null;
  tipo_sanguineo?: string | null;

  // Filiação e Eleitoral
  nome_pai?: string | null;
  nome_mae?: string | null;
  titulo_eleitoral?: string | null;

  // Menor de idade / Responsável legal
  menor_idade: boolean;
  responsavel_nome?: string | null;
  responsavel_cpf?: string | null;
  responsavel_fone?: string | null;
  responsavel_termo_aceite: boolean;

  // Contato e Foto
  fone?: string | null;
  email?: string | null;
  foto_url?: string | null;

  // Função e Liderança
  funcao: string;
  is_lideranca: boolean;
  cargo_detalhe?: string | null;

  origem_cadastro: 'publico' | 'administrativo';
  status: 'ativo' | 'pendente' | 'inativo' | 'regularizacao';

  custom_fields?: Record<string, any>;
  created_at: string;
  updated_at: string;

  // Última solicitação / Situação Financeira (agregada)
  solicitacao_ativa?: UmadespaCarteirinhaSolicitacao | null;
}

export type StatusCarteirinhaUmadespa =
  | 'aguardando_pagamento'
  | 'processando_pagamento'
  | 'pago'
  | 'em_impressao'
  | 'impressa'
  | 'entregue'
  | 'cancelada';

export interface UmadespaCarteirinhaSolicitacao {
  id: string;
  associado_id: string;
  via: number;
  valor: number;
  validade_meses: number;
  validade_data?: string | null;

  idempotency_key: string;
  asaas_payment_id?: string | null;
  asaas_customer_id?: string | null;
  pix_copia_cola?: string | null;
  pix_qr_code_url?: string | null;
  invoice_url?: string | null;

  status: StatusCarteirinhaUmadespa;

  solicitado_em: string;
  pago_em?: string | null;
  impresso_em?: string | null;
  entregue_em?: string | null;
  cancelado_em?: string | null;
  motivo_cancelamento?: string | null;

  entregue_por?: string | null;
  entregue_para?: string | null;
  observacoes?: string | null;

  created_at: string;
  updated_at: string;
}

export interface UmadespaFuncaoHistorico {
  id: string;
  associado_id: string;
  funcao_anterior?: string | null;
  funcao_nova: string;
  is_lideranca: boolean;
  alterado_por?: string | null;
  motivo?: string | null;
  data_inicio: string;
  created_at: string;
}

export interface ValidacaoElegibilidadeResult {
  valido: boolean;
  idade: number;
  menorIdade: boolean;
  erros: string[];
}
