import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { startSession as defaultStartSession, toHistoryError } from "../native/history";
import { historyKeys } from "../queryKeys/history";
import type { ConversationResumeContext, SessionStart } from "../types/history";
import type { ReviewItem } from "../types/review";
import type { TutorMessage } from "../types/tutor";

type ResumeBanner = { title: string; startedAt: number };

type LiveIdentity = {
  sessionId?: number;
  learnerContext?: string;
  seedMessages?: TutorMessage[];
  dueReviewItems?: ReviewItem[];
  resumeBanner?: ResumeBanner;
};

type PendingResume = {
  resume: ConversationResumeContext;
  sourceTitle: string;
  sourceStartedAt: number;
};

type UseLiveConversationOptions = {
  startSession?: () => Promise<SessionStart>;
};

export function useLiveConversation({
  startSession = defaultStartSession,
}: UseLiveConversationOptions = {}) {
  const startedRef = useRef(false);
  const queryClient = useQueryClient();
  const [identity, setIdentity] = useState<LiveIdentity>({});
  const [pendingResume, setPendingResume] = useState<PendingResume | undefined>();

  const startMutation = useMutation({
    mutationFn: () => startSession(),
    onSuccess: (start) => {
      setIdentity((current) =>
        current.sessionId === undefined
          ? {
              sessionId: start.sessionId,
              learnerContext: start.learnerContext,
              dueReviewItems: start.dueReviewItems,
            }
          : current,
      );
      void queryClient.invalidateQueries({ queryKey: historyKeys.all });
    },
  });
  const startMutate = startMutation.mutate;

  useEffect(() => {
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;
    startMutate();
  }, [startMutate]);

  function applyResume(
    resume: ConversationResumeContext,
    sourceTitle: string,
    sourceStartedAt: number,
  ) {
    setIdentity({
      sessionId: resume.continuationSessionId,
      learnerContext: resume.learnerContext,
      seedMessages: resume.recentMessages,
      dueReviewItems: resume.dueReviewItems,
      resumeBanner: { title: sourceTitle, startedAt: sourceStartedAt },
    });
    void queryClient.invalidateQueries({ queryKey: historyKeys.all });
  }

  function requestSwitch(
    resume: ConversationResumeContext,
    sourceTitle: string,
    sourceStartedAt: number,
    hasLiveActivity: boolean,
  ): "switched" | "confirm-required" {
    const alreadyLive = resume.continuationSessionId === identity.sessionId;
    if (!alreadyLive && hasLiveActivity) {
      setPendingResume({ resume, sourceTitle, sourceStartedAt });
      return "confirm-required";
    }
    applyResume(resume, sourceTitle, sourceStartedAt);
    return "switched";
  }

  function confirmPendingSwitch() {
    if (!pendingResume) {
      return;
    }
    applyResume(pendingResume.resume, pendingResume.sourceTitle, pendingResume.sourceStartedAt);
    setPendingResume(undefined);
  }

  function cancelPendingSwitch() {
    setPendingResume(undefined);
  }

  return {
    sessionId: identity.sessionId,
    learnerContext: identity.learnerContext,
    seedMessages: identity.seedMessages,
    dueReviewItems: identity.dueReviewItems,
    resumeBanner: identity.resumeBanner,
    startError: startMutation.error ? toHistoryError(startMutation.error) : undefined,
    pendingResume,
    requestSwitch,
    confirmPendingSwitch,
    cancelPendingSwitch,
  };
}
