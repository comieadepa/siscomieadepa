import type { Metadata } from 'next';
import { APP_URL, PUBLIC_URL } from '@/lib/urls';

const baseUrl = PUBLIC_URL || APP_URL || 'https://siscomieadepa.org';
const metadataBase = baseUrl ? new URL(baseUrl) : undefined;

export const metadata: Metadata = {
  metadataBase,
  title: {
    default: 'Certificado - SISCOMIEADEPA',
    template: '%s | SISCOMIEADEPA Eventos',
  },
  description: 'Valide e imprima certificados emitidos pelo SISCOMIEADEPA.',
  openGraph: {
    title: 'Certificado - SISCOMIEADEPA',
    description: 'Valide e imprima certificados emitidos pelo SISCOMIEADEPA.',
    url: baseUrl || undefined,
    siteName: 'SISCOMIEADEPA Eventos',
    type: 'website',
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon.ico',
  },
};

export default function CertificadoLayout({ children }: { children: React.ReactNode }) {
  return children;
}
