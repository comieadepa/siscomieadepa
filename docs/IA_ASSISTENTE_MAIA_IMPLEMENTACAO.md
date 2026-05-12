# Implementacao do Assistente Maia (IA de atendimento)

Este documento descreve toda a estrutura necessaria para replicar a assistente Maia em outro projeto, incluindo frontend (widget), API, fluxos, intents e dependencias de dados.

## 1) Visao geral

- Arquitetura: Next.js (App Router) + Supabase + API route dedicada.
- IA: fallback local + OpenAI (opcional).
- Memoria de contexto: apenas no frontend (estado do widget), sem banco adicional.
- Avatar: imagem PNG em `public/maia.png`.

## 2) Arquivos principais

- API: `src/app/api/eventos/[eventoId]/assistente/route.ts`
- Widget: `src/components/AssistenteWidget.tsx`
- Avatar: `public/maia.png`

## 3) Contrato de API

**Endpoint**
- `POST /api/eventos/[eventoId]/assistente`

**Body (JSON)**
```
{
  "pergunta": "string",
  "cpf": "string opcional",
  "contexto": {
    "intent": "segunda_via | consulta_inscricao | hospedagem | certificado | null",
    "aguardandoCpf": "boolean",
    "ultimoCpf": "string | null"
  }
}
```

**Resposta (JSON)**
```
{
  "resposta": "string",
  "modo": "fallback | ia"
}
```

## 4) Dependencias de dados (Supabase)

### Tabela `eventos`
Campos usados:
- `id`, `nome`, `slug`, `descricao`, `departamento`, `data_inicio`, `data_fim`
- `local`, `cidade`, `valor_inscricao`
- `permite_hospedagem`, `permite_alimentacao`, `permite_brinde`
- `link_whatsapp`
- `mensagem_confirmacao`, `publico_alvo`, `status`
- `suporte_nome`, `suporte_whatsapp`

### Tabela `evento_programacao`
Campos usados:
- `evento_id`, `data`, `horario`, `titulo`, `descricao`, `palestrante`, `local`, `ordem`

### Tabela `evento_inscricoes`
Campos usados:
- `evento_id`, `cpf`, `nome_inscrito`, `status_pagamento`
- `hospedagem`, `alimentacao`, `brinde`
- `created_at`, `forma_pagamento`
- `valor_final`, `invoice_url`, `pix_copia_cola`, `pix_qr_code`, `asaas_due_date`

### Tabela `evento_assistente_logs`
Campos usados para log:
- `evento_id`, `pergunta`, `resposta`, `cpf`, `modo`

## 5) Fluxos principais

### 5.1 Segunda via de pagamento
- Se intent for `segunda_via` e CPF valido:
  - Responder com segunda via usando `invoice_url`, `pix_copia_cola`, `valor_final`, `asaas_due_date`.
  - Inclui status pendente.
- Se nao ha cobranca (sem `invoice_url` e `pix_copia_cola`):
  - Resposta curta + suporte.
- Se intent for `segunda_via` e CPF nao informado:
  - Pedir CPF (sem suporte).

### 5.2 Consulta de inscricao
- Se intent for `consulta_inscricao` e CPF valido:
  - Responder status da inscricao e extras (hospedagem, brinde, alimentacao).
- Se nao ha inscricao:
  - Resposta com suporte e assinatura opcional.
- Se intent e CPF ausente:
  - Pedir CPF (sem suporte).

### 5.3 Pagamento
- Se inscricao existe e status `pago/isento`: confirmar pagamento.
- Se `pendente`: retorna segunda via.
- Se nao ha inscricao: informar valor e pedir CPF.

### 5.4 Hospedagem, brinde, local, data, programacao, whatsapp
- Respostas diretas com dados do evento.
- Sem suporte em respostas normais.
- Se dados inexistentes (ex: programacao vazia), responde com mensagem simples (sem suporte).

### 5.5 Fallback generico
- Usado quando nada casa.
- Inclui suporte e assinatura.

## 6) Intencoes (intent)

### Normalizacao de texto
A intencao usa texto normalizado:
- lowercase
- remove acentos
- remove pontuacao
- normaliza espacos

### Intencoes reconhecidas
- **segunda_via**: "segunda via", "2 via", "2via", "segundo via", "segunda bia", "boleto", "pix", "link de pagamento", "pagamento", "perdi o pagamento", "gerar cobranca".
- **consulta_inscricao**: "minha inscricao", "inscricao", "status", "confirmado", "estou inscrito", "consultar inscricao".
- **hospedagem**: "hospedagem", "alojamento", "dormir", "cama", "leito".
- **certificado**: "certificado".

## 7) Mensagens sociais (humanas)

Antes do fallback generico, a API trata mensagens sociais:

- **Saudacao**: oi, ola, bom dia, boa tarde, boa noite, eae, opa
  - Resposta: "Ola [emoji sorriso]\nSou a Maia. Como posso te ajudar?"
- **Agradecimento**: obrigado, obrigada, valeu, tmj, gratidao, show, perfeito
  - Resposta: "Por nada [emoji sorriso]\nFico feliz em ajudar."
- **Confirmacao**: ok, certo, entendi, blz, beleza, joia, 👍
  - Resposta: "Perfeito [emoji sorriso]"
- **Despedida**: tchau, ate mais, fui
  - Resposta: "Ate mais [emoji sorriso]\nQualquer duvida estarei por aqui."

Observacao: mensagens sociais nao pedem CPF e nao mostram suporte.

## 8) Detecao e tratamento de CPF

- CPF pode vir no campo `cpf` ou dentro da pergunta.
- Regex extrai CPF com ou sem pontuacao.
- CPF puro sem intent cai em consulta de inscricao.
- CPF com intent `segunda_via` executa `respostaSegundaVia()` diretamente.

## 9) Politica de suporte

Suporte so aparece em erros reais:
- inscricao nao encontrada
- cobranca nao encontrada
- fallback generico
- erro interno

Mensagem de suporte padrao:
- "Nossa equipe pode te ajudar rapidamente" + link WhatsApp do suporte.

## 10) OpenAI (opcional)

- Chave via `OPENAI_API_KEY`
- Modelo via `OPENAI_MODEL` (padrao: `gpt-4o-mini`)
- Se OpenAI estiver ativo:
  - Usa prompt de sistema com regras estritas.
  - Se falhar, cai no fallback local.

## 11) Widget (frontend)

### Estados principais
- `pendingIntent`: intent pendente (segunda_via, consulta_inscricao, etc.)
- `pendingCpf`: indica que falta CPF
- `ultimoCpf`: ultimo CPF valido enviado
- `mostraCpf`: exibe campo CPF

### Regras de contexto (memoria local)
- Se usuario pede segunda via, `pendingIntent = segunda_via` e `pendingCpf = true`.
- Se o proximo envio for CPF:
  - Enviar para API com `pergunta` forçada (ex: "segunda via") e `intent` correspondente.
  - Limpar pendencias apos resposta.
- CPF puro sem pendencia segue consulta de inscricao.

### Campo CPF
- Componente separado para evitar remount.
- Foco mantido ate enviar, fechar ou cancelar.
- Botao OK envia CPF.

### Avatar e UI
- Avatar via `/maia.png`.
- Botao flutuante circular com avatar 56px e glow suave.
- Cabecalho do chat 36px, mensagens 28px.
- Indicador de digitacao mantem avatar visivel.

## 12) Copia de mensagens (exemplos)

- Segunda via (pendente): inclui status, valor, vencimento, pix e link.
- Falta cobranca: "Os dados de pagamento nao foram encontrados." + suporte.
- Consulta de inscricao: nome, status, extras.
- Saudacao: "Ola [emoji sorriso]\nSou a Maia. Como posso te ajudar?"

## 13) Checklist para replicar em outro projeto

1. Copiar `AssistenteWidget.tsx` e ajustar imports.
2. Copiar `route.ts` para a rota equivalente.
3. Garantir tabelas e campos no Supabase.
4. Adicionar `public/maia.png`.
5. Configurar variaveis `OPENAI_API_KEY` e `OPENAI_MODEL` (opcional).
6. Validar fluxo de segunda via, consulta e CPF.
7. Verificar logs em `evento_assistente_logs`.

## 14) Testes recomendados

- "uma segundo via" -> pede CPF -> CPF -> retorna segunda via.
- "minha inscricao esta ok" -> pede CPF -> CPF -> retorna status.
- CPF puro sem intent -> consulta inscricao.
- "obrigado" -> resposta humana (sem fallback).
- Pergunta fora do contexto -> fallback generico com suporte.
