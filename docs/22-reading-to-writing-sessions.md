# Slice 22 - Reading to Writing Sessions

## Objetivo

Usar a força de leitura do usuário para melhorar escrita, vocabulário produtivo e fala estruturada.

O app deve transformar texto compreendido em output ativo:

```text
read -> extract chunks -> summarize -> respond -> rewrite/speak -> review
```

## Contexto

O EF SET mostra reading C2. Essa é uma vantagem grande, mas input sozinho não resolve writing/speaking B1. O Pako deve usar leitura como matéria-prima para produção.

Este slice conecta leitura, escrita, vocabulário e conversa.

## Escopo

- Criar modo "Reading to Writing".
- Incluir textos curtos no app, inicialmente locais.
- Tipos de texto:
  - professional email;
  - technical article excerpt;
  - product update;
  - opinion piece;
  - workplace scenario;
  - short narrative.
- Cada texto deve ter:
  - nível estimado;
  - tema;
  - vocabulário/chunks alvo;
  - tarefa de compreensão;
  - tarefa de produção.
- Fluxo básico:
  - ler texto;
  - responder 1 comprehension check;
  - selecionar ou aceitar 3 a 5 chunks úteis;
  - escrever summary curto;
  - escrever opinião/recomendação/resposta;
  - opcionalmente falar uma resposta de 60 segundos.
- Chunks extraídos alimentam `LexicalChunk`.
- Produções escritas podem alimentar Writing Gym feedback.
- Produções faladas podem alimentar repair loop e speaking assessment.

## Decisões pedagógicas

- A leitura deve ser fácil o suficiente para permitir volume e produção.
- Não transforme leitura em tradução linha por linha.
- O foco é reutilizar linguagem de qualidade.
- O usuário deve produzir algo em todo exercício.
- Para C1, treine paráfrase, síntese, nuance e stance.

## Non-goals

- Não baixar artigos da internet.
- Não implementar navegador interno.
- Não implementar corpus lookup.
- Não criar biblioteca grande de textos.
- Não substituir Writing Gym.

## Critérios de aceite

- O usuário consegue iniciar uma sessão Reading to Writing.
- O app mostra um texto curto e uma tarefa clara.
- O usuário responde um comprehension check.
- O app sugere chunks úteis do texto.
- O usuário escreve um summary ou resposta.
- O output escrito pode receber feedback seletivo.
- Chunks selecionados entram no Chunk Bank.
- Review items são criados quando apropriado.
- Testes cobrem carregamento de textos, seleção de chunks e persistência.

## Teste manual

1. Abrir Reading to Writing.
2. Escolher um texto profissional curto.
3. Ler e responder comprehension check.
4. Selecionar 3 chunks.
5. Escrever um summary de 80 a 120 palavras.
6. Receber feedback.
7. Confirmar que os chunks aparecem no Chunk Bank.
8. Confirmar que 1 ou 2 itens aparecem para revisão futura.

## Stop condition

Pare quando leitura curta conseguir gerar produção escrita, chunks produtivos e itens de revisão.

Não implemente importação web, corpus externo ou biblioteca grande de conteúdo neste slice.
