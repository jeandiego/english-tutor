# Slice 10 - Learner Model

## Objetivo

Criar um modelo persistente do aprendiz para que o tutor adapte sessões, feedback e revisão com base no histórico real do usuário.

O learner model deve ser pequeno, explícito e acionável.

## Contexto

O assessment dá uma foto inicial. O learner model transforma uso contínuo em memória pedagógica:

```text
assessment + sessões + erros + preferências -> learner profile -> adaptação
```

## Escopo

- Criar entidade persistida `LearnerProfile`.
- Guardar:
  - nível estimado atual;
  - níveis por dimensão;
  - objetivos do usuário;
  - temas preferidos;
  - sotaques-alvo;
  - pontos fracos recorrentes;
  - estruturas gramaticais em treino;
  - vocabulário em treino;
  - pronúncia em treino;
  - histórico resumido de progresso.
- Criar serviço para atualizar o modelo após assessment e sessões.
- Criar resumo curto para ser injetado no prompt do tutor.
- Adicionar tela simples "Meu progresso" ou seção equivalente.
- Permitir edição manual de objetivos e preferências.

## Decisões arquiteturais

- Não salve toda conversa dentro do perfil.
- Guarde fatos pedagógicos compactos.
- Separe dados observados de preferências declaradas.
- Toda atualização automática deve preservar evidência ou origem.
- O prompt do tutor deve receber um resumo curto, não o banco inteiro.

## Estrutura sugerida

```ts
type LearnerProfile = {
  currentLevel: CefrLevel | null;
  dimensionLevels: Record<AssessmentDimension, CefrLevel | null>;
  goals: string[];
  preferredScenarios: string[];
  targetAccents: string[];
  recurringIssues: LearnerIssue[];
  activeVocabulary: VocabularyItem[];
  activeGrammarTargets: GrammarTarget[];
  activePronunciationTargets: PronunciationTarget[];
  progressNotes: ProgressNote[];
  updatedAt: string;
};
```

## Non-goals

- Não criar analytics complexos.
- Não criar gráfico detalhado de evolução.
- Não implementar spaced repetition neste slice.
- Não implementar correção fonética profunda.
- Não criar conta, sync cloud ou múltiplos usuários.

## Critérios de aceite

- O assessment atualiza o learner model.
- O perfil é persistido localmente.
- O tutor consegue receber um resumo do perfil no prompt.
- O usuário consegue ver nível atual, prioridades e objetivos.
- O usuário consegue editar objetivos e preferências.
- O app continua funcionando mesmo sem assessment.
- O modelo diferencia "observado pelo app" de "informado pelo usuário".

## Teste manual

1. Abrir o app com um assessment já salvo.
2. Acessar o perfil/progresso.
3. Confirmar que nível e prioridades aparecem.
4. Editar um objetivo, por exemplo: "prepare for software engineering interviews".
5. Salvar.
6. Iniciar uma conversa.
7. Confirmar, pelo comportamento do tutor, que o objetivo influencia a conversa.
8. Fechar e abrir o app.
9. Confirmar que as alterações persistem.

## Stop condition

Pare quando existir um learner model persistido, atualizado pelo assessment e usado pelo tutor como contexto compacto.

Não implemente session engine completo, repair loop ou revisão espaçada neste slice.

