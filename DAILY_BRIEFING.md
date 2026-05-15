# DAILY BRIEFING - siscomieadepa

**Data de ultima atualizacao:** 15 de maio de 2026
**Contexto atual:** CRM administrativo da COMIEADEPA

---

## Projeto em uma linha

**siscomieadepa** e o CRM de gestao da **COMIEADEPA** (Convencao), usado para organizar rotinas administrativas, secretaria, ministros, eventos, debitos CGADB, financeiro, comissoes, patrimonio, missoes, auditoria, usuarios e configuracoes.

Este projeto **nao e mais multi-tenant**. Documentos antigos que falam em GestaoServus, GestaoEklesia, SaaS multi-tenant, planos, tenants ou `ministry_id` devem ser tratados como historico/legado ate que o codigo confirme que ainda existe alguma dependencia tecnica.

Site institucional de referencia: https://comieadepa.org/

---

## Verdades atuais

- **Nome do sistema:** siscomieadepa.
- **Instituicao:** COMIEADEPA.
- **Tipo:** CRM interno/institucional.
- **Modelo de dados:** organizacao unica, sem tenants comerciais.
- **Autenticacao:** Supabase Auth + validacoes administrativas do projeto.
- **Banco:** Supabase/PostgreSQL.
- **Frontend:** Next.js + React + TypeScript.
- **UI:** Tailwind CSS + Lucide Icons, com identidade visual azul/amarelo da COMIEADEPA.
- **Deploy esperado:** Vercel.

---

## Regra sobre legado multi-tenant

O projeto herdou documentacao e possivelmente trechos de codigo de uma fase anterior chamada GestaoServus/GestaoEklesia.

Ao desenvolver:

- Nao criar novas regras de negocio baseadas em tenant.
- Nao introduzir `ministry_id` em novas tabelas sem necessidade real comprovada.
- Nao tratar COMIEADEPA como "cliente" de um SaaS.
- Se encontrar `ministry_id`, `ministries`, `subscription_plans`, trial ou pre-cadastro, analisar se e legado antes de expandir.
- Preferir nomes alinhados ao dominio atual: supervisoes, campos, ministros, funcionarios, eventos, debitos, cartas, certificados, comissoes, patrimonio, missoes.

---

## Modulos ativos vistos na interface

### Gestao
- Dashboard
- Secretaria
  - Supervisoes e Campos
  - Ministros
  - Funcionarios
  - Consagracao (obreiros)
  - Cartas ministeriais
  - Certificados
  - Permutas
- Debitos CGADB
  - Dashboard
  - Debitos
  - Relatorios
  - Historico
- Financeiro
- Eventos
  - Dashboard Geral
  - Todos os Eventos
- Comissao
- Patrimonio
- Missoes

### Administracao
- Auditoria
- Usuarios
- Configuracoes
  - Geral
  - Importar Ministros
  - Certificados
  - Cartoes

---

## Estrutura esperada do projeto

```text
.
├── docs/                    Documentacao historica e guias atuais
├── src/
│   ├── app/                 Rotas Next.js
│   ├── components/          Componentes React
│   ├── lib/                 Clientes, helpers e integracoes
│   ├── config/              Configuracoes visuais/funcionais
│   └── types/               Tipos TypeScript
├── supabase/
│   └── migrations/          Migracoes PostgreSQL
├── public/                  Assets, logo e imagens
├── package.json
├── tsconfig.json
├── .env.local               Credenciais locais (nao commitar)
└── .env.local.template      Template sem segredos
```

---

## Seguranca e dados

- Nunca registrar senhas, tokens ou service role keys em `.md`.
- Usar `.env.local` para segredos locais e manter `.env.local.template` sem valores reais.
- Service role key somente em codigo server-side.
- Rotas administrativas devem validar sessao/permissao no servidor.
- Listagens grandes devem usar paginacao/filtros.
- Alteracoes financeiras, usuarios, debitos, certificados e cartas ministeriais devem ser auditaveis sempre que possivel.

---

## Como iniciar uma sessao de trabalho

1. Ler este arquivo.
2. Conferir estado do repositorio.
3. Conferir `.env.local` quando a tarefa depender de Supabase, mapas, email ou pagamentos.
4. Rodar o servidor local quando for validar UI.
5. Se o dev server no Windows falhar por porta/lock, validar pelo build e corrigir o ambiente antes de teste visual.

Comandos usuais:

```bash
npm run dev
npm run build
npm run lint
```

---

## Documentacao prioritaria

- `docs/AI_DAILY_READ.md` - leitura diaria atualizada.
- `docs/AI_PROJECT_MAP.md` - mapa atual dos modulos.
- `docs/AI_SECURITY_AND_DATA.md` - seguranca e dados no modelo atual.
- `docs/README.md` - indice geral atualizado.

Arquivos antigos continuam uteis para investigar historico, mas nao devem prevalecer contra este briefing quando citarem GestaoServus/GestaoEklesia como SaaS multi-tenant.

---

## Checklist antes de finalizar mudancas

- [ ] A mudanca respeita o dominio COMIEADEPA/siscomieadepa.
- [ ] Nao adicionou regra multi-tenant nova sem justificativa.
- [ ] Nao expôs segredo em codigo, log ou documentacao.
- [ ] Validou TypeScript/build quando aplicavel.
- [ ] Conferiu impacto nos menus/modulos ativos.
- [ ] Atualizou documentacao se mudou fluxo de uso ou regra de negocio.
