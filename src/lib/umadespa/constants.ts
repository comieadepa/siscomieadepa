/**
 * Constantes Oficiais e Parâmetros Operacionais da UMADESPA
 * Módulo de Juventude das Assembleias de Deus no Estado do Pará
 */

export const UMADESPA_PALETTE = {
  primary: '#047857', // emerald-700
  primaryHover: '#065f46', // emerald-800
  primaryLight: '#ecfdf5', // emerald-50
  accent: '#10b981', // emerald-500
  gold: '#d97706', // amber-600
  navyBackground: '#064e3b', // emerald-950
  badgeBg: '#d1fae5',
  badgeText: '#065f46',
} as const;

export const VALOR_PADRAO_CARTEIRINHA_UMADESPA = 25.0;
export const VALOR_PADRAO_CARTEIRINHA_UMADESPA_FORMATADO = 'R$ 25,00';
export const VALIDADE_PADRAO_MESES = 24;
export const IDADE_MAXIMA_CADASTRO_PUBLICO = 30;
export const FUNCAO_PADRAO_INICIAL = 'Membro';

export const FUNCOES_UMADESPA = [
  { id: 'Membro', label: 'Jovem Membro', isLideranca: false },
  { id: 'Líder de Mocidade', label: 'Líder de Mocidade', isLideranca: true },
  { id: 'Vice-Líder de Mocidade', label: 'Vice-Líder de Mocidade', isLideranca: true },
  { id: 'Secretário(a) de Mocidade', label: 'Secretário(a) de Mocidade', isLideranca: true },
  { id: 'Regente / Diretor de Louvor', label: 'Regente / Louvor', isLideranca: true },
  { id: 'Coordenador(a) de Área', label: 'Coordenador(a) de Área', isLideranca: true },
  { id: 'Coordenador(a) Geral', label: 'Coordenador(a) Geral', isLideranca: true },
  { id: 'Assessor(a) de Juventude', label: 'Assessor(a) de Juventude', isLideranca: true },
] as const;

export const STATUS_CARTEIRINHA_LABELS: Record<string, string> = {
  aguardando_pagamento: 'Aguardando Pagamento',
  processando_pagamento: 'Processando PIX',
  pago: 'Pago / Aguardando Impressão',
  em_impressao: 'Em Impressão',
  impressa: 'Impressa / Pronta',
  entregue: 'Entregue',
  cancelada: 'Cancelada',
};

export const STATUS_ASSOCIADO_LABELS: Record<string, string> = {
  pendente: 'Cadastro Pendente',
  ativo: 'Ativo',
  inativo: 'Inativo',
  regularizacao: 'Em Regularização',
};
