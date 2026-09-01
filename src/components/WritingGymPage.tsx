import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useWritingGym } from "../hooks/useWritingGym";
import { listWritingTaskTypes, toWritingError } from "../native/writing";
import { writingKeys } from "../queryKeys/writing";
import { compareLevels, DIMENSION_LABELS } from "../writing/labels";
import type {
  DimensionScoreResult,
  PriorityIssueResult,
  UsefulChunkResult,
  WritingComparisonResult,
  WritingEvaluationResult,
  WritingTaskBlueprint,
} from "../types/writing";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { InputGroup, InputGroupTextarea } from "./ui/input-group";

type WritingGymPageProps = {
  disabled: boolean;
  disabledHint?: string;
};

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

function ThinkingStatus({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-2" role="status">
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-muted-foreground" />
      <p className="text-caption text-muted-foreground">{label}</p>
    </div>
  );
}

function TaskCatalog({
  blueprints,
  disabled,
  onSelect,
}: {
  blueprints: WritingTaskBlueprint[];
  disabled: boolean;
  onSelect: (blueprint: WritingTaskBlueprint) => void;
}) {
  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {blueprints.map((blueprint) => (
        <li key={blueprint.taskType}>
          <button
            className="flex w-full flex-col gap-2 rounded-xl bg-card p-4 text-left ring-1 ring-foreground/10 transition-colors hover:ring-foreground/20 disabled:pointer-events-none disabled:opacity-50"
            disabled={disabled}
            onClick={() => onSelect(blueprint)}
            type="button"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-body font-medium text-foreground">{blueprint.label}</span>
              <Badge variant="outline">{blueprint.targetLevel}</Badge>
            </div>
            <p className="text-caption text-muted-foreground">{blueprint.communicativeGoal}</p>
            <p className="text-caption text-muted-foreground">
              {blueprint.suggestedWordMin}–{blueprint.suggestedWordMax} words
            </p>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TaskBrief({ blueprint }: { blueprint: WritingTaskBlueprint }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 pt-4">
        <div className="flex items-center gap-2">
          <span className="text-body-lg font-medium text-foreground">{blueprint.label}</span>
          <Badge variant="outline">{blueprint.targetLevel}</Badge>
        </div>
        <p className="text-body text-muted-foreground">{blueprint.communicativeGoal}</p>
        <div className="flex flex-col gap-1">
          <h4 className="text-caption font-medium text-muted-foreground">Success criteria</h4>
          <ul className="flex flex-col gap-0.5 text-body text-foreground">
            {blueprint.successCriteria.map((criterion, index) => (
              <li key={index}>{criterion}</li>
            ))}
          </ul>
        </div>
        {blueprint.recommendedChunks.length > 0 && (
          <div className="flex flex-col gap-1">
            <h4 className="text-caption font-medium text-muted-foreground">Chunks to try</h4>
            <ul className="flex flex-col gap-0.5 text-body text-foreground">
              {blueprint.recommendedChunks.map((chunk, index) => (
                <li key={index}>{chunk}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function WritingComposer({
  disabled,
  initialText = "",
  maxWords,
  minWords,
  onSubmit,
  submitLabel,
}: {
  disabled: boolean;
  initialText?: string;
  maxWords: number;
  minWords: number;
  onSubmit: (text: string) => void;
  submitLabel: string;
}) {
  const [text, setText] = useState(initialText);
  const wordCount = countWords(text);

  return (
    <div className="flex flex-col gap-2">
      <InputGroup className="h-auto">
        <InputGroupTextarea
          disabled={disabled}
          onChange={(event) => setText(event.target.value)}
          placeholder="Write here…"
          rows={10}
          value={text}
        />
      </InputGroup>
      <div className="flex items-center justify-between gap-2">
        <span className="text-caption text-muted-foreground">
          {wordCount} {wordCount === 1 ? "word" : "words"} · suggested {minWords}–{maxWords}
        </span>
        <Button
          disabled={disabled || text.trim().length === 0}
          onClick={() => onSubmit(text)}
          type="button"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

function DimensionScores({ dimensions }: { dimensions: DimensionScoreResult[] }) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {dimensions.map((score) => (
        <li className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0" key={score.dimension}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-body text-foreground">{DIMENSION_LABELS[score.dimension]}</span>
            <Badge variant="secondary">{score.level}</Badge>
          </div>
          <p className="text-caption text-muted-foreground">{score.evidence}</p>
        </li>
      ))}
    </ul>
  );
}

function PriorityIssues({ issues }: { issues: PriorityIssueResult[] }) {
  return (
    <ul aria-label="Priority issues" className="flex flex-col gap-3">
      {issues.map((issue, index) => (
        <li
          className="flex flex-col gap-1.5 rounded-[var(--radius-cards)] bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
          key={index}
        >
          <Badge variant="outline">{DIMENSION_LABELS[issue.category]}</Badge>
          <p className="text-body">
            <span className="text-muted-foreground">You wrote </span>
            <span className="text-foreground">“{issue.original}”</span>
          </p>
          <p className="text-body">
            <span className="text-muted-foreground">Better </span>
            <span className="font-medium text-success">“{issue.suggested}”</span>
          </p>
          <p className="text-caption text-muted-foreground">{issue.explanation}</p>
        </li>
      ))}
    </ul>
  );
}

function UsefulChunks({ chunks }: { chunks: UsefulChunkResult[] }) {
  return (
    <ul aria-label="Useful chunks" className="flex flex-col gap-3">
      {chunks.map((chunk, index) => (
        <li
          className="flex flex-col gap-1.5 rounded-[var(--radius-cards)] bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
          key={index}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground">“{chunk.chunk}”</span>
            <Badge variant="outline">{chunk.register}</Badge>
          </div>
          <p className="text-caption text-muted-foreground">{chunk.example}</p>
        </li>
      ))}
    </ul>
  );
}

function FeedbackView({
  evaluation,
  onRewrite,
}: {
  evaluation: WritingEvaluationResult;
  onRewrite: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4 pt-4">
          <div className="flex items-center gap-2">
            <Badge variant="secondary">{evaluation.overallLevel}</Badge>
            <span className="text-caption text-muted-foreground">Overall level for this draft</span>
          </div>
          <DimensionScores dimensions={evaluation.dimensions} />
        </CardContent>
      </Card>

      <div className="flex flex-col gap-2">
        <h3 className="text-body-lg font-medium text-foreground">Priorities to fix</h3>
        <PriorityIssues issues={evaluation.priorityIssues} />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-body-lg font-medium text-foreground">Useful chunks</h3>
        <UsefulChunks chunks={evaluation.usefulChunks} />
      </div>

      <Card>
        <CardContent className="flex flex-col items-start gap-3 pt-4">
          <p className="text-body text-foreground">{evaluation.rewriteInstruction}</p>
          <Button onClick={onRewrite} type="button">
            Rewrite
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function DimensionComparison({
  draftDimensions,
  rewriteDimensions,
}: {
  draftDimensions: DimensionScoreResult[];
  rewriteDimensions: DimensionScoreResult[];
}) {
  return (
    <ul className="flex flex-col divide-y divide-border">
      {draftDimensions.map((before) => {
        const after = rewriteDimensions.find((score) => score.dimension === before.dimension);
        const outcome = compareLevels(before.level, after?.level ?? before.level);
        return (
          <li
            className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
            key={before.dimension}
          >
            <span className="text-body text-foreground">{DIMENSION_LABELS[before.dimension]}</span>
            <div className="flex items-center gap-2">
              <span className="text-caption text-muted-foreground">
                {before.level} → {after?.level ?? before.level}
              </span>
              <Badge
                variant={
                  outcome === "improved" ? "success" : outcome === "declined" ? "destructive" : "secondary"
                }
              >
                {outcome === "improved" ? "Improved" : outcome === "declined" ? "Declined" : "Same"}
              </Badge>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ComparisonView({
  comparison,
  draftText,
  onStartNewTask,
  rewriteText,
}: {
  comparison: WritingComparisonResult;
  draftText: string;
  onStartNewTask: () => void;
  rewriteText: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <h3 className="text-body-lg font-medium text-foreground">Did it improve?</h3>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-caption text-muted-foreground">Draft</span>
              <Badge variant="secondary">{comparison.draftEvaluation.overallLevel}</Badge>
            </div>
            <span aria-hidden="true" className="text-muted-foreground">
              →
            </span>
            <div className="flex items-center gap-2">
              <span className="text-caption text-muted-foreground">Rewrite</span>
              <Badge variant="secondary">{comparison.rewriteEvaluation.overallLevel}</Badge>
            </div>
          </div>
          <DimensionComparison
            draftDimensions={comparison.draftEvaluation.dimensions}
            rewriteDimensions={comparison.rewriteEvaluation.dimensions}
          />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <h4 className="text-caption font-medium text-muted-foreground">Draft</h4>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-body text-foreground">{draftText}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <h4 className="text-caption font-medium text-muted-foreground">Rewrite</h4>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-body text-foreground">{rewriteText}</p>
          </CardContent>
        </Card>
      </div>

      {comparison.learnerProfileWarning && (
        <p className="text-caption text-muted-foreground">{comparison.learnerProfileWarning}</p>
      )}

      <Button className="w-fit" onClick={onStartNewTask} type="button" variant="outline">
        Start a new task
      </Button>
    </div>
  );
}

export function WritingGymPage({ disabled, disabledHint }: WritingGymPageProps) {
  const gym = useWritingGym();
  const taskTypesQuery = useQuery({
    queryKey: writingKeys.taskTypes(),
    queryFn: listWritingTaskTypes,
    staleTime: Infinity,
  });

  return (
    <section aria-labelledby="writing-title" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <h2 className="text-subheading font-semibold text-foreground" id="writing-title">
          Writing
        </h2>

        {gym.status === "catalog" && (
          <div className="flex flex-col gap-4">
            <p className="text-body text-muted-foreground">
              Pick a task, write a short draft, get selective feedback, then rewrite and see
              what changed.
            </p>
            {taskTypesQuery.isPending && <p className="text-body text-muted-foreground">Loading…</p>}
            {taskTypesQuery.isError && (
              <p className="text-body text-destructive" role="alert">
                {toWritingError(taskTypesQuery.error).message}
              </p>
            )}
            {taskTypesQuery.data && (
              <TaskCatalog
                blueprints={taskTypesQuery.data}
                disabled={disabled}
                onSelect={(blueprint) => void gym.selectTask(blueprint)}
              />
            )}
            {disabled && disabledHint && (
              <p className="text-caption text-muted-foreground">{disabledHint}</p>
            )}
          </div>
        )}

        {(gym.status === "drafting" || gym.status === "evaluatingDraft") && gym.blueprint && (
          <div className="flex flex-col gap-4">
            <TaskBrief blueprint={gym.blueprint} />
            <WritingComposer
              disabled={disabled || gym.status === "evaluatingDraft"}
              key={gym.blueprint.taskType}
              maxWords={gym.blueprint.suggestedWordMax}
              minWords={gym.blueprint.suggestedWordMin}
              onSubmit={(text) => void gym.submitDraft(text)}
              submitLabel={gym.status === "evaluatingDraft" ? "Evaluating…" : "Submit for feedback"}
            />
            {gym.status === "evaluatingDraft" && <ThinkingStatus label="Evaluating your draft" />}
          </div>
        )}

        {gym.status === "draftFeedback" && gym.draftEvaluation && (
          <FeedbackView evaluation={gym.draftEvaluation} onRewrite={gym.startRewrite} />
        )}

        {(gym.status === "rewriting" || gym.status === "evaluatingRewrite") &&
          gym.draftText !== undefined &&
          gym.blueprint && (
            <div className="flex flex-col gap-4">
              {gym.draftEvaluation && (
                <Card>
                  <CardContent className="pt-4">
                    <p className="text-body text-foreground">{gym.draftEvaluation.rewriteInstruction}</p>
                  </CardContent>
                </Card>
              )}
              <WritingComposer
                disabled={disabled || gym.status === "evaluatingRewrite"}
                initialText={gym.draftText}
                key="rewrite"
                maxWords={gym.blueprint.suggestedWordMax}
                minWords={gym.blueprint.suggestedWordMin}
                onSubmit={(text) => void gym.submitRewrite(text)}
                submitLabel={gym.status === "evaluatingRewrite" ? "Evaluating…" : "Submit rewrite"}
              />
              {gym.status === "evaluatingRewrite" && <ThinkingStatus label="Evaluating your rewrite" />}
            </div>
          )}

        {gym.status === "comparison" && gym.comparison && gym.draftText && gym.rewriteText && (
          <ComparisonView
            comparison={gym.comparison}
            draftText={gym.draftText}
            onStartNewTask={gym.reset}
            rewriteText={gym.rewriteText}
          />
        )}

        {gym.status === "error" && gym.error && (
          <Alert variant="destructive">
            <AlertTitle>Writing Gym unavailable</AlertTitle>
            <AlertDescription className="flex flex-col gap-2">
              <p>{gym.error.message}</p>
              {gym.error.technicalMessage !== gym.error.message && (
                <details>
                  <summary className="cursor-pointer">Technical details</summary>
                  <code className="block whitespace-pre-wrap">{gym.error.technicalMessage}</code>
                </details>
              )}
            </AlertDescription>
            <Button className="mt-2 w-fit" onClick={gym.reset} size="sm" variant="outline">
              Try again
            </Button>
          </Alert>
        )}
      </div>
    </section>
  );
}
