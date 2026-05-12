import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Playfair_Display, Sora } from 'next/font/google';
import PublicAssistenteWidget from '@/components/PublicAssistenteWidget';
import { APP_URL, PUBLIC_URL } from '@/lib/urls';
import { fetchOpenEvents, getDepartamentoBySlug } from '@/lib/public-portal';

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
  if (usarTipos) return 'Ver modalidades';
  if (valor === 0) return 'Gratuito';
  return valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default async function EventosPorDepartamentoPage({ params }: PageProps) {
  const { departamento } = await params;
  if (!departamento) notFound();
  const dep = getDepartamentoBySlug(departamento);
  if (!dep) notFound();

  const eventos = await fetchOpenEvents({ departamento: dep.key });

  return (
    <div className={`${sora.className} relative min-h-screen bg-[#f8f4ee] text-slate-900`}>
      <div className="pointer-events-none absolute -top-24 right-8 h-72 w-72 rounded-full bg-amber-200/30 blur-3xl" />
      <div className="pointer-events-none absolute left-8 top-48 h-72 w-72 rounded-full bg-slate-200/50 blur-3xl" />

      <section className="relative mx-auto max-w-6xl px-6 pb-16 pt-16">
        <Link href="/eventos-publicos" className="text-xs uppercase tracking-[0.3em] text-slate-500">
          Voltar ao portal
        </Link>

        <div className="mt-6 grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <div className={`inline-flex rounded-full px-4 py-2 text-xs font-semibold ${dep.tonalidade.chip}`}>
              {dep.nome}
            </div>
            <h1 className={`${playfair.className} mt-4 text-4xl font-bold text-slate-900 sm:text-5xl`}>
              Eventos com inscricoes abertas
            </h1>
            <p className="mt-4 max-w-xl text-base text-slate-600">
              {dep.resumo}
            </p>
          </div>

          <div className="overflow-hidden rounded-3xl border border-white/70 bg-white/80 shadow-xl">
            <div className="relative h-40">
              <img src={dep.banner} alt="" className="h-full w-full object-cover" />
              <div className={`absolute inset-0 bg-gradient-to-br ${dep.tonalidade.gradFrom} ${dep.tonalidade.gradTo}`} />
            </div>
            <div className="p-6 text-sm text-slate-600">
              <div className="text-xs uppercase tracking-[0.3em] text-slate-500">Resumo</div>
              <div className="mt-2 font-semibold text-slate-900">{eventos.length} evento(s) aberto(s)</div>
              <p className="mt-3">Clique em um evento para finalizar sua inscricao.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        {eventos.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-300 bg-white/80 p-8 text-center text-sm text-slate-600">
            Nenhum evento com inscricoes abertas no momento.
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-2">
            {eventos.map(ev => (
              <div key={ev.id} className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.3em] text-slate-500">{dep.nome}</div>
                    <h3 className="mt-2 text-lg font-semibold text-slate-900">{ev.nome}</h3>
                  </div>
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">Aberto</span>
                </div>
                <div className="mt-4 text-sm text-slate-600">
                  <div>{formatDate(ev.data_inicio)}{ev.data_fim ? ` a ${formatDate(ev.data_fim)}` : ''}</div>
                  <div>{[ev.local, ev.cidade].filter(Boolean).join(' - ') || 'Local a confirmar'}</div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-700">
                  <span className={`rounded-full px-3 py-1 ${dep.tonalidade.chip}`}>{formatValor(ev.valor_inscricao, ev.usar_tipos_inscricao)}</span>
                  {ev.vagas_disponiveis !== null ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1">{ev.vagas_disponiveis} vagas</span>
                  ) : null}
                </div>
                <div className="mt-6 flex items-center justify-between text-sm">
                  <Link href={`/inscricao/${ev.slug}`} className="font-semibold text-slate-900">
                    Abrir pagina de inscricao
                  </Link>
                  <Link href="/eventos-publicos" className="text-slate-500">
                    Ver outros departamentos
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <PublicAssistenteWidget scope="departamento" departamento={dep} />
    </div>
  );
}
