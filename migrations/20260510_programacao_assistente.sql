-- ══════════════════════════════════════════════════════════════
--  Migração: Programação do evento + Logs do Assistente de IA
--  Data: 2026-05-10
-- ══════════════════════════════════════════════════════════════

-- ── Tabela: evento_programacao ────────────────────────────────
create table if not exists evento_programacao (
  id           uuid primary key default gen_random_uuid(),
  evento_id    uuid not null references eventos(id) on delete cascade,
  data         date not null,
  horario      time null,
  titulo       text not null,
  descricao    text null,
  palestrante  text null,
  local        text null,
  ordem        int  not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_evento_programacao_evento_id
  on evento_programacao(evento_id);

create index if not exists idx_evento_programacao_data_horario
  on evento_programacao(evento_id, data, horario);

-- RLS
alter table evento_programacao enable row level security;

-- Leitura pública (página de inscrição e assistente)
create policy "programacao_select_public"
  on evento_programacao for select
  using (true);

-- Escrita apenas para autenticados (admins)
create policy "programacao_insert_auth"
  on evento_programacao for insert
  with check (auth.role() = 'authenticated');

create policy "programacao_update_auth"
  on evento_programacao for update
  using (auth.role() = 'authenticated');

create policy "programacao_delete_auth"
  on evento_programacao for delete
  using (auth.role() = 'authenticated');

-- ── Tabela: evento_assistente_logs ────────────────────────────
create table if not exists evento_assistente_logs (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null,
  pergunta   text not null,
  resposta   text not null,
  cpf        text null,           -- armazenado apenas se o usuário forneceu
  modo       text not null default 'ia', -- 'ia' | 'fallback'
  created_at timestamptz not null default now()
);

create index if not exists idx_assistente_logs_evento_id
  on evento_assistente_logs(evento_id);

-- Sem RLS restritiva (logs internos, não expostos publicamente)
alter table evento_assistente_logs enable row level security;

create policy "assistente_logs_insert_anon"
  on evento_assistente_logs for insert
  with check (true);

create policy "assistente_logs_select_auth"
  on evento_assistente_logs for select
  using (auth.role() = 'authenticated');
