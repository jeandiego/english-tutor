import { useCallback, useEffect, useState } from "react";
import {
  getLearnerProfile,
  saveLearnerProfilePreferences,
  toLearnerProfileError,
} from "../native/learnerProfile";
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
};

function draftFromProfile(profile: LearnerProfile): PreferencesDraft {
  return {
    goals: profile.goals,
    preferredScenarios: profile.preferredScenarios,
    targetAccents: profile.targetAccents,
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
    arraysEqual(left.targetAccents, right.targetAccents)
  );
}

const EMPTY_DRAFT: PreferencesDraft = {
  goals: [],
  preferredScenarios: [],
  targetAccents: [],
};

export function useLearnerProfile() {
  const [state, setState] = useState<LearnerProfileState>({ status: "checking" });
  const [draft, setDraft] = useState<PreferencesDraft>(EMPTY_DRAFT);

  const refresh = useCallback(async () => {
    setState({ status: "checking" });
    try {
      const profile = await getLearnerProfile();
      setDraft(draftFromProfile(profile));
      setState({ status: "loaded", profile, saving: false });
    } catch (error) {
      setState({ status: "error", message: toLearnerProfileError(error).message });
    }
  }, []);

  useEffect(() => {
    let ignore = false;

    async function load() {
      try {
        const profile = await getLearnerProfile();
        if (!ignore) {
          setDraft(draftFromProfile(profile));
          setState({ status: "loaded", profile, saving: false });
        }
      } catch (error) {
        if (!ignore) {
          setState({ status: "error", message: toLearnerProfileError(error).message });
        }
      }
    }

    void load();

    return () => {
      ignore = true;
    };
  }, []);

  const save = useCallback(async () => {
    if (state.status !== "loaded") {
      return;
    }

    const previousProfile = state.profile;
    setState({ status: "loaded", profile: previousProfile, saving: true });

    try {
      const profile = await saveLearnerProfilePreferences(draft);
      setDraft(draftFromProfile(profile));
      setState({ status: "loaded", profile, saving: false });
    } catch (error) {
      setState({
        status: "loaded",
        profile: previousProfile,
        saving: false,
        saveError: toLearnerProfileError(error).message,
      });
    }
  }, [draft, state]);

  const reset = useCallback(() => {
    if (state.status === "loaded") {
      setDraft(draftFromProfile(state.profile));
    }
  }, [state]);

  const dirty =
    state.status === "loaded" && !draftsEqual(draft, draftFromProfile(state.profile));

  return {
    state,
    draft,
    setDraft,
    dirty,
    save,
    reset,
    refresh,
  };
}
