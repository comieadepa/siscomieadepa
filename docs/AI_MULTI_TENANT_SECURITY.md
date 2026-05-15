# Legado - Multi-tenant e seguranca

Este arquivo foi mantido apenas para contexto historico.

## Status atual

O projeto **siscomieadepa** nao e mais um SaaS multi-tenant. Ele e um CRM administrativo da **COMIEADEPA**, com uma unica organizacao institucional.

As regras antigas abaixo nao devem orientar novas features:

- usar `ministry_id` como tenant canonico;
- criar toda tabela nova com `ministry_id`;
- tratar dados como isolados por cliente/tenant;
- expandir fluxos de planos, trial ou pre-cadastro comercial.

Se algum trecho do codigo ainda depender desses nomes, trate como legado a ser entendido e, quando seguro, simplificado.

## Regras atuais de seguranca e dados

Consulte o documento atual:

- `docs/AI_SECURITY_AND_DATA.md`

Resumo:

- validar autenticacao/permissao em rotas administrativas;
- nunca expor service role no frontend;
- nao gravar segredos em documentacao;
- usar paginacao/filtros em listagens grandes;
- auditar alteracoes sensiveis sempre que possivel.
