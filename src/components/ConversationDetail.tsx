import { useMutation, useQuery } from "@tanstack/react-query";
import { IconArrowLeft } from "@tabler/icons-react";
import { continueSession, getSessionDetail, toHistoryError } from "../native/history";
import { historyKeys } from "../queryKeys/history";
import { conversationTitleFor } from "../sessions/conversationTitle";
import { scenarioLabelFor } from "../sessions/loadPacks";
import type {
  ConversationContinuePayload,
  SessionRepairEventDetail,
  SessionTurnDetail,
} from "../types/history";
import type { RepairOutcome, RepairPriority } from "../types/repair";
import type { ReviewItemType, ReviewOutcome } from "../types/review";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { BetterExpressions, Corrections } from "./ConversationStage";
import { SessionSummaryDetail } from "./SessionSummaryDetail";
import { cn } from "../lib/utils";

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

const REVIEW_TYPE_LABELS: Record<ReviewItemType, string> = {
  grammar_pattern: "Grammar",
  vocabulary: "Vocabulary",
  phrase: "Phrase",
  pronunciation_target: "Pronunciation",
  conversation_strategy: "Conversation",
};

const REVIEW_OUTCOME_LABELS: Record<ReviewOutcome, string> = {
  remembered: "Remembered",
  partially_remembered: "Partially remembered",
  missed: "Missed",
  skipped: "Skipped",
};

function formatDate(timestampMs: number): string {
  return new Date(timestampMs).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function RepairEvents({ events }: { events: SessionRepairEventDetail[] }) {
  if (events.length === 0) {
    return null;
  }

  return (
    <ul aria-label="Repair practice for this turn" className="flex flex-col gap-2">
      {events.map((event) => (
        <li
          className="flex flex-col gap-1.5 rounded-[var(--radius-cards)] bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
          key={event.id}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{REPAIR_PRIORITY_LABELS[event.priority]}</Badge>
            {event.outcome && (
              <Badge
                variant={
                  event.outcome === "improved"
                    ? "success"
                    : event.outcome === "failed"
                      ? "destructive"
                      : "secondary"
                }
              >
                {REPAIR_OUTCOME_LABELS[event.outcome]}
              </Badge>
            )}
          </div>
          <p className="text-body">
            <span className="text-foreground">“{event.original}”</span>
            <span aria-hidden="true" className="text-muted-foreground">
              {" "}
              →{" "}
            </span>
            <span className="font-medium text-success">“{event.suggested}”</span>
          </p>
          <p className="text-caption text-muted-foreground">{event.microExplanation}</p>
        </li>
      ))}
    </ul>
  );
}

function TurnBubble({ turn }: { turn: SessionTurnDetail }) {
  const isUser = turn.role === "user";
  const hasCoaching =
    turn.corrections.length > 0 || turn.expressions.length > 0 || turn.repairEvents.length > 0;

  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      {isUser && turn.origin === "typed" && <Badge variant="outline">Typed</Badge>}
      <div
        className={cn(
          "max-w-[85%] rounded-[var(--radius-cards)] px-3 py-2 text-body",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted text-foreground",
        )}
      >
        {turn.text}
      </div>
      {hasCoaching && (
        <div className="flex w-full max-w-[85%] flex-col gap-2">
          <Corrections corrections={turn.corrections} />
          <BetterExpressions expressions={turn.expressions} />
          <RepairEvents events={turn.repairEvents} />
        </div>
      )}
    </div>
  );
}

export function ConversationDetail({
  onBack,
  onContinue = () => {},
  sessionId,
}: {
  onBack: () => void;
  onContinue?: (payload: ConversationContinuePayload) => void;
  sessionId: number;
}) {
  const query = useQuery({
    queryKey: historyKeys.detail(sessionId),
    queryFn: () => getSessionDetail(sessionId),
  });

  const detail = query.data;
  const conversationDetailTitle = detail ? conversationTitleFor(detail) : "";
  const scenarioLabel = detail ? scenarioLabelFor(detail.mode) : "";

  const continueMutation = useMutation({
    mutationFn: () => continueSession(sessionId),
  });

  function handleContinue() {
    continueMutation.mutate(undefined, {
      onSuccess: (resume) => {
        if (!detail) {
          return;
        }
        onContinue({ resume, sourceTitle: conversationDetailTitle, sourceStartedAt: detail.startedAt });
      },
    });
  }

  return (
    <section
      aria-labelledby="conversation-detail-title"
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
        <button
          className="flex w-fit items-center gap-1.5 text-caption font-medium text-muted-foreground hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          <IconArrowLeft className="size-4" />
          Back to history
        </button>

        {query.isPending && <p className="text-body text-muted-foreground">Loading…</p>}
        {query.isError && (
          <p className="text-body text-destructive" role="alert">
            {toHistoryError(query.error).message}
          </p>
        )}
        {query.isSuccess && detail === null && (
          <p className="text-body text-muted-foreground">This conversation could not be found.</p>
        )}

        {detail && (
          <>
            <div className="flex flex-col gap-1">
              <h2
                className="text-subheading font-semibold text-foreground"
                id="conversation-detail-title"
              >
                {conversationDetailTitle}
              </h2>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                {scenarioLabel !== conversationDetailTitle && <span>{scenarioLabel}</span>}
                <span>{formatDate(detail.startedAt)}</span>
                {detail.status !== "active" && (
                  <Badge variant="outline">{detail.status}</Badge>
                )}
                <Button
                  className="ml-auto"
                  disabled={continueMutation.isPending}
                  onClick={handleContinue}
                  size="sm"
                  variant="outline"
                >
                  {continueMutation.isPending ? "Continuing…" : "Continue"}
                </Button>
              </div>
              {continueMutation.isError && (
                <p className="text-caption text-destructive" role="alert">
                  {toHistoryError(continueMutation.error).message}
                </p>
              )}
            </div>

            {detail.turns.length === 0 ? (
              <p className="text-body text-muted-foreground">
                No turns were recorded for this conversation.
              </p>
            ) : (
              <div className="flex flex-col gap-4">
                {detail.turns.map((turn) => (
                  <TurnBubble key={turn.id} turn={turn} />
                ))}
              </div>
            )}

            {detail.reviewEvents.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-body-lg font-medium text-foreground">Review practice</h3>
                <ul className="flex flex-col divide-y divide-border">
                  {detail.reviewEvents.map((event) => (
                    <li
                      className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0"
                      key={event.reviewItemId}
                    >
                      <Badge variant="outline">{REVIEW_TYPE_LABELS[event.itemType]}</Badge>
                      <span className="text-body text-foreground">{event.content}</span>
                      <span className="ml-auto text-caption text-muted-foreground">
                        {REVIEW_OUTCOME_LABELS[event.outcome]}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <SessionSummaryDetail summary={detail.summary} />
          </>
        )}
      </div>
    </section>
  );
}
