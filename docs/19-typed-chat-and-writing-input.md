# Slice 19 - Typed Chat and Writing Input

## Objetivo

Adicionar entrada digitada ao Pako para destravar prática de escrita e permitir uso quando o usuário não puder falar.

O chat digitado deve compartilhar o mesmo histórico, learner model, corrections, repair loop e review system da conversa falada.

## Contexto

O resultado EF SET do usuário mostra grande assimetria:

```text
reading C2
listening C1
writing B1
speaking B1
```

O Pako já é forte em voz, listening e conversação. Para subir o nível geral com rapidez, precisa criar produção escrita regular e mensurável.

Este slice não é ainda o Writing Gym completo. Ele cria a infraestrutura de input digitado para que escrita vire uma modalidade normal de conversa.

## Escopo

- Adicionar composer de texto no `ConversationStage`.
- Permitir alternar ou combinar:
  - voice input;
  - typed input.
- Reusar `requestTutorTurn` para turnos digitados.
- Persistir turnos digitados na mesma estrutura de histórico.
- Marcar origem do turno quando necessário:
  - `spoken`;
  - `typed`.
- Ajustar prompts para o tutor saber quando está avaliando escrita digitada.
- Correções para texto digitado podem incluir:
  - grammar;
  - vocabulary;
  - naturalness;
  - clarity;
  - cohesion;
  - register.
- Não tratar erros de pontuação/capitalização do mesmo jeito que speech transcript.
- Permitir enviar mensagens longas com quebras de parágrafo.
- Manter atalhos simples:
  - Enter envia;
  - Shift+Enter quebra linha.
- Desabilitar envio enquanto tutor está respondendo.
- Garantir acessibilidade do campo.

## Decisões pedagógicas

- Escrita precisa de mais precisão que fala.
- O tutor deve ser mais exigente em escrita, mas ainda seletivo.
- Um texto digitado pode receber feedback de coesão e registro, não só gramática.
- Correção deve gerar oportunidade de reescrita quando o erro for importante.
- Não misture feedback de fala e escrita sem rotular.

## Decisões arquiteturais

- Se a tabela `turn` não tiver origem/modalidade, adicionar coluna opcional com migração segura.
- Não crie um histórico separado para chat digitado.
- `useTutorConversation` pode ganhar um método `sendTypedMessage(text)` para reaproveitar o pipeline.
- Extraia lógica comum de "process learner turn" se o hook ficar grande demais.
- Preserve push-to-talk funcionando.

## Non-goals

- Não implementar Writing Gym completo.
- Não implementar rubrica CEFR escrita.
- Não implementar editor rico.
- Não implementar anexos, markdown preview ou importação de arquivos.
- Não implementar correção offline gramatical sem LLM.

## Critérios de aceite

- O usuário consegue enviar uma mensagem digitada em uma conversa livre.
- O tutor responde normalmente.
- O turno digitado é persistido e aparece no detalhe da conversa.
- Correções de texto digitado aparecem separadas do reply.
- Shift+Enter cria nova linha.
- Enter envia quando há texto válido.
- Voz e texto podem coexistir na mesma conversa sem quebrar o histórico.
- Testes cobrem envio digitado, estado ocupado e persistência.

## Teste manual

1. Abrir Conversation.
2. Digitar: "I work as software engineer since five years."
3. Enviar.
4. Confirmar resposta do tutor.
5. Confirmar correção útil para `as a software engineer` e `for five years`.
6. Falar um turno por voz.
7. Abrir Recent conversations.
8. Confirmar que os dois turnos aparecem no detalhe.

## Stop condition

Pare quando chat digitado funcionar como modalidade de produção escrita dentro da conversa existente.

Não implemente assessment de escrita nem Writing Gym neste slice.
