'use client';

export default function FluxoEquipeDesativadoPage() {
  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
        <h1 className="text-lg font-bold text-[#123b63] mb-2">Fluxo desativado</h1>
        <p className="text-sm text-gray-500">
          O acesso da equipe agora e feito por cadastro direto no painel do evento.
        </p>
        <a
          href="/eventos"
          className="mt-4 inline-block w-full px-4 py-2 text-sm rounded-lg bg-[#123b63] text-white font-semibold hover:bg-[#0f2a45] transition"
        >
          Voltar
        </a>
      </div>
    </div>
  );
}
