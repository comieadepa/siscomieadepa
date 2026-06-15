export type TipoComNome = {
  nome: string;
};

export type FiltroTiposAgoOptions = {
  sexo: string | null | undefined;
  dataNascimento: string | null | undefined;
  permitirViuvaEEsposaJubilado: boolean;
  permitirJubiladoManual: boolean;
  somentePastorPresidente?: boolean;
  cpfLocalizado?: boolean;
  ministroAtivo?: boolean;
  cargoMinisterial?: string | null;
  pastorPresidente?: boolean;
  pastorAuxiliar?: boolean;
  jubilado?: boolean;
  isCampoMissionario?: boolean;
};

export function normalizarTipoNome(v: string | null | undefined): string {
  return String(v || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function calcularIdade(dataNascimento: string | null | undefined): number | null {
  if (!dataNascimento) return null;
  const nascimento = new Date(dataNascimento);
  if (Number.isNaN(nascimento.getTime())) return null;

  const hoje = new Date();
  let idade = hoje.getFullYear() - nascimento.getFullYear();
  const mes = hoje.getMonth() - nascimento.getMonth();
  if (mes < 0 || (mes === 0 && hoje.getDate() < nascimento.getDate())) idade -= 1;
  return idade;
}

export function ehTipoViuva(nome: string | null | undefined): boolean {
  const n = normalizarTipoNome(nome);
  return n.includes('viuva');
}

export function ehTipoEsposa(nome: string | null | undefined): boolean {
  const n = normalizarTipoNome(nome);
  return n.includes('esposa');
}

export function ehTipoEsposaJubilado(nome: string | null | undefined): boolean {
  const n = normalizarTipoNome(nome);
  return ehTipoEsposa(n) && n.includes('pastor jubilado');
}

export function ehTipoPastorPresidente(nome: string | null | undefined): boolean {
  const n = normalizarTipoNome(nome);
  return n.includes('pastor presidente') && !ehTipoEsposa(n) && !ehTipoViuva(n);
}

export function ehTipoPastorAuxiliar(nome: string | null | undefined): boolean {
  const n = normalizarTipoNome(nome);
  return n.includes('pastor auxiliar') && !ehTipoEsposa(n) && !ehTipoViuva(n);
}

export function ehTipoPastorJubilado(nome: string | null | undefined): boolean {
  const n = normalizarTipoNome(nome);
  return n.includes('pastor jubilado') && !ehTipoEsposa(n) && !ehTipoViuva(n);
}

export function ehTipoJuventude(nome: string | null | undefined): boolean {
  const n = normalizarTipoNome(nome);
  return n.includes('juventude');
}

export function ehTipoVisitante(nome: string | null | undefined): boolean {
  const n = normalizarTipoNome(nome);
  return n.includes('visitante');
}

export function findTipoPastorJubilado<T extends TipoComNome>(tipos: T[]): T | null {
  return tipos.find((t) => ehTipoPastorJubilado(t.nome)) || null;
}

export function findTipoEsposaJubilado<T extends TipoComNome>(tipos: T[]): T | null {
  return tipos.find((t) => ehTipoEsposaJubilado(t.nome)) || null;
}

export function filtrarTiposAgo<T extends TipoComNome>(tipos: T[], options: FiltroTiposAgoOptions): T[] {
  const {
    sexo,
    dataNascimento,
    permitirViuvaEEsposaJubilado,
    permitirJubiladoManual,
    somentePastorPresidente,
    cpfLocalizado,
    ministroAtivo,
    pastorPresidente,
    pastorAuxiliar,
    jubilado,
    isCampoMissionario,
  } = options;

  const idade = calcularIdade(dataNascimento);
  const sexoRaw = String(sexo || '').trim().toUpperCase();
  const sexoNorm = sexoRaw.startsWith('M') ? 'M' : sexoRaw.startsWith('F') ? 'F' : '';
  const cpfFoiLocalizado = !!cpfLocalizado;
  const ministerioAtivo = !!ministroAtivo;
  const ehPastorAuxiliarPorPerfil = !!pastorAuxiliar || (
    cpfFoiLocalizado && ministerioAtivo && sexoNorm === 'M' && !pastorPresidente && !jubilado
  );

  const ehElegivelCM = !!cpfFoiLocalizado && !!ministerioAtivo && !!pastorPresidente && !!isCampoMissionario;

  return tipos
    .filter((t) => {
      const isCMType = /campo\s*mission/i.test(t.nome);
      if (isCMType) {
        return ehElegivelCM;
      }
      if (ehElegivelCM) {
        return ehTipoPastorPresidente(t.nome);
      }
      return true;
    })
    .filter((t) => {
      if (somentePastorPresidente) return ehTipoPastorPresidente(t.nome);
      return true;
    })
    .filter((t) => {
      if (cpfFoiLocalizado && ministerioAtivo && !!jubilado) {
        return ehTipoPastorJubilado(t.nome);
      }
      return true;
    })
    .filter((t) => {
      if (cpfFoiLocalizado && ministerioAtivo && !!jubilado) return true;
      if (permitirJubiladoManual) return true;
      return !ehTipoPastorJubilado(t.nome);
    })
    .filter((t) => {
      if (permitirViuvaEEsposaJubilado) return true;
      if (ehTipoViuva(t.nome)) return false;
      if (ehTipoEsposaJubilado(t.nome)) return false;
      return true;
    })
    .filter((t) => {
      if (sexoNorm === 'M') {
        if (ehTipoEsposa(t.nome) || ehTipoViuva(t.nome)) return false;
      }
      if (sexoNorm === 'F') {
        if (ehTipoPastorPresidente(t.nome) || ehTipoPastorAuxiliar(t.nome)) return false;
      }
      return true;
    })
    .filter((t) => {
      if (!(cpfFoiLocalizado && ministerioAtivo)) {
        // Se o CPF não foi localizado ou não está ativo no cadastro, ele NÃO pode se inscrever como Ministro
        if (ehTipoPastorPresidente(t.nome) || ehTipoPastorAuxiliar(t.nome) || ehTipoPastorJubilado(t.nome)) {
          return false;
        }
        return true;
      }

      if (ehTipoVisitante(t.nome)) return false;

      if (ehTipoPastorPresidente(t.nome)) return !!pastorPresidente;

      if (ehTipoPastorAuxiliar(t.nome)) return ehPastorAuxiliarPorPerfil;

      if (ehTipoPastorJubilado(t.nome)) return !!jubilado;

      return true;
    })
    .filter((t) => {
      if (!ehTipoJuventude(t.nome)) return true;
      if (idade === null) return false;
      return idade <= 29;
    });
}
