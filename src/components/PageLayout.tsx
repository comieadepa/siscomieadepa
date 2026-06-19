'use client';

import { ReactNode, createContext, useContext, useState, useEffect } from 'react';

interface LayoutContextProps {
  title: string;
  setTitle: (t: string) => void;
  description: string;
  setDescription: (d: string) => void;
  activeMenu: string;
  setActiveMenu: (m: string) => void;
}

const LayoutContext = createContext<LayoutContextProps | undefined>(undefined);

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [activeMenu, setActiveMenu] = useState('dashboard');

  return (
    <LayoutContext.Provider value={{ title, setTitle, description, setDescription, activeMenu, setActiveMenu }}>
      {children}
    </LayoutContext.Provider>
  );
}

export function useLayout() {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
}

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
  const { setTitle, setDescription, setActiveMenu } = useLayout();

  useEffect(() => {
    setTitle(title);
    setDescription(description);
    if (activeMenu) {
      setActiveMenu(activeMenu);
    }
  }, [title, description, activeMenu, setTitle, setDescription, setActiveMenu]);

  return <>{children}</>;
}
