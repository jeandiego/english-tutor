# Slice 16 - Accent and Listening Progression

## Objetivo

Criar progressão de listening com vozes e sotaques variados, adaptada ao nível do usuário e aos objetivos dele.

O app deve treinar compreensão auditiva de forma gradual, sem sacrificar clareza.

## Contexto

Depois de TTS provider, learner model, sessões e pronúncia, o app pode controlar a dificuldade auditiva:

```text
nivel atual -> voz/sotaque -> velocidade -> complexidade -> comprehension check -> ajuste
```

## Escopo

- Criar configuração de listening:
  - accent focus;
  - voice gender preference;
  - speech speed;
  - naturalness level;
  - difficulty level.
- Mapear vozes disponíveis para metadados:
  - provider;
  - locale;
  - accent/region quando conhecido;
  - gender label quando disponível;
  - naturalness rating manual.
- Criar progressão:
  - clear slow speech;
  - clear natural speech;
  - natural speech with contractions;
  - regional accent exposure;
  - faster authentic-style speech.
- Adicionar comprehension checks durante sessões:
  - pergunta sobre o que o tutor acabou de dizer;
  - escolha de resumo;
  - pedido para repetir com suas palavras;
  - follow-up baseado em detalhe.
- Atualizar learner model com listening performance.
- Permitir escolher foco:
  - American English;
  - British English;
  - mixed accents;
  - software/workplace English;
  - travel everyday English.

## Decisões pedagógicas

- Comece compreensível e aumente dificuldade progressivamente.
- Não use sotaque difícil como decoração.
- Varie sotaques quando o usuário já entende o essencial.
- Listening deve estar ligado a tarefas comunicativas.
- Se a compreensão cair muito, reduza velocidade ou complexidade.

## Non-goals

- Não baixar bibliotecas de áudio grandes.
- Não criar corpus completo de listening.
- Não exigir ElevenLabs.
- Não prometer cobertura perfeita de todos os sotaques.
- Não misturar cinco sotaques na mesma sessão sem objetivo claro.

## Critérios de aceite

- O usuário consegue configurar foco de listening.
- O app escolhe voz/velocidade com base no learner model e nas preferências.
- Sessões podem incluir comprehension checks.
- O resultado dos checks atualiza o learner model.
- A dificuldade aumenta ou diminui de forma simples conforme desempenho.
- O app mantém fallback para vozes locais disponíveis.
- A progressão funciona mesmo com poucas vozes instaladas.

## Teste manual

1. Abrir configurações de listening.
2. Escolher foco `American English` ou equivalente disponível.
3. Iniciar uma sessão.
4. Confirmar que o tutor usa voz/velocidade compatível.
5. Responder a um comprehension check.
6. Errar ou pedir repetição.
7. Confirmar que o app reduz dificuldade ou repete com clareza.
8. Acertar checks seguintes.
9. Confirmar que o progresso de listening foi registrado.

## Stop condition

Pare quando o app conseguir adaptar voz, velocidade e checks de compreensão com base no learner model e nas preferências do usuário.

Não implemente novos packs, APIs pagas obrigatórias ou dashboards avançados neste slice.

