import Link from 'next/link';
import { Playfair_Display, Sora } from 'next/font/google';
import PublicAssistenteWidget from '@/components/PublicAssistenteWidget';
import { APP_URL, PUBLIC_URL } from '@/lib/urls';
import { DEPARTAMENTOS, fetchOpenEvents } from '@/lib/public-portal';

export const dynamic = 'force-dynamic';

const sora = Sora({ subsets: ['latin'], weight: ['400', '500', '600', '700'] });
const playfair = Playfair_Display({ subsets: ['latin'], weight: ['600', '700'] });

const baseUrl = PUBLIC_URL || APP_URL || 'http://localhost:3000';

export const metadata = {
  metadataBase: new URL(baseUrl),
  title: 'Eventos Publicos - Siscom IEADPA',
  description: 'Portal publico com eventos e inscricoes abertas.',
  openGraph: {
    title: 'Eventos Publicos - Siscom IEADPA',
    description: 'Portal publico com eventos e inscricoes abertas.',
    images: ['/img/bg_site.png'],
  },
  alternates: {
    canonical: '/eventos-publicos',
  },
};

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

export default async function EventosPublicosPage() {
  const eventos = await fetchOpenEvents();
  const contagens = new Map(
    DEPARTAMENTOS.map(dep => [
      dep.key,
      eventos.filter(ev => ev.departamento === dep.key).length,
    ])
  );

  return (
    <div className={`${sora.className} relative min-h-screen bg-[#f8f4ee] text-slate-900`}>
      <div className="pointer-events-none absolute -top-20 right-0 h-80 w-80 rounded-full bg-amber-200/40 blur-3xl" />
      <div className="pointer-events-none absolute left-0 top-40 h-72 w-72 rounded-full bg-cyan-200/40 blur-3xl" />

      <section className="relative mx-auto max-w-6xl px-6 pb-16 pt-16">
        <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Portal de eventos</p>
            <h1 className={`${playfair.className} mt-4 text-4xl font-bold text-slate-900 sm:text-5xl`}>
              Eventos publicos com inscricoes abertas
            </h1>
            <p className="mt-4 max-w-xl text-base text-slate-600">
              Encontre o evento certo, escolha seu departamento e finalize sua inscricao em poucos cliques.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <span className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow">
                Atualizado em tempo real
              </span>
              <span className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow">
                Pagamento e segunda via online
              </span>
              <span className="rounded-full bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow">
                Suporte da Maia 24h
              </span>
            </div>
          </div>

          <div className="rounded-3xl border border-white/60 bg-white/80 p-6 shadow-xl" style={{ animation: 'fadeUp 0.8s ease both' }}>
            <div className="text-xs uppercase tracking-[0.3em] text-slate-500">Status geral</div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl bg-slate-900 px-4 py-4 text-white">
                <div className="text-3xl font-bold">{eventos.length}</div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Eventos abertos</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
                <div className="text-3xl font-bold text-slate-900">{DEPARTAMENTOS.length}</div>
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Departamentos</div>
              </div>
            </div>

            <div className="mt-6 space-y-3 text-sm text-slate-600">
              <p>Selecione um departamento para ver as inscricoes abertas e detalhes de cada evento.</p>
              <p>Prefere ajuda rapida? Clique em Falar com a Maia no canto da tela.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-16">
        <div className="flex items-center justify-between">
          <h2 className={`${playfair.className} text-2xl font-semibold text-slate-900`}>Departamentos</h2>
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Inscricoes abertas</span>
        </div>

        <div className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {DEPARTAMENTOS.map(dep => {
            const total = contagens.get(dep.key) ?? 0;
            const status = total > 0 ? `${total} evento(s) aberto(s)` : 'Sem eventos abertos';
            return (
              <Link
                key={dep.key}
                href={`/eventos-publicos/${dep.slug}`}
                className="group overflow-hidden rounded-3xl border border-white/70 bg-white/80 shadow-lg transition hover:-translate-y-1"
              >
                <div className="relative h-32">
                  <img src={dep.banner} alt="" className="h-full w-full object-cover" />
                  <div className={`absolute inset-0 bg-gradient-to-br ${dep.tonalidade.gradFrom} ${dep.tonalidade.gradTo}`} />
                </div>
                <div className="p-5">
                  <div className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${dep.tonalidade.chip}`}>
                    {dep.nome}
                  </div>
                  <p className="mt-3 text-sm text-slate-600">{dep.resumo}</p>
                  <div className="mt-4 flex items-center justify-between text-xs font-semibold">
                    <span className={dep.tonalidade.acento}>{status}</span>
                    <span className="text-slate-500">Ver eventos</span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 pb-24">
        <div className="flex items-center justify-between">
          <h2 className={`${playfair.className} text-2xl font-semibold text-slate-900`}>Eventos em destaque</h2>
          <span className="text-xs uppercase tracking-[0.3em] text-slate-500">Inscricoes abertas agora</span>
        </div>

        {eventos.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-slate-300 bg-white/70 p-8 text-center text-sm text-slate-600">
            Nenhum evento com inscricoes abertas no momento.
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {eventos.slice(0, 6).map(ev => (
              <div key={ev.id} className="rounded-3xl border border-slate-200 bg-white/90 p-6 shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.3em] text-slate-500">{ev.departamento}</div>
                    <h3 className="mt-2 text-lg font-semibold text-slate-900">{ev.nome}</h3>
                  </div>
                  <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">Aberto</span>
                </div>
                <div className="mt-4 text-sm text-slate-600">
                  <div>{formatDate(ev.data_inicio)}{ev.data_fim ? ` a ${formatDate(ev.data_fim)}` : ''}</div>
                  <div>{[ev.local, ev.cidade].filter(Boolean).join(' - ') || 'Local a confirmar'}</div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3 text-xs font-semibold text-slate-700">
                  <span className="rounded-full bg-amber-100 px-3 py-1">{formatValor(ev.valor_inscricao, ev.usar_tipos_inscricao)}</span>
                  {ev.vagas_disponiveis !== null ? (
                    <span className="rounded-full bg-emerald-100 px-3 py-1">{ev.vagas_disponiveis} vagas</span>
                  ) : null}
                </div>
                <div className="mt-6 flex items-center justify-between text-sm">
                  <Link href={`/inscricao/${ev.slug}`} className="font-semibold text-slate-900">
                    Abrir pagina de inscricao
                  </Link>
                  <Link href={`/eventos-publicos/${ev.departamento.toLowerCase()}`} className="text-slate-500">
                    Ver departamento
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <PublicAssistenteWidget scope="global" />

      <style jsx>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
