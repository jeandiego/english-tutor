# Slice 09 - Assessment Engine Based on CEFR, Cambridge and IELTS

## Objetivo

Criar um assessment inicial de inglês falado para estimar o nível do usuário e gerar um diagnóstico acionável para o app.

O resultado deve ser uma estimativa interna inspirada em CEFR, Cambridge e IELTS, sem afirmar equivalência oficial.

## Contexto

O app precisa saber onde o aluno está antes de adaptar conversas, correções e cenários.

O assessment deve medir comunicação oral de forma prática:

```text
warm-up -> perguntas graduais -> tarefa de fala longa -> follow-ups -> rubrica -> diagnóstico
```

## Escopo

- Criar modo `assessment`.
- Criar roteiro de perguntas graduais de A1 a C1.
- Medir dimensões separadas:
  - fluency;
  - coherence;
  - lexical resource;
  - grammatical range and accuracy;
  - pronunciation intelligibility;
  - interactional competence.
- Gerar estimativa interna de nível:
  - `A1`, `A2`, `B1`, `B2`, `C1`;
  - confidence score;
  - evidências curtas extraídas da sessão.
- Gerar recomendações iniciais:
  - principal gargalo;
  - próximos tipos de sessão;
  - correções prioritárias;
  - nível sugerido de listening input.
- Persistir o resultado do assessment.
- Permitir refazer assessment sem apagar histórico anterior.
- Adicionar tela/resumo de resultado.

## Decisões pedagógicas

- Use CEFR como escala principal de comunicação.
- Use categorias inspiradas em IELTS Speaking para rubrica oral.
- Use Cambridge apenas como referência de progressão e tipos de tarefa.
- Não transforme o assessment em prova longa.
- Prefira diagnóstico útil a pontuação ilusoriamente precisa.

## Prompt contract

O prompt do avaliador deve:

- pedir avaliação em JSON estruturado;
- exigir evidências observáveis;
- separar nível estimado por dimensão;
- declarar incerteza quando a amostra for curta;
- evitar julgamento motivacional vazio;
- gerar recomendações concretas para próximas sessões.

Exemplo de estrutura esperada:

```json
{
  "overallLevel": "B1",
  "confidence": 0.72,
  "dimensions": {
    "fluency": { "level": "B1", "evidence": "..." },
    "coherence": { "level": "B2", "evidence": "..." },
    "lexicalResource": { "level": "B1", "evidence": "..." },
    "grammar": { "level": "A2", "evidence": "..." },
    "pronunciationIntelligibility": { "level": "B1", "evidence": "..." },
    "interactionalCompetence": { "level": "B1", "evidence": "..." }
  },
  "priorities": ["past tense accuracy", "longer answers", "repair hesitation"],
  "recommendedSessions": ["daily", "job interview", "storytelling"],
  "notesForTutor": "..."
}
```

## Non-goals

- Não prometer nota oficial de IELTS, TOEFL, Cambridge ou CEFR.
- Não implementar reconhecimento fonético profundo neste slice.
- Não exigir sessão longa de mais de 15 minutos.
- Não criar dashboards avançados.
- Não bloquear o uso do app se o usuário pular o assessment.

## Critérios de aceite

- Existe um fluxo de assessment acessível pela UI.
- O tutor conduz perguntas em inglês, com dificuldade progressiva.
- O assessment gera JSON validado antes de salvar.
- O resultado aparece em uma tela compreensível para o usuário.
- O app salva histórico de assessments.
- O restante do app consegue ler o nível atual estimado.
- Se a resposta do LLM vier inválida, o app falha de modo recuperável.

## Teste manual

1. Abrir o app.
2. Iniciar assessment.
3. Responder pelo menos 5 perguntas.
4. Finalizar assessment.
5. Conferir tela de resultado.
6. Verificar se há nível geral, níveis por dimensão, confiança e prioridades.
7. Fechar e abrir o app.
8. Confirmar que o assessment permanece salvo.
9. Refazer assessment.
10. Confirmar que o novo resultado aparece sem apagar o anterior.

## Stop condition

Pare quando o app conseguir conduzir, avaliar, salvar e exibir um assessment oral inicial com nível interno inspirado em CEFR.

Não implemente learner model completo, session engine avançado ou spaced retrieval neste slice.

