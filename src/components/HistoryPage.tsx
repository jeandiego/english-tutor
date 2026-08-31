import { useQuery } from "@tanstack/react-query";
import {
  listCorrectionCategoryCounts,
  listRecentExpressions,
  listRecentSessions,
  toHistoryError,
} from "../native/history";
import { listRecentReviewEvents } from "../native/review";
import { historyKeys } from "../queryKeys/history";
import { conversationTitleFor } from "../sessions/conversationTitle";
import { scenarioLabelFor } from "../sessions/loadPacks";
import type {
  CategoryCount,
  ExpressionSummary,
  SessionSummary,
} from "../types/history";
import type { ReviewEventSummary, ReviewItemType, ReviewOutcome } from "../types/review";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader } from "./ui/card";
import { ConversationDetail } from "./ConversationDetail";
import { SessionSummaryDetail } from "./SessionSummaryDetail";

const CATEGORY_LABELS: Record<string, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  naturalness: "Naturalness",
  clarity: "Clarity",
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

type HistoryData = {
  sessions: SessionSummary[];
  categories: CategoryCount[];
  expressions: ExpressionSummary[];
  reviewEvents: ReviewEventSummary[];
};

async function loadHistoryData(): Promise<HistoryData> {
  const [sessions, categories, expressions, reviewEvents] = await Promise.all([
    listRecentSessions(10),
    listCorrectionCategoryCounts(),
    listRecentExpressions(10),
    listRecentReviewEvents(10),
  ]);
  return { sessions, categories, expressions, reviewEvents };
}

function formatSessionDate(startedAt: number): string {
  return new Date(startedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function HistorySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <h3 className="text-body-lg font-medium text-foreground">{title}</h3>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">{children}</CardContent>
    </Card>
  );
}

function SessionList({
  sessions,
  onSelectSession,
}: {
  sessions: SessionSummary[];
  onSelectSession: (sessionId: number) => void;
}) {
  if (sessions.length === 0) {
    return <p className="text-body text-muted-foreground">No sessions yet.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {sessions.map((session) => {
        const title = conversationTitleFor(session);
        const scenario = scenarioLabelFor(session.mode);
        return (
          <li className="py-3 first:pt-0 last:pb-0" key={session.id}>
            <button
              className="flex w-full flex-col gap-2 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => onSelectSession(session.id)}
              type="button"
            >
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-body font-medium text-foreground">{title}</span>
                {scenario !== title && (
                  <span className="text-caption text-muted-foreground">{scenario}</span>
                )}
                <span className="text-caption text-muted-foreground">
                  {formatSessionDate(session.startedAt)}
                </span>
                <span className="text-caption text-muted-foreground">
                  {session.turnCount} {session.turnCount === 1 ? "turn" : "turns"}
                </span>
                {session.status !== "active" && (
                  <Badge variant="outline">{session.status}</Badge>
                )}
              </div>
            </button>
            <SessionSummaryDetail summary={session.summary} />
          </li>
        );
      })}
    </ul>
  );
}

function CategoryList({ categories }: { categories: CategoryCount[] }) {
  if (categories.length === 0) {
    return <p className="text-body text-muted-foreground">No recurring patterns yet.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {categories.map((entry) => (
        <li
          className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
          key={entry.category}
        >
          <span className="text-body text-foreground">
            {CATEGORY_LABELS[entry.category] ?? entry.category}
          </span>
          <span className="text-caption text-muted-foreground">{entry.count}</span>
        </li>
      ))}
    </ul>
  );
}

function ReviewEventList({ events }: { events: ReviewEventSummary[] }) {
  if (events.length === 0) {
    return <p className="text-body text-muted-foreground">No review practice yet.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {events.map((event, index) => (
        <li className="flex flex-wrap items-center gap-2 py-2 first:pt-0 last:pb-0" key={index}>
          <Badge variant="outline">{REVIEW_TYPE_LABELS[event.itemType]}</Badge>
          <span className="text-body text-foreground">{event.content}</span>
          <span className="ml-auto text-caption text-muted-foreground">
            {REVIEW_OUTCOME_LABELS[event.outcome]}
          </span>
        </li>
      ))}
    </ul>
  );
}

function ExpressionList({ expressions }: { expressions: ExpressionSummary[] }) {
  if (expressions.length === 0) {
    return <p className="text-body text-muted-foreground">No saved expressions yet.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {expressions.map((expression, index) => (
        <li className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0" key={index}>
          {expression.original && (
            <p className="text-body">
              <span className="text-muted-foreground">Instead of </span>
              <span className="text-foreground">“{expression.original}”</span>
            </p>
          )}
          <p className="text-body">
            <span className="text-muted-foreground">Try </span>
            <span className="font-medium text-success">“{expression.suggestion}”</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

export function HistoryPage({
  focusSessionId,
  onSelectSession = () => {},
}: {
  focusSessionId?: number;
  onSelectSession?: (sessionId: number | undefined) => void;
} = {}) {
  const query = useQuery({
    queryKey: historyKeys.recent(10),
    queryFn: loadHistoryData,
  });

  if (focusSessionId !== undefined) {
    return (
      <ConversationDetail
        onBack={() => onSelectSession(undefined)}
        sessionId={focusSessionId}
      />
    );
  }

  return (
    <section aria-labelledby="history-title" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-6">
      <h2 className="text-subheading font-semibold text-foreground" id="history-title">
        Recent learning
      </h2>

      {query.isPending && <p className="text-body text-muted-foreground">Loading…</p>}
      {query.isError && (
        <p className="text-body text-destructive" role="alert">
          {toHistoryError(query.error).message}
        </p>
      )}

      {query.data && (
        <div className="flex flex-col gap-6">
          <HistorySection title="Recent sessions">
            <SessionList onSelectSession={onSelectSession} sessions={query.data.sessions} />
          </HistorySection>
          <HistorySection title="Recurring patterns">
            <CategoryList categories={query.data.categories} />
          </HistorySection>
          <HistorySection title="Useful expressions">
            <ExpressionList expressions={query.data.expressions} />
          </HistorySection>
          <HistorySection title="Review practice">
            <ReviewEventList events={query.data.reviewEvents} />
          </HistorySection>
        </div>
      )}
      </div>
    </section>
  );
}
