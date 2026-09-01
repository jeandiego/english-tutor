import { useQuery } from "@tanstack/react-query";
import { IconStar, IconStarFilled } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import type { CefrLevel } from "../types/assessment";
import { useFavoritePacks } from "../hooks/useFavoritePacks";
import { useImportScenarioPackVocabulary } from "../hooks/useImportScenarioPackVocabulary";
import { useSessionRun } from "../hooks/useSessionRun";
import { getLearnerProfile } from "../native/learnerProfile";
import { listDueReviewItems } from "../native/review";
import { reviewKeys } from "../queryKeys/review";
import { DURATION_PRESETS, type DurationPresetId } from "../sessions/catalog";
import { PACK_CATALOG } from "../sessions/loadPacks";
import { toSessionSource, type ScenarioPack, type SessionSource } from "../types/scenarioPack";
import type { RepairIntensity, RepairOutcome, RepairPriority } from "../types/repair";
import type { TutorModel } from "../types/tutor";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Field, FieldContent, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "../lib/utils";
import { ConversationControls } from "./ConversationControls";
import { ConversationStage, ListeningCheckCard } from "./ConversationStage";

type SessionsPageProps = {
  currentModel?: string;
  disabled: boolean;
  disabledHint?: string;
  modelPickerDisabled?: boolean;
  models: TutorModel[];
  onSelectModel: (modelName: string) => void;
  repairIntensity?: RepairIntensity;
};

const REPAIR_PRIORITY_LABELS: Record<RepairPriority, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  pronunciation: "Pronunciation",
  fluency: "Fluency",
  coherence: "Coherence",
  pragmatics: "Pragmatics",
};

const REPAIR_OUTCOME_LABELS: Record<RepairOutcome, string> = {
  improved: "Fixed",
  failed: "Still tricky",
  skipped: "Skipped",
};

const CEFR_LEVELS: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

function SummarySection({ heading, items }: { heading: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-caption font-medium text-muted-foreground">{heading}</h4>
      <ul className="flex flex-col gap-0.5 text-body text-foreground">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ProcessingStatus({ label, meta }: { label: string; meta?: string }) {
  return (
    <div className="flex items-center gap-2 py-2" role="status">
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-muted-foreground" />
      <p className="text-caption text-muted-foreground">
        {label}
        {meta && <span className="ml-1.5">· {meta}</span>}
      </p>
    </div>
  );
}

function DueReviewItems() {
  const query = useQuery({
    queryKey: reviewKeys.due(),
    queryFn: () => listDueReviewItems(3),
  });

  if (!query.data || query.data.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-caption font-medium text-muted-foreground">Due for review</h4>
      <ul className="flex flex-wrap gap-1.5">
        {query.data.map((item) => (
          <li key={item.id}>
            <Badge variant="outline">{item.content}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PackLoadErrors() {
  const { errors } = PACK_CATALOG;
  if (errors.length === 0) {
    return null;
  }

  return (
    <Alert variant="destructive">
      <AlertTitle>Some scenario packs could not be loaded</AlertTitle>
      <AlertDescription className="flex flex-col gap-1">
        {errors.map((error) => (
          <p key={error.file}>
            {error.file}: {error.message}
          </p>
        ))}
      </AlertDescription>
    </Alert>
  );
}

function SessionCatalog({
  defaultDifficulty,
  disabled,
  disabledHint,
  onStart,
}: {
  defaultDifficulty?: CefrLevel;
  disabled: boolean;
  disabledHint?: string;
  onStart: (
    source: SessionSource,
    options: { difficulty: CefrLevel; focus?: string; durationPresetId: DurationPresetId },
  ) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [selectedVariationId, setSelectedVariationId] = useState<string | undefined>();
  const [difficulty, setDifficulty] = useState<CefrLevel>(defaultDifficulty ?? "B1");
  const [focus, setFocus] = useState("");
  const [durationPresetId, setDurationPresetId] = useState<DurationPresetId>("standard");
  const { isFavorite, toggleFavorite, favoriteIds } = useFavoritePacks();
  const importVocabulary = useImportScenarioPackVocabulary();

  useEffect(() => {
    if (defaultDifficulty) {
      setDifficulty(defaultDifficulty);
    }
  }, [defaultDifficulty]);

  const packs = PACK_CATALOG.packs;
  const orderedPacks = useMemo<ScenarioPack[]>(() => {
    return [...packs].sort((a, b) => {
      const aFavorite = favoriteIds.includes(a.id);
      const bFavorite = favoriteIds.includes(b.id);
      if (aFavorite === bFavorite) {
        return 0;
      }
      return aFavorite ? -1 : 1;
    });
  }, [packs, favoriteIds]);

  const selectedPack = packs.find((pack) => pack.id === selectedId);

  function selectPack(id: string) {
    setSelectedId(id);
    setSelectedVariationId(undefined);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-muted-foreground">
        Pick a scenario for a short guided conversation with a clear objective and a
        closing summary.
      </p>

      <PackLoadErrors />

      <DueReviewItems />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {orderedPacks.map((pack) => (
          <li key={pack.id}>
            <div
              aria-pressed={selectedId === pack.id}
              className={cn(
                "relative flex w-full flex-col gap-1 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-colors hover:ring-foreground/20",
                selectedId === pack.id && "ring-2 ring-primary hover:ring-primary",
              )}
              onClick={() => selectPack(pack.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  selectPack(pack.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <button
                aria-label={isFavorite(pack.id) ? "Unfavorite this pack" : "Favorite this pack"}
                aria-pressed={isFavorite(pack.id)}
                className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!isFavorite(pack.id)) {
                    void importVocabulary(pack);
                  }
                  toggleFavorite(pack.id);
                }}
                type="button"
              >
                {isFavorite(pack.id) ? (
                  <IconStarFilled className="size-4 text-primary" />
                ) : (
                  <IconStar className="size-4" />
                )}
              </button>
              <span className="pr-6 text-body font-medium text-foreground">{pack.title}</span>
              <span className="text-caption text-muted-foreground">
                {pack.shortDescription}
              </span>
            </div>
          </li>
        ))}
      </ul>

      {selectedPack && (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="session-difficulty">Difficulty</FieldLabel>
                <Select
                  onValueChange={(value) => setDifficulty(value as CefrLevel)}
                  value={difficulty}
                >
                  <SelectTrigger className="w-full" id="session-difficulty">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CEFR_LEVELS.map((level) => (
                      <SelectItem key={level} value={level}>
                        {level}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <Field>
                <FieldLabel htmlFor="session-duration">Duration</FieldLabel>
                <Select
                  onValueChange={(value) => setDurationPresetId(value as DurationPresetId)}
                  value={durationPresetId}
                >
                  <SelectTrigger className="w-full" id="session-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DURATION_PRESETS.map((preset) => (
                      <SelectItem key={preset.id} value={preset.id}>
                        {preset.label} ({preset.approxMinutes})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>

            {selectedPack.variations && selectedPack.variations.length > 0 && (
              <Field>
                <FieldLabel htmlFor="session-variation">Variation (optional)</FieldLabel>
                <Select
                  onValueChange={(value) =>
                    setSelectedVariationId(!value || value === "standard" ? undefined : value)
                  }
                  value={selectedVariationId ?? "standard"}
                >
                  <SelectTrigger className="w-full" id="session-variation">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    {selectedPack.variations.map((variation) => (
                      <SelectItem key={variation.id} value={variation.id}>
                        {variation.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            <Field>
              <FieldLabel htmlFor="session-focus">Focus (optional)</FieldLabel>
              <FieldContent>
                <Input
                  id="session-focus"
                  onChange={(event) => setFocus(event.target.value)}
                  placeholder={selectedPack.focusPlaceholder}
                  type="text"
                  value={focus}
                />
              </FieldContent>
            </Field>

            <div>
              <Button
                className="w-fit"
                disabled={disabled}
                onClick={() => {
                  void importVocabulary(selectedPack);
                  onStart(toSessionSource(selectedPack, selectedVariationId), {
                    difficulty,
                    focus: focus.trim() || undefined,
                    durationPresetId,
                  });
                }}
                type="button"
              >
                Start session
              </Button>
              {disabled && disabledHint && (
                <p className="mt-2 text-caption text-muted-foreground">{disabledHint}</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function SessionSummaryView({
  run,
  onBackToCatalog,
}: {
  run: ReturnType<typeof useSessionRun>;
  onBackToCatalog: () => void;
}) {
  const summary = run.summary;

  return (
    <div className="flex flex-col gap-4">
      <h3 className="text-body-lg font-medium text-foreground">
        {run.template?.label} — session summary
      </h3>
      {summary ? (
        <Card>
          <CardContent className="flex flex-col gap-4 pt-4">
            <SummarySection heading="What went well" items={summary.whatWentWell} />
            <SummarySection heading="Priorities to work on" items={summary.priorityIssues} />
            {summary.alternativePhrases.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="text-caption font-medium text-muted-foreground">
                  Better ways to say it
                </h4>
                <ul className="flex flex-col gap-0.5 text-body text-foreground">
                  {summary.alternativePhrases.map((phrase, index) => (
                    <li key={index}>
                      {phrase.original && <>“{phrase.original}” → </>}“{phrase.suggestion}”
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <SummarySection
              heading="Review later"
              items={summary.reviewItems.map((item) => item.content)}
            />
            {summary.repairEvents.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="text-caption font-medium text-muted-foreground">
                  Repair practice
                </h4>
                <ul className="flex flex-col gap-0.5 text-body text-foreground">
                  {summary.repairEvents.map((event, index) => (
                    <li key={index}>
                      {REPAIR_PRIORITY_LABELS[event.priority]}: {event.issue}
                      {event.outcome && <> — {REPAIR_OUTCOME_LABELS[event.outcome]}</>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <p className="text-body text-muted-foreground">
          The session was saved, but a written summary isn't available this time.
        </p>
      )}
      <Button className="w-fit" onClick={onBackToCatalog} type="button" variant="outline">
        Back to catalog
      </Button>
    </div>
  );
}

export function SessionsPage({
  currentModel,
  disabled,
  disabledHint,
  modelPickerDisabled,
  models,
  onSelectModel,
  repairIntensity,
}: SessionsPageProps) {
  const [defaultDifficulty, setDefaultDifficulty] = useState<CefrLevel | undefined>();
  const run = useSessionRun({ enabled: !disabled, repairIntensity });

  useEffect(() => {
    void getLearnerProfile()
      .then((profile) => setDefaultDifficulty(profile.currentLevel))
      .catch(() => setDefaultDifficulty(undefined));
  }, []);

  const talkControlDisabled =
    disabled || run.status !== "active" || run.listeningChecks.state.status !== "idle";

  return (
    <section aria-labelledby="sessions-title" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h2 className="text-subheading font-semibold text-foreground" id="sessions-title">
        Sessions
      </h2>

      {run.status === "catalog" && (
        <SessionCatalog
          defaultDifficulty={defaultDifficulty}
          disabled={disabled}
          disabledHint={disabledHint}
          onStart={(template, options) => void run.start(template, options)}
        />
      )}

      {run.status === "starting" && (
        <ProcessingStatus label="Setting the scene" meta={`Preparing ${run.template?.label}`} />
      )}

      {(run.status === "active" || run.status === "finishing") && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant="outline">{run.template?.label}</Badge>
            {run.targetTurns !== undefined && (
              <span className="text-caption text-muted-foreground">
                Turn {run.turnCount} of ~{run.targetTurns}
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Button
                disabled={run.status !== "active" || run.turnCount === 0}
                onClick={() => void run.finish()}
                size="sm"
                type="button"
              >
                Finish session
              </Button>
              <Button
                disabled={run.status !== "active"}
                onClick={() => void run.abandon()}
                size="sm"
                type="button"
                variant="outline"
              >
                Abandon
              </Button>
            </div>
          </div>

          <ConversationStage
            exchanges={run.conversation.exchanges}
            loopState={run.conversation.loopState}
            onSkipRepair={run.conversation.skipRepair}
            onSkipReview={run.conversation.skipReview}
            showCoaching={false}
            speaking={run.conversation.speaking}
            state={run.conversation.state}
            thinking={run.conversation.thinking}
          />

          {run.listeningChecks.state.status !== "idle" && (
            <ListeningCheckCard
              onDismiss={run.listeningChecks.dismissResult}
              onSkip={run.listeningChecks.skipCheck}
              onSubmit={run.listeningChecks.submitAnswer}
              state={run.listeningChecks.state}
            />
          )}

          {run.status === "finishing" ? (
            <ProcessingStatus label="Writing your session summary…" />
          ) : (
            <ConversationControls
              currentModel={currentModel}
              disabled={talkControlDisabled}
              disabledHint={disabledHint}
              modelPickerDisabled={modelPickerDisabled}
              models={models}
              onRecordEnd={(owner) => void run.conversation.end(owner)}
              onRecordStart={(owner) => void run.conversation.begin(owner)}
              onSelectModel={onSelectModel}
              onSend={(text) => run.conversation.sendTypedMessage(text)}
              recordingState={run.conversation.state}
              speaking={run.conversation.speaking}
              thinking={run.conversation.thinking}
            />
          )}
        </div>
      )}

      {run.status === "error" && run.error && (
        <Alert variant="destructive">
          <AlertTitle>Session unavailable</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>{run.error.message}</p>
            {run.error.technicalMessage !== run.error.message && (
              <details>
                <summary className="cursor-pointer">Technical details</summary>
                <code className="block whitespace-pre-wrap">{run.error.technicalMessage}</code>
              </details>
            )}
          </AlertDescription>
          <Button className="mt-2 w-fit" onClick={() => run.reset()} size="sm" variant="outline">
            Back to catalog
          </Button>
        </Alert>
      )}

      {run.status === "complete" && (
        <SessionSummaryView run={run} onBackToCatalog={() => run.reset()} />
      )}
      </div>
    </section>
  );
}
