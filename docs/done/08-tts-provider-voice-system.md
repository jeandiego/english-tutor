# Slice 08 - TTS Provider and Voice System

## Objetivo

Substituir o TTS fixo da V0 por uma camada de providers de voz configurável, começando com o TTS nativo do macOS e abrindo caminho para Kokoro local e ElevenLabs opcional.

O usuário deve conseguir escolher voz, gênero percebido, sotaque/região quando disponível, velocidade e provider, sem quebrar o loop atual de conversa.

## Contexto

A V0 já fala usando o mecanismo disponível no macOS. Este slice transforma isso em uma interface estável:

```text
tutor response -> TTS provider -> audio playback
```

O provider padrão deve continuar gratuito e local. ElevenLabs deve ser tratado como melhoria opcional, nunca como dependência obrigatória.

## Escopo

- Criar uma abstração de TTS no backend.
- Implementar provider `macos_say` usando o mecanismo atual.
- Criar configuração persistida para:
  - provider ativo;
  - voz ativa;
  - velocidade;
  - volume, se suportado;
  - sotaque/região, quando suportado pelo provider.
- Expor lista de vozes disponíveis para a UI.
- Adicionar UI simples de seleção de voz nas configurações.
- Preparar interface para provider `kokoro_local`, mesmo que fique desabilitado quando o binário/modelo não existir.
- Preparar interface para provider `elevenlabs`, habilitado apenas com API key configurada.
- Mostrar estado claro quando um provider não está disponível.
- Manter fallback automático para `macos_say` quando outro provider falhar.

## Decisões arquiteturais

- Use uma interface comum, por exemplo:

```ts
type TtsProvider = {
  id: string;
  label: string;
  listVoices(): Promise<TtsVoice[]>;
  synthesize(input: TtsRequest): Promise<TtsResult>;
  isAvailable(): Promise<TtsAvailability>;
};
```

- Não acople ElevenLabs diretamente à tela de conversa.
- Não espalhe condicionais de provider pela UI.
- Concentre diferenças de provider na camada TTS.
- Guarde secrets fora do repositório, via variável de ambiente ou mecanismo seguro já usado no app.

## Non-goals

- Não implementar clonagem de voz.
- Não comprar, baixar ou embutir modelos pagos.
- Não exigir ElevenLabs para rodar o app.
- Não implementar streaming de áudio se o app ainda funciona bem com síntese completa.
- Não alterar o comportamento pedagógico do tutor neste slice.

## Critérios de aceite

- O app continua falando usando o provider local padrão.
- A UI lista ao menos as vozes disponíveis do macOS.
- O usuário consegue trocar a voz ativa e ouvir a próxima resposta com a nova voz.
- A configuração de voz persiste ao fechar e abrir o app.
- Provider indisponível aparece como indisponível, sem quebrar a conversa.
- Falha em provider opcional faz fallback para provider local.
- O código deixa claro onde Kokoro e ElevenLabs devem ser conectados.

## Teste manual

1. Abrir o app.
2. Iniciar uma conversa curta.
3. Confirmar que a resposta é falada.
4. Abrir configurações de voz.
5. Trocar para outra voz do macOS.
6. Fazer nova pergunta.
7. Confirmar que a nova resposta usa a voz selecionada.
8. Selecionar um provider indisponível, se exibido.
9. Confirmar que o app informa indisponibilidade ou volta para o provider local sem travar.
10. Fechar e abrir o app.
11. Confirmar que a configuração escolhida foi preservada.

## Stop condition

Pare quando a camada de TTS configurável estiver funcionando com `macos_say`, a UI de seleção existir, providers opcionais estiverem modelados como indisponíveis quando não configurados, e o loop da V0 continuar funcionando.

Não implemente assessment, sessões pedagógicas, correções ou pronúncia neste slice.

