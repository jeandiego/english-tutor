import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  listCorrectionCategoryCounts,
  listRecentExpressions,
  listRecentSessions,
  toHistoryError,
} from "../native/history";
import { historyKeys } from "../queryKeys/history";
import { scenarioLabelFor } from "../sessions/catalog";
import type {
  CategoryCount,
  ExpressionSummary,
  SessionSummary,
} from "../types/history";
import type { RepairOutcome, RepairPriority } from "../types/repair";
import { Badge } from "./ui/badge";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";
import { cn } from "../lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  naturalness: "Naturalness",
  clarity: "Clarity",
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

type HistoryData = {
  sessions: SessionSummary[];
  categories: CategoryCount[];
  expressions: ExpressionSummary[];
};

async function loadHistoryData(): Promise<HistoryData> {
  const [sessions, categories, expressions] = await Promise.all([
    listRecentSessions(10),
    listCorrectionCategoryCounts(),
    listRecentExpressions(10),
  ]);
  return { sessions, categories, expressions };
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

function SummaryList({ heading, items }: { heading: string; items: string[] }) {
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

function SessionSummaryDetail({ session }: { session: SessionSummary }) {
  const [expanded, setExpanded] = useState(false);
  const summary = session.summary;

  if (!summary) {
    return null;
  }

  return (
    <Collapsible onOpenChange={setExpanded} open={expanded}>
      <CollapsibleTrigger
        aria-expanded={expanded}
        className="text-caption font-medium text-primary hover:underline"
      >
        {expanded ? "Hide summary" : "Show summary"}
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 flex flex-col gap-3">
        <SummaryList heading="What went well" items={summary.whatWentWell} />
        <SummaryList heading="Priorities" items={summary.priorityIssues} />
        <SummaryList heading="Review later" items={summary.reviewItems} />
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
      </CollapsibleContent>
    </Collapsible>
  );
}

function SessionList({
  sessions,
  focusSessionId,
}: {
  sessions: SessionSummary[];
  focusSessionId?: number;
}) {
  if (sessions.length === 0) {
    return <p className="text-body text-muted-foreground">No sessions yet.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {sessions.map((session) => (
        <li
          className={cn(
            "flex flex-col gap-2 py-3 first:pt-0 last:pb-0",
            session.id === focusSessionId && "-mx-2 rounded-lg px-2 ring-2 ring-primary",
          )}
          id={`history-session-${session.id}`}
          key={session.id}
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-body font-medium text-foreground">
              {scenarioLabelFor(session.mode)}
            </span>
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
          <SessionSummaryDetail session={session} />
        </li>
      ))}
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

export function HistoryPage({ focusSessionId }: { focusSessionId?: number } = {}) {
  const query = useQuery({
    queryKey: historyKeys.recent(10),
    queryFn: loadHistoryData,
  });

  useEffect(() => {
    if (focusSessionId === undefined || !query.data) {
      return;
    }
    document
      .getElementById(`history-session-${focusSessionId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focusSessionId, query.data]);

  return (
    <section
      aria-labelledby="history-title"
      className="mx-auto flex w-full max-w-2xl flex-col gap-6 overflow-y-auto p-6"
    >
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
            <SessionList focusSessionId={focusSessionId} sessions={query.data.sessions} />
          </HistorySection>
          <HistorySection title="Recurring patterns">
            <CategoryList categories={query.data.categories} />
          </HistorySection>
          <HistorySection title="Useful expressions">
            <ExpressionList expressions={query.data.expressions} />
          </HistorySection>
        </div>
      )}
    </section>
  );
}
