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

const pageStyle: CSSProperties & Record<string, string> = {
  '--portal-light': '#e8f7ef',
  '--portal-mid': '#d6f5e3',
  '--portal-deep': '#0f766e',
  background: 'linear-gradient(180deg, var(--portal-light) 0%, #f0fdf4 45%, #e0f2fe 100%)',
};

function formatQuantidade(total: number) {
  return `${total} evento${total === 1 ? '' : 's'}`;
}

export default async function EventosPublicosPage() {
  const eventos = await fetchOpenEvents();
  const contagens = new Map(
    DEPARTAMENTOS.map(dep => [
      dep.key,
      eventos.filter(ev => ev.departamento === dep.key).length,
    ])
  );
  const departamentosComEventos = DEPARTAMENTOS.filter(dep => (contagens.get(dep.key) ?? 0) > 0).length;

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
            Portal de eventos
          </div>
          <h1 className={`${playfair.className} mt-6 text-4xl font-semibold leading-tight sm:text-5xl`}>
            Escolha seu departamento e veja as inscricoes abertas
          </h1>
          <p className="mt-4 max-w-xl text-base text-white/80">
            Os eventos da IEADPA estao organizados por departamento. Selecione sua area para conferir a lista atualizada.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <span className="rounded-full bg-white/90 px-4 py-2 text-xs font-semibold text-emerald-900 shadow">
              {eventos.length} eventos abertos agora
            </span>
            <span className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white/90">
              {departamentosComEventos} departamentos com inscricao
            </span>
            <span className="rounded-full bg-white/10 px-4 py-2 text-xs font-semibold text-white/90">
              Atendimento da Maia 24h
            </span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="text-center">
          <h2 className={`${playfair.className} text-3xl font-semibold text-slate-900`}>Departamentos</h2>
          <p className="mt-3 text-sm text-slate-600">
            Cada card representa um departamento. Clique para ver os eventos disponiveis.
          </p>
        </div>

        <div className="mt-12 grid gap-10 sm:grid-cols-2 xl:grid-cols-3 place-items-center">
          {DEPARTAMENTOS.map((dep, index) => {
            const total = contagens.get(dep.key) ?? 0;
            const aberto = total > 0;
            return (
              <Link
                key={dep.key}
                href={`/eventos-publicos/${dep.slug}`}
                className="group w-full max-w-[320px] overflow-hidden rounded-[28px] bg-white/90 shadow-xl ring-1 ring-emerald-900/5 transition hover:-translate-y-1"
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
                  <p className="text-sm text-slate-600">{dep.resumo}</p>
                  <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 p-4 text-sm">
                    <div className={`font-semibold ${aberto ? dep.tonalidade.acento : 'text-slate-600'}`}>
                      {aberto ? `Inscricoes abertas para ${formatQuantidade(total)}` : 'Inscricoes encerradas'}
                    </div>
                    {!aberto ? (
                      <div className="mt-1 text-xs text-slate-500">Obrigado por participar!</div>
                    ) : null}
                  </div>
                  <div className="mt-auto">
                    <div className={`inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold shadow-sm ${aberto ? dep.tonalidade.chip : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>
                      {aberto ? 'Fazer inscricao' : 'Ver eventos'}
                      <span aria-hidden>→</span>
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 pb-24">
        <div className="rounded-[32px] border border-emerald-100 bg-white/80 p-8 text-center shadow-lg">
          <h3 className={`${playfair.className} text-2xl font-semibold text-slate-900`}>Precisa de ajuda?</h3>
          <p className="mt-3 text-sm text-slate-600">
            A Maia pode orientar sobre eventos, documentos e segunda via de inscricao. Basta clicar no chat.
          </p>
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
      `}</style>
    </div>
  );
}
