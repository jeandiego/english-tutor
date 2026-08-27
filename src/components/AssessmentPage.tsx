import { useEffect, useState } from "react";
import { COMPETENCY_LABELS, levelLabel } from "../assessment/labels";
import { useAssessmentSession } from "../hooks/useAssessmentSession";
import { listAssessments, toAssessmentError } from "../native/assessment";
import type {
  AggregatedResult,
  AssessmentSummary,
  AssessmentSummaryText,
} from "../types/assessment";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card, CardContent, CardHeader } from "./ui/card";
import { TalkControl } from "./TalkControl";

type AssessmentPageProps = {
  disabled: boolean;
  disabledHint?: string;
  onAssessmentCompleted?: () => void;
};

type PastResultsLoadState =
  | { status: "loading" }
  | { status: "loaded"; results: AssessmentSummary[] }
  | { status: "error"; message: string };

function formatDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function confidenceLabel(confidence: number): string {
  if (confidence >= 0.75) {
    return "High confidence";
  }
  if (confidence >= 0.4) {
    return "Some evidence";
  }
  return "Limited evidence";
}

function LevelChip({ level }: { level: string }) {
  return <Badge variant="secondary">{level}</Badge>;
}

function ThinkingStatus({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-2" role="status">
      <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-muted-foreground" />
      <p className="text-caption text-muted-foreground">{label}</p>
    </div>
  );
}

function AssessmentResultView({
  result,
  summary,
}: {
  result: AggregatedResult;
  summary?: AssessmentSummaryText;
}) {
  const overallLevel =
    result.overallLevel === "insufficient_evidence"
      ? "Not yet clear"
      : `${result.overallLevel}${result.overallLevelModifier ?? ""}`;

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-4">
        <div className="flex items-center gap-2">
          <LevelChip level={overallLevel} />
          <span className="text-caption text-muted-foreground">
            {confidenceLabel(result.overallConfidence)}
          </span>
        </div>

        <ul className="flex flex-col divide-y divide-border">
          {result.competencyProfiles.map((profile) => (
            <li
              className="flex items-center justify-between gap-2 py-2 first:pt-0 last:pb-0"
              key={profile.competency}
            >
              <span className="text-body text-foreground">
                {COMPETENCY_LABELS[profile.competency]}
              </span>
              <div className="flex items-center gap-2">
                <LevelChip
                  level={
                    profile.level === "insufficient_evidence"
                      ? "Insufficient evidence"
                      : `${profile.level}${profile.levelModifier ?? ""}`
                  }
                />
                <span className="text-caption text-muted-foreground">
                  {confidenceLabel(profile.confidence)}
                </span>
              </div>
            </li>
          ))}
        </ul>

        {summary && (
          <div className="flex flex-col gap-3 border-t border-border pt-3">
            {summary.priorities.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="text-caption font-medium text-muted-foreground">Priorities</h4>
                <ul className="flex flex-col gap-0.5 text-body text-foreground">
                  {summary.priorities.map((priority, index) => (
                    <li key={index}>{priority}</li>
                  ))}
                </ul>
              </div>
            )}
            {summary.recommendedSessions.length > 0 && (
              <div className="flex flex-col gap-1">
                <h4 className="text-caption font-medium text-muted-foreground">
                  Recommended next sessions
                </h4>
                <ul className="flex flex-col gap-0.5 text-body text-foreground">
                  {summary.recommendedSessions.map((session, index) => (
                    <li key={index}>{session}</li>
                  ))}
                </ul>
              </div>
            )}
            <details className="text-caption text-muted-foreground">
              <summary className="cursor-pointer">Details for the tutor</summary>
              <p className="mt-1">{summary.notesForTutor}</p>
            </details>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PastAssessmentsList({ results }: { results: AssessmentSummary[] }) {
  if (results.length === 0) {
    return <p className="text-body text-muted-foreground">No past assessments yet.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {results.map((entry) => (
        <li
          className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
          key={entry.id}
        >
          <span className="text-caption text-muted-foreground">
            {formatDate(entry.startedAt)}
          </span>
          <LevelChip level={levelLabel(entry.estimatedLevel)} />
        </li>
      ))}
    </ul>
  );
}

export function AssessmentPage({
  disabled,
  disabledHint,
  onAssessmentCompleted,
}: AssessmentPageProps) {
  const [pastResults, setPastResults] = useState<PastResultsLoadState>({
    status: "loading",
  });
  const session = useAssessmentSession({ enabled: !disabled });

  useEffect(() => {
    let cancelled = false;

    void listAssessments(10)
      .then((results) => {
        if (!cancelled) {
          setPastResults({ status: "loaded", results });
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPastResults({ status: "error", message: toAssessmentError(error).message });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [session.status]);

  useEffect(() => {
    if (session.status === "complete") {
      onAssessmentCompleted?.();
    }
  }, [session.status, onAssessmentCompleted]);

  const showConversation =
    session.status === "asking" ||
    session.status === "awaitingAnswer" ||
    session.status === "evaluating";
  const talkControlDisabled =
    disabled || session.status !== "awaitingAnswer";

  return (
    <section
      aria-labelledby="assessment-title"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-y-auto p-6"
    >
      <h2 className="text-subheading font-semibold text-foreground" id="assessment-title">
        Assessment
      </h2>

      {session.status === "idle" && (
        <Card>
          <CardContent className="flex flex-col items-start gap-4 pt-4">
            <p className="text-body text-muted-foreground">
              A short adaptive speaking assessment. Answer naturally — the next
              question adapts to what you say, and it usually takes about
              10–15 minutes.
            </p>
            <Button disabled={disabled} onClick={() => session.start()} type="button">
              Start assessment
            </Button>
            {disabled && disabledHint && (
              <p className="text-caption text-muted-foreground">{disabledHint}</p>
            )}
          </CardContent>
        </Card>
      )}

      {showConversation && (
        <div className="flex flex-1 flex-col gap-4 overflow-hidden">
          <Card className="flex-1 overflow-y-auto">
            <CardContent className="flex flex-col gap-4 pt-4">
              {session.exchanges.map((exchange) => (
                <div className="flex flex-col gap-3" key={exchange.id}>
                  <div>
                    <p className="text-caption font-medium text-muted-foreground">Tutor</p>
                    <p className="text-body text-foreground">{exchange.question}</p>
                  </div>
                  <div>
                    <p className="text-caption font-medium text-muted-foreground">You</p>
                    <p className="text-body text-foreground">{exchange.answer}</p>
                  </div>
                </div>
              ))}
              {session.currentQuestion && (
                <div>
                  <p className="text-caption font-medium text-muted-foreground">Tutor</p>
                  <p className="text-body text-foreground">{session.currentQuestion}</p>
                </div>
              )}
              {(session.status === "asking" || session.status === "evaluating") && (
                <ThinkingStatus
                  label={session.status === "asking" ? "Thinking" : "Evaluating your answer"}
                />
              )}
            </CardContent>
          </Card>
          <TalkControl
            disabled={talkControlDisabled}
            disabledHint={disabledHint}
            onEnd={(owner) => void session.end(owner)}
            onStart={(owner) => void session.begin(owner)}
            state={session.state}
          />
        </div>
      )}

      {session.status === "finalizing" && <ThinkingStatus label="Evaluating your answers…" />}

      {session.status === "error" && session.error && (
        <Alert variant="destructive">
          <AlertTitle>Assessment unavailable</AlertTitle>
          <AlertDescription className="flex flex-col gap-2">
            <p>{session.error.message}</p>
            {session.error.technicalMessage !== session.error.message && (
              <details>
                <summary className="cursor-pointer">Technical details</summary>
                <code className="block whitespace-pre-wrap">
                  {session.error.technicalMessage}
                </code>
              </details>
            )}
          </AlertDescription>
          <Button className="mt-2 w-fit" onClick={() => session.retake()} size="sm" variant="outline">
            Try again
          </Button>
        </Alert>
      )}

      {session.status === "complete" && session.result && (
        <div className="flex flex-col gap-4">
          <AssessmentResultView result={session.result} summary={session.summary} />
          <Button className="w-fit" onClick={() => session.retake()} type="button" variant="outline">
            Retake assessment
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <h3 className="text-body-lg font-medium text-foreground">Past assessments</h3>
        </CardHeader>
        <CardContent>
          {pastResults.status === "loading" && (
            <p className="text-body text-muted-foreground">Loading…</p>
          )}
          {pastResults.status === "error" && (
            <p className="text-body text-destructive" role="alert">
              {pastResults.message}
            </p>
          )}
          {pastResults.status === "loaded" && (
            <PastAssessmentsList results={pastResults.results} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
