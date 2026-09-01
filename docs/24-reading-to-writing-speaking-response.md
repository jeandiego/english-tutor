# Slice 24 - Reading to Writing Speaking Response

## Objetivo

Adicionar o passo opcional de resposta falada de 60 segundos ao fluxo Reading to Writing (slice 22), fechando o ciclo `read -> extract chunks -> summarize -> respond -> rewrite/speak -> review`.

## Contexto

O slice 22 implementa o fluxo completo de leitura para escrita — texto, comprehension check, seleção de chunks, summary, resposta escrita e feedback seletivo — mas deixa a resposta falada deliberadamente de fora do escopo. A UI da tela de feedback já reserva um botão "Speak your response (optional)" desabilitado como seam de integração.

O pipeline de fala já existe no app e não precisa ser reconstruído, só conectado a este fluxo:

- `usePushToTalk` (`src/hooks/usePushToTalk.ts`) — grava e transcreve;
- `src/native/repair.ts` — repair loop sobre uma transcrição;
- `usePronunciationPractice.ts` — padrão de prática falada já usado no Chunk Bank.

## Escopo

- Habilitar o botão "Speak your response" na tela de feedback do Reading to Writing (`ReadingToWritingPage.tsx`).
- Gravar até 60 segundos via `usePushToTalk`, transcrever com o pipeline de transcrição já usado por pronunciation practice.
- Persistir a transcrição falada na sessão de leitura (`reading_session_attempt`, coluna nova, ex. `spoken_response_text`).
- Reaproveitar o repair loop (`src/native/repair.ts`) sobre a transcrição, na mesma linha do que já acontece em conversas ao vivo.
- Opcionalmente comparar a versão falada com a resposta escrita já avaliada pelo slice 22.

## Non-goals

- Não criar um novo pipeline de fala — reaproveitar o existente.
- Não pontuar pronúncia de forma independente (isso já é coberto por `usePronunciationPractice`, fora deste slice).
- Não tornar a resposta falada obrigatória.
- Não reabrir ou alterar o fluxo escrito do slice 22.

## Critérios de aceite

- O botão "Speak your response" fica habilitado na tela de feedback.
- O usuário consegue gravar até 60 segundos e ver a transcrição.
- A transcrição falada é persistida vinculada à sessão de leitura.
- O repair loop roda sobre a transcrição e mostra feedback, quando aplicável.

## Teste manual

1. Completar uma sessão Reading to Writing até a tela de feedback (slice 22).
2. Clicar em "Speak your response".
3. Gravar uma resposta falada curta.
4. Confirmar que a transcrição aparece.
5. Confirmar que a sessão de leitura salva a transcrição falada.
6. Confirmar que oportunidades de repair, quando detectadas, aparecem.

## Stop condition

Pare quando o usuário conseguir gravar uma resposta falada de até 60 segundos ao final de uma sessão Reading to Writing, ver a transcrição persistida, e opcionalmente receber repair feedback sobre ela.
