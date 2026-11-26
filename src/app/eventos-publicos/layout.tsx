import type { Viewport } from 'next';
import type { ReactNode } from 'react';
import PublicMobileZoomGuard from '@/components/PublicMobileZoomGuard';

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
};

export default function EventosPublicosLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <PublicMobileZoomGuard />
      {children}
    </>
  );
}
