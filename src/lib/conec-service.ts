import { SupabaseClient } from '@supabase/supabase-js';

export interface InstitutionInput {
  nome_instituicao: string;
  cnpj: string;
  nome_representante: string;
  cpf_representante: string;
  email_representante: string;
  telefone_representante?: string;
  whatsapp?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  estado?: string;
  status?: string;
  observacoes_internas?: string;
  asaas_customer_id?: string;
}

export const getInstituicoes = async (supabase: SupabaseClient) => {
  const { data, error } = await supabase
    .from('conec_instituicoes')
    .select('*')
    .is('deleted_at', null)
    .order('nome_instituicao', { ascending: true });

  if (error) throw error;
  return data;
};

export const getInstituicaoById = async (supabase: SupabaseClient, id: string) => {
  const { data, error } = await supabase
    .from('conec_instituicoes')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .single();

  if (error) throw error;
  return data;
};

export const createInstituicao = async (supabase: SupabaseClient, input: InstitutionInput) => {
  const { data, error } = await supabase
    .from('conec_instituicoes')
    .insert([input])
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const updateInstituicao = async (supabase: SupabaseClient, id: string, input: Partial<InstitutionInput>) => {
  const { data, error } = await supabase
    .from('conec_instituicoes')
    .update(input)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};

export const deleteInstituicao = async (supabase: SupabaseClient, id: string) => {
  const { data, error } = await supabase
    .from('conec_instituicoes')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;
  return data;
};
