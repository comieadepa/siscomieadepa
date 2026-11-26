'use client';

import { Search } from 'lucide-react';

export default function BotaoConsultarInscricaoAgo() {
  const handleClick = () => {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('abrir-sara-publica', {
          detail: {
            mensagemAssistente: 'Olá! Vou ajudar você a consultar sua inscrição na 126ª AGO. Por favor, informe seu CPF.',
            pendingIntent: 'confirmar_inscricao',
          },
        })
      );
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-[#0D2B4E] shadow-sm transition-all duration-200 hover:border-[#D4AF37] hover:bg-slate-50 hover:shadow focus:outline-none focus:ring-2 focus:ring-[#D4AF37]/40"
    >
      <Search className="h-4 w-4 text-[#0D2B4E]" />
      Consultar Inscrição
    </button>
  );
}
