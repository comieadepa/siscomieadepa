import type { Metadata } from 'next';
import { APP_URL, PUBLIC_URL } from '@/lib/urls';

const IS_PROD = process.env.NODE_ENV === 'production';
if (IS_PROD && !PUBLIC_URL) {
  throw new Error('NEXT_PUBLIC_PUBLIC_URL não configurado');
}

const baseUrl = PUBLIC_URL || APP_URL;
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
