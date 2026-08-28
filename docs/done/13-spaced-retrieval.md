# Slice 13 - Spaced Retrieval

## Objetivo

Transformar erros, vocabulário e estruturas praticadas em itens de revisão espaçada.

O usuário deve reencontrar pontos importantes em sessões futuras, no momento certo, sem virar flashcard app genérico.

## Contexto

O app já deve ter sessões, learner model e repair loop. Agora ele precisa lembrar do que merece voltar.

Loop deste slice:

```text
erro ou frase útil -> review item -> agenda -> reaparece em conversa futura -> resultado atualiza agenda
```

## Escopo

- Criar entidade `ReviewItem`.
- Criar tipos:
  - grammar pattern;
  - vocabulary;
  - phrase;
  - pronunciation target;
  - conversation strategy.
- Criar scheduler simples inspirado em spaced repetition:
  - novo;
  - revisar em 1 dia;
  - revisar em 3 dias;
  - revisar em 7 dias;
  - revisar em 14 dias;
  - revisar em 30 dias.
- Criar serviço para gerar itens a partir de:
  - repair events;
  - session summaries;
  - assessment priorities.
- Injetar 1 a 3 itens vencidos no contexto de uma sessão.
- Criar micro-review no começo ou fim de sessão.
- Registrar resultado:
  - remembered;
  - partially remembered;
  - missed;
  - skipped.
- Atualizar próxima data de revisão.

## Decisões pedagógicas

- Revisão deve aparecer dentro de uso comunicativo.
- O item deve exigir produção ativa, não apenas reconhecimento.
- Poucos itens por sessão.
- Priorize itens recorrentes e úteis para os objetivos do usuário.

## Non-goals

- Não criar clone de Anki.
- Não implementar algoritmo SM-2 completo se um scheduler simples resolver.
- Não criar notificações do sistema operacional.
- Não criar dashboard complexo.
- Não revisar tudo que apareceu na conversa.

## Critérios de aceite

- Repair events podem gerar review items.
- O app mostra itens vencidos.
- Uma sessão pode incluir revisão de itens vencidos.
- O usuário pratica o item falando.
- O resultado altera a próxima data.
- Itens revisados aparecem no histórico.
- O learner model recebe sinal de melhora ou recorrência.

## Teste manual

1. Criar ou usar um repair event.
2. Confirmar que um review item foi criado.
3. Ajustar temporariamente a data para ficar vencido, se necessário.
4. Iniciar nova sessão.
5. Confirmar que o tutor inclui o item naturalmente.
6. Responder corretamente.
7. Confirmar que a próxima revisão foi empurrada para uma data futura.
8. Responder errado em outro item.
9. Confirmar que a próxima revisão fica mais próxima.

## Stop condition

Pare quando itens de revisão forem criados, agendados, praticados em sessões e reagendados de acordo com o desempenho.

Não implemente packs avançados, pronúncia profunda ou progressão de sotaques neste slice.

