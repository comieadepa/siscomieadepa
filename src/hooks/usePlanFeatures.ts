'use client';

import { useEffect, useState } from 'react';

export interface PlanFeatures {
  has_modulo_financeiro: boolean;
  has_modulo_eventos: boolean;
  has_modulo_reunioes: boolean;
  /** true enquanto carrega, false quando resolvido */
  loading: boolean;
}

const DEFAULT_FEATURES: PlanFeatures = {
  has_modulo_financeiro: true,
  has_modulo_eventos: true,
  has_modulo_reunioes: true,
  loading: true,
};

export function usePlanFeatures(): PlanFeatures {
  const [features, setFeatures] = useState<PlanFeatures>(DEFAULT_FEATURES);

  useEffect(() => {
    setFeatures({ ...DEFAULT_FEATURES, loading: false });
  }, []);

  return features;
}
