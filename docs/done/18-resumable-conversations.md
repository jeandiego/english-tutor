# Slice 18 - Resumable Conversations

## Objetivo

Permitir que o usuário continue uma conversa anterior sem perder contexto pedagógico.

O app deve conseguir abrir uma conversa recente, carregar seu histórico essencial e continuar a prática como a mesma unidade de aprendizado.

## Contexto

Depois do slice 17, conversas recentes podem ser abertas e inspecionadas. O próximo passo é tornar uma conversa reutilizável:

```text
conversa antiga -> abrir detalhe -> continue -> tutor recebe contexto -> novos turnos são anexados
```

Isso é importante para evolução real porque o usuário precisa repetir temas, revisitar erros e continuar linhas de raciocínio, não sempre começar do zero.

## Escopo

- Adicionar ação "Continue" no detalhe de uma conversa.
- Carregar a conversa selecionada no `ConversationStage`.
- Anexar novos turnos ao mesmo `sessionId`.
- Enviar ao tutor um contexto curto da conversa anterior:
  - últimos turnos;
  - summary quando existir;
  - issues prioritários;
  - review items vencidos;
  - learner context atual.
- Evitar reenviar todo o histórico quando a conversa for longa.
- Definir política de trimming:
  - últimos N pares de turnos;
  - summary final ou interim summary;
  - principais correções/reparos.
- Marcar conversas retomadas com `ended_at` atualizado quando novos turnos forem gravados.
- Se a conversa estava `completed`, decidir e documentar uma política:
  - ou reabrir como `active`;
  - ou criar uma continuação vinculada à sessão original.
- Proteger contra mistura acidental:
  - se há uma conversa ativa em andamento, pedir ação explícita para trocar;
  - não anexar turnos a outra conversa por causa de estado antigo de hook.
- Atualizar sidebar e History após novos turnos.

## Decisão recomendada

Para V1, prefira **continuar no mesmo `sessionId` quando a conversa ainda estiver `active` ou `abandoned`**, e **criar uma nova sessão vinculada à original quando a anterior estiver `completed`**.

Motivo: uma sessão completed representa uma prática fechada com summary e review items gerados. Reabrir pode invalidar summary, métricas e status. Uma continuação explícita preserva histórico e permite mostrar:

```text
Continued from: Software engineering interview, Aug 26
```

## Estrutura sugerida

```ts
type ConversationResumeContext = {
  sourceSessionId: number;
  continuationSessionId: number;
  title: string;
  recentMessages: TutorMessage[];
  priorSummary?: SessionSummaryPayload;
  learnerContext?: string;
};
```

## Decisões pedagógicas

- Continuar conversa não é só restaurar chat; é restaurar intenção.
- O tutor deve lembrar o que estava sendo praticado, mas não repetir toda a sessão.
- Se a conversa anterior teve erros recorrentes, a continuação deve criar oportunidades naturais de repair.
- Se houver review items vencidos, injete poucos itens e mantenha a conversa viva.

## Non-goals

- Não implementar branches/forks de conversa.
- Não implementar edição manual do transcript.
- Não criar sync cloud.
- Não implementar busca semântica.
- Não criar summaries automáticos contínuos para todas as conversas longas, exceto se necessário para contexto mínimo.
- Não adicionar writing ou chat digitado neste slice.

## Critérios de aceite

- O usuário consegue abrir uma conversa recente e clicar em "Continue".
- A tela de conversa mostra o contexto retomado.
- Novos turnos são persistidos no lugar correto ou em uma continuação vinculada.
- O tutor usa o contexto anterior de forma observável.
- A continuação não duplica turnos antigos.
- A sidebar atualiza a conversa mais recente após novos turnos.
- Conversas completed não têm seu summary antigo corrompido.
- Testes cobrem retomada de active, abandoned e completed.

## Teste manual

1. Criar uma conversa livre sobre entrevistas.
2. Fazer 3 turnos e sair.
3. Abrir "Recent conversations".
4. Clicar na conversa.
5. Clicar "Continue".
6. Dizer "Let's keep practicing the same topic."
7. Confirmar que o tutor continua o assunto sem resetar.
8. Finalizar uma sessão guiada completed.
9. Continuar essa sessão.
10. Confirmar que uma continuação é criada ou que a política documentada é aplicada sem corromper o summary original.

## Stop condition

Pare quando conversas recentes puderem ser retomadas com contexto suficiente e persistência correta.

Não implemente escrita, vocabulário avançado ou leitura neste slice.
