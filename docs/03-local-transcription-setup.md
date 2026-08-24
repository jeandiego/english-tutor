# Local transcription setup and test guide

This guide prepares a macOS development machine to test Slice 03 end to end:

```text
hold -> speak -> release -> local transcription appears
```

English Coach does not download Whisper, models, or FFmpeg. Install and select all three locally before recording.

## 1. Install the project prerequisites

Install Apple's command-line tools if they are not already present:

```bash
xcode-select --install
```

Install [Rust](https://www.rust-lang.org/tools/install), [Bun](https://bun.sh/docs/installation), and the [Tauri 2 macOS prerequisites](https://v2.tauri.app/start/prerequisites/). Then install the project dependencies from the repository root:

```bash
bun install
```

## 2. Install Whisper and FFmpeg

The simplest macOS setup uses Homebrew:

```bash
brew install whisper-cpp ffmpeg
```

Confirm both commands are runnable:

```bash
command -v whisper-cli
whisper-cli --version
command -v ffmpeg
ffmpeg -version
```

On an Apple Silicon Mac, Homebrew commonly reports:

```text
/opt/homebrew/bin/whisper-cli
/opt/homebrew/bin/ffmpeg
```

Use the paths printed on your machine; do not copy the examples blindly.

### Build whisper.cpp from source instead

If Homebrew is not an option, follow the official [whisper.cpp quick start](https://github.com/ggml-org/whisper.cpp#quick-start):

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
cmake -B build
cmake --build build -j --config Release
./build/bin/whisper-cli --version
```

The executable path entered in English Coach must then point to `build/bin/whisper-cli` using its full absolute path.

## 3. Download an English Whisper model

`base.en` is a practical first model for local testing. Store it somewhere that will not be removed with build artifacts:

```bash
mkdir -p "$HOME/Models/whisper"
cd "$HOME/Models/whisper"
curl --fail --location --output ggml-base.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
pwd
test -r ggml-base.en.bin && echo "Model is readable"
```

The `pwd` output plus `/ggml-base.en.bin` is the model path to enter in the app. It must be an absolute path, for example:

```text
/Users/your-name/Models/whisper/ggml-base.en.bin
```

Do not enter a path beginning with `~`; the native validation expects either an absolute file path or, for executables, a bare command resolvable through `PATH`.

Other compatible English GGML models are available from the [official whisper.cpp model repository](https://huggingface.co/ggerganov/whisper.cpp/tree/main). Larger models can improve recognition but take more memory and time.

## 4. Launch and configure English Coach

From the repository root, start the Tauri application:

```bash
bun run tauri dev
```

In the application:

1. Open **Settings**.
2. Enter the path printed by `command -v whisper-cli` under **Whisper executable**.
3. Enter the absolute `.bin` path under **Whisper model**.
4. Enter the path printed by `command -v ffmpeg` under **FFmpeg executable**. The bare command `ffmpeg` is also valid when it is available through `PATH`.
5. Select **Save and verify**.
6. Confirm the page reports **Ready** and all three runtime checks pass.
7. Return to **Conversation**. **Hold to talk** should now be enabled.

The settings are stored in `transcription.json` inside Tauri's per-user application-config directory. They are not committed to the repository.

## 5. Grant microphone access

The first recording should trigger the macOS microphone permission prompt. Allow access for English Coach.

If the prompt was denied, open:

```text
System Settings -> Privacy & Security -> Microphone
```

Enable English Coach, then restart `bun run tauri dev`.

## 6. Run the acceptance test

On **Conversation**:

1. Press and hold **Hold to talk**, or hold the Space key while focus is not inside another control.
2. Speak clearly for several seconds:

   ```text
   I've been working with React for several years, and today I'm building an English tutor.
   ```

3. Release the button or Space.
4. Confirm the UI shows **Transcribing…**.
5. Confirm a **You** turn appears with text that preserves the sentence's meaning.
6. Play the retained recording and verify it contains the expected speech.
7. Repeat the test several times to confirm subsequent recordings remain enabled.

Expected behavior:

- FFmpeg converts the WebKit recording to mono, 16 kHz, 16-bit PCM WAV.
- Whisper runs with English explicitly selected.
- No cloud transcription API is called.
- A failed transcription keeps the take available for playback.
- Temporary `englisher-stt-*` directories are removed after success and error paths.

To check for leftover temporary directories after the app becomes idle:

```bash
find "${TMPDIR%/}" -maxdepth 1 -type d -name 'englisher-stt-*' -print
```

No output is expected.

## Troubleshooting

### Whisper executable is not found

Run `command -v whisper-cli` in the same terminal used to launch Tauri, then save that absolute path in Settings. If you built from source, use the absolute path to `build/bin/whisper-cli`.

### Model is missing or unreadable

Confirm the configured value is an absolute path and run:

```bash
test -r /absolute/path/to/ggml-base.en.bin && echo "Model is readable"
```

### FFmpeg is not found

Run `command -v ffmpeg` and configure the returned absolute path. Verify it independently with `ffmpeg -version`.

### Recording fails before transcription

Check macOS microphone permission, restart the Tauri application, and hold the control long enough to capture audible speech.

### Whisper returns no text

Use an English `.en` model, speak closer to the microphone, reduce background noise, and record a complete sentence. The app intentionally treats empty output as an error rather than displaying a blank conversation turn.

### Settings load fails

Open **Settings** and select **Try again**. If the native runtime itself is unavailable, restart `bun run tauri dev` before retrying.

## Automated validation

Run the same checks used before committing Slice 03:

```bash
bun run test
bun run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```
