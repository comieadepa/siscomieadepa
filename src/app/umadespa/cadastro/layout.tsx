import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Inscrição e Credenciamento — UMADESPA',
  description: 'Portal oficial de cadastro de jovens e solicitação de credenciais da UMADESPA.',
};

export default function UmadespaCadastroLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 antialiased selection:bg-emerald-500 selection:text-white">
      {children}
    </div>
  );
}
