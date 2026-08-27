# Slice 12 - Repair Loop

## Objetivo

Implementar o loop pedagógico mais importante do produto: detectar um erro prioritário, oferecer correção curta e pedir que o usuário tente novamente.

O objetivo não é corrigir tudo. É criar self-repair.

## Contexto

Fluência melhora quando o aluno precisa produzir linguagem, recebe feedback seletivo e reformula.

O loop central deste slice é:

```text
fala do usuário -> erro prioritário -> dica curta -> nova tentativa -> confirmação -> continuar conversa
```

## Escopo

- Criar detector de oportunidades de repair por turno.
- Classificar feedback:
  - grammar;
  - vocabulary;
  - pronunciation/intelligibility;
  - fluency;
  - coherence;
  - pragmatics.
- Selecionar no máximo 1 erro prioritário por intervenção.
- Criar modo de intervenção:
  - `implicit`: tutor reformula naturalmente;
  - `quick`: correção curta antes de continuar;
  - `repair`: usuário precisa repetir/reformular.
- Adicionar configuração de intensidade:
  - light;
  - balanced;
  - strict.
- Salvar eventos de repair.
- Atualizar learner model com erros recorrentes.
- Garantir que o tutor não interrompa toda frase.

## Prompt contract

O avaliador de turno deve retornar algo como:

```json
{
  "shouldIntervene": true,
  "priority": "grammar",
  "issue": "past tense form",
  "original": "Yesterday I go to the office",
  "suggested": "Yesterday I went to the office",
  "microExplanation": "Use past tense for a finished action yesterday.",
  "repairPrompt": "Try that sentence again using 'went'."
}
```

Se não houver erro relevante:

```json
{
  "shouldIntervene": false,
  "reason": "message was communicative and correction would interrupt flow"
}
```

## Decisões pedagógicas

- Corrigir menos, mas melhor.
- Priorizar erros que atrapalham comunicação ou aparecem repetidamente.
- Em sessão de fluência, preferir feedback no fim.
- Em sessão de accuracy, intervir mais cedo.
- Sempre que pedir repair, o usuário deve falar de novo.

## Non-goals

- Não criar gramática completa.
- Não corrigir todos os erros de todos os turnos.
- Não implementar pronúncia fonética profunda.
- Não implementar spaced retrieval.
- Não transformar o tutor em professor interrompendo cada frase.

## Critérios de aceite

- O app consegue detectar um erro prioritário em um turno.
- O tutor consegue pedir uma reformulação curta.
- A próxima fala do usuário é tratada como tentativa de repair.
- O app registra se o repair melhorou, falhou ou foi pulado.
- A sessão continua depois do repair.
- A intensidade de correção altera o comportamento.
- Eventos de repair aparecem no resumo da sessão.

## Teste manual

1. Iniciar uma sessão guiada.
2. Dizer uma frase com erro simples: "Yesterday I go to work".
3. Confirmar que o tutor pede correção para "went" ou reformula.
4. Repetir corretamente.
5. Confirmar que o tutor reconhece a melhoria e continua a conversa.
6. Mudar intensidade para `light`.
7. Confirmar que o tutor interrompe menos.
8. Finalizar sessão.
9. Confirmar que o repair aparece no resumo.

## Stop condition

Pare quando o app tiver um repair loop funcional, seletivo, persistido e integrado ao resumo da sessão.

Não implemente revisão espaçada, packs de cenário ou pronúncia profunda neste slice.

