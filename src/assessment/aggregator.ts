import type {
  AggregatedResult,
  AssessmentCompetency,
  CefrLevel,
  CompetencyProfile,
} from "../types/assessment";
import { requiredStopCompetencies } from "./controller";
import type { AssessmentState, CompetencyEvidenceState } from "./controller";

const CEFR_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

// A competency needs at least one real sample before it is reported as a
// level at all; below this it stays "insufficient_evidence" rather than a
// guess extrapolated from a single ambiguous turn.
const MIN_REPORTABLE_COVERAGE = 1 / 3;

// The runner-up candidate must carry at least this share of the total
// vote weight to earn a "+"/"-" modifier on the reported level.
const MODIFIER_THRESHOLD = 0.35;

function levelIndex(level: CefrLevel): number {
  return CEFR_ORDER.indexOf(level);
}

function topTwoCandidates(
  levelCandidates: Partial<Record<CefrLevel, number>>,
): {
  top?: CefrLevel;
  topWeight: number;
  runnerUp?: CefrLevel;
  runnerUpWeight: number;
} {
  const entries = (Object.entries(levelCandidates) as [CefrLevel, number][])
    .filter(([, weight]) => weight > 0)
    .sort((a, b) => b[1] - a[1]);
  return {
    top: entries[0]?.[0],
    topWeight: entries[0]?.[1] ?? 0,
    runnerUp: entries[1]?.[0],
    runnerUpWeight: entries[1]?.[1] ?? 0,
  };
}

function profileForCompetency(evidence: CompetencyEvidenceState): CompetencyProfile {
  if (evidence.sampleCount === 0 || evidence.coverage < MIN_REPORTABLE_COVERAGE) {
    return {
      competency: evidence.competency,
      level: "insufficient_evidence",
      confidence: 0,
    };
  }

  const { top, topWeight, runnerUp, runnerUpWeight } = topTwoCandidates(
    evidence.levelCandidates,
  );
  if (!top) {
    return {
      competency: evidence.competency,
      level: "insufficient_evidence",
      confidence: 0,
    };
  }

  const totalWeight = topWeight + runnerUpWeight;
  let levelModifier: "+" | "-" | undefined;
  if (runnerUp && totalWeight > 0 && runnerUpWeight / totalWeight >= MODIFIER_THRESHOLD) {
    levelModifier = levelIndex(runnerUp) > levelIndex(top) ? "+" : "-";
  }

  return {
    competency: evidence.competency,
    level: top,
    levelModifier,
    confidence: evidence.confidence,
  };
}

/**
 * Deterministic combination of accumulated per-turn evidence into a final
 * multidimensional CEFR profile. No LLM call: the whole point of keeping
 * this pure TypeScript is that no level here can be invented by a model —
 * every number traces back to a stored CompetencyEvidenceResult that was
 * itself persisted (see history.rs's assessment_evidence table).
 */
export function aggregateResult(state: AssessmentState): AggregatedResult {
  const required = requiredStopCompetencies(state.tasks);
  const allCompetencies = Object.keys(
    state.evidenceByCompetency,
  ) as AssessmentCompetency[];

  const competencyProfiles = allCompetencies.map((competency) =>
    profileForCompetency(state.evidenceByCompetency[competency]),
  );

  const scored = competencyProfiles.filter(
    (profile): profile is CompetencyProfile & { level: CefrLevel } =>
      profile.level !== "insufficient_evidence" &&
      required.includes(profile.competency),
  );

  if (scored.length === 0) {
    return {
      overallLevel: "insufficient_evidence",
      overallConfidence: 0,
      competencyProfiles,
    };
  }

  // CEFR levels are ordinal, not interval — combine via a confidence-
  // weighted vote over levels (a weighted mode), never an arithmetic mean
  // of enum indices.
  const votes = new Map<CefrLevel, number>();
  for (const profile of scored) {
    votes.set(
      profile.level,
      (votes.get(profile.level) ?? 0) + Math.max(profile.confidence, 0.01),
    );
  }
  const sortedVotes = [...votes.entries()].sort((a, b) => b[1] - a[1]);
  const [overallLevel] = sortedVotes[0];
  const totalVoteWeight = sortedVotes.reduce((sum, [, weight]) => sum + weight, 0);
  const runnerUp = sortedVotes[1];

  let overallLevelModifier: "+" | "-" | undefined;
  if (runnerUp && runnerUp[1] / totalVoteWeight >= MODIFIER_THRESHOLD) {
    overallLevelModifier =
      levelIndex(runnerUp[0]) > levelIndex(overallLevel) ? "+" : "-";
  }

  const overallConfidence =
    scored.reduce((sum, profile) => sum + profile.confidence, 0) / scored.length;

  return {
    overallLevel,
    overallLevelModifier,
    overallConfidence,
    competencyProfiles,
  };
}
