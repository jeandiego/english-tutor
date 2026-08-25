# Slice 11 - Session Engine

## Objetivo

Criar um motor de sessões guiadas para que o usuário possa escolher práticas com intenção clara: daily, entrevista, pair programming, restaurante, shopping, filmes, séries e cotidiano.

Cada sessão deve ter objetivo, nível, roteiro, critérios de sucesso e fechamento.

## Contexto

A conversa livre é útil, mas fluência cresce melhor com tarefas comunicativas repetíveis.

O app deve passar de:

```text
chat aberto
```

para:

```text
tipo de sessão -> objetivo -> conversa -> fechamento -> atualização do learner model
```

## Escopo

- Criar entidade `SessionTemplate`.
- Criar entidade `SessionRun`.
- Implementar catálogo inicial de sessões:
  - daily standup;
  - resume/job interview;
  - pair programming;
  - restaurant;
  - shopping;
  - movies and series;
  - small talk;
  - storytelling about past experiences.
- Permitir escolher:
  - cenário;
  - dificuldade;
  - duração aproximada;
  - foco da sessão.
- Fazer o tutor conduzir a sessão com começo, meio e fim.
- Gerar resumo final:
  - o que o usuário comunicou bem;
  - 1 a 3 problemas prioritários;
  - frases alternativas;
  - itens para revisar depois.
- Persistir cada sessão concluída.
- Atualizar o learner model ao final.

## Decisões pedagógicas

- Cada sessão deve ter uma tarefa comunicativa real.
- O tutor deve manter a conversa viva, não transformar tudo em aula.
- Correções completas ficam para o fechamento, exceto quando o erro impedir comunicação.
- A dificuldade deve usar o nível do learner model como padrão.

## Non-goals

- Não implementar packs externos ainda.
- Não implementar marketplace ou importação de cenários.
- Não implementar spaced retrieval.
- Não implementar UI avançada de calendário.
- Não reescrever o chat inteiro se a arquitetura atual puder receber um `sessionMode`.

## Critérios de aceite

- O usuário consegue escolher um tipo de sessão.
- O tutor inicia a conversa com contexto do cenário.
- A sessão tem estado explícito: `active`, `completed` ou `abandoned`.
- Ao finalizar, o app gera resumo estruturado.
- O resumo é salvo no histórico.
- O learner model recebe uma atualização compacta.
- A conversa livre continua disponível.

## Teste manual

1. Abrir o app.
2. Escolher sessão "daily standup".
3. Fazer uma conversa de 3 a 5 turnos.
4. Finalizar sessão.
5. Conferir resumo final.
6. Abrir histórico.
7. Confirmar que a sessão aparece com cenário, data e resumo.
8. Iniciar sessão "restaurant".
9. Confirmar que o tutor muda o contexto e o vocabulário.

## Stop condition

Pare quando sessões guiadas funcionarem de ponta a ponta com catálogo inicial, resumo final, histórico e atualização básica do learner model.

Não implemente repair loop, spaced retrieval, scenario packs avançados ou pronúncia neste slice.

