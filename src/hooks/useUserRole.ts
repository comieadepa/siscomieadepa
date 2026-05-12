'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase-client';
import { normalizeRole, type CanonicalRole } from '@/lib/auth/roles';

export function useUserRole() {
  const supabase = useMemo(() => createClient(), []);
  const [role, setRole] = useState<CanonicalRole | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data.user;
        if (!user) {
          if (!cancelled) {
            setRole(null);
            setLoading(false);
          }
          return;
        }

        const rawMeta = (user.user_metadata?.nivel || user.user_metadata?.role) as string | undefined;
        let resolved = normalizeRole(rawMeta);

        if (!resolved) {
          const { data: sessionData } = await supabase.auth.getSession();
          const token = sessionData.session?.access_token;
          if (token) {
            const res = await fetch('/api/auth/me', {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
              const json = (await res.json()) as { nivel?: string | null };
              resolved = normalizeRole(json.nivel || undefined);
            }
          }
        }

        if (!cancelled) {
          setRole(resolved);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setRole(null);
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  return { role, loading };
}
