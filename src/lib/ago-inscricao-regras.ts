export type TipoComNome = {
  nome: string;
};

export type FiltroTiposAgoOptions = {
  sexo: string | null | undefined;
  dataNascimento: string | null | undefined;
  permitirViuvaEEsposaJubilado: boolean;
  permitirJubiladoManual: boolean;
  somentePastorPresidente?: boolean;
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

export function findTipoPastorJubilado<T extends TipoComNome>(tipos: T[]): T | null {
  return tipos.find((t) => ehTipoPastorJubilado(t.nome)) || null;
}

export function filtrarTiposAgo<T extends TipoComNome>(tipos: T[], options: FiltroTiposAgoOptions): T[] {
  const {
    sexo,
    dataNascimento,
    permitirViuvaEEsposaJubilado,
    permitirJubiladoManual,
    somentePastorPresidente,
  } = options;

  const idade = calcularIdade(dataNascimento);
  const sexoNorm = String(sexo || '').toUpperCase();

  return tipos
    .filter((t) => !/campo\s*mission/i.test(t.nome))
    .filter((t) => {
      if (somentePastorPresidente) return ehTipoPastorPresidente(t.nome);
      return true;
    })
    .filter((t) => {
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
      if (!ehTipoJuventude(t.nome)) return true;
      if (idade === null) return false;
      return idade <= 29;
    });
}
