# Slice 05 — Spoken Tutor Response

## Objective

Complete the first end-to-end local conversation loop by speaking the tutor's `reply`.

At the end of this slice:

```text
hold
-> speak
-> release
-> transcribe locally
-> reason/respond through local Ollama
-> hear tutor response
-> ready for next turn
```

This is the primary "run today" milestone.

## V0 TTS

Use macOS native speech for the first implementation.

A native Tauri/Rust service may invoke the system speech command/API.

Only the `TutorTurn.reply` field may be spoken.

Never speak:

- JSON
- correction metadata
- scoring
- diagnostics
- prompt text

## Speech safety

Do not interpolate untrusted text into a shell command string.

Pass text as a process argument through a safe process API.

Support canceling or replacing speech cleanly enough that repeated turns do not spawn uncontrolled speech processes.

## Interaction state machine

Make the main loop explicit.

Suggested states:

```text
idle
recording
transcribing
thinking
speaking
error
```

The push-to-talk control must be disabled while the application is in a state that cannot safely accept a new turn.

For V0, do not implement barge-in.

## UI feedback

The primary status should make it obvious what is happening:

- `Listening`
- `Transcribing`
- `Thinking`
- `Speaking`
- `Ready`

Avoid fake progress percentages.

## Conversation loop

After speech finishes:

- return to `Ready`;
- allow the next push-to-talk turn;
- preserve current in-memory conversation history.

## Non-goals

Do not implement:

- Kokoro
- selectable voices
- voice cloning
- full duplex
- barge-in
- VAD
- pronunciation scoring
- SQLite

## Acceptance criteria

1. User can complete at least five consecutive spoken turns.
2. Every turn follows the full local pipeline.
3. Tutor answers are audible.
4. Tutor corrections are not read aloud.
5. UI state accurately reflects pipeline stage.
6. Failure at STT, LLM, or TTS returns the app to a recoverable state.
7. No browser/cloud speech service is used.

## Required manual acceptance conversation

Have a short conversation of at least five turns.

Start with:

`I'm a software engineer from Brazil, and I want to improve my English for international jobs.`

Then answer the tutor naturally.

Success means the interaction already feels usable for a 10-minute practice session.

## Stop condition

Once the five-turn conversation works end-to-end, stop and report that the first usable V0 milestone is complete.
