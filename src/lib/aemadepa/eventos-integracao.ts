/**
 * Utilitários e Tipos de Integração AEMADEPA para Inscrições de Eventos
 */

export type CategoriaAemadepa =
  | 'esposa_presidente'
  | 'esposa_auxiliar'
  | 'esposa_jubilado'
  | 'esposa_falecido';

export interface ValidacaoDataNascimentoResult {
  valida: boolean;
  idade: number | null;
  motivoInvalido?: string;
}

/**
 * Valida se uma data de nascimento é coerente e cronologicamente possível
 */
export function validarDataNascimento(dataNasc: string | null | undefined): ValidacaoDataNascimentoResult {
  if (!dataNasc || typeof dataNasc !== 'string' || !dataNasc.trim()) {
    return { valida: false, idade: null, motivoInvalido: 'Data de nascimento ausente' };
  }

  const str = dataNasc.trim().split('T')[0];
  const parts = str.split('-');
  if (parts.length !== 3) {
    return { valida: false, idade: null, motivoInvalido: 'Formato de data inválido' };
  }

  const ano = parseInt(parts[0], 10);
  const mes = parseInt(parts[1], 10);
  const dia = parseInt(parts[2], 10);

  if (Number.isNaN(ano) || Number.isNaN(mes) || Number.isNaN(dia)) {
    return { valida: false, idade: null, motivoInvalido: 'Data de nascimento não numérica' };
  }

  const hoje = new Date();
  const anoAtual = hoje.getFullYear();

  // Ano deve ser razoável: não pode ser no futuro nem anterior a 1900 ou ano bizarro como 9195
  if (ano < 1900 || ano > anoAtual) {
    return { valida: false, idade: null, motivoInvalido: `Ano de nascimento incoerente (${ano})` };
  }

  if (mes < 1 || mes > 12) {
    return { valida: false, idade: null, motivoInvalido: `Mês inválido (${mes})` };
  }

  if (dia < 1 || dia > 31) {
    return { valida: false, idade: null, motivoInvalido: `Dia inválido (${dia})` };
  }

  const d = new Date(ano, mes - 1, dia);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) {
    return { valida: false, idade: null, motivoInvalido: 'Data inexistente no calendário' };
  }

  let idade = anoAtual - ano;
  const mesAtual = hoje.getMonth() + 1;
  const diaAtual = hoje.getDate();
  if (mesAtual < mes || (mesAtual === mes && diaAtual < dia)) {
    idade -= 1;
  }

  if (idade < 12 || idade > 120) {
    return { valida: false, idade, motivoInvalido: `Idade fora dos limites operacionais (${idade} anos)` };
  }

  return { valida: true, idade };
}

export interface AemadepaElegibilidadeInfo {
  isAemadepa: boolean;
  categoriaAemadepa: CategoriaAemadepa | null;
  categoriaLabel: string | null;
  cadastroRegularizado: boolean;
  motivoIrregularidade: string | null;
  elegivelGratuidade: boolean;
  isCampoMissionario: boolean;
  ministroId: string | null;
  ministroNome: string | null;
  ministroStatus: string | null;
  ministroCargo: string | null;
}

/**
 * Determina a categoria e elegibilidade da associada AEMADEPA segundo os dados dela e do ministro vinculado.
 * Aplica o CRITÉRIO 1:
 * - CPF válido e nome consistente
 * - Data de nascimento válida (sem datas impossíveis como 9195)
 * - Registro na aemadepa_associadas
 * - Vínculo comprovado com ministro em members (jubilado, falecido, presidente ou auxiliar)
 */
export function avaliarElegibilidadeAemadepa(params: {
  associada: {
    id: string;
    nome: string | null;
    cpf: string | null;
    data_nascimento: string | null;
  };
  ministro: {
    id: string;
    name: string | null;
    status: string | null;
    pastor_presidente: boolean | null;
    pastor_auxiliar: boolean | null;
    jubilado: boolean | null;
    is_campo_missionario?: boolean | null;
  } | null;
}): AemadepaElegibilidadeInfo {
  const { associada, ministro } = params;

  if (!ministro) {
    return {
      isAemadepa: true,
      categoriaAemadepa: null,
      categoriaLabel: null,
      cadastroRegularizado: false,
      motivoIrregularidade: 'Vínculo com ministro não localizado no sistema',
      elegivelGratuidade: false,
      isCampoMissionario: false,
      ministroId: null,
      ministroNome: null,
      ministroStatus: null,
      ministroCargo: null,
    };
  }

  const validacaoData = validarDataNascimento(associada.data_nascimento);
  const dataValida = validacaoData.valida;
  const motivoData = validacaoData.motivoInvalido || null;

  const nomeValido = Boolean(associada.nome && associada.nome.trim().length >= 3);
  const cadastroConsistente = nomeValido && dataValida;

  const minStatus = String(ministro.status || '').toLowerCase().trim();
  const isDeceased = minStatus === 'deceased' || minStatus.includes('falec');
  const isJubilado = !!ministro.jubilado;
  const isPres = !!ministro.pastor_presidente;
    const isCampoMissionario = !!ministro.is_campo_missionario;

  let categoriaAemadepa: CategoriaAemadepa = 'esposa_auxiliar';
  let categoriaLabel = 'Esposa de Pastor Auxiliar';
  let elegivelGratuidade = false;

  if (isDeceased) {
    categoriaAemadepa = 'esposa_falecido';
    categoriaLabel = 'Esposa de Pastor Falecido (Viúva)';
    elegivelGratuidade = cadastroConsistente;
  } else if (isJubilado) {
    categoriaAemadepa = 'esposa_jubilado';
    categoriaLabel = 'Esposa de Pastor Jubilado';
    elegivelGratuidade = cadastroConsistente;
  } else if (isPres) {
    categoriaAemadepa = 'esposa_presidente';
    categoriaLabel = isCampoMissionario
      ? 'Esposa de Pastor Presidente (Campo Missionário)'
      : 'Esposa de Pastor Presidente';
    elegivelGratuidade = false;
  } else {
    // Demais ministros ativos (auxiliares, evangelistas etc)
    categoriaAemadepa = 'esposa_auxiliar';
    categoriaLabel = 'Esposa de Pastor Auxiliar';
    elegivelGratuidade = false;
  }

  let motivoIrregularidade: string | null = null;
  if (!cadastroConsistente) {
    motivoIrregularidade = !nomeValido
      ? 'Nome cadastral incompleto'
      : motivoData || 'Data de nascimento inválida';
  }

  return {
    isAemadepa: true,
    categoriaAemadepa,
    categoriaLabel,
    cadastroRegularizado: cadastroConsistente,
    motivoIrregularidade,
    elegivelGratuidade,
    isCampoMissionario,
    ministroId: ministro.id,
    ministroNome: ministro.name || null,
    ministroStatus: ministro.status || null,
    ministroCargo: null,
  };
}
