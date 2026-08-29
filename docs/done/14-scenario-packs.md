# Slice 14 - Scenario Packs

## Objetivo

Transformar os cenários em pacotes estruturados e expansíveis, com tarefas, vocabulário, funções comunicativas, níveis e variações.

O app deve ficar preparado para crescer sem hardcode de cada conversa.

## Contexto

O session engine criou cenários iniciais. Este slice dá estrutura de conteúdo:

```text
scenario pack -> session template -> task cards -> tutor behavior -> review items
```

## Escopo

- Criar formato local para `ScenarioPack`, em JSON, YAML ou Markdown com frontmatter.
- Cada pack deve conter:
  - id;
  - título;
  - descrição curta;
  - níveis recomendados;
  - objetivos comunicativos;
  - vocabulário útil;
  - grammar targets;
  - conversation moves;
  - warm-up prompts;
  - role-play prompts;
  - challenge prompts;
  - success criteria;
  - suggested review items.
- Migrar cenários iniciais para packs.
- Criar loader de packs.
- Validar schema dos packs.
- Mostrar catálogo baseado nos packs.
- Permitir variações dentro do mesmo cenário.
- Permitir marcar packs favoritos.

## Packs iniciais obrigatórios

- `daily-standup`
- `software-engineering-interview`
- `pair-programming`
- `restaurant`
- `shopping`
- `movies-and-series`
- `small-talk`
- `storytelling-past-experiences`

## Decisões arquiteturais

- Packs devem ser dados, não código.
- O session engine deve consumir packs por interface.
- Validação deve falhar com mensagem clara se um pack estiver inválido.
- Comece local; importação externa pode vir depois.

## Non-goals

- Não criar marketplace.
- Não baixar packs da internet.
- Não criar editor visual de packs.
- Não implementar multi-usuário.
- Não implementar tradução completa de todos os packs.

## Critérios de aceite

- Cenários iniciais existem como packs estruturados.
- O app carrega packs ao iniciar.
- O catálogo da UI vem dos packs.
- Uma sessão usa o conteúdo do pack selecionado.
- Packs inválidos são ignorados ou reportados sem quebrar o app.
- O usuário consegue favoritar um pack.
- A arquitetura permite adicionar um novo pack sem alterar o session engine.

## Teste manual

1. Abrir o app.
2. Ver catálogo de cenários.
3. Confirmar que os packs iniciais aparecem.
4. Iniciar `software-engineering-interview`.
5. Confirmar que o tutor usa contexto de entrevista técnica.
6. Iniciar `restaurant`.
7. Confirmar mudança de papel, vocabulário e tarefa.
8. Adicionar manualmente um pack inválido em ambiente de dev.
9. Confirmar que o app reporta o problema sem travar.

## Stop condition

Pare quando os cenários iniciais estiverem migrados para packs validados, carregados pela UI e consumidos pelo session engine.

Não implemente pronúncia, listening progression ou importação remota de packs neste slice.

