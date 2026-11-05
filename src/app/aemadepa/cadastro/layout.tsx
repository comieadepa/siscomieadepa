import type { Metadata, Viewport } from 'next';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Cadastro Oficial AEMADEPA - SISCOMIEADEPA',
  description: 'Formulário de cadastro e atualização de associadas da AEMADEPA - COMIEADEPA.',
};

export default function AemadepaCadastroLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
