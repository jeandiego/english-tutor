# Slice 17 - Recent Conversations

## Objetivo

Finalizar a área "Recent conversations" da sidebar para que conversas anteriores sejam confiáveis, legíveis e úteis para retomar prática.

O usuário deve conseguir ver as últimas conversas, entender rapidamente o que cada uma foi, abrir seus detalhes e começar uma nova conversa sem confusão.

## Contexto

O app já persiste sessões, turnos, correções, expressões, summaries e eventos de revisão. A sidebar já mostra "Recent conversations", mas hoje o clique apenas navega para History e destaca uma sessão. A experiência parece inacabada porque a conversa recente não funciona como um objeto real do produto.

Antes de adicionar writing e vocabulário C1, o app precisa ter uma base sólida de histórico:

```text
conversa feita -> aparece na sidebar -> abre detalhe -> mostra transcript e aprendizado -> permite próxima ação
```

## Escopo

- Garantir que toda conversa livre e toda sessão guiada crie um registro persistido.
- Exibir na sidebar:
  - título curto;
  - cenário ou "Free conversation";
  - data relativa ou horário curto;
  - status quando relevante;
  - número de turnos quando couber.
- Substituir títulos genéricos repetidos por títulos úteis:
  - usar scenario pack quando existir;
  - usar foco/tópico quando existir;
  - fallback para primeira fala do usuário ou summary curto;
  - nunca mostrar texto vazio.
- Criar comando nativo para buscar detalhes de uma conversa por `sessionId`.
- O detalhe deve retornar:
  - metadata da sessão;
  - turnos em ordem;
  - correções ligadas ao turno correto;
  - better expressions;
  - repair events;
  - review events ligados quando disponíveis;
  - summary final quando existir.
- Criar view de detalhe no History ou uma tela dedicada de conversation detail.
- O clique em uma conversa recente deve abrir o detalhe da conversa, não apenas destacar um item em uma lista agregada.
- O botão "New conversation" deve iniciar uma conversa nova de modo previsível.
- Atualizar queries/invalidation para que a sidebar reflita novas conversas e conversas completadas.

## Decisões de produto

- Recent conversations é navegação primária, não analytics.
- O usuário deve saber "o que pratiquei" em menos de dois segundos.
- Não esconda conversas ativas ou abandonadas, mas rotule claramente.
- A lista recente deve ser útil mesmo sem summaries.
- O histórico detalhado deve preservar a relação entre fala, resposta, correção e repair.

## Decisões arquiteturais

- Reaproveite a tabela `session` e `turn`.
- Não crie uma segunda entidade `conversation` se `session` já representa a unidade persistida.
- Se o nome "session" estiver vazando para UX, traduza na camada de UI para "conversation".
- Prefira um comando explícito `get_session_detail`/`get_conversation_detail` em vez de inflar `list_recent_sessions`.
- Mantenha `listRecentSessions` leve para sidebar e dashboards.

## Non-goals

- Não implementar retomada de conversa neste slice.
- Não implementar busca global no histórico.
- Não implementar edição/renomeação manual.
- Não criar tags, pastas ou favoritos.
- Não implementar escrita C1 ou vocabulário avançado ainda.
- Não redesenhar toda a History page.

## Critérios de aceite

- A sidebar mostra conversas recentes reais depois de uma conversa livre.
- A sidebar mostra sessões guiadas recentes com label útil.
- Clicar em uma conversa recente abre um detalhe com transcript completo.
- Correções aparecem no turno correto.
- Better expressions aparecem no contexto correto.
- Conversas sem summary continuam abrindo normalmente.
- Conversas ativas, concluídas e abandonadas são rotuladas corretamente.
- "New conversation" cria ou navega para uma conversa nova sem misturar histórico anterior.
- Os testes cobrem listagem, detalhe e estados vazios.

## Teste manual

1. Abrir o app sem histórico.
2. Confirmar estado vazio em "Recent conversations".
3. Iniciar uma conversa livre.
4. Fazer 2 a 3 turnos.
5. Confirmar que ela aparece na sidebar.
6. Clicar na conversa.
7. Confirmar que o transcript, respostas e correções aparecem em ordem.
8. Iniciar uma sessão guiada.
9. Finalizar a sessão.
10. Confirmar que a sidebar atualiza título, status e summary.

## Stop condition

Pare quando "Recent conversations" deixar de ser placeholder e virar uma navegação confiável para conversas persistidas.

Não implemente continuação/retomada de conversas neste slice.
