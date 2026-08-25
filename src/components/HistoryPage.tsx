import { useEffect, useState } from "react";
import {
  listCorrectionCategoryCounts,
  listRecentExpressions,
  listRecentSessions,
  toHistoryError,
} from "../native/history";
import type {
  CategoryCount,
  ExpressionSummary,
  SessionSummary,
} from "../types/history";

const CATEGORY_LABELS: Record<string, string> = {
  grammar: "Grammar",
  vocabulary: "Vocabulary",
  naturalness: "Naturalness",
  clarity: "Clarity",
};

type HistoryData = {
  sessions: SessionSummary[];
  categories: CategoryCount[];
  expressions: ExpressionSummary[];
};

type HistoryLoadState =
  | { status: "loading" }
  | { status: "loaded"; data: HistoryData }
  | { status: "error"; message: string };

function formatSessionDate(startedAt: number): string {
  return new Date(startedAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function SessionList({ sessions }: { sessions: SessionSummary[] }) {
  if (sessions.length === 0) {
    return <p className="history-empty">No sessions yet.</p>;
  }

  return (
    <ul className="history-sessions">
      {sessions.map((session) => (
        <li className="history-session" key={session.id}>
          <span className="history-session__date">
            {formatSessionDate(session.startedAt)}
          </span>
          <span className="history-session__turns">
            {session.turnCount} {session.turnCount === 1 ? "turn" : "turns"}
          </span>
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
  const [state, setState] = useState<HistoryLoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    setState({ status: "loading" });

    void Promise.all([
      listRecentSessions(10),
      listCorrectionCategoryCounts(),
      listRecentExpressions(10),
    ])
      .then(([sessions, categories, expressions]) => {
        if (cancelled) {
          return;
        }
        setState({ status: "loaded", data: { sessions, categories, expressions } });
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setState({ status: "error", message: toHistoryError(error).message });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="history-page" aria-labelledby="history-title">
      <h2 id="history-title">Recent learning</h2>

      {state.status === "loading" && <p className="history-empty">Loading…</p>}
      {state.status === "error" && (
        <p className="history-empty" role="alert">
          {state.message}
        </p>
      )}

      {state.status === "loaded" && (
        <div className="history-sections">
          <div className="history-section">
            <h3>Recent sessions</h3>
            <SessionList sessions={state.data.sessions} />
          </div>
          <div className="history-section">
            <h3>Recurring patterns</h3>
            <CategoryList categories={state.data.categories} />
          </div>
          <div className="history-section">
            <h3>Useful expressions</h3>
            <ExpressionList expressions={state.data.expressions} />
          </div>
        </div>
      )}
    </section>
  );
}
