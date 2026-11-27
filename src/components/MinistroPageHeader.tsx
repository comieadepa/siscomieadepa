'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, LucideIcon } from 'lucide-react';

interface MinistroPageHeaderProps {
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: LucideIcon;
  backHref?: string;
  action?: React.ReactNode;
}

export default function MinistroPageHeader({
  title,
  subtitle,
  badge,
  icon: Icon,
  backHref = '/app',
  action,
}: MinistroPageHeaderProps) {
  const router = useRouter();

  const handleBack = () => {
    if (backHref) {
      router.push(backHref);
    } else {
      router.back();
    }
  };

  return (
    <div className="mb-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-gray-200/70">
      <div className="flex items-start gap-3">
        {/* Botão Voltar mobile e desktop */}
        <button
          onClick={handleBack}
          aria-label="Voltar"
          className="mt-1 p-2 rounded-xl bg-white border border-gray-200 text-gray-700 hover:bg-gray-100 hover:text-[#0D2B4E] transition shadow-xs flex-shrink-0 active:scale-95"
        >
          <ArrowLeft size={18} strokeWidth={2.5} />
        </button>

        <div>
          {badge && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-blue-50 text-[#0D2B4E] text-[11px] font-bold mb-1.5 border border-blue-100">
              {Icon && <Icon size={13} className="text-[#BD8724]" />}
              <span>{badge}</span>
            </div>
          )}
          <h1 className="text-2xl font-black text-gray-900 tracking-tight flex items-center gap-2">
            {!badge && Icon && <Icon size={24} className="text-[#0D2B4E] hidden sm:inline" />}
            <span>{title}</span>
          </h1>
          {subtitle && (
            <p className="text-xs md:text-sm text-gray-500 font-medium mt-0.5">
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {action && <div className="flex items-center gap-2 flex-shrink-0">{action}</div>}
    </div>
  );
}
