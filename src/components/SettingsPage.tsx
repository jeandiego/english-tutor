import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "./ui/field";
import { Input } from "./ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Slider } from "./ui/slider";
import { Switch } from "./ui/switch";
import { cn } from "../lib/utils";
import { useLearnerProfile } from "../hooks/useLearnerProfile";
import type {
  DependencyCheck,
  TranscriptionSettings,
  TranscriptionSetupState,
} from "../types/transcription";
import { TTS_PROVIDER_LABELS, type TtsProviderId, type TtsSettings, type TtsSetupState } from "../types/tts";
import type { RepairIntensity, TutorSettings, TutorSetupState } from "../types/tutor";
import type { ListeningAccentFocus, VoiceGenderPreference } from "../types/listening";

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

const ACCENT_FOCUS_LABELS: Record<ListeningAccentFocus, string> = {
  american: "American English",
  british: "British English",
  mixed: "Mixed accents",
  software_workplace: "Software & workplace English",
  travel_everyday: "Travel & everyday English",
};

const VOICE_GENDER_PREF_LABELS: Record<VoiceGenderPreference, string> = {
  any: "Any",
  female: "Female",
  male: "Male",
};

const LISTENING_STAGE_LABELS = [
  "Clear & slow",
  "Clear & natural",
  "Natural, with contractions",
  "Regional accent exposure",
  "Faster, authentic speech",
];

const DEPENDENCY_NAMES: Record<DependencyCheck["dependency"], string> = {
  whisperExecutable: "Whisper runtime",
  whisperModel: "English model",
  ffmpegExecutable: "Audio conversion",
};

function DependencyDot({ ready }: { ready: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-1.5 size-2 shrink-0 rounded-full",
        ready ? "bg-success" : "bg-destructive",
      )}
    />
  );
}

function LoadErrorAlert({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      <Button className="mt-2 w-fit" onClick={onRetry} size="sm" variant="outline">
        Try again
      </Button>
    </Alert>
  );
}

function SettingsSection({
  title,
  titleId,
  description,
  children,
}: {
  title: string;
  titleId: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card aria-labelledby={titleId} className="rounded-lg" size="sm">
      <CardHeader>
        <CardTitle id={titleId}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function FormFooter({
  note,
  dirty,
  saving,
  onReset,
  saveLabel,
  savingLabel,
}: {
  note: string;
  dirty: boolean;
  saving: boolean;
  onReset: () => void;
  saveLabel: string;
  savingLabel: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
      <p className="text-caption text-muted-foreground">{note}</p>
      <div className="flex gap-2">
        <Button
          disabled={!dirty || saving}
          onClick={onReset}
          type="button"
          variant="outline"
        >
          Reset changes
        </Button>
        <Button disabled={!dirty || saving} type="submit">
          {saving ? savingLabel : saveLabel}
        </Button>
      </div>
    </div>
  );
}

type TranscriptionSettingsSectionProps = {
  transcriptionState: TranscriptionSetupState;
  transcriptionDraft: TranscriptionSettings;
  transcriptionDirty: boolean;
  onTranscriptionDraftChange: (settings: TranscriptionSettings) => void;
  onTranscriptionReset: () => void;
  onTranscriptionRetry: () => Promise<void>;
  onTranscriptionSave: () => Promise<void>;
};

export function TranscriptionSettingsSection({
  transcriptionState,
  transcriptionDraft,
  transcriptionDirty,
  onTranscriptionDraftChange,
  onTranscriptionReset,
  onTranscriptionRetry,
  onTranscriptionSave,
}: TranscriptionSettingsSectionProps) {
  const transcriptionSetup =
    transcriptionState.status === "loaded" ? transcriptionState.setup : undefined;
  const transcriptionSaving =
    transcriptionState.status === "loaded" && transcriptionState.saving;
  const transcriptionSaveError =
    transcriptionState.status === "loaded" ? transcriptionState.saveError : undefined;

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        description="All three dependencies must pass before voice input is enabled."
        title="Local transcription"
        titleId="transcription-checks-title"
      >
        {transcriptionState.status === "checking" && (
          <p className="text-body text-muted-foreground">Checking local dependencies…</p>
        )}

        {transcriptionState.status === "error" && (
          <LoadErrorAlert
            message={transcriptionState.message}
            onRetry={() => void onTranscriptionRetry()}
            title="Transcription settings could not be loaded."
          />
        )}

        {transcriptionSetup && (
          <div className="flex flex-col divide-y divide-border">
            {transcriptionSetup.preflight.checks.map((check) => (
              <div className="flex gap-3 py-2 first:pt-0 last:pb-0" key={check.dependency}>
                <DependencyDot ready={check.status === "ready"} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-body font-medium text-foreground">
                    {DEPENDENCY_NAMES[check.dependency]}
                  </p>
                  <p className="text-caption text-muted-foreground">{check.message}</p>
                  {check.technicalMessage && (
                    <details className="text-caption text-muted-foreground">
                      <summary className="cursor-pointer">Technical details</summary>
                      <code className="block whitespace-pre-wrap">{check.technicalMessage}</code>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {transcriptionSetup && (
        <SettingsSection
          description="Use a command available on PATH or enter an absolute file path."
          title="Transcription paths"
          titleId="paths-title"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onTranscriptionSave();
            }}
          >
            <FieldGroup className="gap-4">
              <Field orientation="responsive">
                <FieldLabel htmlFor="whisper-executable-path">Whisper executable</FieldLabel>
                <FieldContent>
                  <Input
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
                  <FieldDescription className="text-xs text-muted-foreground/62">The locally installed whisper.cpp command.</FieldDescription>
                </FieldContent>
              </Field>

              <Field orientation="responsive">
                <FieldLabel htmlFor="whisper-model-path">Whisper model</FieldLabel>
                <FieldContent>
                  <Input
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
                  <FieldDescription className="text-xs text-muted-foreground/62">
                    An English-capable GGML model file stored locally.
                  </FieldDescription>
                </FieldContent>
              </Field>

              <Field orientation="responsive">
                <FieldLabel htmlFor="ffmpeg-executable-path">FFmpeg executable</FieldLabel>
                <FieldContent>
                  <Input
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
                  <FieldDescription className="text-xs text-muted-foreground/62">
                    Converts recordings to mono 16 kHz WAV before Whisper.
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>

            {transcriptionSaveError && (
              <p className="mt-4 text-caption text-destructive" role="alert">
                {transcriptionSaveError}
              </p>
            )}

            <FormFooter
              dirty={transcriptionDirty}
              note="Models are never downloaded automatically."
              onReset={onTranscriptionReset}
              saveLabel="Save and verify"
              saving={transcriptionSaving}
              savingLabel="Saving and verifying…"
            />
          </form>
        </SettingsSection>
      )}
    </div>
  );
}

type TutorSettingsSectionProps = {
  tutorState: TutorSetupState;
  tutorDraft: TutorSettings;
  tutorDirty: boolean;
  onTutorDraftChange: (settings: TutorSettings) => void;
  onTutorReset: () => void;
  onTutorRetry: () => Promise<void>;
  onTutorSave: () => Promise<void>;
};

export function TutorSettingsSection({
  tutorState,
  tutorDraft,
  tutorDirty,
  onTutorDraftChange,
  onTutorReset,
  onTutorRetry,
  onTutorSave,
}: TutorSettingsSectionProps) {
  const tutorSetup = tutorState.status === "loaded" ? tutorState.setup : undefined;
  const tutorSaving = tutorState.status === "loaded" && tutorState.saving;
  const tutorSaveError =
    tutorState.status === "loaded" ? tutorState.saveError : undefined;

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        description="Ollama must be running with the configured model installed locally."
        title="Local tutor"
        titleId="tutor-check-title"
      >
        {tutorState.status === "checking" && (
          <p className="text-body text-muted-foreground">Checking local Ollama…</p>
        )}

        {tutorState.status === "error" && (
          <LoadErrorAlert
            message={tutorState.message}
            onRetry={() => void onTutorRetry()}
            title="Tutor settings could not be loaded."
          />
        )}

        {tutorSetup && (
          <div className="flex gap-3">
            <DependencyDot ready={tutorSetup.preflight.status === "ready"} />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-body font-medium text-foreground">Ollama tutor</p>
              <p className="text-caption text-muted-foreground">
                {tutorSetup.preflight.message}
                {tutorSetup.preflight.version && (
                  <span className="ml-1.5 text-muted-foreground">
                    · Ollama {tutorSetup.preflight.version}
                  </span>
                )}
              </p>
              {tutorSetup.preflight.technicalMessage && (
                <details className="text-caption text-muted-foreground">
                  <summary className="cursor-pointer">Technical details</summary>
                  <code className="block whitespace-pre-wrap">
                    {tutorSetup.preflight.technicalMessage}
                  </code>
                </details>
              )}
              <Button
                className="mt-1 w-fit"
                disabled={tutorSaving}
                onClick={() => void onTutorRetry()}
                size="sm"
                type="button"
                variant="outline"
              >
                Check again
              </Button>
            </div>
          </div>
        )}
      </SettingsSection>

      {tutorSetup && (
        <SettingsSection
          description="Only local or private-network URLs are accepted, so transcripts stay on your network."
          title="Ollama configuration"
          titleId="tutor-settings-title"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onTutorSave();
            }}
          >
            <FieldGroup className="gap-4">
              <Field orientation="responsive">
                <FieldLabel htmlFor="ollama-base-url">Ollama URL</FieldLabel>
                <FieldContent>
                  <Input
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
                  <FieldDescription  className="text-xs text-muted-foreground/62">
                    Use localhost, 127.0.0.1, ::1, or a private network address (e.g.
                    192.168.x.x) with any local port.
                  </FieldDescription>
                </FieldContent>
              </Field>

              <Field orientation="responsive">
                <FieldLabel htmlFor="ollama-model-name">Tutor model</FieldLabel>
                <FieldContent>
                  <Select
                    disabled={tutorSaving || tutorSetup.preflight.availableModels.length === 0}
                    onValueChange={(value) =>
                      onTutorDraftChange({ ...tutorDraft, modelName: value ?? "" })
                    }
                    value={tutorDraft.modelName || undefined}
                  >
                    <SelectTrigger className="w-full" id="ollama-model-name">
                      <SelectValue
                        placeholder={
                          tutorSetup.preflight.availableModels.length > 0
                            ? "Choose an installed model"
                            : "No models found at this URL"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {tutorDraft.modelName &&
                        !tutorSetup.preflight.availableModels.some(
                          (model) => model.name === tutorDraft.modelName,
                        ) && (
                          <SelectItem value={tutorDraft.modelName}>
                            {tutorDraft.modelName} (not found at this URL)
                          </SelectItem>
                        )}
                      {tutorSetup.preflight.availableModels.map((model) => (
                        <SelectItem key={model.name} value={model.name}>
                          {model.name}
                          {model.parameterSize ? ` — ${model.parameterSize}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription  className="text-xs text-muted-foreground/62">
                    {tutorSetup.preflight.availableModels.length > 0
                      ? `${tutorSetup.preflight.availableModels.length} local model${
                          tutorSetup.preflight.availableModels.length === 1 ? "" : "s"
                        } available at this URL.`
                      : "Save the Ollama URL above to discover models installed there."}
                  </FieldDescription>
                </FieldContent>
              </Field>

              <Field orientation="horizontal">
                <FieldContent>
                  <FieldLabel htmlFor="ollama-thinking-enabled">Thinking mode</FieldLabel>
                  <FieldDescription className="text-xs text-muted-foreground/62">
                    Only affects models that support extended thinking. Turning it off
                    usually replies faster and raises tokens/sec.
                  </FieldDescription>
                </FieldContent>
                <Switch
                  checked={tutorDraft.thinkingEnabled}
                  disabled={tutorSaving}
                  id="ollama-thinking-enabled"
                  onCheckedChange={(checked) =>
                    onTutorDraftChange({ ...tutorDraft, thinkingEnabled: checked })
                  }
                />
              </Field>

              <Field orientation="responsive">
                <FieldLabel htmlFor="repair-intensity">Repair intensity</FieldLabel>
                <FieldContent>
                  <Select
                    disabled={tutorSaving}
                    onValueChange={(value) =>
                      onTutorDraftChange({
                        ...tutorDraft,
                        repairIntensity: value as RepairIntensity,
                      })
                    }
                    value={tutorDraft.repairIntensity}
                  >
                    <SelectTrigger className="w-full" id="repair-intensity">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {REPAIR_INTENSITY_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription className="text-xs text-muted-foreground/62">
                    {
                      REPAIR_INTENSITY_OPTIONS.find(
                        (option) => option.value === tutorDraft.repairIntensity,
                      )?.description
                    }
                  </FieldDescription>
                </FieldContent>
              </Field>
            </FieldGroup>

            {tutorSaveError && (
              <p className="mt-4 text-caption text-destructive" role="alert">
                {tutorSaveError}
              </p>
            )}

            <FormFooter
              dirty={tutorDirty}
              note="Pako never pulls or selects an Ollama model automatically."
              onReset={onTutorReset}
              saveLabel="Save and verify tutor"
              saving={tutorSaving}
              savingLabel="Saving and verifying…"
            />
          </form>
        </SettingsSection>
      )}
    </div>
  );
}

type VoiceSettingsSectionProps = {
  ttsState: TtsSetupState;
  ttsDraft: TtsSettings;
  ttsDirty: boolean;
  onTtsDraftChange: (settings: TtsSettings) => void;
  onTtsReset: () => void;
  onTtsRetry: () => Promise<void>;
  onTtsSave: () => Promise<void>;
};

export function VoiceSettingsSection({
  ttsState,
  ttsDraft,
  ttsDirty,
  onTtsDraftChange,
  onTtsReset,
  onTtsRetry,
  onTtsSave,
}: VoiceSettingsSectionProps) {
  const ttsSetup = ttsState.status === "loaded" ? ttsState.setup : undefined;
  const ttsSaving = ttsState.status === "loaded" && ttsState.saving;
  const ttsSaveError = ttsState.status === "loaded" ? ttsState.saveError : undefined;
  const selectedProvider = ttsSetup?.providers.find(
    (provider) => provider.id === ttsDraft.provider,
  );

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        description="macOS speech works out of the box. Kokoro and ElevenLabs are optional."
        title="Voice"
        titleId="voice-checks-title"
      >
        {ttsState.status === "checking" && (
          <p className="text-body text-muted-foreground">Checking voice providers…</p>
        )}

        {ttsState.status === "error" && (
          <LoadErrorAlert
            message={ttsState.message}
            onRetry={() => void onTtsRetry()}
            title="Voice settings could not be loaded."
          />
        )}

        {ttsSetup && (
          <div className="flex flex-col divide-y divide-border">
            {ttsSetup.providers.map((provider) => (
              <div className="flex gap-3 py-2 first:pt-0 last:pb-0" key={provider.id}>
                <DependencyDot ready={provider.availability.available} />
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="text-body font-medium text-foreground">{provider.label}</p>
                  <p className="text-caption text-muted-foreground">
                    {provider.availability.message}
                  </p>
                  {provider.availability.technicalMessage && (
                    <details className="text-caption text-muted-foreground">
                      <summary className="cursor-pointer">Technical details</summary>
                      <code className="block whitespace-pre-wrap">
                        {provider.availability.technicalMessage}
                      </code>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      {ttsSetup && (
        <SettingsSection
          description="Unavailable providers automatically fall back to macOS speech."
          title="Voice configuration"
          titleId="voice-settings-title"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void onTtsSave();
            }}
          >
            <FieldGroup className="gap-4">
              <Field orientation="responsive">
                <FieldLabel htmlFor="tts-provider">Provider</FieldLabel>
                <FieldContent>
                  <Select
                    disabled={ttsSaving}
                    onValueChange={(value) =>
                      onTtsDraftChange({
                        ...ttsDraft,
                        provider: value as TtsProviderId,
                        voiceId: "",
                      })
                    }
                    value={ttsDraft.provider}
                  >
                    <SelectTrigger className="w-full" id="tts-provider">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ttsSetup.providers.map((provider) => (
                        <SelectItem key={provider.id} value={provider.id}>
                          {TTS_PROVIDER_LABELS[provider.id]}
                          {provider.availability.available ? "" : " (unavailable)"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldDescription className="text-xs text-muted-foreground/62">
                    Unavailable providers fall back to macOS speech automatically.
                  </FieldDescription>
                </FieldContent>
              </Field>

              <Field orientation="responsive">
                <FieldLabel htmlFor="tts-voice">Voice</FieldLabel>
                <FieldContent>
                  <Input
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
                  <FieldDescription  className="text-xs text-muted-foreground/62">
                    {selectedProvider?.voices.length
                      ? `${selectedProvider.voices.length} voice${
                          selectedProvider.voices.length === 1 ? "" : "s"
                        } available. The locale shown is the voice's accent/region.`
                      : "This provider has no voices available yet."}
                  </FieldDescription>
                </FieldContent>
              </Field>

              {ttsDraft.provider === "kokoro_local" && (
                <>
                  <Field orientation="responsive">
                    <FieldLabel htmlFor="kokoro-executable-path">Koko executable</FieldLabel>
                    <FieldContent>
                      <Input
                        autoComplete="off"
                        disabled={ttsSaving}
                        id="kokoro-executable-path"
                        onChange={(event) =>
                          onTtsDraftChange({
                            ...ttsDraft,
                            kokoroExecutablePath: event.target.value,
                          })
                        }
                        placeholder="~/kokoros/target/release/koko"
                        spellCheck={false}
                        value={ttsDraft.kokoroExecutablePath}
                      />
                      <FieldDescription className="text-xs text-muted-foreground/62">
                        The locally built kokoros CLI binary.
                      </FieldDescription>
                    </FieldContent>
                  </Field>

                  <Field orientation="responsive">
                    <FieldLabel htmlFor="kokoro-model-path">Kokoro model</FieldLabel>
                    <FieldContent>
                      <Input
                        autoComplete="off"
                        disabled={ttsSaving}
                        id="kokoro-model-path"
                        onChange={(event) =>
                          onTtsDraftChange({
                            ...ttsDraft,
                            kokoroModelPath: event.target.value,
                          })
                        }
                        placeholder="~/kokoros/checkpoints/kokoro-v1.0.onnx"
                        spellCheck={false}
                        value={ttsDraft.kokoroModelPath}
                      />
                      <FieldDescription className="text-xs text-muted-foreground/62">
                        The Kokoro-82M ONNX model file.
                      </FieldDescription>
                    </FieldContent>
                  </Field>

                  <Field orientation="responsive">
                    <FieldLabel htmlFor="kokoro-voices-path">Kokoro voices data</FieldLabel>
                    <FieldContent>
                      <Input
                        autoComplete="off"
                        disabled={ttsSaving}
                        id="kokoro-voices-path"
                        onChange={(event) =>
                          onTtsDraftChange({
                            ...ttsDraft,
                            kokoroVoicesPath: event.target.value,
                          })
                        }
                        placeholder="~/kokoros/data/voices-v1.0.bin"
                        spellCheck={false}
                        value={ttsDraft.kokoroVoicesPath}
                      />
                      <FieldDescription className="text-xs text-muted-foreground/62">
                        The voice embeddings file that pairs with the model.
                      </FieldDescription>
                    </FieldContent>
                  </Field>
                </>
              )}

              {selectedProvider?.supportsRate && (
                <Field orientation="responsive">
                  <FieldLabel htmlFor="tts-rate">Speed</FieldLabel>
                  <FieldContent>
                    <div className="flex items-center gap-3">
                      <Slider
                        disabled={ttsSaving}
                        id="tts-rate"
                        max={360}
                        min={90}
                        onValueChange={(next) =>
                          onTtsDraftChange({
                            ...ttsDraft,
                            rate: Array.isArray(next) ? next[0] : next,
                          })
                        }
                        value={[ttsDraft.rate ?? 175]}
                      />
                      <output className="w-16 shrink-0 text-caption text-muted-foreground" htmlFor="tts-rate">
                        {ttsDraft.rate ?? 175} wpm
                      </output>
                    </div>
                    <FieldDescription  className="text-xs text-muted-foreground/62">Words per minute.</FieldDescription>
                  </FieldContent>
                </Field>
              )}

              {selectedProvider?.supportsVolume && (
                <Field orientation="responsive">
                  <FieldLabel htmlFor="tts-volume">Volume</FieldLabel>
                  <FieldContent>
                    <div className="flex items-center gap-3">
                      <Slider
                        disabled={ttsSaving}
                        id="tts-volume"
                        max={1}
                        min={0}
                        onValueChange={(next) =>
                          onTtsDraftChange({
                            ...ttsDraft,
                            volume: Array.isArray(next) ? next[0] : next,
                          })
                        }
                        step={0.05}
                        value={[ttsDraft.volume ?? 1]}
                      />
                      <output className="w-12 shrink-0 text-caption text-muted-foreground" htmlFor="tts-volume">
                        {Math.round((ttsDraft.volume ?? 1) * 100)}%
                      </output>
                    </div>
                  </FieldContent>
                </Field>
              )}
            </FieldGroup>

            {ttsSaveError && (
              <p className="mt-4 text-caption text-destructive" role="alert">
                {ttsSaveError}
              </p>
            )}

            <FormFooter
              dirty={ttsDirty}
              note="Providers without a configured key or model fall back to macOS speech."
              onReset={onTtsReset}
              saveLabel="Save voice settings"
              saving={ttsSaving}
              savingLabel="Saving…"
            />
          </form>
        </SettingsSection>
      )}
    </div>
  );
}

export function ListeningSettingsSection() {
  const learnerProfile = useLearnerProfile();
  const listeningSaving =
    learnerProfile.state.status === "loaded" && learnerProfile.state.saving;
  const listeningSaveError =
    learnerProfile.state.status === "loaded" ? learnerProfile.state.saveError : undefined;

  if (learnerProfile.state.status !== "loaded") {
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <SettingsSection
        description="Adapts the tutor's voice and pacing to your listening focus. Difficulty moves itself as comprehension checks land during sessions, but you can override it here."
        title="Listening"
        titleId="listening-settings-title"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            learnerProfile.save();
          }}
        >
          <FieldGroup className="gap-4">
            <Field orientation="responsive">
              <FieldLabel htmlFor="listening-accent-focus">Accent focus</FieldLabel>
              <FieldContent>
                <Select
                  disabled={listeningSaving}
                  onValueChange={(value) =>
                    learnerProfile.setDraft({
                      ...learnerProfile.draft,
                      accentFocus:
                        value === "none" ? undefined : (value as ListeningAccentFocus),
                    })
                  }
                  value={learnerProfile.draft.accentFocus ?? "none"}
                >
                  <SelectTrigger className="w-full" id="listening-accent-focus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No preference</SelectItem>
                    {(Object.keys(ACCENT_FOCUS_LABELS) as ListeningAccentFocus[]).map(
                      (focus) => (
                        <SelectItem key={focus} value={focus}>
                          {ACCENT_FOCUS_LABELS[focus]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
                <FieldDescription className="text-xs text-muted-foreground/62">
                  Drives which installed voice is picked for sessions when a match exists.
                </FieldDescription>
              </FieldContent>
            </Field>

            <Field orientation="responsive">
              <FieldLabel htmlFor="listening-voice-gender">Voice gender preference</FieldLabel>
              <FieldContent>
                <Select
                  disabled={listeningSaving}
                  onValueChange={(value) =>
                    learnerProfile.setDraft({
                      ...learnerProfile.draft,
                      voiceGenderPref: value as VoiceGenderPreference,
                    })
                  }
                  value={learnerProfile.draft.voiceGenderPref}
                >
                  <SelectTrigger className="w-full" id="listening-voice-gender">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(VOICE_GENDER_PREF_LABELS) as VoiceGenderPreference[]).map(
                      (pref) => (
                        <SelectItem key={pref} value={pref}>
                          {VOICE_GENDER_PREF_LABELS[pref]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </FieldContent>
            </Field>

            <Field orientation="responsive">
              <FieldLabel htmlFor="listening-stage">Listening difficulty</FieldLabel>
              <FieldContent>
                <Select
                  disabled={listeningSaving}
                  onValueChange={(value) =>
                    learnerProfile.setDraft({
                      ...learnerProfile.draft,
                      listeningStage: Number(value),
                    })
                  }
                  value={String(learnerProfile.draft.listeningStage)}
                >
                  <SelectTrigger className="w-full" id="listening-stage">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LISTENING_STAGE_LABELS.map((label, stage) => (
                      <SelectItem key={stage} value={String(stage)}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription className="text-xs text-muted-foreground/62">
                  Advances after a few correct comprehension checks, and eases back after
                  missed ones.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>

          {listeningSaveError && (
            <p className="mt-4 text-caption text-destructive" role="alert">
              {listeningSaveError}
            </p>
          )}

          <FormFooter
            dirty={learnerProfile.dirty}
            note="Applies to guided sessions started after saving."
            onReset={learnerProfile.reset}
            saveLabel="Save listening settings"
            saving={listeningSaving}
            savingLabel="Saving…"
          />
        </form>
      </SettingsSection>
    </div>
  );
}
