import type { Metadata, Viewport } from 'next';

export const viewport: Viewport = {
  themeColor: '#092A50',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: 'Aplicativo do Ministro - COMIEADEPA',
  description: 'Aplicativo oficial dos Ministros da Convenção COMIEADEPA',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'App Ministro',
  },
};

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
