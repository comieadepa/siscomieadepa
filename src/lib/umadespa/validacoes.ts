import { cleanCpf, isValidCpf } from '@/lib/cpf';
import { IDADE_MAXIMA_CADASTRO_PUBLICO, FUNCAO_PADRAO_INICIAL } from './constants';
import type { ValidacaoElegibilidadeResult } from './types';

/**
 * Calcula a idade com precisão com base na data de nascimento (formato YYYY-MM-DD)
 */
export function calcularIdade(dataNascimento: string | Date): number {
  const dNasc = typeof dataNascimento === 'string' ? new Date(`${dataNascimento}T00:00:00`) : dataNascimento;
  if (isNaN(dNasc.getTime())) return -1;

  const hoje = new Date();
  let idade = hoje.getFullYear() - dNasc.getFullYear();
  const mesAtual = hoje.getMonth();
  const diaAtual = hoje.getDate();
  const mesNasc = dNasc.getMonth();
  const diaNasc = dNasc.getDate();

  if (mesAtual < mesNasc || (mesAtual === mesNasc && diaAtual < diaNasc)) {
    idade--;
  }

  return Math.max(0, idade);
}

/**
 * Validação de Elegibilidade Cadastral UMADESPA
 * Regras:
 * - Cadastro público: idade até 30 anos (inclusive).
 * - Menores de 18 anos exigem nome, CPF válido e telefone do responsável legal.
 * - Cadastro administrativo: permite maiores de 30 anos (líderes, assessores, coordenação).
 */
export function validarElegibilidadeUmadespa(params: {
  dataNascimento: string;
  origemCadastro?: 'publico' | 'administrativo';
  menorIdade?: boolean;
  responsavelNome?: string | null;
  responsavelCpf?: string | null;
  responsavelFone?: string | null;
  responsavelTermoAceite?: boolean;
}): ValidacaoElegibilidadeResult {
  const erros: string[] = [];
  const idade = calcularIdade(params.dataNascimento);

  if (idade === -1) {
    erros.push('Data de nascimento inválida.');
    return { valido: false, idade: 0, menorIdade: false, erros };
  }

  const isPublico = params.origemCadastro !== 'administrativo';
  const isMenor = idade < 18;

  // Regra de idade pública (até 30 anos)
  if (isPublico && idade > IDADE_MAXIMA_CADASTRO_PUBLICO) {
    erros.push(
      `O cadastro público da UMADESPA é restrito a jovens de até ${IDADE_MAXIMA_CADASTRO_PUBLICO} anos. Líderes acima dessa idade devem ser cadastrados pela Secretaria/Coordenação.`
    );
  }

  // Regra de Menor de Idade
  if (isMenor) {
    if (!params.responsavelNome || params.responsavelNome.trim().length < 3) {
      erros.push('Nome do responsável legal é obrigatório para menores de 18 anos.');
    }

    if (!params.responsavelCpf || !isValidCpf(cleanCpf(params.responsavelCpf))) {
      erros.push('CPF válido do responsável legal é obrigatório para menores de 18 anos.');
    }

    if (!params.responsavelFone || cleanCpf(params.responsavelFone).length < 10) {
      erros.push('Telefone de contato do responsável legal é obrigatório para menores de 18 anos.');
    }

    if (!params.responsavelTermoAceite) {
      erros.push('É necessário o aceite do termo de autorização do responsável legal.');
    }
  }

  return {
    valido: erros.length === 0,
    idade,
    menorIdade: isMenor,
    erros,
  };
}

/**
 * Validação de Função e Liderança
 * No cadastro público a função é forçada a 'Membro' e isLideranca = false.
 */
export function sanitizarFuncaoCadastro(params: {
  funcao?: string;
  isLideranca?: boolean;
  origemCadastro?: 'publico' | 'administrativo';
}): { funcao: string; isLideranca: boolean } {
  if (params.origemCadastro !== 'administrativo') {
    return {
      funcao: FUNCAO_PADRAO_INICIAL,
      isLideranca: false,
    };
  }

  return {
    funcao: params.funcao?.trim() || FUNCAO_PADRAO_INICIAL,
    isLideranca: Boolean(params.isLideranca),
  };
}
