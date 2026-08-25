# Local Ollama tutor setup and test guide

This guide prepares a macOS development machine to test Slice 04 end to end:

```text
speech -> local transcription -> local Ollama tutor -> textual reply
```

English Coach does not download Ollama or pull a model. The configured service
must run on this Mac, and the model must already be installed locally.

## 1. Start Ollama

Confirm the Ollama command is installed:

```bash
ollama --version
```

Start the local service if the Ollama desktop app is not already running:

```bash
ollama serve
```

Leave that process running. In another terminal, verify the local API and list
the models already available:

```bash
curl --fail http://127.0.0.1:11434/api/version
ollama list
```

This development machine uses the quantized `qwen3.5:4b` for the manual test,
favoring conversational latency over the larger 9B variant. The application
does not hard-code that name; use the exact model shown by `ollama list` on the
machine being tested.

If no suitable model is installed, choose and pull one explicitly with Ollama
before opening English Coach. A model pull is always a user action and is never
triggered by the application.

## 2. Configure English Coach

Launch the desktop application from the repository root:

```bash
bun run tauri dev
```

In the application:

1. Open **Settings**.
2. Under **Ollama configuration**, leave **Ollama URL** as
   `http://127.0.0.1:11434` unless the local service uses a different port.
3. Enter or choose `qwen3.5:4b` under **Tutor model**.
4. Select **Save and verify tutor**.
5. Confirm the page reports **Ready** and the System strip reports
   **Tutor** with **Ready · qwen3.5:4b** beneath it.
6. Return to **Conversation**. Voice input is enabled only when the desktop,
   transcription, and tutor checks are all ready.

Tutor settings are stored in `tutor.json` inside Tauri's per-user application
configuration directory. They are not committed to the repository.

Only these base URL forms are accepted:

- `http://localhost:<port>`
- `http://127.0.0.1:<port>`
- `http://[::1]:<port>`

HTTPS, credentials, URL paths, redirects, proxies, LAN addresses, and internet
hosts are rejected so transcripts cannot leave this Mac.

## 3. Understand tutor status

- **Ollama unavailable**: the configured loopback URL is invalid, stopped, or
  did not return a valid Ollama response. Start Ollama and select **Check again**.
- **No model configured**: Ollama is running, but the model field is empty.
- **Configured model unavailable**: Ollama is running, but that exact model is
  not present locally. Choose one of the discovered local models.
- **Ready**: Ollama is reachable and the configured model is installed locally.

Remote/cloud model entries are not offered or accepted. A failed preflight or
chat request never triggers a model pull.

## 4. Run the acceptance conversation

On **Conversation**, hold the talk control or Space and say:

```text
I've been working with React since many years, but lately I am studying more backend.
```

Release the control and confirm:

1. The transcript appears as a **You** turn.
2. **Tutor is thinking locally** appears while Ollama works.
3. A concise, natural **Tutor** reply appears.
4. **Responded in** and the measured Ollama output rate in **tok/s** appear
   beneath the tutor reply. Hover the rate to see the output-token count.
5. The reply continues the topic and does not become a grammar lecture.
6. The response is text only; no speech is generated.

Then record a second answer to the tutor's question. Confirm the second reply is
coherent with the first exchange. The first turn's correction data is retained
in memory but intentionally has no corrections panel in this slice.

To exercise recovery, stop Ollama after setup and record again. The transcript
must remain visible, an actionable **Tutor unavailable** error must appear, and
the talk control must become available for another attempt.

## 5. Offline and privacy behavior

After Ollama and the selected models are present, this flow needs no internet
connection. The native HTTP client disables proxies and redirects and accepts
only loopback destinations. It sends transcript text and recent in-memory
conversation context; microphone audio is never sent to Ollama.

The current session retains at most 12 exchanges. Only user transcripts and
tutor replies are included in future context; correction metadata is not sent
back as conversation history.

## Automated validation

Run:

```bash
bun run test
bun run build
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```
