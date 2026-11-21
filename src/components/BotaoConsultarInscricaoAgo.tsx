'use client';

export default function BotaoConsultarInscricaoAgo() {
  const handleClick = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('abrir-sara-publica', {
          detail: {
            mensagemInicial: 'Quero consultar minha inscrição na 126ª AGO',
          },
        })
      );
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-3 inline-flex w-full items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 hover:border-slate-400 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-amber-500/30"
    >
      <span className="mr-2 text-base">🔍</span>
      Consultar Inscrição
    </button>
  );
}
