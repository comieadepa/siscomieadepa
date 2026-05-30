'use client';

import { createContext, useContext } from 'react';

export interface MinistroData {
  id: string;
  nome: string;
  matricula: string | null;
  cpfMascarado: string;
  cargo: string;
  status: string;
  supervisao: string;
  campo: string;
  fotoUrl: string | null;
  isPastorPresidente: boolean;
  uniqueId: string | null;
  dataValidadeCredencial: string | null;
}

export interface MinistroContextType {
  ministro: MinistroData | null;
  loading: boolean;
}

export const MinistroContext = createContext<MinistroContextType>({ ministro: null, loading: true });
export const useMinistro = () => useContext(MinistroContext);
