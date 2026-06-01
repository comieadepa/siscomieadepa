import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Playfair_Display, Sora } from 'next/font/google';
import PublicAssistenteWidget from '@/components/PublicAssistenteWidget';
import { APP_URL, PUBLIC_URL } from '@/lib/urls';
import { fetchOpenEvents, getDepartamentoBySlug, type DepartamentoKey } from '@/lib/public-portal';
import { isEventoInscricaoPublicaDisponivel } from '@/lib/eventos/evento-listing';

export const dynamic = 'force-dynamic';

const sora = Sora({ subsets: ['latin'], weight: ['400', '500', '600', '700'] });
const playfair = Playfair_Display({ subsets: ['latin'], weight: ['600', '700'] });

const baseUrl = PUBLIC_URL || APP_URL || 'http://localhost:3000';

type PageProps = {
  params: Promise<{ departamento: string }>;
};

export async function generateMetadata({ params }: PageProps) {
  const { departamento } = await params;
  if (!departamento) return {};
  const dep = getDepartamentoBySlug(departamento);
  if (!dep) return {};

  return {
    metadataBase: new URL(baseUrl),
    title: `Eventos ${dep.nome} - Siscom IEADPA`,
    description: `Eventos publicos e inscricoes abertas do departamento ${dep.nome}.`,
    openGraph: {
      title: `Eventos ${dep.nome} - Siscom IEADPA`,
      description: `Eventos publicos e inscricoes abertas do departamento ${dep.nome}.`,
      images: [dep.banner],
    },
    alternates: {
      canonical: `/eventos-publicos/${dep.slug}`,
    },
  };
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function formatValor(valor: number, usarTipos: boolean) {
  const formatted = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (valor === 0) return 'Inscricao gratuita';
  if (usarTipos) return `Inscricao a partir de ${formatted}`;
  return `Inscricao ${formatted}`;
}

function formatQuantidadeEventos(total: number) {
  if (total === 0) return 'Nenhum evento com inscricoes abertas';
  return `${total} evento${total === 1 ? '' : 's'} com inscricoes abertas`;
}

const CTA_CLASSES: Record<DepartamentoKey, string> = {
  AGO: 'bg-amber-600 hover:bg-amber-700',
  UMADESPA: 'bg-emerald-600 hover:bg-emerald-700',
  COADESPA: 'bg-rose-500 hover:bg-rose-600',
  SEIADEPA: 'bg-sky-600 hover:bg-sky-700',
  AVULSO: 'bg-slate-700 hover:bg-slate-800',
};

const BADGE_CLASSES: Record<DepartamentoKey, string> = {
  AGO: 'bg-amber-600',
  UMADESPA: 'bg-emerald-600',
  COADESPA: 'bg-rose-500',
  SEIADEPA: 'bg-sky-600',
  AVULSO: 'bg-slate-700',
};

const HERO_GRADIENTS: Record<DepartamentoKey, string> = {
  AGO: 'from-amber-500/40 via-amber-700/50 to-amber-900/60',
  UMADESPA: 'from-emerald-500/40 via-teal-600/45 to-emerald-900/60',
  COADESPA: 'from-rose-500/35 via-emerald-500/40 to-emerald-900/60',
  SEIADEPA: 'from-sky-500/40 via-blue-600/50 to-blue-900/60',
  AVULSO: 'from-slate-400/30 via-slate-600/45 to-slate-900/60',
};

export default async function EventosPorDepartamentoPage({ params }: PageProps) {
  const { departamento } = await params;
  if (!departamento) notFound();
  const dep = getDepartamentoBySlug(departamento);
  if (!dep) notFound();

  const eventos = await fetchOpenEvents({ departamento: dep.key });

  return (
    <div className={`${sora.className} relative min-h-screen bg-[#f8f4ee] text-slate-900`}>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src={dep.banner} alt="" className="h-full w-full object-cover" />
          <div className={`absolute inset-0 bg-gradient-to-br ${HERO_GRADIENTS[dep.key]} `} />
          <div className="absolute inset-0 bg-slate-900/55" />
        </div>
        <div className="relative mx-auto max-w-6xl px-6 pb-16 pt-14 text-white">
          <Link
            href="/eventos-publicos"
            className="inline-flex items-center rounded-full bg-white/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-white/80 backdrop-blur"
          >
            Voltar ao portal
          </Link>

          <div className="mt-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-2xl">
              <div className={`inline-flex rounded-full px-4 py-2 text-xs font-semibold shadow-sm ${dep.tonalidade.chip}`}>
                {dep.nome}
              </div>
              <h1 className={`${playfair.className} mt-4 text-4xl font-bold text-white sm:text-5xl`}>
                {dep.nome}
              </h1>
              <p className="mt-4 text-base text-white/80">
                {dep.resumo}
              </p>
            </div>

            <div className="w-full max-w-sm rounded-2xl border border-white/15 bg-white/10 px-5 py-4 shadow-sm backdrop-blur">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/70">
                Inscricoes abertas
              </div>
              <div className="mt-2 text-lg font-semibold">
                {formatQuantidadeEventos(eventos.length)}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24 pt-12">
        {eventos.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/80 p-8 text-center text-sm text-slate-600">
            No momento nao ha inscricoes abertas para este departamento.
          </div>
        ) : (
          <div className="grid justify-center gap-6 [grid-template-columns:repeat(auto-fit,minmax(280px,360px))]">
            {eventos.map(ev => {
              const inscricaoDisponivel = isEventoInscricaoPublicaDisponivel(ev);
              return (
              <div key={ev.id} className="flex h-full flex-col rounded-3xl border border-slate-200 bg-white/90 p-6 shadow">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="text-xs uppercase tracking-[0.3em] text-slate-500">Evento</div>
                    <h3 className="mt-2 text-xl font-semibold text-slate-900">{ev.nome}</h3>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold text-white ${BADGE_CLASSES[dep.key]}`}>
                    {inscricaoDisponivel ? 'Inscricoes abertas' : 'Evento realizado'}
                  </span>
                </div>
                <div className="mt-4 text-sm text-slate-600">
                  <div className="font-semibold text-slate-700">
                    {formatDate(ev.data_inicio)}{ev.data_fim ? ` a ${formatDate(ev.data_fim)}` : ''}
                  </div>
                  <div className="mt-1">{[ev.local, ev.cidade].filter(Boolean).join(' - ') || 'Local a confirmar'}</div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
                  <span className={`rounded-full px-3 py-1 ${dep.tonalidade.chip}`}>{formatValor(ev.valor_inscricao, ev.usar_tipos_inscricao)}</span>
                  {ev.vagas_disponiveis !== null ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1">{ev.vagas_disponiveis} vagas</span>
                  ) : null}
                </div>
                <div className="mt-auto pt-6">
                  {inscricaoDisponivel ? (
                    <Link
                      href={`/inscricao/${ev.slug}`}
                      className={`inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold text-white shadow transition ${CTA_CLASSES[dep.key]}`}
                    >
                      Fazer inscricao
                    </Link>
                  ) : (
                    <div className="inline-flex w-full items-center justify-center rounded-full bg-slate-200 px-5 py-3 text-sm font-semibold text-slate-600">
                      Evento realizado
                    </div>
                  )}
                </div>
              </div>
              );
            })}
          </div>
        )}
      </section>

      <PublicAssistenteWidget scope="departamento" departamento={dep} />
    </div>
  );
}
