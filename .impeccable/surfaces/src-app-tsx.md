---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/App.css","index.html","src/components/AppHeader.tsx","src/components/SettingsPage.tsx","src/components/SystemDiagnostics.tsx","src/hooks/useRuntimeSetup.ts"]
---

## Scope and mode

Operate-mode desktop shell for `src/App.tsx`, covering separate Conversation and Settings surfaces, push-to-talk recording and playback states, compact native readiness on the rehearsal surface, and detailed local transcription configuration on the settings surface.

## Audience and job

A B2 learner on a personal Mac needs to rehearse spoken English without configuration interrupting the session, while retaining a clear place to inspect and maintain the local Whisper, model, and FFmpeg paths.

## Direction

Subtitled rehearsal with a separate technical room. Conversation preserves the approved `.impeccable/mocks/subtitled-rehearsal-a.png` composition: compact masthead, dominant cinema-safe dialogue stage, broad action control, and subordinate system strip. Settings extends the same visual world as a calm, ruled utility page with runtime checks first and editable paths second. A persistent two-item masthead makes the separation explicit.

## Implementation grammar

- Cool white and soft blue-gray surfaces, deep navy ink, signal blue for local identity, and semantic green/red only for health.
- Native system sans; subtitle-like centered conversation copy; thin rules and alignment instead of nested cards.
- Conversation and Settings are peer pages controlled by the app shell; Settings is not a modal, drawer, or expanded diagnostic panel.
- Configuration state and persistence live in `useRuntimeSetup`; the settings form lives in `SettingsPage`; conversation receives only readiness and recovery summaries.
- Flat surfaces, 1px cool-gray rules, modest 12px corner language only on primary controls, and restrained elevation.
- Semantic HTML/CSS owns every ingredient; native audio controls provide local playback and no raster asset is required in the shipped UI.
- Fluid from 320px upward; narrow windows stack settings headings, checks, labels, controls, and actions without horizontal overflow.

## Boundaries

No conversation history, waveform, correction pane, external routing, cloud requests, downloads, remote assets, or persistence beyond the existing local transcription settings. Future settings categories should extend the dedicated Settings page rather than re-entering the Conversation surface.
