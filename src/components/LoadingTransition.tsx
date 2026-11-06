interface LoadingTransitionProps {
  mensagem?: string;
  subtitulo?: string;
  fullScreen?: boolean;
}

export default function LoadingTransition({
  mensagem = 'Carregando...',
  subtitulo = 'SISCOMIEADEPA',
  fullScreen = true,
}: LoadingTransitionProps) {
  const containerClasses = fullScreen
    ? 'fixed inset-0 z-50 flex flex-col items-center justify-center bg-[#0d233a] text-white select-none'
    : 'w-full h-full min-h-[360px] flex flex-col items-center justify-center bg-[#0d233a]/5 rounded-2xl p-8 text-slate-700 select-none';

  return (
    <div className={containerClasses}>
      {/* Elementos de fundo suave apenas se fullscreen */}
      {fullScreen && (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-blue-500/10 blur-3xl animate-pulse" />
          <div className="absolute -bottom-32 -right-32 w-96 h-96 rounded-full bg-amber-500/10 blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
        </div>
      )}

      <div className="relative flex flex-col items-center text-center">
        {/* Glow e Anel de Loading com Brasão/Logo Central */}
        <div className="relative flex items-center justify-center w-28 h-28 mb-6">
          {/* Anel giratório externo */}
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#38bdf8] border-r-[#0284c7] animate-spin"
            style={{ animationDuration: '1.2s' }}
          />
          {/* Anel pulsante decorativo */}
          <div
            className="absolute inset-2 rounded-full border border-blue-400/20 animate-ping"
            style={{ animationDuration: '2.5s' }}
          />

          {/* Logo da COMIEADEPA */}
          <div className="relative w-20 h-20 rounded-full bg-white/10 backdrop-blur-md p-2 flex items-center justify-center shadow-lg border border-white/20">
            <img
              src="/img/logo_comieadepa.png"
              alt="COMIEADEPA"
              className="w-full h-full object-contain filter drop-shadow"
            />
          </div>
        </div>

        {/* Título e Subtítulo */}
        <h3 className={`text-lg font-semibold tracking-wide ${fullScreen ? 'text-white' : 'text-[#0d233a]'}`}>
          {mensagem}
        </h3>
        {subtitulo && (
          <p className={`text-xs uppercase tracking-widest mt-1.5 font-medium ${fullScreen ? 'text-sky-300/80' : 'text-slate-500'}`}>
            {subtitulo}
          </p>
        )}

        {/* Linha de progresso suave */}
        <div className="w-36 h-1 bg-white/10 rounded-full mt-5 overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-sky-400 to-amber-300 rounded-full animate-pulse"
            style={{ width: '70%' }}
          />
        </div>
      </div>
    </div>
  );
}
