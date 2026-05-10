-- ══════════════════════════════════════════════════════════════
--  Migração: Configuração de certificados por evento
--  Data: 2026-05-10
-- ══════════════════════════════════════════════════════════════

create table if not exists evento_certificado_config (
  id                uuid primary key default gen_random_uuid(),
  evento_id         uuid unique not null references eventos(id) on delete cascade,
  -- Arte de fundo (URL — pode ser Supabase Storage ou qualquer URL pública)
  arte_url          text null,
  -- Texto principal com placeholders: {NOME} {EVENTO} {DATA_EVENTO} {CARGO} {CAMPO} {SUPERVISAO} {CODIGO}
  texto_corpo       text not null default 'Certificamos que {NOME} participou do evento {EVENTO}, realizado em {DATA_EVENTO}.',
  -- Rodapé / data de emissão — suporta {DATA_EMISSAO} {EVENTO}
  rodape_texto      text null default 'Belém, {DATA_EMISSAO}',
  -- Assinatura opcional
  assinatura_nome   text null,
  assinatura_cargo  text null,
  -- Layout
  orientacao        text not null default 'landscape' check (orientacao in ('landscape','portrait')),
  fonte_tamanho     int  not null default 14,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- RLS
alter table evento_certificado_config enable row level security;

-- Leitura pública (página de download público precisa da config)
create policy "cert_config_select_public"
  on evento_certificado_config for select
  using (true);

-- Escrita apenas para autenticados
create policy "cert_config_write_auth"
  on evento_certificado_config for all
  using (auth.role() = 'authenticated');
