# IA - Seguranca e dados no siscomieadepa

## Contexto

O siscomieadepa e um CRM administrativo da COMIEADEPA. O sistema trabalha com dados institucionais, ministeriais, administrativos e financeiros. Mesmo sem multi-tenant, a seguranca continua sendo essencial.

---

## Principios

- Validar usuario e permissao no servidor para rotas administrativas.
- Nunca expor `SUPABASE_SERVICE_ROLE_KEY` no frontend.
- Nunca registrar senhas, tokens ou chaves em `.md`.
- Evitar logs com dados pessoais, financeiros ou credenciais.
- Usar filtros e paginacao em telas com muitos registros.
- Auditar alteracoes sensiveis sempre que possivel.

---

## Areas sensiveis

- Usuarios e permissoes.
- Financeiro.
- Debitos CGADB.
- Importacao de ministros.
- Certificados.
- Cartas ministeriais.
- Auditoria.
- Eventos com inscricoes/pagamentos.

---

## Checklist para nova tabela

- [ ] O nome reflete o dominio COMIEADEPA?
- [ ] Ha chaves/indices para filtros usados na UI?
- [ ] Campos sensiveis sao realmente necessarios?
- [ ] Existe `created_at` e, quando util, `updated_at`?
- [ ] Alteracoes devem gerar log/auditoria?
- [ ] RLS/policies fazem sentido para o modelo atual?

Observacao: nao adicionar `ministry_id` por padrao. Isso era regra da fase multi-tenant antiga.

---

## Checklist para nova API

- [ ] Valida sessao/permissao no servidor?
- [ ] Usa service role apenas quando necessario?
- [ ] Nao confia em payload do cliente para permissao?
- [ ] Valida entrada antes de gravar?
- [ ] Retorna erros claros sem vazar detalhes internos?
- [ ] Usa paginacao em listagens?
- [ ] Registra auditoria quando altera dado sensivel?

---

## Checklist para nova tela

- [ ] Esta alinhada aos menus ativos do sistema?
- [ ] Usa a identidade visual atual do siscomieadepa?
- [ ] Evita carregar todos os registros sem necessidade?
- [ ] Trata estados vazios, carregamento e erro?
- [ ] Respeita permissoes do usuario?
- [ ] Nao mostra dados sensiveis sem necessidade?

---

## Legado

Documentos antigos podem citar:

- GestaoServus/GestaoEklesia;
- SaaS multi-tenant;
- `ministry_id`;
- planos de assinatura;
- trial/pre-cadastro.

Esses pontos nao sao regra atual. Se ainda aparecerem no codigo, investigue antes de remover, mas nao expanda esse modelo em novas features.
