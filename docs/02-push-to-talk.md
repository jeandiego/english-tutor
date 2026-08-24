# Slice 02 — Push-to-Talk Recording

## Objective

Turn the desktop shell into a local microphone recorder.

At the end of this slice, the user must be able to hold a control, speak, release it, and verify that an audio recording was captured locally.

Do not transcribe yet.

## Interaction

Support both:

- pointer/mouse: hold the `Hold to talk` button
- keyboard: hold `Space` when focus is not inside an editable input

Behavior:

```text
press/hold
-> recording starts

release
-> recording stops
-> local audio artifact is finalized
```

Prevent accidental browser-style repeated key behavior from starting multiple recordings.

## Implementation strategy

Prefer the fastest reliable implementation compatible with the current Tauri/macOS app.

You may capture audio in the webview using browser media APIs if that is simpler.

Keep an abstraction boundary so recording can later move to native Rust without changing the conversation UI.

Do not add VAD.

## macOS permission

Ensure the Tauri/macOS bundle has the microphone permission description required by macOS.

If a config or plist entry is required, add it correctly for the current Tauri version.

Do not guess the config key: inspect the installed Tauri version/project schema or official local docs/types when needed.

## Recorded audio

After release:

- retain the audio only locally;
- expose useful metadata to the UI:
  - duration
  - MIME/format if available
  - size
- allow immediate local playback for debugging.

If a temporary file is created, use an app temp location.

Do not store audio permanently.

## UI states

Implement explicit states:

```text
idle
recording
recorded
error
```

The UI should make recording obvious.

## Non-goals

Do not implement:

- Whisper
- transcription
- Ollama
- TTS
- automatic silence detection
- waveform polish
- persistence

## Acceptance criteria

1. macOS asks for microphone permission when appropriate.
2. Holding the control records audio.
3. Releasing stops recording.
4. The app displays the captured duration.
5. The captured audio can be played back locally.
6. Repeating the process replaces or safely disposes of the prior temporary recording.
7. Denied microphone permission produces a visible useful error.
8. No audio leaves the machine.

## Manual test

1. Launch the app.
2. Hold Space.
3. Say: `This is a local English coach microphone test.`
4. Release Space.
5. Play the captured recording.

You should clearly hear the sentence.

## Stop condition

Once recording and playback are reliable, stop. Do not begin transcription.
