import type { AccentRegion, TtsProviderId, TtsProviderInfo } from "../types/tts";
import type { ListeningAccentFocus, ListeningProfile } from "../types/listening";

export type ListeningVoiceOverride = {
  provider?: TtsProviderId;
  voiceId?: string;
  rate?: number;
};

/**
 * Words-per-minute for macOS `say`, the only provider with rate support —
 * the pacing lever for every other provider is the tutor's opening-prompt
 * directive instead (see `session.rs::listening_stage_directive`).
 */
const STAGE_RATE_WPM: Record<number, number> = {
  0: 140,
  1: 160,
  2: 175,
  3: 185,
  4: 195,
};

function desiredAccentRegion(focus?: ListeningAccentFocus): AccentRegion | undefined {
  switch (focus) {
    case "american":
      return "american";
    case "british":
      return "british";
    default:
      // mixed / software_workplace / travel_everyday aren't tied to one
      // accent region, so no filter is applied for them.
      return undefined;
  }
}

/**
 * Picks a voice/rate override for the current session from the learner's
 * listening profile. Filters gracefully — an unmatched accent or gender
 * preference just falls back to the unfiltered voice list, so this keeps
 * working with as few as one installed voice.
 *
 * `varietySeed` (e.g. the session id) drives the stage-3 "regional accent
 * exposure" variety pick deterministically, so it's reproducible and
 * testable rather than random.
 */
export function selectListeningVoice(
  providers: TtsProviderInfo[],
  currentProviderId: TtsProviderId,
  profile: ListeningProfile,
  varietySeed = 0,
): ListeningVoiceOverride | undefined {
  const provider = providers.find((candidate) => candidate.id === currentProviderId);
  if (!provider || provider.voices.length === 0) {
    return undefined;
  }

  let candidates = provider.voices;

  const desiredAccent = desiredAccentRegion(profile.accentFocus);
  if (desiredAccent) {
    const accentMatches = candidates.filter((voice) => voice.accentRegion === desiredAccent);
    if (accentMatches.length > 0) {
      candidates = accentMatches;
    }
  }

  if (profile.voiceGenderPref !== "any") {
    const genderMatches = candidates.filter((voice) => voice.gender === profile.voiceGenderPref);
    if (genderMatches.length > 0) {
      candidates = genderMatches;
    }
  }

  if (profile.stage === 3) {
    const accentTagged = provider.voices.filter((voice) => voice.accentRegion !== undefined);
    const distinctAccents = [...new Set(accentTagged.map((voice) => voice.accentRegion))];
    if (distinctAccents.length >= 2 && varietySeed % 2 === 1) {
      const otherAccent = distinctAccents.find((accent) => accent !== desiredAccent);
      const otherMatches = accentTagged.filter((voice) => voice.accentRegion === otherAccent);
      if (otherMatches.length > 0) {
        candidates = otherMatches;
      }
    }
  }

  const voice = candidates[0];
  if (!voice) {
    return undefined;
  }

  return {
    provider: provider.id,
    voiceId: voice.id,
    rate: provider.supportsRate ? STAGE_RATE_WPM[profile.stage] : undefined,
  };
}
