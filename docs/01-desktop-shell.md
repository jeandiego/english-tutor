# Slice 01 — Runnable Tauri Desktop Shell

## Objective

Create the smallest runnable Tauri 2 + React + TypeScript desktop application that will host the English Coach.

At the end of this slice, the desktop app must launch successfully and show a minimal conversation screen.

## User-visible outcome

Launching the development app shows:

- app title: `English Coach`
- status indicator: `Local`
- empty conversation area
- a large disabled-looking or placeholder `Hold to talk` control
- a small diagnostics area showing that voice integrations are not connected yet

This is a shell only. Do not implement microphone recording yet.

## Scope

If the repository is empty, bootstrap a Tauri 2 + React + TypeScript + Vite app.

If a project already exists, adapt it rather than recreating it.

Create a minimal folder structure that keeps:

- UI components
- application/domain types
- native Tauri commands

reasonably separated without over-architecting.

## Required native health command

Add one typed Tauri command:

```text
health_check() -> app/runtime information
```

It should prove React can invoke Rust.

Return a small serializable object such as:

- app status
- operating system
- architecture

Do not execute external binaries in this slice.

## UI state

The screen should visibly distinguish:

- `Ready`
- `Error`

If the Rust health check fails, show the error in the diagnostics area.

## Non-goals

Do not implement:

- microphone
- STT
- Ollama calls
- TTS
- SQLite
- conversation persistence
- settings screens
- design system work
- complex routing

## Acceptance criteria

The slice is complete only when:

1. `tauri dev` launches a desktop window.
2. React renders the English Coach shell.
3. React successfully invokes the Rust health command.
4. The UI displays the returned native health result.
5. No cloud/network dependency is required to launch the app.
6. TypeScript and Rust checks pass.

## Manual test

Launch the app.

Expected result:

```text
English Coach          Local

[ empty conversation ]

[ Hold to talk ]

System
✓ Desktop runtime ready
```

Exact visual styling is unimportant.

## Stop condition

Once the shell launches and the React -> Tauri -> Rust round trip works, stop. Do not begin microphone work.
