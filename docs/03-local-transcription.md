# Slice 03 — Local Speech-to-Text

## Objective

Convert the push-to-talk recording into English text using a local Whisper runtime.

At the end of this slice:

```text
hold -> speak -> release -> local transcription appears
```

No LLM response yet.

## Runtime

Use `whisper.cpp` / `whisper-cli` as an external local runtime for V0.

Do not bundle the binary or model in this slice.

The app must support configurable:

- Whisper executable path
- Whisper model path

Never hard-code a developer-specific absolute path.

## Preflight

Add a native preflight check that verifies:

1. configured Whisper executable exists or is resolvable;
2. configured model exists;
3. executable can be invoked;
4. failures produce actionable messages.

If configuration is absent, show exactly what is missing.

Do not automatically download models.

## Audio compatibility

Inspect the actual format emitted by Slice 02.

Before invoking Whisper, ensure it receives an audio format it supports reliably.

For today's V0, it is acceptable to use a locally installed conversion utility if necessary, but:

- keep conversion behind a native service;
- perform it in a temp directory;
- surface a clear preflight error if the utility is missing;
- document this temporary dependency;
- do not make conversion logic leak into React.

Prefer mono speech-oriented audio.

## Invocation safety

Do not accept arbitrary executable arguments from the UI.

Rust should construct the Whisper command.

Set language to English where appropriate so the STT does not unnecessarily auto-detect Portuguese.

Capture stdout/stderr safely.

Delete temporary intermediary files when possible.

## UI states

Extend the interaction state:

```text
idle
recording
transcribing
transcribed
error
```

Show the recognized text as a user conversation turn.

## Error handling

Handle at least:

- missing executable
- missing model
- incompatible audio/conversion failure
- Whisper process failure
- empty transcription

Do not crash the app.

## Non-goals

Do not implement:

- Ollama
- tutor logic
- TTS
- corrections
- VAD
- phoneme/pronunciation analysis
- persistence

## Acceptance criteria

1. Recording still works.
2. Releasing push-to-talk starts local transcription.
3. The UI visibly enters a `Transcribing` state.
4. Spoken English appears as text.
5. No cloud API is called.
6. Missing local STT dependencies produce actionable diagnostics.
7. Temp files do not accumulate indefinitely.

## Manual test

Speak:

`I've been working with React for several years, and today I'm building an English tutor.`

The transcription does not need to be character-perfect, but it should preserve the meaning and be good enough to send to a language model.

## Stop condition

Once microphone -> local English transcription works repeatedly, stop. Do not call Ollama yet.
