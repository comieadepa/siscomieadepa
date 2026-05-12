import { createServerClient } from '@/lib/supabase-server';

export type DepartamentoKey = 'AGO' | 'UMADESPA' | 'COADESPA' | 'SEIADEPA' | 'AVULSO';

export type DepartamentoConfig = {
  key: DepartamentoKey;
  slug: string;
  nome: string;
  resumo: string;
  banner: string;
  tonalidade: {
    chip: string;
    gradFrom: string;
    gradTo: string;
    acento: string;
  };
};

export const DEPARTAMENTOS: DepartamentoConfig[] = [
  {
    key: 'AGO',
    slug: 'ago',
    nome: 'AGO',
    resumo: 'Assembleia Geral Ordinaria.',
    banner: '/img/ago.png',
    tonalidade: {
      chip: 'bg-amber-100 text-amber-800',
      gradFrom: 'from-amber-400/30',
      gradTo: 'to-amber-600/30',
      acento: 'text-amber-700',
    },
  },
  {
    key: 'UMADESPA',
    slug: 'umadespa',
    nome: 'UMADESPA',
    resumo: 'Uniao de Mocidade das Assembleias de Deus no Estado do Para.',
    banner: '/img/umadespa.png',
    tonalidade: {
      chip: 'bg-blue-100 text-blue-800',
      gradFrom: 'from-blue-400/30',
      gradTo: 'to-blue-600/30',
      acento: 'text-blue-700',
    },
  },
  {
    key: 'COADESPA',
    slug: 'coadespa',
    nome: 'COADESPA',
    resumo: 'Congresso do Circulo de Oracao das Assembleias de Deus do Estado do Para.',
    banner: '/img/coadespa.jpg',
    tonalidade: {
      chip: 'bg-emerald-100 text-emerald-800',
      gradFrom: 'from-emerald-400/30',
      gradTo: 'to-emerald-600/30',
      acento: 'text-emerald-700',
    },
  },
  {
    key: 'SEIADEPA',
    slug: 'seiadepa',
    nome: 'SEIADEPA',
    resumo: 'Secretaria de Educacao Infantil das Assembleias de Deus do Estado do Para.',
    banner: '/img/seiadepa.jpg',
    tonalidade: {
      chip: 'bg-cyan-100 text-cyan-800',
      gradFrom: 'from-cyan-400/30',
      gradTo: 'to-cyan-600/30',
      acento: 'text-cyan-700',
    },
  },
  {
    key: 'AVULSO',
    slug: 'avulso',
    nome: 'OUTROS EVENTOS',
    resumo: 'Eventos especiais, conferencias e iniciativas regionais da convencao.',
    banner: '/img/avulso.png',
    tonalidade: {
      chip: 'bg-slate-100 text-slate-800',
      gradFrom: 'from-slate-400/30',
      gradTo: 'to-slate-600/30',
      acento: 'text-slate-700',
    },
  },
];

export function getDepartamentoBySlug(slug: string): DepartamentoConfig | null {
  const key = slug.trim().toLowerCase();
  return DEPARTAMENTOS.find(d => d.slug === key) ?? null;
}

export function getDepartamentoByKey(key: string): DepartamentoConfig | null {
  const up = key.trim().toUpperCase();
  return DEPARTAMENTOS.find(d => d.key === up) ?? null;
}

export type EventoPublico = {
  id: string;
  nome: string;
  slug: string;
  departamento: string;
  data_inicio: string;
  data_fim: string | null;
  local: string | null;
  cidade: string | null;
  banner_url: string | null;
  valor_inscricao: number;
  usar_tipos_inscricao: boolean;
  limite_vagas: number | null;
  vagas_disponiveis: number | null;
  total_inscritos: number | null;
};

function fimDoDia(dateStr: string): Date {
  return new Date(`${dateStr}T23:59:59`);
}

function isEventoDentroDaData(dataFim: string | null, hoje: Date): boolean {
  if (!dataFim) return true;
  return fimDoDia(dataFim).getTime() >= hoje.getTime();
}

export async function fetchOpenEvents(options?: { departamento?: string }) {
  const supabase = createServerClient();
  const hoje = new Date();

  let query = supabase
    .from('eventos')
    .select('id,nome,slug,departamento,data_inicio,data_fim,local,cidade,banner_url,valor_inscricao,usar_tipos_inscricao,limite_vagas,inscricoes_abertas,status')
    .eq('status', 'programado')
    .eq('inscricoes_abertas', true);

  if (options?.departamento) {
    query = query.eq('departamento', options.departamento);
  }

  const { data } = await query.order('data_inicio', { ascending: true });
  const base = (data ?? []) as Array<Omit<EventoPublico, 'vagas_disponiveis' | 'total_inscritos'>>;

  const dentroData = base.filter(e => isEventoDentroDaData(e.data_fim, hoje));

  const contagens = await Promise.all(
    dentroData.map(async e => {
      if (!e.limite_vagas) {
        return { id: e.id, total: null };
      }
      const { count } = await supabase
        .from('evento_inscricoes')
        .select('id', { count: 'exact', head: true })
        .eq('evento_id', e.id);
      return { id: e.id, total: count ?? 0 };
    })
  );

  const countMap = new Map(contagens.map(c => [c.id, c.total]));

  const result: EventoPublico[] = [];
  for (const ev of dentroData) {
    const total = countMap.get(ev.id) ?? null;
    const vagas = ev.limite_vagas ? Math.max(0, ev.limite_vagas - (total ?? 0)) : null;
    if (ev.limite_vagas && (total ?? 0) >= ev.limite_vagas) {
      continue;
    }
    result.push({
      ...ev,
      total_inscritos: total,
      vagas_disponiveis: vagas,
    });
  }

  return result;
}
