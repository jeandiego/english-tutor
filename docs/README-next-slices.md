# Local English Coach - Next Implementation Slices

Este pacote continua os slices `00-07` da V0 do Local English Coach.

A V0 já provou o loop técnico:

```text
microfone -> transcrição local -> tutor local -> resposta -> TTS -> próxima fala
```

Agora o objetivo muda de "chatbot de voz" para:

```text
assessment -> learner model -> sessões guiadas -> feedback seletivo -> repair -> revisão espaçada -> progressão
```

## Ordem recomendada

1. `08-tts-provider-voice-system.md`
2. `09-assessment-engine-cefr.md`
3. `10-learner-model.md`
4. `11-session-engine.md`
5. `12-repair-loop.md`
6. `13-spaced-retrieval.md`
7. `14-scenario-packs.md`
8. `15-pronunciation-engine.md`
9. `16-accent-listening-progression.md`

## Milestone principal

Ao final do slice `12`, o produto deve conseguir fazer uma sessão pedagógica real:

```text
tema escolhido
   ↓
conversa adaptada ao nível
   ↓
erro detectado
   ↓
correção seletiva
   ↓
usuário tenta novamente
   ↓
learner model atualizado
```

Ao final do slice `16`, o produto deve começar a parecer um English Coach pessoal:

```text
nível estimado
   ↓
objetivos e fraquezas persistidos
   ↓
cenários recorrentes
   ↓
pronúncia analisada
   ↓
listening com sotaques graduais
   ↓
revisão espaçada
```

## Próximo bloco: conversa retomável e output C1

Depois do slice `16`, o diagnóstico muda: o app já é forte em conversa oral, listening,
repair e revisão. O próximo bloco deve corrigir o gargalo real do usuário:

```text
reading C2 + listening C1
writing B1 + speaking B1
```

Isso significa priorizar histórico retomável, produção escrita, vocabulário produtivo e
uso ativo de leitura.

## Ordem recomendada para o próximo bloco

10. `17-recent-conversations.md`
11. `18-resumable-conversations.md`
12. `19-typed-chat-and-writing-input.md`
13. `20-writing-gym-c1-foundation.md`
14. `21-productive-vocabulary-chunk-bank.md`
15. `22-reading-to-writing-sessions.md`

## Milestone de continuidade

Ao final do slice `18`, a sidebar deve deixar de parecer um placeholder:

```text
conversa feita
   ↓
aparece em Recent conversations
   ↓
abre transcript e feedback
   ↓
pode ser continuada com contexto
```

## Milestone de output produtivo

Ao final do slice `22`, o produto deve atacar diretamente o gap B1 em writing/speaking:

```text
texto ou conversa
   ↓
chunks úteis
   ↓
produção escrita/falada
   ↓
feedback seletivo
   ↓
rewrite ou repair
   ↓
revisão espaçada
```

## Regras para o coding LLM

- Execute apenas um slice por vez.
- Leia este README e o slice atual antes de editar código.
- Preserve a V0 funcionando durante toda a implementação.
- Prefira providers locais e gratuitos por padrão.
- Integrações pagas, como ElevenLabs, devem ser opcionais e configuradas por variável de ambiente.
- Não implemente features de slices futuros antes da hora.
- Ao terminar um slice, rode os testes relevantes e faça um teste manual mínimo.
- Pare ao satisfazer a stop condition do slice.

## Princípio pedagógico

O app deve otimizar fluência comunicativa, não apenas respostas bonitas.

Cada nova feature deve reforçar pelo menos um destes mecanismos:

- exposição compreensível;
- interação significativa;
- produção ativa;
- feedback corretivo seletivo;
- reformulação pelo próprio aluno;
- repetição de tarefas com variação;
- revisão espaçada;
- progressão mensurável.
