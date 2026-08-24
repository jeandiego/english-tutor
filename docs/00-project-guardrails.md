# LLM Instructions — Project Guardrails

You are implementing a local-first desktop English conversation coach.

Treat this file as persistent project-level instructions for every implementation slice.

## Product goal

Build the smallest useful app that lets a B2 English learner practice spoken conversation locally:

`user speech -> transcription -> tutor response -> spoken response`

The tutor should keep the conversation natural while separately surfacing useful English corrections.

## Primary constraint

Optimize for **having a working application today**, not for final architecture.

Prefer a boring, observable implementation over an elegant abstraction that delays the first working voice loop.

## Stack

Use:

- Tauri 2
- React
- TypeScript
- Vite
- Rust for native/process operations
- Ollama through its local HTTP API
- local STT through `whisper.cpp` / `whisper-cli`
- macOS native `say` for the first TTS implementation

Do not introduce Python unless a later requirement makes it necessary.

## Engineering rules

1. Inspect the existing repository before modifying files.
2. Follow existing formatting, package manager, linting, and project conventions.
3. Do not replace working project configuration unless necessary.
4. Keep native integrations behind small Tauri commands/services.
5. Keep React components unaware of shell commands and executable paths.
6. Prefer explicit typed contracts between React and Tauri.
7. Do not create speculative frameworks or generic plugin systems.
8. Do not implement features assigned to later slices.
9. Every slice must leave the app runnable.
10. Surface runtime errors in the UI during development instead of swallowing them.
11. Never call a cloud API.
12. Never upload microphone recordings.
13. Temporary audio files must live in an application temp directory, not the repository.
14. Do not commit model files, generated audio, secrets, or machine-specific absolute paths.
15. Add focused tests where behavior can be tested cheaply, but do not block the V0 on elaborate test infrastructure.

## Configuration

Machine-specific values must be configurable rather than hard-coded.

Expected configuration may include:

- Ollama base URL, default `http://127.0.0.1:11434`
- Ollama model name
- path to `whisper-cli`
- path to the Whisper model

Prefer environment variables or a small local config mechanism for V0.

Never assume the exact Ollama model tag. Discover or configure it explicitly.

## Architecture boundary

Use this dependency direction:

```text
React UI
   |
   v
typed Tauri commands
   |
   +--> audio/native process integration
   +--> local STT
   +--> Ollama
   +--> local TTS
```

The React layer may own presentation state.

Rust should own native process execution and filesystem/temp-file concerns.

Do not let React construct arbitrary shell commands.

## UX principle

Conversation comes first.

Corrections must not turn every turn into a grammar lesson.

The tutor should:

- respond naturally to what the user said;
- correct errors separately;
- ignore harmless minor mistakes unless useful;
- prioritize errors that affect clarity, naturalness, or B2 -> C1 progression;
- avoid interrupting the spoken answer with correction explanations.

## Completion protocol for every slice

Before finishing a slice:

1. Run formatter.
2. Run typecheck.
3. Run Rust checks.
4. Run relevant tests.
5. Launch the app when possible.
6. State exactly what was implemented.
7. State any manual setup still required.
8. State the exact manual acceptance test.
9. Stop.

Do not proceed to the next slice until explicitly instructed.
