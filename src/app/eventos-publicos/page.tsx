import Link from 'next/link';
import type { CSSProperties } from 'react';
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
  title: 'Portal de Inscricoes da COMIEADEPA',
  description: 'Eventos e congressos da convencao com inscricoes abertas.',
  openGraph: {
    title: 'Portal de Inscricoes da COMIEADEPA',
    description: 'Eventos e congressos da convencao com inscricoes abertas.',
    images: ['/img/bg_site.png'],
  },
  alternates: {
    canonical: '/eventos-publicos',
  },
};

const pageStyle: CSSProperties & Record<string, string> = {
  '--portal-light': '#e8f7ef',
  '--portal-mid': '#d6f5e3',
  '--portal-deep': '#0f766e',
  background: 'linear-gradient(180deg, var(--portal-light) 0%, #f0fdf4 45%, #e0f2fe 100%)',
};

function formatQuantidadeBadge(total: number) {
  return `${total} EVENTO${total === 1 ? '' : 'S'} DISPONIVEL${total === 1 ? '' : 'S'}`;
}

export default async function EventosPublicosPage() {
  const eventos = await fetchOpenEvents();
  const contagens = new Map(
    DEPARTAMENTOS.map(dep => [
      dep.key,
      eventos.filter(ev => ev.departamento === dep.key).length,
    ])
  );
  const departamentosAbertos = DEPARTAMENTOS.filter(dep => (contagens.get(dep.key) ?? 0) > 0);

  return (
    <div className={`${sora.className} relative min-h-screen text-slate-900`} style={pageStyle}>
      <section className="relative overflow-hidden">
        <div className="absolute inset-0">
          <img src="/img/bg_site.png" alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-emerald-900/70" />
          <div className="absolute inset-0 bg-gradient-to-r from-emerald-900/70 via-emerald-700/40 to-emerald-900/70" />
        </div>
        <div className="relative mx-auto max-w-6xl px-6 py-16 text-white" style={{ animation: 'portalFade 0.8s ease-out both' }}>
          <div className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[11px] uppercase tracking-[0.35em] text-white/80">
            Portal de inscricoes da COMIEADEPA
          </div>
          <h1 className={`${playfair.className} mt-6 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl`}>
            Eventos e congressos da convencao
          </h1>
          <p className="mt-4 max-w-2xl text-base text-white/80">
            Escolha um dos eventos disponiveis para ver detalhes e garantir sua inscricao.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="rounded-2xl bg-white/95 px-5 py-4 text-emerald-900 shadow-lg">
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-emerald-700">Inscricoes abertas</div>
              <div className="mt-2 text-3xl font-semibold">{eventos.length}</div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
                {formatQuantidadeBadge(eventos.length)}
              </div>
            </div>
            <div className="group rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-white/90 shadow-sm backdrop-blur-md transition hover:bg-white/15">
              <div className="flex items-start gap-3">
                <div className="text-2xl">🏛️</div>
                <div>
                  <div className="text-sm font-semibold">Portal Oficial</div>
                  <p className="mt-1 text-xs text-white/70">Eventos, congressos e inscricoes da COMIEADEPA.</p>
                </div>
              </div>
            </div>
            <div className="group rounded-2xl border border-white/20 bg-white/10 px-5 py-4 text-white/90 shadow-sm backdrop-blur-md transition hover:bg-white/15">
              <div className="flex items-start gap-3">
                <div className="text-2xl">🤖</div>
                <div>
                  <div className="text-sm font-semibold">Maia — Assistente Virtual</div>
                  <p className="mt-1 text-xs text-white/70">Suporte para inscricoes, pagamentos e duvidas.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center">
          <h2 className={`${playfair.className} text-3xl font-semibold text-slate-900`}>Eventos e congressos da convencao</h2>
          <p className="mt-3 text-sm text-slate-600">
            Escolha um dos eventos disponiveis e siga para a pagina de inscricao.
          </p>
        </div>

        {departamentosAbertos.length === 0 ? (
          <div className="mt-12 rounded-3xl border border-emerald-100 bg-white/80 p-10 text-center text-sm text-slate-600 shadow-lg">
            No momento nao ha eventos com inscricoes abertas. Volte em breve!
          </div>
        ) : null}

        <div className="mt-12 grid justify-center gap-10 [grid-template-columns:repeat(auto-fit,minmax(280px,320px))]">
          {departamentosAbertos.map((dep, index) => {
            const total = contagens.get(dep.key) ?? 0;
            return (
              <Link
                key={dep.key}
                href={`/eventos-publicos/${dep.slug}`}
                className="group flex h-[430px] w-full flex-col overflow-hidden rounded-[28px] bg-white/90 shadow-xl ring-1 ring-emerald-900/5 transition hover:-translate-y-1"
                style={{ animation: `portalCard 0.6s ease-out ${index * 0.08}s both` }}
              >
                <div className="relative h-44">
                  <img src={dep.banner} alt="" className="h-full w-full object-cover" />
                  <div className={`absolute inset-0 bg-gradient-to-br ${dep.tonalidade.gradFrom} ${dep.tonalidade.gradTo}`} />
                  <div className="absolute left-4 top-4">
                    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${dep.tonalidade.chip}`}>
                      {dep.nome}
                    </span>
                  </div>
                </div>
                <div className="flex h-full flex-col gap-4 p-6">
                  <p className="portal-clamp min-h-[48px] text-sm text-slate-600">{dep.resumo}</p>
                  <div className="rounded-2xl border-2 border-emerald-500/70 bg-emerald-600 px-4 py-3 text-white shadow">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-100">
                      🔥 Inscricoes abertas
                    </div>
                    <div className="mt-1 text-sm font-semibold uppercase">
                      {formatQuantidadeBadge(total)}
                    </div>
                  </div>
                  <div className="mt-auto">
                    <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-sm ${dep.tonalidade.chip}`}>
                      Ver inscricoes
                      <span aria-hidden>→</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <PublicAssistenteWidget scope="global" />

      <style>{`
        @keyframes portalFade {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes portalCard {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .portal-clamp {
          display: -webkit-box;
          -webkit-line-clamp: 2;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
    </div>
  );
}
