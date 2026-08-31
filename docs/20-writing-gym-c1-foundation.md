# Slice 20 - Writing Gym C1 Foundation

## Objetivo

Criar um modo dedicado de prática escrita para elevar writing de B1 para B2/C1 de forma mensurável.

O usuário deve escrever textos curtos, receber feedback seletivo, reescrever e ver se melhorou.

## Contexto

O EF SET mostra writing em B1 enquanto reading está em C2. Isso indica que o usuário entende inglês complexo, mas ainda não produz escrita com estrutura, precisão e naturalidade equivalentes.

O caminho mais rápido não é consumir mais input. É fazer ciclos curtos de produção:

```text
prompt -> draft -> feedback seletivo -> rewrite -> comparação -> review items
```

## Escopo

- Criar página ou modo "Writing".
- Criar entidade persistida `WritingTask` ou equivalente.
- Criar tipos iniciais de tarefa:
  - professional email;
  - opinion paragraph;
  - technical explanation;
  - summary;
  - recommendation;
  - short argument with counterpoint.
- Cada tarefa deve definir:
  - objetivo comunicativo;
  - nível alvo;
  - limite sugerido de palavras;
  - critérios de sucesso;
  - vocabulário/chunks recomendados;
  - rubrica de avaliação.
- Criar fluxo:
  - escolher tarefa;
  - escrever draft;
  - enviar para avaliação;
  - mostrar feedback;
  - pedir rewrite;
  - comparar draft vs rewrite.
- Avaliar dimensões:
  - task achievement;
  - coherence and cohesion;
  - lexical resource;
  - grammatical range and accuracy;
  - register and tone.
- Gerar score interno por dimensão:
  - `B1`;
  - `B2`;
  - `C1`.
- Feedback deve retornar:
  - 1 a 3 pontos prioritários;
  - exemplos concretos do texto;
  - versão melhorada de trechos específicos;
  - chunks úteis;
  - próximo exercício recomendado.
- Criar review items a partir de:
  - collocations corrigidas;
  - grammar patterns recorrentes;
  - phrases úteis;
  - cohesion devices.
- Atualizar learner model com sinais de escrita.

## Prompt contract

O avaliador deve retornar JSON validado:

```json
{
  "overallLevel": "B1",
  "dimensions": {
    "taskAchievement": { "level": "B2", "evidence": "..." },
    "coherenceCohesion": { "level": "B1", "evidence": "..." },
    "lexicalResource": { "level": "B1", "evidence": "..." },
    "grammar": { "level": "B1", "evidence": "..." },
    "registerTone": { "level": "B2", "evidence": "..." }
  },
  "priorityIssues": [
    {
      "category": "lexical_resource",
      "original": "I have much experience",
      "suggested": "I have extensive experience",
      "explanation": "Use 'extensive experience' as a natural professional collocation."
    }
  ],
  "usefulChunks": [
    {
      "chunk": "I have extensive experience with...",
      "register": "professional",
      "example": "I have extensive experience with React and TypeScript."
    }
  ],
  "rewriteInstruction": "Rewrite the paragraph focusing on professional collocations and clearer paragraph structure."
}
```

## Decisões pedagógicas

- Feedback sem rewrite não conta como treino completo.
- O app deve corrigir menos itens, mas exigir incorporação.
- Priorize clareza, coesão e collocations naturais antes de vocabulário raro.
- Para B1 writing, o primeiro salto é B2 sólido: frases mais controladas, parágrafos claros e erros menos recorrentes.
- C1 vem depois: nuance, registro, densidade lexical e argumentação.

## Non-goals

- Não implementar editor rico.
- Não criar curso completo de gramática.
- Não implementar correção humana.
- Não implementar leitura guiada neste slice.
- Não transformar todos os chats em Writing Gym.

## Critérios de aceite

- O usuário consegue criar uma writing task.
- O usuário consegue escrever e salvar um draft.
- O app avalia o draft com JSON validado.
- O app mostra feedback por dimensão e 1 a 3 prioridades.
- O usuário consegue enviar rewrite.
- O app compara draft e rewrite.
- Review items são criados a partir de pontos úteis.
- Learner model registra progresso de escrita.
- Testes cobrem persistência, validação do JSON e criação de review items.

## Teste manual

1. Abrir Writing.
2. Escolher "professional email".
3. Escrever um e-mail curto com erros naturais.
4. Enviar para avaliação.
5. Confirmar feedback seletivo.
6. Reescrever o texto.
7. Confirmar comparação entre versões.
8. Abrir revisão espaçada.
9. Confirmar que chunks úteis foram criados.

## Stop condition

Pare quando existir um ciclo completo de escrita com draft, feedback, rewrite, comparação, persistência e review items.

Não implemente leitura guiada ou corpus lookup neste slice.
