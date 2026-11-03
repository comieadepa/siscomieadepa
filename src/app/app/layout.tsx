import type { Metadata, Viewport } from 'next';
import './app.css';

export const metadata: Metadata = {
  title: 'Aplicativo do Ministro - COMIEADEPA',
  description: 'Aplicativo oficial dos Ministros da Convenção Interestadual de Ministros e Igrejas Evangélicas Assembleias de Deus no Estado do Pará (COMIEADEPA).',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'App Ministro',
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#092A50',
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-viewport-root w-full min-h-[100dvh] h-[100dvh] overflow-hidden bg-[#071D36] flex justify-center">
      {children}
    </div>
  );
}
