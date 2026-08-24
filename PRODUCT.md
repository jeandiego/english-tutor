# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

The primary user is one B2 English learner practicing spoken conversation on a personal Mac. The V0 is a personal tool, not a distributable beta or public release.

## Product Purpose

English Coach makes it possible to practice a natural spoken English conversation entirely on the user's machine. Success for the first useful version is a reliable local loop from speech to transcription, tutor response, and spoken reply, with useful corrections shown separately.

## Positioning

The product keeps the complete voice-practice loop local while separating conversational replies from selective coaching, so practice stays private and corrections do not interrupt the exchange.

## Operating Context

The learner runs a Tauri desktop app on macOS, holds a control or the Space key to speak, and practices through repeated conversational turns. Local runtimes provide speech recognition, tutoring, and speech output in later slices.

## Capabilities and Constraints

- Tauri 2 hosts a React, TypeScript, and Vite webview; Rust owns native and process integration.
- Ollama, `whisper.cpp` / `whisper-cli`, and macOS `say` are planned local runtimes, introduced only in their assigned slices.
- No cloud APIs, authentication, accounts, sync, full duplex audio, automatic VAD, or packaging are part of the V0.
- Microphone recordings and generated audio must never leave the machine; temporary audio belongs in an application temp directory.
- Every slice must leave the application runnable and must stop before work assigned to later slices.

## Brand Commitments

The product name is **English Coach**. The voice is calm, direct, and encouraging. Conversation comes first; coaching is selective and secondary.

## Evidence on Hand

The repository contains the execution plan and slice specifications in `README.md` and `docs/`. It has no customer claims, testimonials, benchmarks, final logo, or production brand assets; future work must not fabricate them.

## Product Principles

1. Working locally today is more valuable than speculative architecture.
2. Conversation must remain natural and visually primary.
3. Corrections should be selective, useful, and separate from spoken replies.
4. Native operations stay behind small typed Tauri boundaries.
5. Runtime state and failures remain visible and understandable.
