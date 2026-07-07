'use client';

import { useEffect, useState } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration?: number; // ms, padrão 4000
}

interface ToastNotificationProps {
  toasts: ToastItem[];
  onRemove: (id: string) => void;
}

const ICONS: Record<ToastType, string> = {
  success: '✅',
  error:   '❌',
  warning: '⚠️',
  info:    'ℹ️',
};

const COLORS: Record<ToastType, { bg: string; border: string; text: string }> = {
  success: { bg: '#f0fdf4', border: '#86efac', text: '#166534' },
  error:   { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b' },
  warning: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e' },
  info:    { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af' },
};

function ToastCard({ toast, onRemove }: { toast: ToastItem; onRemove: () => void }) {
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const duration = toast.duration ?? (toast.type === 'error' ? 6000 : 4000);

  useEffect(() => {
    // Acionar animação de entrada
    const enterTimer = setTimeout(() => setVisible(true), 10);

    // Agendar saída
    const leaveTimer = setTimeout(() => {
      setLeaving(true);
      setTimeout(onRemove, 300);
    }, duration);

    return () => {
      clearTimeout(enterTimer);
      clearTimeout(leaveTimer);
    };
  }, [duration, onRemove]);

  const { bg, border, text } = COLORS[toast.type];

  return (
    <div
      role="alert"
      aria-live="polite"
      onClick={() => {
        setLeaving(true);
        setTimeout(onRemove, 300);
      }}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '10px',
        padding: '12px 16px',
        backgroundColor: bg,
        border: `1px solid ${border}`,
        borderRadius: '12px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        cursor: 'pointer',
        minWidth: '280px',
        maxWidth: '400px',
        color: text,
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: visible && !leaving ? 1 : 0,
        transform: visible && !leaving ? 'translateX(0)' : 'translateX(100%)',
        pointerEvents: 'auto',
      }}
    >
      <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>
        {ICONS[toast.type]}
      </span>
      <span style={{ fontSize: '13px', fontWeight: 500, lineHeight: '1.4', flex: 1 }}>
        {toast.message}
      </span>
      <span style={{ fontSize: '16px', flexShrink: 0, opacity: 0.5, marginTop: '-1px' }}>
        ×
      </span>
    </div>
  );
}

export default function ToastNotification({ toasts, onRemove }: ToastNotificationProps) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-label="Notificações"
      style={{
        position: 'fixed',
        bottom: '24px',
        right: '24px',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        alignItems: 'flex-end',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onRemove={() => onRemove(t.id)} />
      ))}
    </div>
  );
}

// Hook utilitário para gerenciar a fila de toasts
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = (type: ToastType, message: string, duration?: number) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => {
      const next = [...prev, { id, type, message, duration }];
      // Limitar a 5 toasts simultâneos
      return next.length > 5 ? next.slice(next.length - 5) : next;
    });
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return { toasts, showToast, removeToast };
}
