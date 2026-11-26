'use client';

import { useEffect } from 'react';

export default function PublicMobileZoomGuard() {
  useEffect(() => {
    const preventGesture = (e: Event) => {
      e.preventDefault();
    };

    // Bloqueia gestos de pinça no Safari iOS
    document.addEventListener('gesturestart', preventGesture, { passive: false });
    document.addEventListener('gesturechange', preventGesture, { passive: false });
    document.addEventListener('gestureend', preventGesture, { passive: false });

    // Aplica touch-action: pan-y e font-size >= 16px em inputs no mobile apenas nas páginas públicas
    const style = document.createElement('style');
    style.id = 'public-mobile-zoom-guard';
    style.textContent = `
      html, body {
        touch-action: pan-y;
        overscroll-behavior-x: none;
      }
      @media (max-width: 767px) {
        input, select, textarea {
          font-size: 16px !important;
        }
      }
    `;
    document.head.appendChild(style);

    return () => {
      document.removeEventListener('gesturestart', preventGesture);
      document.removeEventListener('gesturechange', preventGesture);
      document.removeEventListener('gestureend', preventGesture);
      style.remove();
    };
  }, []);

  return null;
}
