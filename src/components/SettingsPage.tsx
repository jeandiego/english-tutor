import type {
  DependencyCheck,
  TranscriptionSettings,
  TranscriptionSetupState,
} from "../types/transcription";
import type { TtsProviderId, TtsSettings, TtsSetupState } from "../types/tts";
import type { RepairIntensity, TutorSettings, TutorSetupState } from "../types/tutor";

type SettingsPageProps = {
  transcriptionState: TranscriptionSetupState;
  transcriptionDraft: TranscriptionSettings;
  transcriptionDirty: boolean;
  onTranscriptionDraftChange: (settings: TranscriptionSettings) => void;
  onTranscriptionReset: () => void;
  onTranscriptionRetry: () => Promise<void>;
  onTranscriptionSave: () => Promise<void>;
  tutorState: TutorSetupState;
  tutorDraft: TutorSettings;
  tutorDirty: boolean;
  onTutorDraftChange: (settings: TutorSettings) => void;
  onTutorReset: () => void;
  onTutorRetry: () => Promise<void>;
  onTutorSave: () => Promise<void>;
  ttsState: TtsSetupState;
  ttsDraft: TtsSettings;
  ttsDirty: boolean;
  onTtsDraftChange: (settings: TtsSettings) => void;
  onTtsReset: () => void;
  onTtsRetry: () => Promise<void>;
  onTtsSave: () => Promise<void>;
};

const TTS_PROVIDER_LABELS: Record<TtsProviderId, string> = {
  macos_say: "macOS Speech",
  kokoro_local: "Kokoro (local)",
  elevenlabs: "ElevenLabs",
};

const REPAIR_INTENSITY_OPTIONS: Array<{
  value: RepairIntensity;
  label: string;
  description: string;
}> = [
  {
    value: "light",
    label: "Light",
    description: "Only flags errors that would genuinely confuse a listener.",
  },
  {
    value: "balanced",
    label: "Balanced",
    description: "Flags meaningful or recurring errors without interrupting often.",
  },
  {
    value: "strict",
    label: "Strict",
    description: "Flags most errors worth attention, including smaller slips.",
  },
];

const DEPENDENCY_NAMES: Record<DependencyCheck["dependency"], string> = {
  whisperExecutable: "Whisper runtime",
  whisperModel: "English model",
  ffmpegExecutable: "Audio conversion",
};

function isTranscriptionReady(state: TranscriptionSetupState) {
  return (
    state.status === "loaded" &&
    !state.saving &&
    state.setup.preflight.status === "ready"
  );
}

function isTutorReady(state: TutorSetupState) {
  return (
    state.status === "loaded" &&
    !state.saving &&
    state.setup.preflight.status === "ready"
  );
}

function overallStatus(
  transcriptionState: TranscriptionSetupState,
  tutorState: TutorSetupState,
) {
  if (
    transcriptionState.status === "checking" ||
    tutorState.status === "checking" ||
    (transcriptionState.status === "loaded" && transcriptionState.saving) ||
    (tutorState.status === "loaded" && tutorState.saving)
  ) {
    return { label: "Checking", visual: "checking" as const };
  }

  if (isTranscriptionReady(transcriptionState) && isTutorReady(tutorState)) {
    return { label: "Ready", visual: "ready" as const };
  }

  return { label: "Needs setup", visual: "error" as const };
}

export function SettingsPage({
  transcriptionState,
  transcriptionDraft,
  transcriptionDirty,
  onTranscriptionDraftChange,
  onTranscriptionReset,
  onTranscriptionRetry,
  onTranscriptionSave,
  tutorState,
  tutorDraft,
  tutorDirty,
  onTutorDraftChange,
  onTutorReset,
  onTutorRetry,
  onTutorSave,
  ttsState,
  ttsDraft,
  ttsDirty,
  onTtsDraftChange,
  onTtsReset,
  onTtsRetry,
  onTtsSave,
}: SettingsPageProps) {
  const transcriptionSetup =
    transcriptionState.status === "loaded"
      ? transcriptionState.setup
      : undefined;
  const transcriptionSaving =
    transcriptionState.status === "loaded" && transcriptionState.saving;
  const transcriptionSaveError =
    transcriptionState.status === "loaded"
      ? transcriptionState.saveError
      : undefined;
  const tutorSetup = tutorState.status === "loaded" ? tutorState.setup : undefined;
  const tutorSaving = tutorState.status === "loaded" && tutorState.saving;
  const tutorSaveError =
    tutorState.status === "loaded" ? tutorState.saveError : undefined;
  const ttsSetup = ttsState.status === "loaded" ? ttsState.setup : undefined;
  const ttsSaving = ttsState.status === "loaded" && ttsState.saving;
  const ttsSaveError = ttsState.status === "loaded" ? ttsState.saveError : undefined;
  const selectedProvider = ttsSetup?.providers.find(
    (provider) => provider.id === ttsDraft.provider,
  );
  const status = overallStatus(transcriptionState, tutorState);

  return (
    <section className="settings-page" aria-labelledby="settings-title">
      <div className="settings-page__header">
        <div>
          <h2 id="settings-title">Local runtimes</h2>
          <p>
            Configure the on-device tools that transcribe your speech and power
            the English tutor. Audio and transcripts stay on this Mac.
          </p>
        </div>
        <div
          className={`settings-page__status settings-page__status--${status.visual}`}
          role="status"
        >
          <span aria-hidden="true" />
          {status.label}
        </div>
      </div>

      <section className="settings-section" aria-labelledby="transcription-checks-title">
        <div className="settings-section__heading">
          <h3 id="transcription-checks-title">Local transcription</h3>
          <p>All three dependencies must pass before voice input is enabled.</p>
        </div>

        <div className="dependency-list">
          {transcriptionState.status === "checking" && (
            <p className="settings-empty-state">Checking local dependencies…</p>
          )}

          {transcriptionState.status === "error" && (
            <div className="settings-page__error" role="alert">
              <p>Transcription settings could not be loaded.</p>
              <span>{transcriptionState.message}</span>
              <button
                className="settings-button settings-button--secondary"
                onClick={() => void onTranscriptionRetry()}
                type="button"
              >
                Try again
              </button>
            </div>
          )}

          {transcriptionSetup?.preflight.checks.map((check) => (
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

      {transcriptionSetup && (
        <section className="settings-section" aria-labelledby="paths-title">
          <div className="settings-section__heading">
            <h3 id="paths-title">Transcription paths</h3>
            <p>Use a command available on PATH or enter an absolute file path.</p>
          </div>

          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onTranscriptionSave();
            }}
          >
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="whisper-executable-path">
                Whisper executable
              </label>
              <span className="settings-field__control">
                <input
                  autoComplete="off"
                  disabled={transcriptionSaving}
                  id="whisper-executable-path"
                  onChange={(event) =>
                    onTranscriptionDraftChange({
                      ...transcriptionDraft,
                      whisperExecutablePath: event.target.value,
                    })
                  }
                  placeholder="whisper-cli or /path/to/whisper-cli"
                  spellCheck={false}
                  value={transcriptionDraft.whisperExecutablePath}
                />
                <small>The locally installed whisper.cpp command.</small>
              </span>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="whisper-model-path">
                Whisper model
              </label>
              <span className="settings-field__control">
                <input
                  autoComplete="off"
                  disabled={transcriptionSaving}
                  id="whisper-model-path"
                  onChange={(event) =>
                    onTranscriptionDraftChange({
                      ...transcriptionDraft,
                      whisperModelPath: event.target.value,
                    })
                  }
                  placeholder="/path/to/ggml-model.bin"
                  spellCheck={false}
                  value={transcriptionDraft.whisperModelPath}
                />
                <small>An English-capable GGML model file stored locally.</small>
              </span>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="ffmpeg-executable-path">
                FFmpeg executable
              </label>
              <span className="settings-field__control">
                <input
                  autoComplete="off"
                  disabled={transcriptionSaving}
                  id="ffmpeg-executable-path"
                  onChange={(event) =>
                    onTranscriptionDraftChange({
                      ...transcriptionDraft,
                      ffmpegExecutablePath: event.target.value,
                    })
                  }
                  placeholder="ffmpeg or /path/to/ffmpeg"
                  spellCheck={false}
                  value={transcriptionDraft.ffmpegExecutablePath}
                />
                <small>Converts recordings to mono 16 kHz WAV before Whisper.</small>
              </span>
            </div>

            {transcriptionSaveError && (
              <p className="settings-form__error" role="alert">
                {transcriptionSaveError}
              </p>
            )}

            <div className="settings-form__footer">
              <p>Models are never downloaded automatically.</p>
              <div className="settings-form__actions">
                <button
                  className="settings-button settings-button--secondary"
                  disabled={!transcriptionDirty || transcriptionSaving}
                  onClick={onTranscriptionReset}
                  type="button"
                >
                  Reset changes
                </button>
                <button
                  className="settings-button settings-button--primary"
                  disabled={!transcriptionDirty || transcriptionSaving}
                  type="submit"
                >
                  {transcriptionSaving ? "Saving and verifying…" : "Save and verify"}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      <section className="settings-section" aria-labelledby="tutor-check-title">
        <div className="settings-section__heading">
          <h3 id="tutor-check-title">Local tutor</h3>
          <p>Ollama must be running with the configured model installed locally.</p>
        </div>

        <div className="dependency-list">
          {tutorState.status === "checking" && (
            <p className="settings-empty-state">Checking local Ollama…</p>
          )}

          {tutorState.status === "error" && (
            <div className="settings-page__error" role="alert">
              <p>Tutor settings could not be loaded.</p>
              <span>{tutorState.message}</span>
              <button
                className="settings-button settings-button--secondary"
                onClick={() => void onTutorRetry()}
                type="button"
              >
                Try again
              </button>
            </div>
          )}

          {tutorSetup && (
            <div className="dependency-row">
              <span
                className={`dependency-row__mark dependency-row__mark--${tutorSetup.preflight.status}`}
                aria-hidden="true"
              />
              <div className="dependency-row__name">Ollama tutor</div>
              <div className="dependency-row__message">
                <span>{tutorSetup.preflight.message}</span>
                {tutorSetup.preflight.version && (
                  <small className="dependency-row__meta">
                    Ollama {tutorSetup.preflight.version}
                  </small>
                )}
                {tutorSetup.preflight.technicalMessage && (
                  <details>
                    <summary>Technical details</summary>
                    <code>{tutorSetup.preflight.technicalMessage}</code>
                  </details>
                )}
                <button
                  className="settings-button settings-button--secondary settings-button--inline"
                  disabled={tutorSaving}
                  onClick={() => void onTutorRetry()}
                  type="button"
                >
                  Check again
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      {tutorSetup && (
        <section className="settings-section" aria-labelledby="tutor-settings-title">
          <div className="settings-section__heading">
            <h3 id="tutor-settings-title">Ollama configuration</h3>
            <p>Only local or private-network URLs are accepted, so transcripts stay on your network.</p>
          </div>

          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onTutorSave();
            }}
          >
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="ollama-base-url">
                Ollama URL
              </label>
              <span className="settings-field__control">
                <input
                  autoComplete="off"
                  disabled={tutorSaving}
                  id="ollama-base-url"
                  onChange={(event) =>
                    onTutorDraftChange({
                      ...tutorDraft,
                      baseUrl: event.target.value,
                    })
                  }
                  placeholder="http://127.0.0.1:11434"
                  spellCheck={false}
                  value={tutorDraft.baseUrl}
                />
                <small>
                  Use localhost, 127.0.0.1, ::1, or a private network address
                  (e.g. 192.168.x.x) with any local port.
                </small>
              </span>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="ollama-model-name">
                Tutor model
              </label>
              <span className="settings-field__control">
                <select
                  disabled={tutorSaving || tutorSetup.preflight.availableModels.length === 0}
                  id="ollama-model-name"
                  onChange={(event) =>
                    onTutorDraftChange({
                      ...tutorDraft,
                      modelName: event.target.value,
                    })
                  }
                  value={tutorDraft.modelName}
                >
                  <option disabled value="">
                    {tutorSetup.preflight.availableModels.length > 0
                      ? "Choose an installed model"
                      : "No models found at this URL"}
                  </option>
                  {tutorDraft.modelName &&
                    !tutorSetup.preflight.availableModels.some(
                      (model) => model.name === tutorDraft.modelName,
                    ) && (
                      <option value={tutorDraft.modelName}>
                        {tutorDraft.modelName} (not found at this URL)
                      </option>
                    )}
                  {tutorSetup.preflight.availableModels.map((model) => (
                    <option key={model.name} value={model.name}>
                      {model.name}
                      {model.parameterSize ? ` — ${model.parameterSize}` : ""}
                    </option>
                  ))}
                </select>
                <small>
                  {tutorSetup.preflight.availableModels.length > 0
                    ? `${tutorSetup.preflight.availableModels.length} local model${
                        tutorSetup.preflight.availableModels.length === 1 ? "" : "s"
                      } available at this URL.`
                    : "Save the Ollama URL above to discover models installed there."}
                </small>
              </span>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="ollama-thinking-enabled">
                Thinking mode
              </label>
              <span className="settings-field__control">
                <span className="settings-field__checkbox">
                  <input
                    checked={tutorDraft.thinkingEnabled}
                    disabled={tutorSaving}
                    id="ollama-thinking-enabled"
                    onChange={(event) =>
                      onTutorDraftChange({
                        ...tutorDraft,
                        thinkingEnabled: event.target.checked,
                      })
                    }
                    type="checkbox"
                  />
                  <span>Let the model reason before replying</span>
                </span>
                <small>
                  Only affects models that support extended thinking. Turning
                  it off usually replies faster and raises tokens/sec.
                </small>
              </span>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="repair-intensity">
                Repair intensity
              </label>
              <span className="settings-field__control">
                <select
                  disabled={tutorSaving}
                  id="repair-intensity"
                  onChange={(event) =>
                    onTutorDraftChange({
                      ...tutorDraft,
                      repairIntensity: event.target.value as RepairIntensity,
                    })
                  }
                  value={tutorDraft.repairIntensity}
                >
                  {REPAIR_INTENSITY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <small>
                  {
                    REPAIR_INTENSITY_OPTIONS.find(
                      (option) => option.value === tutorDraft.repairIntensity,
                    )?.description
                  }
                </small>
              </span>
            </div>

            {tutorSaveError && (
              <p className="settings-form__error" role="alert">
                {tutorSaveError}
              </p>
            )}

            <div className="settings-form__footer">
              <p>English Coach never pulls or selects an Ollama model automatically.</p>
              <div className="settings-form__actions">
                <button
                  className="settings-button settings-button--secondary"
                  disabled={!tutorDirty || tutorSaving}
                  onClick={onTutorReset}
                  type="button"
                >
                  Reset changes
                </button>
                <button
                  className="settings-button settings-button--primary"
                  disabled={!tutorDirty || tutorSaving}
                  type="submit"
                >
                  {tutorSaving ? "Saving and verifying…" : "Save and verify tutor"}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      <section className="settings-section" aria-labelledby="voice-checks-title">
        <div className="settings-section__heading">
          <h3 id="voice-checks-title">Voice</h3>
          <p>macOS speech works out of the box. Kokoro and ElevenLabs are optional.</p>
        </div>

        <div className="dependency-list">
          {ttsState.status === "checking" && (
            <p className="settings-empty-state">Checking voice providers…</p>
          )}

          {ttsState.status === "error" && (
            <div className="settings-page__error" role="alert">
              <p>Voice settings could not be loaded.</p>
              <span>{ttsState.message}</span>
              <button
                className="settings-button settings-button--secondary"
                onClick={() => void onTtsRetry()}
                type="button"
              >
                Try again
              </button>
            </div>
          )}

          {ttsSetup?.providers.map((provider) => (
            <div className="dependency-row" key={provider.id}>
              <span
                className={`dependency-row__mark dependency-row__mark--${
                  provider.availability.available ? "available" : "unavailable"
                }`}
                aria-hidden="true"
              />
              <div className="dependency-row__name">{provider.label}</div>
              <div className="dependency-row__message">
                <span>{provider.availability.message}</span>
                {provider.availability.technicalMessage && (
                  <details>
                    <summary>Technical details</summary>
                    <code>{provider.availability.technicalMessage}</code>
                  </details>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      {ttsSetup && (
        <section className="settings-section" aria-labelledby="voice-settings-title">
          <div className="settings-section__heading">
            <h3 id="voice-settings-title">Voice configuration</h3>
            <p>Unavailable providers automatically fall back to macOS speech.</p>
          </div>

          <form
            className="settings-form"
            onSubmit={(event) => {
              event.preventDefault();
              void onTtsSave();
            }}
          >
            <div className="settings-field">
              <label className="settings-field__label" htmlFor="tts-provider">
                Provider
              </label>
              <span className="settings-field__control">
                <select
                  disabled={ttsSaving}
                  id="tts-provider"
                  onChange={(event) =>
                    onTtsDraftChange({
                      ...ttsDraft,
                      provider: event.target.value as TtsProviderId,
                      voiceId: "",
                    })
                  }
                  value={ttsDraft.provider}
                >
                  {ttsSetup.providers.map((provider) => (
                    <option key={provider.id} value={provider.id}>
                      {TTS_PROVIDER_LABELS[provider.id]}
                      {provider.availability.available ? "" : " (unavailable)"}
                    </option>
                  ))}
                </select>
                <small>Unavailable providers fall back to macOS speech automatically.</small>
              </span>
            </div>

            <div className="settings-field">
              <label className="settings-field__label" htmlFor="tts-voice">
                Voice
              </label>
              <span className="settings-field__control">
                <input
                  autoComplete="off"
                  disabled={ttsSaving || !selectedProvider?.voices.length}
                  id="tts-voice"
                  list="tts-voices"
                  onChange={(event) =>
                    onTtsDraftChange({ ...ttsDraft, voiceId: event.target.value })
                  }
                  placeholder={
                    selectedProvider?.voices.length
                      ? "Choose a voice"
                      : "No voices available"
                  }
                  spellCheck={false}
                  value={ttsDraft.voiceId}
                />
                <datalist id="tts-voices">
                  {selectedProvider?.voices.map((voice) => (
                    <option key={voice.id} value={voice.id}>
                      {voice.locale ? `${voice.label} — ${voice.locale}` : voice.label}
                    </option>
                  ))}
                </datalist>
                <small>
                  {selectedProvider?.voices.length
                    ? `${selectedProvider.voices.length} voice${
                        selectedProvider.voices.length === 1 ? "" : "s"
                      } available. The locale shown is the voice's accent/region.`
                    : "This provider has no voices available yet."}
                </small>
              </span>
            </div>

            {selectedProvider?.supportsRate && (
              <div className="settings-field">
                <label className="settings-field__label" htmlFor="tts-rate">
                  Speed
                </label>
                <span className="settings-field__control">
                  <span className="settings-field__range">
                    <input
                      disabled={ttsSaving}
                      id="tts-rate"
                      max={360}
                      min={90}
                      onChange={(event) =>
                        onTtsDraftChange({
                          ...ttsDraft,
                          rate: Number(event.target.value),
                        })
                      }
                      type="range"
                      value={ttsDraft.rate ?? 175}
                    />
                    <output htmlFor="tts-rate">{ttsDraft.rate ?? 175} wpm</output>
                  </span>
                  <small>Words per minute.</small>
                </span>
              </div>
            )}

            {selectedProvider?.supportsVolume && (
              <div className="settings-field">
                <label className="settings-field__label" htmlFor="tts-volume">
                  Volume
                </label>
                <span className="settings-field__control">
                  <span className="settings-field__range">
                    <input
                      disabled={ttsSaving}
                      id="tts-volume"
                      max={1}
                      min={0}
                      onChange={(event) =>
                        onTtsDraftChange({
                          ...ttsDraft,
                          volume: Number(event.target.value),
                        })
                      }
                      step={0.05}
                      type="range"
                      value={ttsDraft.volume ?? 1}
                    />
                    <output htmlFor="tts-volume">
                      {Math.round((ttsDraft.volume ?? 1) * 100)}%
                    </output>
                  </span>
                </span>
              </div>
            )}

            {ttsSaveError && (
              <p className="settings-form__error" role="alert">
                {ttsSaveError}
              </p>
            )}

            <div className="settings-form__footer">
              <p>Providers without a configured key or model fall back to macOS speech.</p>
              <div className="settings-form__actions">
                <button
                  className="settings-button settings-button--secondary"
                  disabled={!ttsDirty || ttsSaving}
                  onClick={onTtsReset}
                  type="button"
                >
                  Reset changes
                </button>
                <button
                  className="settings-button settings-button--primary"
                  disabled={!ttsDirty || ttsSaving}
                  type="submit"
                >
                  {ttsSaving ? "Saving…" : "Save voice settings"}
                </button>
              </div>
            </div>
          </form>
        </section>
      )}
    </section>
  );
}
