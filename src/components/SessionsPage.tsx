import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { CefrLevel } from "../types/assessment";
import { useSessionRun } from "../hooks/useSessionRun";
import { getLearnerProfile } from "../native/learnerProfile";
import { listDueReviewItems } from "../native/review";
import { reviewKeys } from "../queryKeys/review";
import {
  DURATION_PRESETS,
  SESSION_TEMPLATES,
  type DurationPresetId,
  type SessionTemplate,
} from "../sessions/catalog";
import type { RepairIntensity, RepairOutcome, RepairPriority } from "../types/repair";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Field, FieldContent, FieldLabel } from "./ui/field";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { cn } from "../lib/utils";
import { ConversationStage } from "./ConversationStage";
import { TalkControl } from "./TalkControl";

type SessionsPageProps = {
  disabled: boolean;
  disabledHint?: string;
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
    template: SessionTemplate,
    options: { difficulty: CefrLevel; focus?: string; durationPresetId: DurationPresetId },
  ) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [difficulty, setDifficulty] = useState<CefrLevel>(defaultDifficulty ?? "B1");
  const [focus, setFocus] = useState("");
  const [durationPresetId, setDurationPresetId] = useState<DurationPresetId>("standard");

  useEffect(() => {
    if (defaultDifficulty) {
      setDifficulty(defaultDifficulty);
    }
  }, [defaultDifficulty]);

  const selectedTemplate = SESSION_TEMPLATES.find((template) => template.id === selectedId);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body text-muted-foreground">
        Pick a scenario for a short guided conversation with a clear objective and a
        closing summary.
      </p>

      <DueReviewItems />

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SESSION_TEMPLATES.map((template) => (
          <li key={template.id}>
            <button
              aria-pressed={selectedId === template.id}
              className={cn(
                "flex w-full flex-col gap-1 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-colors hover:ring-foreground/20",
                selectedId === template.id && "ring-2 ring-primary hover:ring-primary",
              )}
              onClick={() => setSelectedId(template.id)}
              type="button"
            >
              <span className="text-body font-medium text-foreground">{template.label}</span>
              <span className="text-caption text-muted-foreground">
                {template.description}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {selectedTemplate && (
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

            <Field>
              <FieldLabel htmlFor="session-focus">Focus (optional)</FieldLabel>
              <FieldContent>
                <Input
                  id="session-focus"
                  onChange={(event) => setFocus(event.target.value)}
                  placeholder={selectedTemplate.focusPlaceholder}
                  type="text"
                  value={focus}
                />
              </FieldContent>
            </Field>

            <div>
              <Button
                className="w-fit"
                disabled={disabled}
                onClick={() =>
                  onStart(selectedTemplate, {
                    difficulty,
                    focus: focus.trim() || undefined,
                    durationPresetId,
                  })
                }
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

export function SessionsPage({ disabled, disabledHint, repairIntensity }: SessionsPageProps) {
  const [defaultDifficulty, setDefaultDifficulty] = useState<CefrLevel | undefined>();
  const run = useSessionRun({ enabled: !disabled, repairIntensity });

  useEffect(() => {
    void getLearnerProfile()
      .then((profile) => setDefaultDifficulty(profile.currentLevel))
      .catch(() => setDefaultDifficulty(undefined));
  }, []);

  const talkControlDisabled = disabled || run.status !== "active";

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

          {run.status === "finishing" ? (
            <ProcessingStatus label="Writing your session summary…" />
          ) : (
            <TalkControl
              disabled={talkControlDisabled}
              disabledHint={disabledHint}
              onEnd={(owner) => void run.conversation.end(owner)}
              onStart={(owner) => void run.conversation.begin(owner)}
              speaking={run.conversation.speaking}
              state={run.conversation.state}
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
