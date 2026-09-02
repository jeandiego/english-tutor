import { useQuery } from "@tanstack/react-query";
import { getAssessmentDetail } from "../native/assessment";
import { getReadingSession } from "../native/reading";
import { getWritingTask } from "../native/writing";
import { assessmentKeys } from "../queryKeys/assessment";
import { readingKeys } from "../queryKeys/reading";
import { writingKeys } from "../queryKeys/writing";
import type { JourneyCheckpoint } from "../types/journey";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "./ui/sheet";
import { DimensionScores, PriorityIssues, UsefulChunks } from "./WritingGymPage";

const KIND_LABELS: Record<JourneyCheckpoint["kind"], string> = {
  conversation: "Conversation",
  writing: "Writing",
  reading: "Reading to writing",
  assessment: "Level check",
  chunk_attempt: "Vocabulary practice",
};

function LoadingNote() {
  return <p className="text-caption text-muted-foreground">Loading…</p>;
}

function ErrorNote({ label }: { label: string }) {
  return <p className="text-caption text-destructive">{label}</p>;
}

function WritingCheckpointBody({ writingTaskId }: { writingTaskId: number }) {
  const query = useQuery({
    queryKey: writingKeys.detail(writingTaskId),
    queryFn: () => getWritingTask(writingTaskId),
  });

  if (query.isPending) return <LoadingNote />;
  if (query.isError || !query.data) return <ErrorNote label="Could not load this writing task." />;

  const task = query.data;
  const evaluation = task.rewriteEvaluation ?? task.draftEvaluation;

  return (
    <div className="flex flex-col gap-4">
      {task.draftText && (
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium text-foreground">Draft</span>
          <p className="whitespace-pre-wrap text-body text-muted-foreground">{task.draftText}</p>
        </div>
      )}
      {task.rewriteText && (
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium text-foreground">Rewrite</span>
          <p className="whitespace-pre-wrap text-body text-muted-foreground">{task.rewriteText}</p>
        </div>
      )}
      {evaluation && (
        <>
          <DimensionScores dimensions={evaluation.dimensions} />
          {evaluation.priorityIssues.length > 0 && <PriorityIssues issues={evaluation.priorityIssues} />}
          {evaluation.usefulChunks.length > 0 && <UsefulChunks chunks={evaluation.usefulChunks} />}
        </>
      )}
    </div>
  );
}

function ReadingCheckpointBody({ attemptId }: { attemptId: number }) {
  const query = useQuery({
    queryKey: readingKeys.detail(attemptId),
    queryFn: () => getReadingSession(attemptId),
  });

  if (query.isPending) return <LoadingNote />;
  if (query.isError || !query.data) return <ErrorNote label="Could not load this reading session." />;

  const detail = query.data;
  const evaluation = detail.evaluation;

  return (
    <div className="flex flex-col gap-4">
      {evaluation && (
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Summary: {evaluation.summaryFidelity.replace(/_/g, " ")}</Badge>
          <Badge variant="outline">Response: {evaluation.responseRelevance.replace(/_/g, " ")}</Badge>
        </div>
      )}
      {detail.summaryText && (
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium text-foreground">Your summary</span>
          <p className="whitespace-pre-wrap text-body text-muted-foreground">{detail.summaryText}</p>
        </div>
      )}
      {detail.responseText && (
        <div className="flex flex-col gap-1">
          <span className="text-caption font-medium text-foreground">Your response</span>
          <p className="whitespace-pre-wrap text-body text-muted-foreground">{detail.responseText}</p>
        </div>
      )}
      {evaluation && evaluation.priorityIssues.length > 0 && (
        <ul className="flex flex-col gap-3">
          {evaluation.priorityIssues.map((issue, index) => (
            <li
              className="flex flex-col gap-1.5 rounded-[var(--radius-cards)] bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
              key={index}
            >
              <p className="text-body">
                <span className="text-muted-foreground">You wrote </span>
                <span className="text-foreground">&ldquo;{issue.original}&rdquo;</span>
              </p>
              <p className="text-body">
                <span className="text-muted-foreground">Better </span>
                <span className="font-medium text-success">&ldquo;{issue.suggested}&rdquo;</span>
              </p>
              <p className="text-caption text-muted-foreground">{issue.explanation}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AssessmentCheckpointBody({ assessmentId }: { assessmentId: number }) {
  const query = useQuery({
    queryKey: assessmentKeys.detail(assessmentId),
    queryFn: () => getAssessmentDetail(assessmentId),
  });

  if (query.isPending) return <LoadingNote />;
  if (query.isError || !query.data) return <ErrorNote label="Could not load this level check." />;

  const detail = query.data;

  return (
    <div className="flex flex-col gap-2">
      {detail.estimatedLevel && (
        <Badge className="w-fit" variant="secondary">
          {detail.estimatedLevel}
        </Badge>
      )}
      {detail.confidence !== undefined && (
        <p className="text-caption text-muted-foreground">
          Confidence: {Math.round(detail.confidence * 100)}%
        </p>
      )}
      <p className="text-caption text-muted-foreground">{detail.taskRuns.length} tasks completed</p>
    </div>
  );
}

export function JourneyCheckpointSheet({
  checkpoint,
  onOpenChange,
  onOpenConversation,
}: {
  checkpoint: JourneyCheckpoint | undefined;
  onOpenChange: (open: boolean) => void;
  onOpenConversation: (sessionId: number) => void;
}) {
  return (
    <Sheet onOpenChange={onOpenChange} open={checkpoint !== undefined}>
      <SheetContent>
        {checkpoint && (
          <>
            <SheetHeader>
              <SheetTitle>{checkpoint.headline}</SheetTitle>
              <SheetDescription>
                {KIND_LABELS[checkpoint.kind]}
                {checkpoint.detail ? ` · ${checkpoint.detail}` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-4">
              {checkpoint.needsReview && (
                <Badge className="w-fit" variant="outline">
                  Needs review
                </Badge>
              )}
              {checkpoint.kind === "conversation" && (
                <Button onClick={() => onOpenConversation(checkpoint.refId)} variant="outline">
                  View full conversation
                </Button>
              )}
              {checkpoint.kind === "writing" && <WritingCheckpointBody writingTaskId={checkpoint.refId} />}
              {checkpoint.kind === "reading" && <ReadingCheckpointBody attemptId={checkpoint.refId} />}
              {checkpoint.kind === "assessment" && <AssessmentCheckpointBody assessmentId={checkpoint.refId} />}
              {checkpoint.kind === "chunk_attempt" && (
                <p className="text-caption text-muted-foreground">Outcome: {checkpoint.detail ?? "—"}</p>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
