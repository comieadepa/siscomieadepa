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

const CTA_CLASSES: Record<string, string> = {
  AGO: 'bg-amber-600 hover:bg-amber-700',
  UMADESPA: 'bg-emerald-600 hover:bg-emerald-700',
  COADESPA: 'bg-rose-500 hover:bg-rose-600',
  SEIADEPA: 'bg-sky-600 hover:bg-sky-700',
  AVULSO: 'bg-slate-700 hover:bg-slate-800',
};

const BADGE_CLASSES: Record<string, string> = {
  AGO: 'bg-amber-600',
  UMADESPA: 'bg-emerald-600',
  COADESPA: 'bg-rose-500',
  SEIADEPA: 'bg-sky-600',
  AVULSO: 'bg-slate-700',
};

function formatDate(dateStr: string | null) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  if (!y || !m || !d) return dateStr;
  return `${d}/${m}/${y}`;
}

function formatValor(valor: number, usarTipos: boolean) {
  const formatted = valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  if (usarTipos) return `Inscrição a partir de ${formatted}`;
  if (valor === 0) return 'Inscrição gratuita';
  return `Inscrição ${formatted}`;
}

function formatQuantidadeBadge(total: number) {
  return `${total} EVENTO${total === 1 ? '' : 'S'} DISPONIVEL${total === 1 ? '' : 'S'}`;
}

export default async function EventosPublicosPage() {
  const eventos = await fetchOpenEvents();
  const eventosAgo = eventos.filter(ev => ev.departamento === 'AGO');
  const temAgoUnica = eventosAgo.length === 1;
  const agoAtiva = temAgoUnica ? eventosAgo[0] : null;

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
          <div className="mt-6">
            <div className="inline-flex w-fit items-center gap-4 rounded-lg bg-white/90 px-3 py-2 text-emerald-900 shadow-sm ring-1 ring-emerald-900/10">
              <div className="flex flex-col">
                <div className="text-[9px] font-semibold uppercase tracking-[0.24em] text-emerald-700">Inscricoes abertas</div>
                <div className="text-[9px] font-semibold uppercase tracking-[0.16em] text-emerald-700">
                  {formatQuantidadeBadge(eventos.length)}
                </div>
              </div>
              <div className="text-xl font-semibold leading-tight">{eventos.length}</div>
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

        <div className="mt-12 grid justify-center gap-10 [grid-template-columns:repeat(auto-fit,minmax(280px,360px))]">
          {departamentosAbertos.map((dep, index) => {
            const total = contagens.get(dep.key) ?? 0;

            // Se for o departamento AGO e houver exatamente uma AGO ativa, renderiza o card real do evento
            if (dep.key === 'AGO' && agoAtiva) {
              const bannerCard = agoAtiva.banner_url || dep.banner;
              return (
                <div
                  key={agoAtiva.id}
                  className="flex h-full min-h-[440px] w-full flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white/90 shadow-xl ring-1 ring-emerald-900/5 transition hover:-translate-y-1 hover:shadow-2xl"
                  style={{ animation: `portalCard 0.6s ease-out ${index * 0.08}s both` }}
                >
                  <div className="relative h-44 w-full overflow-hidden bg-slate-100">
                    <img
                      src={bannerCard}
                      alt={agoAtiva.nome}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute right-3 top-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold text-white shadow-sm ${BADGE_CLASSES.AGO}`}>
                        Inscrições abertas
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-6">
                    <div className="mb-1 text-xs uppercase tracking-[0.3em] text-slate-500">Evento Oficial</div>

                    <h3 className="text-xl font-semibold leading-tight text-slate-900">{agoAtiva.nome}</h3>

                    <div className="mt-4 text-sm text-slate-600">
                      <div className="font-semibold text-slate-700">
                        {formatDate(agoAtiva.data_inicio)}{agoAtiva.data_fim ? ` a ${formatDate(agoAtiva.data_fim)}` : ''}
                      </div>
                      <div className="mt-1">{[agoAtiva.local, agoAtiva.cidade].filter(Boolean).join(' - ') || 'Local a confirmar'}</div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2 text-xs font-semibold text-slate-700">
                      <span className={`rounded-full px-3 py-1 ${dep.tonalidade.chip}`}>
                        {formatValor(agoAtiva.valor_inscricao, agoAtiva.usar_tipos_inscricao)}
                      </span>
                      {agoAtiva.vagas_disponiveis !== null ? (
                        <span className="rounded-full bg-emerald-100 px-3 py-1 text-emerald-800">
                          {agoAtiva.vagas_disponiveis} vagas
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-auto pt-6">
                      <Link
                        href={`/inscricao/${agoAtiva.slug}`}
                        className={`inline-flex w-full items-center justify-center rounded-full px-5 py-3 text-sm font-semibold text-white shadow transition ${CTA_CLASSES.AGO}`}
                      >
                        Fazer inscrição
                      </Link>
                    </div>
                  </div>
                </div>
              );
            }

            // Para outros departamentos (ou se houver mais de uma AGO por inconsistência), preserva o card do departamento
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
                      🔥 Inscrições abertas
                    </div>
                    <div className="mt-1 text-sm font-semibold uppercase">
                      {formatQuantidadeBadge(total)}
                    </div>
                  </div>
                  <div className="mt-auto">
                    <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-sm ${dep.tonalidade.chip}`}>
                      Ver inscrições
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
