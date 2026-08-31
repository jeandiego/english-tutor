import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  startSession as defaultStartSession,
  toHistoryError,
} from "../native/history";
import { historyKeys } from "../queryKeys/history";
import type { SessionStart } from "../types/history";

type UseSessionHistoryOptions = {
  startSession?: () => Promise<SessionStart>;
};

export function useSessionHistory({
  startSession = defaultStartSession,
}: UseSessionHistoryOptions = {}) {
  const startedRef = useRef(false);
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => startSession(),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: historyKeys.all }),
  });
  const mutate = mutation.mutate;

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    mutate();
  }, [mutate]);

  return {
    sessionId: mutation.data?.sessionId,
    learnerContext: mutation.data?.learnerContext,
    startError: mutation.error ? toHistoryError(mutation.error) : undefined,
  };
}
