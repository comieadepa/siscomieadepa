import type { SupabaseClient } from '@supabase/supabase-js';

export type TipoCartao = 'membro' | 'congregado' | 'ministro' | 'funcionario';

const TIPOS_HABILITADOS: TipoCartao[] = ['ministro', 'funcionario'];

function getSupabaseErrorText(error: any): string {
  if (!error) return '';
  const anyErr = error as any;
  const parts = [
    anyErr?.code ? `(${String(anyErr.code)})` : '',
    anyErr?.message ? String(anyErr.message) : '',
    anyErr?.details ? String(anyErr.details) : '',
    anyErr?.hint ? String(anyErr.hint) : '',
  ].filter(Boolean);

  if (parts.length > 0) return parts.join(' ');

  try {
    const ownNames = Object.getOwnPropertyNames(anyErr || {});
    const dump: Record<string, unknown> = {};
    for (const k of ownNames) {
      try {
        dump[k] = anyErr[k];
      } catch {
        // ignore property access issues
      }
    }
    const json = JSON.stringify(dump);
    return json && json !== '{}' ? json : String(anyErr);
  } catch {
    return String(anyErr || 'erro desconhecido');
  }
}

function isCartoesTemplatesUnavailableError(error: any): boolean {
  const text = getSupabaseErrorText(error).toLowerCase();
  return (
    (text.includes('cartoes_templates') && (text.includes('schema cache') || text.includes('could not find the table'))) ||
    text.includes('pgrst205') ||
    text.includes('permission denied') ||
    text.includes('not authorized') ||
    text.includes('violates row-level security') ||
    text.includes('failed to fetch') ||
    text.includes('networkerror') ||
    text.includes('network request failed')
  );
}

export async function resolveMinistryId(supabase: SupabaseClient): Promise<string | null> {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    // Single-tenant: retornar user.id como namespace
    return user?.id || null;
  } catch {
    return null;
  }
}

function ensureDefaultActives(templatesInput: any[]): { next: any[]; changed: boolean } {
  const tipos: TipoCartao[] = TIPOS_HABILITADOS;
  let changed = false;
  const next = templatesInput.map(t => ({ ...t }));

  tipos.forEach((tipo) => {
    const hasActive = next.some(t => (t?.tipoCadastro || t?.tipo) === tipo && t?.ativo);
    if (hasActive) return;

    const firstOfType = next.find(t => (t?.tipoCadastro || t?.tipo) === tipo);
    if (firstOfType) {
      firstOfType.ativo = true;
      changed = true;
    }
  });

  return { next, changed };
}

function buildDefaultTemplatesSnapshot(): any[] {
  const { TEMPLATES_CUSTOMIZADOS } = require('@/lib/custom-card-templates');
  const { TEMPLATES_DISPONIVEIS, converterParaTemplateEditavel } = require('@/lib/card-templates');
  const mapCustomizados = new Map();
  TEMPLATES_CUSTOMIZADOS.forEach((ct: any) => mapCustomizados.set(ct.id, ct));

  return TEMPLATES_DISPONIVEIS
    .filter((t: any) => TIPOS_HABILITADOS.includes((t.tipo || t.tipoCadastro) as TipoCartao))
    .map((t: any) => {
    const customizado = mapCustomizados.get(t.id);
    const templateParaUsar = customizado || t;
    const editavel = converterParaTemplateEditavel(templateParaUsar);
    const tipoCadastro = editavel.tipoCadastro || templateParaUsar.tipo || templateParaUsar.tipoCadastro;
    return {
      ...editavel,
      tipoCadastro: tipoCadastro,
      tipo: tipoCadastro,
    };
  });
}

function sanitizeTemplateForStorage(template: any): any {
  if (!template || typeof template !== 'object') return template;
  const copy = { ...template };
  delete copy.backgroundFile;
  delete copy.backgroundFileVerso;
  return copy;
}

export async function fetchCartoesTemplatesFromSupabase(
  supabase: SupabaseClient,
  _ministryId: string
): Promise<any[]> {
  const { data, error } = await supabase
    .from('cartoes_templates')
    .select('id,name,tipo,is_active,template_data,updated_at,created_at')
    .order('updated_at', { ascending: false });

  if (error) {
    const msg = getSupabaseErrorText(error);
    if (isCartoesTemplatesUnavailableError(error)) {
      console.warn('⚠️ Tabela/rede de cartoes_templates indisponível; usando templates locais.');
      return [];
    }
    console.error('❌ Erro ao buscar templates no Supabase:', msg || error);
    return [];
  }

  const rows = (data as any[]) || [];
  return rows
    .map((r: any) => {
      const t = r?.template_data;
      if (!t) return null;
      const tipoCadastro = (t.tipoCadastro || t.tipo || r.tipo) as string | undefined;
      return {
        ...t,
        id: t.id || r.id,
        _dbId: r.id,
        tipoCadastro: tipoCadastro,
        tipo: tipoCadastro,
        ativo: r.is_active === true,
      };
    })
    .filter(Boolean);
}

export async function persistTemplatesSnapshotToSupabase(
  supabase: SupabaseClient,
  _ministryId: string,
  tipo: TipoCartao,
  templatesSnapshot: any[]
): Promise<void> {
  const templatesDoTipo = templatesSnapshot
    .filter(t => (t?.tipoCadastro || t?.tipo) === tipo)
    .map(sanitizeTemplateForStorage);

  if (templatesDoTipo.length === 0) return;

  const rows = templatesDoTipo.map(t => {
    // preview_url é VARCHAR(500) no banco — data URLs base64 excedem esse limite
    const rawPreview: string | undefined = t.previewImage;
    const previewUrl =
      rawPreview && !rawPreview.startsWith('data:') && rawPreview.length <= 500
        ? rawPreview
        : null;
    return {
      template_key: String(t.id),
      tipo,
      name: String(t.nome || t.name || t.id),
      description: null as any,
      template_data: t,
      preview_url: previewUrl as any,
      is_default: (t.ativo === true) as any,
      is_active: (t.ativo === true) as any,
    };
  });

  // Estratégia: INSERT primeiro; se 23505 (duplicate key, pois delete pode ser bloqueado por
  // RLS), faz UPDATE por template_key nos rows conflitantes.
  const ins = await supabase.from('cartoes_templates').insert(rows as any);

  if (!ins.error) return; // sucesso

  const insMsg = getSupabaseErrorText(ins.error);

  if (isCartoesTemplatesUnavailableError(ins.error)) {
    console.warn('⚠️ Persistência de templates ignorada: cartoes_templates indisponível neste ambiente.');
    return;
  }

  if ((ins.error as any)?.code === '23505') {
    // Linha já existe — atualizar cada template por template_key
    for (const row of rows) {
      const { error: updErr } = await supabase
        .from('cartoes_templates')
        .update({
          name: row.name,
          tipo: row.tipo,
          template_data: row.template_data,
          is_default: row.is_default,
          is_active: row.is_active,
          preview_url: row.preview_url,
        })
        .eq('template_key', row.template_key);

      if (updErr && !isCartoesTemplatesUnavailableError(updErr)) {
        console.error('❌ Erro ao atualizar template no Supabase:', getSupabaseErrorText(updErr) || updErr);
      }
    }
    return;
  }

  console.error('❌ Erro ao inserir templates no Supabase:', insMsg || ins.error);
}

async function canUseCartoesTemplatesTable(supabase: SupabaseClient, _ministryId: string): Promise<boolean> {
  const probe = await supabase
    .from('cartoes_templates')
    .select('id', { count: 'exact', head: true })
    .limit(1);

  if (!probe.error) return true;
  if (isCartoesTemplatesUnavailableError(probe.error)) return false;
  return true;
}

export async function loadTemplatesForCurrentUser(
  supabase: SupabaseClient,
  options?: { allowLocalMigration?: boolean }
): Promise<{ templates: any[]; ministryId: string | null }>
{
  const ministryId = await resolveMinistryId(supabase);
  if (!ministryId) return { templates: [], ministryId: null };

  const tableAvailable = await canUseCartoesTemplatesTable(supabase, ministryId);
  if (!tableAvailable) {
    const fallback = buildDefaultTemplatesSnapshot();
    const ensuredFallback = ensureDefaultActives(fallback);
    return { templates: ensuredFallback.next, ministryId };
  }

  const fromDb = await fetchCartoesTemplatesFromSupabase(supabase, ministryId);
  const fromDbFiltrado = fromDb.filter((t: any) => TIPOS_HABILITADOS.includes((t?.tipoCadastro || t?.tipo) as TipoCartao));
  if (fromDbFiltrado.length > 0) {
    const ensured = ensureDefaultActives(fromDbFiltrado);
    if (ensured.changed) {
      const tipos: TipoCartao[] = TIPOS_HABILITADOS;
      for (const tipo of tipos) {
        // eslint-disable-next-line no-await-in-loop
        await persistTemplatesSnapshotToSupabase(supabase, ministryId, tipo, ensured.next);
      }
    }
    return { templates: ensured.next, ministryId };
  }

  let templatesBase: any[] = [];
  let migratedFromLocal = false;

  if (options?.allowLocalMigration && typeof window !== 'undefined') {
    try {
      const legacy = localStorage.getItem('cartoes_templates_v2');
      if (legacy) {
        const parsed = JSON.parse(legacy);
        if (Array.isArray(parsed) && parsed.length > 0) {
          templatesBase = parsed;
          migratedFromLocal = true;
        }
      }
    } catch {
      // ignore
    }
  }

  if (templatesBase.length === 0) {
    templatesBase = buildDefaultTemplatesSnapshot();
  }

  templatesBase = templatesBase.filter((t: any) => TIPOS_HABILITADOS.includes((t?.tipoCadastro || t?.tipo) as TipoCartao));

  const ensured = ensureDefaultActives(templatesBase);
  const templatesFinal = ensured.next;

  const tipos: TipoCartao[] = TIPOS_HABILITADOS;
  for (const tipo of tipos) {
    // eslint-disable-next-line no-await-in-loop
    await persistTemplatesSnapshotToSupabase(supabase, ministryId, tipo, templatesFinal);
  }

  if (migratedFromLocal && typeof window !== 'undefined') {
    try {
      localStorage.removeItem('cartoes_templates_v2');
    } catch {
      // ignore
    }
  }

  return { templates: templatesFinal, ministryId };
}

/**
 * Versão com cache local: lê cartoes_templates_v3 do localStorage primeiro.
 * Use esta função nos componentes de impressão/visualização.
 */
export async function loadTemplatesWithLocalCache(
  supabase: SupabaseClient,
  options?: { allowLocalMigration?: boolean }
): Promise<{ templates: any[]; ministryId: string | null }> {
  if (typeof window !== 'undefined') {
    try {
      const cached = localStorage.getItem('cartoes_templates_v3');
      if (cached) {
        const parsed = JSON.parse(cached) as any[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          // retorna cache imediatamente; ministryId é resolvido em background
          return { templates: parsed, ministryId: null };
        }
      }
    } catch { /* ignore */ }
  }
  return loadTemplatesForCurrentUser(supabase, options);
}
