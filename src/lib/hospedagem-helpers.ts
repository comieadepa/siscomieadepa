/**
 * hospedagem-helpers.ts
 * Helpers para prioridade e autoalocação de hospedagem AGO.
 */

// ─── Tipos ────────────────────────────────────────────────────
export interface InscricaoParaHospedagem {
  id: string;
  nome_inscrito: string;
  sexo: string | null;
  data_nascimento: string | null;
  tipo_inscricao: string | null;
  hosp_necessidade_especial: boolean;
  hosp_descricao_necessidade: string | null;
  hosp_cama_inferior: boolean;
  hosp_observacoes: string | null;
  hosp_possui_comorbidade?: boolean;
  hosp_descricao_comorbidade?: string | null;
  grupo_hospedagem?: string | null;
}

export interface HospedagemAGOInput {
  sexo: string | null;
  data_nascimento: string | null;
  tipo_inscricao: string | null;
  hosp_necessidade_especial?: boolean;
  hosp_possui_comorbidade?: boolean;
}

export interface Alojamento {
  id: string;
  evento_id: string;
  nome: string;
  publico: string;   // feminino | presidentes | jubilados | masculino_geral | misto
  sexo: string | null; // M | F | null (misto)
  total_vagas: number;
  camas_inferiores: number;
  camas_superiores: number;
  ativo: boolean;
  // Vagas calculadas (da view v_vagas_alojamento)
  vagas_livres?: number;
  inferiores_livres?: number;
  superiores_livres?: number;
}

export interface SugestaoHospedagem {
  alojamento_id: string | null;
  tipo_cama: 'inferior' | 'superior' | null;
  status: 'confirmada' | 'lista_espera';
  prioridade: number;
  prioridadeInferiorNaoAtendida?: boolean;
}

// ─── Prioridade ───────────────────────────────────────────────

/**
 * Calcula a prioridade numérica de uma inscrição para hospedagem AGO.
 * Pontuação maior = atendido primeiro.
 */
export function calcularPrioridadeHospedagem(inscricao: InscricaoParaHospedagem): number {
  let pontos = 0;

  // Necessidade especial → máxima prioridade
  if (inscricao.hosp_necessidade_especial) pontos += 100;

  // Cama inferior solicitada (ex: coluna, cirurgia)
  if (inscricao.hosp_cama_inferior) pontos += 80;

  // Comorbidade relevante precisa de atencao adicional
  if (inscricao.hosp_possui_comorbidade) pontos += 60;

  // Idade > 70 ou > 60
  const idade = calcularIdade(inscricao.data_nascimento);
  if (idade !== null) {
    if (idade > 70) pontos += 70;
    else if (idade > 60) pontos += 50;
  }

  // Jubilado detectado pelo tipo de inscrição
  const tipoLower = (inscricao.tipo_inscricao ?? '').toLowerCase();
  if (tipoLower.includes('jubilado')) pontos += 40;

  // Pastor presidente
  if (tipoLower.includes('presidente')) pontos += 30;

  return pontos;
}

export function resolveCamaInferiorAutomatica(input: HospedagemAGOInput): boolean {
  const idade = calcularIdade(input.data_nascimento);
  const idadePrioritaria = idade !== null && idade >= 60;
  return idadePrioritaria || !!input.hosp_necessidade_especial || !!input.hosp_possui_comorbidade;
}

export function resolveGrupoHospedagemAGO(input: HospedagemAGOInput): string {
  const norm = (v: string | null | undefined) =>
    (v ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const tipo = norm(input.tipo_inscricao);
  const sexo = (input.sexo ?? '').toUpperCase();

  const ehEsposaOuViuva = tipo.includes('esposa') || tipo.includes('viuva') || tipo.includes('viúva');
  if (sexo === 'F' || ehEsposaOuViuva) return 'Mulheres';

  if (tipo.includes('presidente') || tipo.includes('jubilado') || tipo.includes('campo missionario')) {
    return 'Pastor Presidente / Pastor Jubilado';
  }

  // Categorias masculinas de juventude devem sempre cair neste grupo,
  // independentemente de pagamento ou status operacional.
  const ehJuventudeMasculina =
    sexo === 'M' && (
      tipo.includes('juventude')
      || tipo.includes('jovem')
      || tipo.includes('jovens')
      || tipo.includes('umadepa')
    );

  if (ehJuventudeMasculina || tipo.includes('auxiliar') || tipo.includes('juventude') || sexo === 'M') {
    return 'Pastor Auxiliar / Juventude';
  }

  return 'Misto';
}

function calcularIdade(dataNascimento: string | null): number | null {
  if (!dataNascimento) return null;
  const nasc = new Date(dataNascimento);
  if (isNaN(nasc.getTime())) return null;
  const hoje = new Date();
  let anos = hoje.getFullYear() - nasc.getFullYear();
  const meses = hoje.getMonth() - nasc.getMonth();
  if (meses < 0 || (meses === 0 && hoje.getDate() < nasc.getDate())) anos--;
  return anos;
}

// ─── Perfil AGO ───────────────────────────────────────────────

type PerfilAGO = 'feminino' | 'presidentes' | 'jubilados' | 'masculino_geral' | 'misto';

export function detectarPerfilAGO(inscricao: InscricaoParaHospedagem): PerfilAGO {
  const tipoLower = (inscricao.tipo_inscricao ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const sexo = inscricao.sexo?.toUpperCase();

  if (tipoLower.includes('presidente') || tipoLower.includes('campo missionario')) return 'presidentes';
  if (tipoLower.includes('jubilado'))   return 'jubilados';
  if (sexo === 'F')                     return 'feminino';
  return 'masculino_geral';
}

// ─── Sugestão de alojamento ───────────────────────────────────

/**
 * Sugere o melhor alojamento para uma inscrição.
 * Retorna null no alojamento_id se não houver vaga disponível.
 */
/**
 * Verifica se o grupo de hospedagem da inscrição é compatível com o público do alojamento.
 * Retorna true quando não há grupo definido (sem preferência = aceita qualquer setor ativo).
 */
export function grupoMatchesAlojamento(
  grupoHospedagem: string | null | undefined,
  alojamento: { publico: string; nome: string },
): boolean {
  if (!grupoHospedagem) return true;
  if (alojamento.publico === 'misto') return true;

  const norm = (s: string) =>
    s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

  const g = norm(grupoHospedagem);
  const p = alojamento.publico.toLowerCase();
  const n = norm(alojamento.nome);

  if (p === 'presidentes' && (g.includes('presidente') || g.includes('jubilad'))) return true;
  if (p === 'jubilados'   && (g.includes('jubilad') || g.includes('presidente'))) return true;
  if (p === 'feminino'    && (g.includes('feminino') || g.includes('mulher') || g === 'f')) return true;
  if (p === 'masculino_geral' && (
    g.includes('masculino') || g.includes('auxiliar') || g.includes('juventude') || g === 'm'
  )) return true;

  // Fallback: correspondência pelo nome do alojamento
  if (n.includes(g) || g.includes(n)) return true;

  return false;
}

export function sugerirAlojamento(
  inscricao: InscricaoParaHospedagem,
  alojamentos: Alojamento[],
  prioridade: number,
): SugestaoHospedagem {
  const perfil = detectarPerfilAGO(inscricao);
  const precisaCamaInferior = inscricao.hosp_cama_inferior || inscricao.hosp_necessidade_especial;

  // Filtra alojamentos ativos com vagas livres
  // Filtra alojamentos ativos com vagas livres
  const candidatos = alojamentos
    .filter(a => a.ativo && (a.vagas_livres ?? 0) > 0)
    .filter(a => {
      // Compatibilidade de publico
      if (a.publico === 'misto') return true;
      if (a.publico === perfil)  return true;

      // AGO: Presidentes e Jubilados compartilham os mesmos alojamentos
      if (perfil === 'presidentes' && a.publico === 'jubilados') return true;
      if (perfil === 'jubilados' && a.publico === 'presidentes') return true;

      // Fallback: alojamentos por sexo
      const sexo = inscricao.sexo?.toUpperCase();
      if (a.publico === 'feminino' && sexo === 'F')          return true;
      if (a.publico === 'masculino_geral' && sexo === 'M')   return true;

      return false;
    });

  if (candidatos.length === 0) {
    return { alojamento_id: null, tipo_cama: null, status: 'lista_espera', prioridade };
  }

  // Prefere alojamento do perfil exato, depois relacionados, depois misto
  const ordenados = [...candidatos].sort((a, b) => {
    const getScore = (pub: string) => {
      if (pub === perfil) return 0;
      if (
        (perfil === 'presidentes' && pub === 'jubilados') ||
        (perfil === 'jubilados' && pub === 'presidentes')
      ) return 1;
      if (pub === 'misto') return 2;
      return 3;
    };
    return getScore(a.publico) - getScore(b.publico);
  });

  for (const aloj of ordenados) {
    if (precisaCamaInferior) {
      const infLivres = aloj.inferiores_livres ?? (aloj.camas_inferiores - 0);
      if (infLivres > 0) {
        return {
          alojamento_id: aloj.id,
          tipo_cama: 'inferior',
          status: 'confirmada',
          prioridade,
          prioridadeInferiorNaoAtendida: false,
        };
      }
      const supLivres = aloj.superiores_livres ?? (aloj.camas_superiores - 0);
      if (supLivres > 0) {
        return {
          alojamento_id: aloj.id,
          tipo_cama: 'superior',
          status: 'confirmada',
          prioridade,
          prioridadeInferiorNaoAtendida: true,
        };
      }
      continue;
    }

    // Sem preferência especial: prefere superior (deixar inferiores para prioritários)
    const supLivres = aloj.superiores_livres ?? (aloj.camas_superiores - 0);
    if (supLivres > 0) {
      return {
        alojamento_id: aloj.id,
        tipo_cama: 'superior',
        status: 'confirmada',
        prioridade,
        prioridadeInferiorNaoAtendida: false,
      };
    }

    // Se só tem inferior sobrando
    const infLivres = aloj.inferiores_livres ?? 0;
    if (infLivres > 0) {
      return {
        alojamento_id: aloj.id,
        tipo_cama: 'inferior',
        status: 'confirmada',
        prioridade,
        prioridadeInferiorNaoAtendida: false,
      };
    }
  }

  return {
    alojamento_id: null,
    tipo_cama: null,
    status: 'lista_espera',
    prioridade,
    prioridadeInferiorNaoAtendida: false,
  };
}
