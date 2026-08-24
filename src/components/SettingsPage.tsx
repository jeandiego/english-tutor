import type {
  DependencyCheck,
  TranscriptionSettings,
  TranscriptionSetupState,
} from "../types/transcription";

type SettingsPageProps = {
  state: TranscriptionSetupState;
  draft: TranscriptionSettings;
  dirty: boolean;
  onDraftChange: (settings: TranscriptionSettings) => void;
  onReset: () => void;
  onRetry: () => Promise<void>;
  onSave: () => Promise<void>;
};

const DEPENDENCY_NAMES: Record<DependencyCheck["dependency"], string> = {
  whisperExecutable: "Whisper runtime",
  whisperModel: "English model",
  ffmpegExecutable: "Audio conversion",
};

function statusLabel(state: TranscriptionSetupState) {
  if (state.status === "checking") {
    return "Checking";
  }

  if (state.status === "error") {
    return "Unavailable";
  }

  if (state.saving) {
    return "Verifying";
  }

  return state.setup.preflight.status === "ready" ? "Ready" : "Needs setup";
}

export function SettingsPage({
  state,
  draft,
  dirty,
  onDraftChange,
  onReset,
  onRetry,
  onSave,
}: SettingsPageProps) {
  const setup = state.status === "loaded" ? state.setup : undefined;
  const ready = setup?.preflight.status === "ready";
  const saving = state.status === "loaded" && state.saving;
  const saveError = state.status === "loaded" ? state.saveError : undefined;
  const visualStatus =
    state.status === "checking" || saving
      ? "checking"
      : ready
        ? "ready"
        : "error";

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="settings-page__header">
        <div>
          <h2 id="settings-title">Local transcription</h2>
          <p>
            Choose the local tools English Coach uses to turn each recording into
            text. These paths stay on this Mac.
          </p>
        </div>
        <div
          className={`settings-page__status settings-page__status--${visualStatus}`}
          role="status"
        >
          <span aria-hidden="true" />
          {statusLabel(state)}
        </div>
      </div>

      <section className="settings-section" aria-labelledby="dependencies-title">
        <div className="settings-section__heading">
          <h3 id="dependencies-title">Runtime checks</h3>
          <p>All three dependencies must pass before voice input is enabled.</p>
        </div>

        <div className="dependency-list">
          {state.status === "checking" && (
            <p className="settings-empty-state">Checking local dependencies…</p>
          )}

          {state.status === "error" && (
            <div className="settings-page__error" role="alert">
              <p>Transcription settings could not be loaded.</p>
              <span>{state.message}</span>
              <button
                className="settings-button settings-button--secondary"
                onClick={() => void onRetry()}
                type="button"
              >
                Try again
              </button>
            </div>
          )}

          {setup?.preflight.checks.map((check) => (
            <div className="dependency-row" key={check.dependency}>
              <span
                className={`dependency-row__mark dependency-row__mark--${check.status}`}
                aria-hidden="true"
              />
              <div className="dependency-row__name">
                {DEPENDENCY_NAMES[check.dependency]}
              </div>
              <div className="dependency-row__message">
                <span>{check.message}</span>
                {check.technicalMessage && (
                  <details>
                    <summary>Technical details</summary>
                    <code>{check.technicalMessage}</code>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {setup && (
        <section className="settings-section" aria-labelledby="paths-title">
          <div className="settings-section__heading">
            <h3 id="paths-title">Runtime paths</h3>
            <p>Use a command available on PATH or enter an absolute file path.</p>
          </div>

          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onSave();
            }}
          >
            <div className="settings-field">
              <label
                className="settings-field__label"
                htmlFor="whisper-executable-path"
              >
                Whisper executable
              </label>
              <span className="settings-field__control">
                <input
                  autoComplete="off"
                  disabled={saving}
                  id="whisper-executable-path"
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      whisperExecutablePath: event.target.value,
                    })
                  }
                  placeholder="whisper-cli or /path/to/whisper-cli"
                  spellCheck={false}
                  value={draft.whisperExecutablePath}
                />
                <small>The locally installed whisper.cpp command.</small>
              </span>
            </div>

            <div className="settings-field">
              <label
                className="settings-field__label"
                htmlFor="whisper-model-path"
              >
                Whisper model
              </label>
              <span className="settings-field__control">
                <input
                  autoComplete="off"
                  disabled={saving}
                  id="whisper-model-path"
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      whisperModelPath: event.target.value,
                    })
                  }
                  placeholder="/path/to/ggml-model.bin"
                  spellCheck={false}
                  value={draft.whisperModelPath}
                />
                <small>An English-capable GGML model file stored locally.</small>
              </span>
            </div>

            <div className="settings-field">
              <label
                className="settings-field__label"
                htmlFor="ffmpeg-executable-path"
              >
                FFmpeg executable
              </label>
              <span className="settings-field__control">
                <input
                  autoComplete="off"
                  disabled={saving}
                  id="ffmpeg-executable-path"
                  onChange={(event) =>
                    onDraftChange({
                      ...draft,
                      ffmpegExecutablePath: event.target.value,
                    })
                  }
                  placeholder="ffmpeg or /path/to/ffmpeg"
                  spellCheck={false}
                  value={draft.ffmpegExecutablePath}
                />
                <small>Converts recordings to mono 16 kHz WAV before Whisper.</small>
              </span>
            </div>

            {saveError && (
              <p className="settings-form__error" role="alert">
                {saveError}
              </p>
            )}

            <div className="settings-form__footer">
              <p>Models are never downloaded automatically.</p>
              <div className="settings-form__actions">
                <button
                  className="settings-button settings-button--secondary"
                  disabled={!dirty || saving}
                  onClick={onReset}
                  type="button"
                >
                  Reset changes
                </button>
                <button
                  className="settings-button settings-button--primary"
                  disabled={!dirty || saving}
                  type="submit"
                >
                  {saving ? "Saving and verifying…" : "Save and verify"}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}
    </section>
  );
}
