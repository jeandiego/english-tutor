# Setting up Kokoro (local) TTS

Kokoro is a free, local text-to-speech engine. englisher shells out to the
[`kokoros`](https://github.com/lucasjinreal/kokoros) Rust CLI (`koko`) to
synthesize the tutor's replies to a WAV file, then plays it back the same
way the other voice providers do. Nothing leaves your machine and no API
key is required.

## 1. Prerequisites

- A Rust toolchain (`cargo`, `rustc`) — install via [rustup](https://rustup.rs)
  if you don't already have one.
- `git`.
- Internet access for the one-time download of the Kokoro model files
  (~350 MB total).

## 2. Build the `koko` CLI

```bash
git clone https://github.com/lucasjinreal/kokoros
cd kokoros
cargo build --release
```

When the build finishes, note the full path to the binary it produced:

```bash
realpath target/release/koko
```

You'll paste this into englisher's Settings as the **Koko executable**.

## 3. Download the model files

Still inside the `kokoros` directory:

```bash
bash download_all.sh
```

If that script isn't present in your checkout, run the two individual
scripts instead:

```bash
bash scripts/download_models.sh
bash scripts/download_voices.sh
```

This downloads two files you'll also need the paths to:

- `kokoro-v1.0.onnx` — the model
- `voices-v1.0.bin` — the voice embeddings ("voices data")

Find their absolute paths, for example:

```bash
realpath checkpoints/kokoro-v1.0.onnx
realpath data/voices-v1.0.bin
```

## 4. Configure englisher

1. Open englisher and go to **Settings**.
2. In **Voice configuration**, set **Provider** to `Kokoro (local)`.
3. Three new fields appear — paste in the paths from steps 2 and 3:
   - **Koko executable** → `target/release/koko`
   - **Kokoro model** → `checkpoints/kokoro-v1.0.onnx`
   - **Kokoro voices data** → `data/voices-v1.0.bin`
4. Pick a **Voice** from the list (e.g. `af_sarah`, `am_adam`, `bf_emma`).
   English (US) voices use the `af_`/`am_` prefix; English (UK) voices use
   `bf_`/`bm_`.
5. Adjust **Volume** if you like, then **Save**.

## 5. Automatic fallback

If Kokoro can't run for any reason — a path is wrong, the binary crashed,
the model file is missing — englisher automatically falls back to macOS
Speech for that reply so the tutor never goes silent. You won't see an
error dialog; the reply is just spoken by the fallback voice instead.

## Troubleshooting

The Voice configuration section shows a live availability message for
whichever provider is selected:

- **"Set a valid path for the koko executable, ..."** — one or more of
  the three paths is empty, or doesn't point to a file. Double-check the
  paths with `ls` and re-paste them (no `~` expansion is performed —
  use an absolute path if you're unsure).
- Speech that never plays, with no error shown, usually means Kokoro
  failed and the app silently fell back to macOS Speech. Try running the
  same command englisher runs, directly in a terminal, to see the actual
  error:

  ```bash
  /path/to/koko --model /path/to/kokoro-v1.0.onnx \
    --data /path/to/voices-v1.0.bin \
    --style af_sarah \
    text "Testing Kokoro." --output /tmp/test.wav
  afplay /tmp/test.wav
  ```

  Common causes: the model/voices files didn't finish downloading, or the
  `koko` binary was built for a different architecture than the one
  englisher is running on.
