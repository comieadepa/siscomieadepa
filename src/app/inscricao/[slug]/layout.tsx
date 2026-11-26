import type { Metadata, Viewport } from 'next';
import { APP_URL, PUBLIC_URL } from '@/lib/urls';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

const baseUrl = PUBLIC_URL || APP_URL || 'https://siscomieadepa.org';
const metadataBase = baseUrl ? new URL(baseUrl) : undefined;

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: 'Inscricao de Evento - SISCOMIEADEPA',
    template: '%s | SISCOMIEADEPA Eventos',
  },
  description: 'Inscricao oficial de eventos do SISCOMIEADEPA.',
  openGraph: {
    title: 'Inscricao de Evento - SISCOMIEADEPA',
    description: 'Inscricao oficial de eventos do SISCOMIEADEPA.',
    url: baseUrl || undefined,
    siteName: 'SISCOMIEADEPA Eventos',
    type: 'website',
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
  },
};

export default function InscricaoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
