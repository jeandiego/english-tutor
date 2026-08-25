import { useEffect, useRef, useState } from "react";
import {
  startSession as defaultStartSession,
  toHistoryError,
  type HistoryError,
} from "../native/history";
import type { SessionStart } from "../types/history";

type UseSessionHistoryOptions = {
  startSession?: () => Promise<SessionStart>;
};

type SessionHistoryState = {
  sessionId?: number;
  learnerContext?: string;
  startError?: HistoryError;
};

export function useSessionHistory({
  startSession = defaultStartSession,
}: UseSessionHistoryOptions = {}) {
  const [state, setState] = useState<SessionHistoryState>({});
  const startedRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    void startSession()
      .then((session) => {
        if (!mountedRef.current) {
          return;
        }
        setState({
          sessionId: session.sessionId,
          learnerContext: session.learnerContext,
        });
      })
      .catch((error: unknown) => {
        if (!mountedRef.current) {
          return;
        }
        setState({ startError: toHistoryError(error) });
      });
  }, [startSession]);

  return state;
}
