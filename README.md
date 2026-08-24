# Local English Coach — Vertical Slice Execution Plan

Goal: ship a usable local English conversation coach on macOS today.

The implementation must evolve through small vertical slices. Each slice must leave the application runnable and testable. Do not implement future slices early.

## Target stack

- Tauri 2
- React + TypeScript + Vite
- Rust for native/process integration
- Ollama as the local LLM runtime
- `whisper.cpp` / `whisper-cli` as the initial local STT runtime
- macOS `say` as the initial TTS runtime
- SQLite only after the core voice loop works

## V0 interaction model

Use **push-to-talk** first.

1. User holds a button or Space.
2. App records microphone audio.
3. User releases.
4. App transcribes locally.
5. Local LLM answers as an English tutor.
6. App speaks only the tutor's conversational reply.
7. Corrections are displayed separately and do not interrupt the conversation.

Do not implement full duplex, barge-in, automatic VAD, phoneme scoring, cloud APIs, authentication, sync, accounts, or packaging before the basic loop works.

## Execution order

1. `00-project-guardrails.md`
2. `01-desktop-shell.md`
3. `02-push-to-talk.md`
4. `03-local-transcription.md`
5. `04-local-tutor.md`
6. `05-spoken-response.md`
7. `06-corrections-ui.md`
8. `07-session-persistence.md`

### "Running today" milestone

The first useful end-to-end version is complete after **Slice 05**:

`microphone -> local STT -> Ollama -> spoken reply`

Slice 06 makes it a real learning tool. Slice 07 is useful but must not block today's first working version.

## How to use these files with a coding LLM

Give the coding agent `00-project-guardrails.md` first.

Then give it exactly one numbered slice at a time.

After each slice:

- inspect the resulting diff;
- run the validation commands;
- manually test the acceptance criteria;
- commit;
- only then provide the next artifact.

The agent must not silently expand scope.
