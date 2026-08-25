# Slice 15 - Pronunciation Engine

## Objetivo

Adicionar uma primeira versão de análise de pronúncia focada em inteligibilidade e padrões recorrentes, sem depender de avaliação fonética perfeita.

O app deve ajudar o usuário a falar de forma mais clara e compreensível.

## Contexto

A transcrição já revela parte da inteligibilidade: se o ASR entende errado, pode haver problema de pronúncia, áudio ou vocabulário. Este slice cria uma camada específica para investigar isso com cuidado.

Loop deste slice:

```text
fala -> transcrição -> alvo esperado/opcional -> análise -> dica curta -> repetição -> registro
```

## Escopo

- Criar entidade `PronunciationTarget`.
- Criar modo curto de prática de pronúncia.
- Permitir o tutor selecionar frases úteis da sessão para repetição.
- Comparar:
  - texto esperado;
  - transcrição real;
  - palavras omitidas/trocadas;
  - padrões recorrentes.
- Classificar problemas prováveis:
  - word stress;
  - final consonants;
  - vowel contrast;
  - connected speech;
  - rhythm;
  - specific word pronunciation.
- Gerar dica simples e prática.
- Permitir repetir a frase.
- Salvar tentativas e progresso.
- Integrar targets importantes ao spaced retrieval.

## Decisões pedagógicas

- Foque inteligibilidade antes de sotaque nativo.
- Evite sobrecorrigir pronúncia durante conversa fluida.
- Use frases reais das sessões do usuário.
- Trate falha de transcrição como sinal incerto, não prova absoluta.
- Dê uma dica por tentativa.

## Non-goals

- Não prometer análise fonética perfeita.
- Não implementar IPA completo se não for necessário.
- Não exigir API paga.
- Não comparar o usuário com falante nativo como objetivo principal.
- Não bloquear sessões normais por causa de pronúncia.

## Critérios de aceite

- O app consegue criar pronunciation targets a partir de frases.
- O usuário consegue praticar uma frase curta.
- O app compara esperado vs transcrito.
- O app gera uma dica curta.
- O usuário consegue repetir e ver melhora, sem UI pesada.
- Tentativas são persistidas.
- Targets podem virar review items.

## Teste manual

1. Fazer uma sessão curta.
2. Selecionar uma frase sugerida para prática.
3. Repetir a frase de propósito com uma palavra omitida ou mal pronunciada.
4. Confirmar que o app identifica diferença provável.
5. Ler a dica.
6. Repetir melhor.
7. Confirmar que a tentativa foi salva.
8. Confirmar que um target pode aparecer para revisão futura.

## Stop condition

Pare quando existir uma prática de pronúncia básica, persistida e integrada ao learner model/spaced retrieval, focada em inteligibilidade.

Não implemente progressão de listening/sotaques neste slice.

