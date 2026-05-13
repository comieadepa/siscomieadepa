'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function SecretariaIndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/secretaria/estrutura-hierarquica');
  }, [router]);

  return <div className="p-8">Redirecionando...</div>;
}
