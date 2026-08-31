# Slice 21 - Productive Vocabulary Chunk Bank

## Objetivo

Criar um banco de vocabulário produtivo focado em chunks, collocations e formulações C1.

O objetivo não é listar palavras conhecidas. É transformar expressões úteis em itens que o usuário consegue usar em fala e escrita.

## Contexto

O EF SET mostra reading C2 e writing/speaking B1. Isso sugere vocabulário receptivo forte e vocabulário produtivo fraco.

Para C1, a unidade principal deve ser:

```text
chunk/collocation -> contexto -> produção ativa -> feedback -> spaced retrieval
```

Exemplos:

```text
not: "concern"
yes: "raise concerns about", "a growing concern", "my main concern is whether..."

not: "depend"
yes: "it depends on whether", "depending on the context", "a context-dependent decision"
```

## Escopo

- Criar entidade `LexicalChunk`.
- Diferenciar:
  - single word;
  - collocation;
  - phrase;
  - discourse marker;
  - hedging expression;
  - stance phrase;
  - register-specific expression;
  - domain-specific expression.
- Cada chunk deve conter:
  - texto;
  - significado curto;
  - registro;
  - nível alvo;
  - exemplos;
  - cenário/domínio;
  - origem;
  - status produtivo;
  - últimos usos;
  - erro comum quando houver.
- Fontes de chunks:
  - corrections;
  - better expressions;
  - repair events;
  - writing feedback;
  - scenario packs;
  - leitura guiada futura;
  - adição manual simples.
- Criar UI para ver chunks ativos.
- Permitir promover um chunk para revisão espaçada.
- Criar exercícios produtivos:
  - usar em uma frase;
  - completar uma resposta;
  - reescrever frase usando o chunk;
  - usar em resposta falada curta;
  - usar em mini-parágrafo.
- Registrar tentativas e marcar:
  - not tried;
  - recognized;
  - used with help;
  - used independently;
  - automatic.
- Integrar ao learner model como vocabulário ativo.

## Decisões pedagógicas

- Priorize chunks de alta utilidade para trabalho, entrevistas, tecnologia e argumentação.
- Não adicione todos os sinônimos possíveis.
- Um chunk só conta como aprendido quando o usuário o produz corretamente.
- Repetição deve alternar escrita e fala.
- O app deve detectar uso natural do chunk em conversas futuras.

## Decisões arquiteturais

- Não substitua `ReviewItem`; `LexicalChunk` deve alimentar `ReviewItem`.
- `ReviewItem` agenda a prática; `LexicalChunk` guarda conhecimento lexical mais rico.
- Use origem explícita para rastrear por que o chunk existe.
- Deduplicate por normalização simples antes de criar novo chunk.
- Evite guardar explicações longas no learner model; injete apenas chunks ativos prioritários.

## Non-goals

- Não criar clone de Anki.
- Não importar listas gigantes de vocabulário.
- Não implementar corpus externo neste slice.
- Não criar gamificação, streaks ou pontuação decorativa.
- Não exigir internet.

## Critérios de aceite

- Chunks podem ser criados a partir de corrections e better expressions.
- Chunks podem ser criados a partir de feedback de escrita quando o slice 20 existir.
- O usuário consegue ver chunks ativos.
- O usuário consegue praticar um chunk por escrita.
- O usuário consegue praticar um chunk por fala quando voice input estiver disponível.
- O status produtivo muda conforme tentativas.
- Chunks promovidos aparecem na revisão espaçada.
- Learner model recebe resumo compacto de chunks prioritários.
- Testes cobrem deduplicação, promoção para review e atualização de status.

## Teste manual

1. Fazer uma conversa com frase não natural.
2. Confirmar que uma better expression vira candidato a chunk.
3. Promover o chunk.
4. Praticar usando uma frase digitada.
5. Errar a collocation.
6. Confirmar feedback curto.
7. Praticar novamente corretamente.
8. Confirmar mudança de status.
9. Iniciar nova conversa.
10. Confirmar que o tutor cria oportunidade natural para usar o chunk.

## Stop condition

Pare quando chunks produtivos puderem ser capturados, praticados, promovidos para revisão e injetados no contexto do tutor.

Não implemente leitura guiada nem corpus lookup neste slice.
