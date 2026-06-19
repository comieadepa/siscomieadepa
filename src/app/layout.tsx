import type { Metadata } from 'next';
import './globals.css';
import { AppDialogProvider } from '@/providers/AppDialogProvider';
import { AuthProvider } from '@/providers/AuthProvider';
import { UsuarioProvider } from '@/providers/UsuarioContext';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'SISCOMIEADEPA - Acesso ao Sistema',
  description: 'Sistema de Gestão para Instituições',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Akshar:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased bg-white">
        <AuthProvider>
          <UsuarioProvider>
            <AppDialogProvider>
              {children}
            </AppDialogProvider>
          </UsuarioProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
