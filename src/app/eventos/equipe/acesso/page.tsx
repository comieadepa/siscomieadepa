'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setEquipeSession } from '@/lib/equipe-session';
import { buildUrl, getAppBaseUrl, getPublicBaseUrl } from '@/lib/urls';

export default function AcessoEquipePage() {
  const router = useRouter();
  const search = useSearchParams();
  // decodeURIComponent garante que tokens URL-encoded (ex: via safe-links de Outlook) sejam normalizados
  const token = decodeURIComponent(search?.get('token') || '');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setErro('Token ausente.');
      return;
    }

    let cancelled = false;

    async function validar() {
      setErro(null);
      try {
        const res = await fetch('/api/eventos/equipe/acesso', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const json = await res.json();
        if (!res.ok) {
          if (!cancelled) setErro(json.error || 'Convite invalido.');
          return;
        }

        const expiraEm = json.expira_em || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        setEquipeSession({
          eventoId: json.evento_id,
          equipeId: json.equipe_id,
          tipo: json.tipo,
          expiraEm,
        });

        const destino = json.tipo === 'checkin'
          ? buildUrl(getPublicBaseUrl(), `/eventos/${json.evento_id}/checkin`)
          : buildUrl(getAppBaseUrl(), `/eventos/${json.evento_id}`);
        router.replace(destino);
      } catch {
        if (!cancelled) setErro('Erro ao validar convite.');
      }
    }

    validar();
    return () => { cancelled = true; };
  }, [token, router]);

  return (
    <div className="min-h-[70vh] flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8 max-w-md w-full text-center">
        <div className="text-3xl mb-3">🔐</div>
        <h1 className="text-lg font-bold text-[#123b63] mb-2">Acesso da Equipe</h1>
        {erro ? (
          <p className="text-sm text-red-600">{erro}</p>
        ) : (
          <p className="text-sm text-gray-500">Validando convite... aguarde.</p>
        )}
      </div>
    </div>
  );
}
