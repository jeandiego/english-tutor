import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
  getLearnerProfile,
  saveLearnerProfilePreferences,
  toLearnerProfileError,
} from "../native/learnerProfile";
import { learnerProfileKeys } from "../queryKeys/learnerProfile";
import type { ListeningAccentFocus, VoiceGenderPreference } from "../types/listening";
import type { LearnerProfile } from "../types/learnerProfile";

export type LearnerProfileState =
  | { status: "checking" }
  | {
      status: "loaded";
      profile: LearnerProfile;
      saving: boolean;
      saveError?: string;
    }
  | { status: "error"; message: string };

type PreferencesDraft = {
  goals: string[];
  preferredScenarios: string[];
  targetAccents: string[];
  accentFocus?: ListeningAccentFocus;
  voiceGenderPref: VoiceGenderPreference;
  listeningStage: number;
};

function draftFromProfile(profile: LearnerProfile): PreferencesDraft {
  return {
    goals: profile.goals,
    preferredScenarios: profile.preferredScenarios,
    targetAccents: profile.targetAccents,
    accentFocus: profile.listening.accentFocus,
    voiceGenderPref: profile.listening.voiceGenderPref,
    listeningStage: profile.listening.stage,
  };
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length && left.every((value, index) => value === right[index])
  );
}

function draftsEqual(left: PreferencesDraft, right: PreferencesDraft): boolean {
  return (
    arraysEqual(left.goals, right.goals) &&
    arraysEqual(left.preferredScenarios, right.preferredScenarios) &&
    arraysEqual(left.targetAccents, right.targetAccents) &&
    left.accentFocus === right.accentFocus &&
    left.voiceGenderPref === right.voiceGenderPref &&
    left.listeningStage === right.listeningStage
  );
}

const EMPTY_DRAFT: PreferencesDraft = {
  goals: [],
  preferredScenarios: [],
  targetAccents: [],
  accentFocus: undefined,
  voiceGenderPref: "any",
  listeningStage: 0,
};

export function useLearnerProfile() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: learnerProfileKeys.detail(),
    queryFn: getLearnerProfile,
  });
  const [draft, setDraft] = useState<PreferencesDraft>(EMPTY_DRAFT);

  useEffect(() => {
    if (query.data) {
      setDraft(draftFromProfile(query.data));
    }
  }, [query.data]);

  const mutation = useMutation({
    mutationFn: (nextDraft: PreferencesDraft) =>
      saveLearnerProfilePreferences(nextDraft),
    onSuccess: (profile) => {
      queryClient.setQueryData(learnerProfileKeys.detail(), profile);
      setDraft(draftFromProfile(profile));
    },
  });

  const save = useCallback(() => {
    if (!query.data) {
      return;
    }
    mutation.mutate(draft);
  }, [draft, mutation, query.data]);

  const reset = useCallback(() => {
    if (query.data) {
      setDraft(draftFromProfile(query.data));
    }
  }, [query.data]);

  const dirty = query.data !== undefined && !draftsEqual(draft, draftFromProfile(query.data));

  const state: LearnerProfileState = query.isPending
    ? { status: "checking" }
    : query.isError
      ? { status: "error", message: toLearnerProfileError(query.error).message }
      : {
          status: "loaded",
          profile: query.data,
          saving: mutation.isPending,
          saveError: mutation.error
            ? toLearnerProfileError(mutation.error).message
            : undefined,
        };

  return {
    state,
    draft,
    setDraft,
    dirty,
    save,
    reset,
    refresh: query.refetch,
  };
}
