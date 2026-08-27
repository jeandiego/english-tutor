import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  listCorrectionCategoryCounts,
  listRecentExpressions,
  listRecentSessions,
  toHistoryError,
} from "../native/history";
import { historyKeys } from "../queryKeys/history";
import { findSessionTemplate } from "../sessions/catalog";
import type {
  CategoryCount,
  ExpressionSummary,
  SessionSummary,
} from "../types/history";
import type { RepairOutcome, RepairPriority } from "../types/repair";

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

function scenarioLabel(session: SessionSummary): string {
  return findSessionTemplate(session.mode)?.label ?? "Free conversation";
}

function SessionSummaryDetail({ session }: { session: SessionSummary }) {
  const [expanded, setExpanded] = useState(false);
  const summary = session.summary;

  if (!summary) {
    return null;
  }

  return (
    <div className="history-session__summary">
      <button
        aria-expanded={expanded}
        className="history-session__summary-toggle"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        {expanded ? "Hide summary" : "Show summary"}
      </button>
      {expanded && (
        <div className="history-session__summary-body">
          {summary.whatWentWell.length > 0 && (
            <div className="history-session__summary-section">
              <h4>What went well</h4>
              <ul>
                {summary.whatWentWell.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.priorityIssues.length > 0 && (
            <div className="history-session__summary-section">
              <h4>Priorities</h4>
              <ul>
                {summary.priorityIssues.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.reviewItems.length > 0 && (
            <div className="history-session__summary-section">
              <h4>Review later</h4>
              <ul>
                {summary.reviewItems.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {summary.repairEvents.length > 0 && (
            <div className="history-session__summary-section">
              <h4>Repair practice</h4>
              <ul>
                {summary.repairEvents.map((event, index) => (
                  <li key={index}>
                    {REPAIR_PRIORITY_LABELS[event.priority]}: {event.issue}
                    {event.outcome && <> — {REPAIR_OUTCOME_LABELS[event.outcome]}</>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SessionList({ sessions }: { sessions: SessionSummary[] }) {
  if (sessions.length === 0) {
    return <p className="history-empty">No sessions yet.</p>;
  }

  return (
    <ul className="history-sessions">
      {sessions.map((session) => (
        <li className="history-session" key={session.id}>
          <div className="history-session__row">
            <span className="history-session__scenario">{scenarioLabel(session)}</span>
            <span className="history-session__date">
              {formatSessionDate(session.startedAt)}
            </span>
            <span className="history-session__turns">
              {session.turnCount} {session.turnCount === 1 ? "turn" : "turns"}
            </span>
            {session.status !== "active" && (
              <span
                className={`history-session__status history-session__status--${session.status}`}
              >
                {session.status}
              </span>
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
    return <p className="history-empty">No recurring patterns yet.</p>;
  }

  return (
    <ul className="history-categories">
      {categories.map((entry) => (
        <li className="history-category" key={entry.category}>
          <span className="history-category__label">
            {CATEGORY_LABELS[entry.category] ?? entry.category}
          </span>
          <span className="history-category__count">{entry.count}</span>
        </li>
      ))}
    </ul>
  );
}

function ExpressionList({ expressions }: { expressions: ExpressionSummary[] }) {
  if (expressions.length === 0) {
    return <p className="history-empty">No saved expressions yet.</p>;
  }

  return (
    <ul className="history-expressions">
      {expressions.map((expression, index) => (
        <li className="history-expression" key={index}>
          {expression.original && (
            <p className="history-expression__row">
              <span className="history-expression__row-label">Instead of</span>
              <span className="history-expression__quote">
                “{expression.original}”
              </span>
            </p>
          )}
          <p className="history-expression__row">
            <span className="history-expression__row-label">Try</span>
            <span className="history-expression__quote history-expression__quote--better">
              “{expression.suggestion}”
            </span>
          </p>
        </li>
      ))}
    </ul>
  );
}

export function HistoryPage() {
  const query = useQuery({
    queryKey: historyKeys.recent(10),
    queryFn: loadHistoryData,
  });

  return (
    <section className="history-page" aria-labelledby="history-title">
      <h2 id="history-title">Recent learning</h2>

      {query.isPending && <p className="history-empty">Loading…</p>}
      {query.isError && (
        <p className="history-empty" role="alert">
          {toHistoryError(query.error).message}
        </p>
      )}

      {query.data && (
        <div className="history-sections">
          <div className="history-section">
            <h3>Recent sessions</h3>
            <SessionList sessions={query.data.sessions} />
          </div>
          <div className="history-section">
            <h3>Recurring patterns</h3>
            <CategoryList categories={query.data.categories} />
          </div>
          <div className="history-section">
            <h3>Useful expressions</h3>
            <ExpressionList expressions={query.data.expressions} />
          </div>
        </div>
      )}
    </section>
  );
}
