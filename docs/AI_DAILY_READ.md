# IA - Leitura diaria essencial

**Objetivo:** alinhar rapidamente o contexto atual antes de mexer no projeto.

---

## 1) Identidade atual do projeto

- **Sistema:** siscomieadepa.
- **Instituicao:** COMIEADEPA.
- **Natureza:** CRM administrativo/institucional.
- **Nao e SaaS multi-tenant.**
- **Nao tratar COMIEADEPA como tenant/cliente.**

O historico antigo usa nomes como GestaoServus/GestaoEklesia e fala em multi-tenant. Isso e legado. Antes de reaproveitar qualquer regra antiga, confirme se ela ainda existe no codigo atual.

Referencia institucional: https://comieadepa.org/

---

## 2) Regras que nao devem ser quebradas

- Rotas administrativas precisam validar autenticacao/permissao no servidor.
- Segredos nunca devem entrar em `.md`, codigo client-side ou logs.
- Service role key somente em API/server-side.
- Listagens grandes devem usar filtros, paginacao ou carregamento controlado.
- Alteracoes sensiveis devem considerar auditoria: usuarios, financeiro, debitos, certificados, cartas e importacoes.
- Evite criar dependencia nova em `ministry_id`, `ministries`, planos, trial ou tenants sem confirmar que ainda e necessario.

---

## 3) Modulos ativos na UI

- Dashboard
- Secretaria: Supervisoes e Campos, Ministros, Funcionarios, Consagracao, Cartas ministeriais, Certificados, Permutas
- Debitos CGADB: Dashboard, Debitos, Relatorios, Historico
- Financeiro
- Eventos: Dashboard Geral, Todos os Eventos
- Comissao
- Patrimonio
- Missoes
- Administracao: Auditoria, Usuarios, Configuracoes

---

## 4) Arquivos para consultar primeiro

- `DAILY_BRIEFING.md`
- `docs/AI_PROJECT_MAP.md`
- `docs/AI_SECURITY_AND_DATA.md`
- `docs/README.md`

Quando mexer em um modulo especifico, procure tambem docs historicos do modulo. Use-os como contexto, nao como autoridade absoluta se falarem em SaaS/multi-tenant.

---

## 5) Ambiente

Variaveis comuns:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Comandos usuais:

```bash
npm run dev
npm run build
npm run lint
```

Observacao: no Windows, o dev server pode falhar por porta ocupada ou lock em `.next`. Quando isso acontecer, estabilize o ambiente antes de validar UI.

---

## 6) Atencao a legado

Se encontrar documentos ou codigo falando em:

- GestaoServus/GestaoEklesia
- SaaS
- tenants
- `ministry_id`
- `ministries`
- planos de assinatura
- trial/pre-cadastro

trate como possivel legado. A regra atual e **CRM unico da COMIEADEPA**.
