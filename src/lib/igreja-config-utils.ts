// Utilitário para gerenciar configurações da igreja — schema single-tenant
// Todas as configurações são armazenadas em public.configurations (key/value JSONB)
// Não existe ministry_id, ministries ou ministry_users neste schema.

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ConfiguracaoIgreja {
    nome: string;
    endereco: string;
    cnpj: string;
    telefone: string;
    email: string;
    website?: string;
    descricao?: string;
    responsavel?: string;
    dataCadastro?: string;
    logo: string; // Base64 da imagem
}

const CHURCH_PROFILE_KEY = 'church_profile';
const LOGO_KEY = 'logo';

const CONFIGURACAO_PADRAO: ConfiguracaoIgreja = {
    nome: 'Igreja/Ministério',
    endereco: 'Endereço não configurado',
    cnpj: '',
    telefone: '',
    email: '',
    website: '',
    descricao: '',
    responsavel: '',
    logo: ''
};

export async function fetchConfiguracaoIgrejaFromSupabase(
    supabase: SupabaseClient
): Promise<ConfiguracaoIgreja> {
    const [profileResult, logoResult] = await Promise.all([
        supabase
            .from('configurations')
            .select('value')
            .eq('key', CHURCH_PROFILE_KEY)
            .maybeSingle(),
        supabase
            .from('configurations')
            .select('value')
            .eq('key', LOGO_KEY)
            .maybeSingle(),
    ]);

    const profile = (profileResult.data?.value as any) || {};
    const logo = (logoResult.data?.value as any)?.base64 || '';

    return {
        nome: profile.nome || CONFIGURACAO_PADRAO.nome,
        endereco: profile.endereco || CONFIGURACAO_PADRAO.endereco,
        cnpj: profile.cnpj || '',
        telefone: profile.telefone || '',
        email: profile.email || '',
        website: profile.website || '',
        descricao: profile.descricao || '',
        responsavel: profile.responsavel || '',
        dataCadastro: profile.dataCadastro || '',
        logo,
    };
}

export async function updateConfiguracaoIgrejaInSupabase(
    supabase: SupabaseClient,
    config: Partial<ConfiguracaoIgreja>
): Promise<void> {
    const updates: PromiseLike<any>[] = [];

    const profileFields = ['nome', 'endereco', 'cnpj', 'telefone', 'email', 'website', 'descricao', 'responsavel', 'dataCadastro'] as const;
    const hasProfileUpdate = profileFields.some((k) => typeof (config as any)[k] === 'string');

    if (hasProfileUpdate) {
        const { data: current } = await supabase
            .from('configurations')
            .select('value')
            .eq('key', CHURCH_PROFILE_KEY)
            .maybeSingle();

        const existing = (current?.value as any) || {};
        const next: Record<string, any> = { ...existing };

        for (const k of profileFields) {
            if (typeof (config as any)[k] === 'string') {
                next[k] = (config as any)[k];
            }
        }

        updates.push(
            supabase
                .from('configurations')
                .upsert({ key: CHURCH_PROFILE_KEY, value: next }, { onConflict: 'key' })
                .then((r) => r)
        );
    }

    if (typeof config.logo === 'string') {
        updates.push(
            supabase
                .from('configurations')
                .upsert({ key: LOGO_KEY, value: { base64: config.logo } }, { onConflict: 'key' })
                .then((r) => r)
        );
    }

    if (updates.length === 0) return;

    const results = await Promise.all(updates);
    const firstError = results.find((r) => r.error)?.error;
    if (firstError) throw firstError;
}
