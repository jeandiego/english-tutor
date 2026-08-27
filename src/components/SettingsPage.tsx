import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
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

function StatusBadge({ status }: { status: ReturnType<typeof overallStatus> }) {
  return (
    <Badge
      role="status"
      variant={
        status.visual === "ready"
          ? "success"
          : status.visual === "error"
            ? "destructive"
            : "secondary"
      }
    >
      {status.label}
    </Badge>
  );
}

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
    <Card aria-labelledby={titleId} className="rounded-xl">
      <CardHeader>
        <h3 className="text-subheading font-medium text-foreground" id={titleId}>
          {title}
        </h3>
        <p className="text-body text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">{children}</CardContent>
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
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
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
    <section
      aria-labelledby="settings-title"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-subheading font-semibold text-foreground" id="settings-title">
            Local runtimes
          </h2>
          <p className="text-body text-muted-foreground">
            Configure the on-device tools that transcribe your speech and power
            the English tutor. Audio and transcripts stay on this Mac.
          </p>
        </div>
        <StatusBadge status={status} />
      </div>

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
              <div className="flex gap-3 py-3 first:pt-0 last:pb-0" key={check.dependency}>
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
            <FieldGroup>
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
                  <FieldDescription>The locally installed whisper.cpp command.</FieldDescription>
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
                  <FieldDescription>
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
                  <FieldDescription>
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
            <FieldGroup>
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
                  <FieldDescription>
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
                  <FieldDescription>
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
                  <FieldDescription>
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
                  <FieldDescription>
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
              note="English Coach never pulls or selects an Ollama model automatically."
              onReset={onTutorReset}
              saveLabel="Save and verify tutor"
              saving={tutorSaving}
              savingLabel="Saving and verifying…"
            />
          </form>
        </SettingsSection>
      )}

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
              <div className="flex gap-3 py-3 first:pt-0 last:pb-0" key={provider.id}>
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
            <FieldGroup>
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
                  <FieldDescription>
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
                  <FieldDescription>
                    {selectedProvider?.voices.length
                      ? `${selectedProvider.voices.length} voice${
                          selectedProvider.voices.length === 1 ? "" : "s"
                        } available. The locale shown is the voice's accent/region.`
                      : "This provider has no voices available yet."}
                  </FieldDescription>
                </FieldContent>
              </Field>

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
                    <FieldDescription>Words per minute.</FieldDescription>
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
    </section>
  );
}
