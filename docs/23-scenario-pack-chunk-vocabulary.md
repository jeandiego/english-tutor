# Slice 23 - Scenario Pack Chunk Vocabulary

## Objetivo

Usar scenario packs como mais uma fonte de candidatos a `LexicalChunk` (slice 21), para que cada cenário recorrente já sugira o vocabulário produtivo esperado antes da conversa começar.

## Contexto

O slice 21 lista "scenario packs" entre as fontes possíveis de chunks, mas foi adiado deliberadamente: hoje os arquivos de scenario pack não carregam nenhum campo de vocabulário/chunk, então não há dado real para importar ainda.

## Escopo

- Adicionar um campo opcional de vocabulário-alvo (chunks/collocations) ao formato de scenario pack.
- Ao selecionar ou favoritar um pack, criar candidatos a `LexicalChunk` a partir desse campo (origem `scenario_pack`, reaproveitando `create_chunk_candidate` e a deduplicação por `normalized_text` do slice 21).
- Atualizar `docs/14-scenario-packs.md` (ou equivalente já implementado) para documentar o novo campo.

## Non-goals

- Não reescrever o formato de scenario pack existente além do campo novo.
- Não gerar vocabulário automaticamente via LLM neste slice — o campo é preenchido manualmente nos packs.

## Stop condition

Pare quando selecionar um scenario pack com vocabulário-alvo criar os chunks correspondentes no banco, deduplicados corretamente contra chunks já existentes.
