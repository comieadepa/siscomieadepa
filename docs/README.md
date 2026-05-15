# Documentacao - siscomieadepa

Esta pasta contem documentacao atual e historica do projeto.

## Contexto atual

**siscomieadepa** e o CRM administrativo da **COMIEADEPA**. O sistema nao e mais GestaoServus/GestaoEklesia e nao deve ser tratado como SaaS multi-tenant.

Use como referencia principal:

1. `../DAILY_BRIEFING.md`
2. `AI_DAILY_READ.md`
3. `AI_PROJECT_MAP.md`
4. `AI_SECURITY_AND_DATA.md`

## Modulos ativos

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

## Como ler esta pasta

Muitos documentos foram criados em fases anteriores do produto. Eles podem ser uteis para entender historico, mas alguns usam conceitos antigos:

- GestaoServus/GestaoEklesia;
- SaaS;
- multi-tenant;
- `ministry_id`;
- planos e trials comerciais;
- pre-cadastro de clientes.

Esses conceitos nao representam a direcao atual do projeto. Antes de aplicar qualquer instrucao antiga, confirme no codigo e nos documentos atuais.

## Documentos atuais recomendados

| Arquivo | Uso |
|---|---|
| `AI_DAILY_READ.md` | Leitura rapida antes de codar |
| `AI_PROJECT_MAP.md` | Mapa dos modulos atuais |
| `AI_SECURITY_AND_DATA.md` | Regras atuais de seguranca e dados |
| `IA_ASSISTENTE_MAIA_IMPLEMENTACAO.md` | Referencia da assistente Maia para eventos |
| `GUIA_DEPLOY_PRODUCAO.md` | Guia de deploy, revisar variaveis antes de usar |

## Documentos historicos por tema

### Atendimento/trial legado

Arquivos sobre painel de atendimento, pre-cadastros, trials, planos e assinaturas refletem a fase anterior do projeto. Consulte apenas para reaproveitar componentes, padroes de UI ou historico tecnico.

### Geolocalizacao

Documentos de geolocalizacao podem conter ideias uteis sobre mapas, coordenadas e filtros. Confirme nomes de tabelas/campos no codigo atual antes de alterar.

### Suporte/tickets

Documentos de suporte/tickets podem ser aproveitados se o modulo ainda existir ativo no codigo. Confirme no menu atual antes de expandir.

### Seguranca/admin

Documentos de seguranca sobre autenticação admin ainda podem conter correcoes validas, mas remova mentalmente a camada multi-tenant quando ela aparecer.

## Regra final

Quando houver conflito entre documentos antigos e a orientacao atual:

**prevalece o modelo siscomieadepa, CRM unico da COMIEADEPA.**
