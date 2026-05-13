'use client';

import Sidebar from '@/components/Sidebar';
import { ReactNode, useState } from 'react';

interface PageLayoutProps {
  title: string;
  description: string;
  children: ReactNode;
  activeMenu?: string;
}

export default function PageLayout({
  title,
  description,
  children,
  activeMenu = 'dashboard'
}: PageLayoutProps) {
  const [sidebarActive, setSidebarActive] = useState(activeMenu);

  return (
    <div className="flex min-h-screen bg-gray-100 overflow-x-hidden">
      {/* SIDEBAR */}
      <Sidebar activeMenu={sidebarActive} setActiveMenu={setSidebarActive} />

      {/* MAIN CONTENT */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
        {/* HEADER */}
        <div className="bg-white shadow-sm border-b border-gray-200 p-4 sm:p-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-[#123b63]">{title}</h1>
          <p className="text-gray-600 text-xs sm:text-sm mt-1">{description}</p>
        </div>

        {/* CONTENT */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6">
          {children}
        </div>
      </div>
    </div>
  );
}
