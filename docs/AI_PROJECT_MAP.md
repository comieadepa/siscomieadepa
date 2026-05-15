# IA - Mapa atual do projeto

## Visao em uma linha

**siscomieadepa** e um CRM administrativo da **COMIEADEPA**, construido com Next.js, React, TypeScript e Supabase.

Nao e mais um SaaS multi-tenant.

---

## Modulos principais

### 1) Dashboard

Tela inicial do sistema, com atalhos e indicadores institucionais.

Indicadores vistos na UI:

- Total de Supervisao
- Total de Campos
- Total de Candidatos
- Ministros Ativos
- Resumo institucional

### 2) Secretaria

Modulo operacional principal da convencao.

Menus ativos:

- Supervisoes e Campos
- Ministros
- Funcionarios
- Consagracao (obreiros)
- Cartas ministeriais
- Certificados
- Permutas

Provaveis areas de codigo:

- `src/app/secretaria/*`
- componentes e helpers relacionados a ministros, campos, supervisoes, cartas e certificados

### 3) Debitos CGADB

Controle de debitos vinculados a CGADB.

Menus ativos:

- Dashboard
- Debitos
- Relatorios
- Historico

### 4) Financeiro

Rotinas financeiras internas. Confirmar no codigo quais telas e APIs estao ativas antes de alterar.

### 5) Eventos

Gestao de eventos da COMIEADEPA.

Menus ativos:

- Dashboard Geral
- Todos os Eventos

Tambem existe documentacao recente sobre a assistente Maia em eventos:

- `docs/IA_ASSISTENTE_MAIA_IMPLEMENTACAO.md`

### 6) Comissao

Modulo institucional de comissao. Confirmar estrutura no codigo antes de alterar.

### 7) Patrimonio

Modulo de controle patrimonial. Confirmar estrutura no codigo antes de alterar.

### 8) Missoes

Modulo ligado a missoes e atividades institucionais. Confirmar estrutura no codigo antes de alterar.

### 9) Administracao

Menus ativos:

- Auditoria
- Usuarios
- Configuracoes
  - Geral
  - Importar Ministros
  - Certificados
  - Cartoes

Areas sensiveis:

- usuarios e permissoes;
- importacao de dados;
- certificados/cartoes;
- logs de auditoria.

---

## Pastas importantes

```text
src/app/                 Rotas e telas Next.js
src/components/          Componentes compartilhados
src/lib/                 Clientes, helpers e integracoes
src/config/              Configuracoes do sistema
src/types/               Tipos TypeScript
supabase/migrations/     Migracoes de banco
public/                  Logos, imagens e assets
docs/                    Documentacao atual e historica
```

---

## Nota sobre nomes antigos

Se encontrar referencias a GestaoServus, GestaoEklesia, SaaS, multi-tenant ou `ministry_id`, trate como legado da fase anterior do projeto. A regra atual e usar a linguagem do dominio COMIEADEPA/siscomieadepa.
