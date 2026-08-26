import { useEffect, useState } from "react";
import { useAssessmentSession } from "../hooks/useAssessmentSession";
import { listAssessments, toAssessmentError } from "../native/assessment";
import type {
  AggregatedResult,
  AssessmentCompetency,
  AssessmentSummary,
  AssessmentSummaryText,
  CefrLevel,
} from "../types/assessment";
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

const COMPETENCY_LABELS: Record<AssessmentCompetency, string> = {
  fluency: "Fluency",
  grammaticalRange: "Grammar range",
  grammaticalAccuracy: "Grammar accuracy",
  lexicalResource: "Vocabulary",
  discourseManagement: "Organizing ideas",
  interactiveCommunication: "Interaction",
  pronunciation: "Pronunciation",
  listening: "Listening",
};

function formatDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function levelLabel(level: CefrLevel | undefined): string {
  return level ?? "Not yet estimated";
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
  return <span className="local-status assessment-level-chip">{level}</span>;
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
    <div className="assessment-result">
      <div className="assessment-result__overall">
        <LevelChip level={overallLevel} />
        <span className="assessment-result__confidence">
          {confidenceLabel(result.overallConfidence)}
        </span>
      </div>

      <ul className="assessment-result__competencies">
        {result.competencyProfiles.map((profile) => (
          <li className="assessment-result__competency" key={profile.competency}>
            <span className="assessment-result__competency-label">
              {COMPETENCY_LABELS[profile.competency]}
            </span>
            <LevelChip
              level={
                profile.level === "insufficient_evidence"
                  ? "Insufficient evidence"
                  : `${profile.level}${profile.levelModifier ?? ""}`
              }
            />
            <span className="assessment-result__competency-confidence">
              {confidenceLabel(profile.confidence)}
            </span>
          </li>
        ))}
      </ul>

      {summary && (
        <div className="assessment-result__summary">
          {summary.priorities.length > 0 && (
            <div className="assessment-result__summary-section">
              <h4>Priorities</h4>
              <ul>
                {summary.priorities.map((priority, index) => (
                  <li key={index}>{priority}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.recommendedSessions.length > 0 && (
            <div className="assessment-result__summary-section">
              <h4>Recommended next sessions</h4>
              <ul>
                {summary.recommendedSessions.map((session, index) => (
                  <li key={index}>{session}</li>
                ))}
              </ul>
            </div>
          )}
          <details className="assessment-result__notes">
            <summary>Details for the tutor</summary>
            <p>{summary.notesForTutor}</p>
          </details>
        </div>
      )}
    </div>
  );
}

function PastAssessmentsList({ results }: { results: AssessmentSummary[] }) {
  if (results.length === 0) {
    return <p className="history-empty">No past assessments yet.</p>;
  }

  return (
    <ul className="history-sessions">
      {results.map((entry) => (
        <li className="history-session" key={entry.id}>
          <span className="history-session__date">{formatDate(entry.startedAt)}</span>
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
    <section className="assessment-page" aria-labelledby="assessment-title">
      <h2 id="assessment-title">Assessment</h2>

      {session.status === "idle" && (
        <div className="assessment-intro">
          <p>
            A short adaptive speaking assessment. Answer naturally — the next
            question adapts to what you say, and it usually takes about
            10–15 minutes.
          </p>
          <button
            className="assessment-start-button"
            disabled={disabled}
            onClick={() => session.start()}
            type="button"
          >
            Start assessment
          </button>
          {disabled && disabledHint && (
            <p className="assessment-disabled-hint">{disabledHint}</p>
          )}
        </div>
      )}

      {showConversation && (
        <div className="assessment-conversation">
          <div className="conversation-log">
            {session.exchanges.map((exchange) => (
              <article className="conversation-exchange" key={exchange.id}>
                <div className="conversation-turn conversation-turn--tutor">
                  <p className="conversation-turn__speaker">Tutor</p>
                  <p className="conversation-turn__text">{exchange.question}</p>
                </div>
                <div className="conversation-turn conversation-turn--user">
                  <p className="conversation-turn__speaker">You</p>
                  <p className="conversation-turn__text">{exchange.answer}</p>
                </div>
              </article>
            ))}
            {session.currentQuestion && (
              <article className="conversation-exchange">
                <div className="conversation-turn conversation-turn--tutor">
                  <p className="conversation-turn__speaker">Tutor</p>
                  <p className="conversation-turn__text">{session.currentQuestion}</p>
                </div>
              </article>
            )}
            {(session.status === "asking" || session.status === "evaluating") && (
              <div className="recording-status recording-status--processing" role="status">
                <span className="recording-status__mark" aria-hidden="true" />
                <p>{session.status === "asking" ? "Thinking" : "Evaluating your answer"}</p>
              </div>
            )}
          </div>
          <TalkControl
            disabled={talkControlDisabled}
            disabledHint={disabledHint}
            onEnd={(owner) => void session.end(owner)}
            onStart={(owner) => void session.begin(owner)}
            state={session.state}
          />
        </div>
      )}

      {session.status === "finalizing" && (
        <div className="recording-status recording-status--processing" role="status">
          <span className="recording-status__mark" aria-hidden="true" />
          <p>Evaluating your answers…</p>
        </div>
      )}

      {session.status === "error" && session.error && (
        <div className="recording-error" role="alert">
          <p className="recording-error__title">Assessment unavailable</p>
          <p>{session.error.message}</p>
          {session.error.technicalMessage !== session.error.message && (
            <details>
              <summary>Technical details</summary>
              <code>{session.error.technicalMessage}</code>
            </details>
          )}
          <button
            className="assessment-start-button"
            onClick={() => session.retake()}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {session.status === "complete" && session.result && (
        <div className="assessment-complete">
          <AssessmentResultView result={session.result} summary={session.summary} />
          <button
            className="assessment-start-button"
            onClick={() => session.retake()}
            type="button"
          >
            Retake assessment
          </button>
        </div>
      )}

      <div className="assessment-history">
        <h3>Past assessments</h3>
        {pastResults.status === "loading" && <p className="history-empty">Loading…</p>}
        {pastResults.status === "error" && (
          <p className="history-empty" role="alert">
            {pastResults.message}
          </p>
        )}
        {pastResults.status === "loaded" && (
          <PastAssessmentsList results={pastResults.results} />
        )}
      </div>
    </section>
  );
}
