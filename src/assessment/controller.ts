import type {
  AssessmentCompetency,
  CefrLevel,
  CompetencyEvidenceResult,
  FollowUpIntent,
} from "../types/assessment";
import { BLUEPRINT_TASKS, BLUEPRINT_VERSION } from "./blueprint";
import type { AssessmentTask } from "./types";

/**
 * The Assessment Engine chooses what must be measured; the LLM only ever
 * chooses wording (see FOLLOW_UP_SYSTEM_INSTRUCTION in
 * src-tauri/src/commands/assessment.rs). Everything in this file is pure,
 * deterministic, and network-free — it decides which task/follow-up/stop
 * step comes next from evidence already collected, and never calls Ollama
 * or any Tauri command itself. The orchestration hook (useAssessmentSession)
 * is the only thing that turns a NextStep into an actual native call.
 */

export const RUBRIC_VERSION = "rubric-2026.1";

// Tunable thresholds — reasonable starting defaults, not derived from any
// real data yet. Keep them here, named, so they are easy to retune after
// real assessment runs without touching the decision logic itself.
export const TARGET_COVERAGE = 0.7;
export const TARGET_SAMPLES_PER_COMPETENCY = 3;
export const STRONG_EVIDENCE_CONFIDENCE = 0.6;
export const STOP_CONFIDENCE_THRESHOLD = 0.55;
export const MAX_TASK_RUNS = 10;
export const MAX_TURNS = 18;

const ALL_COMPETENCIES: AssessmentCompetency[] = [
  "fluency",
  "grammaticalRange",
  "grammaticalAccuracy",
  "lexicalResource",
  "discourseManagement",
  "interactiveCommunication",
  "pronunciation",
  "listening",
];

const CEFR_ORDER: CefrLevel[] = ["A1", "A2", "B1", "B2", "C1", "C2"];

function levelIndex(level: CefrLevel): number {
  return CEFR_ORDER.indexOf(level);
}

function levelAt(index: number): CefrLevel {
  const clamped = Math.max(0, Math.min(CEFR_ORDER.length - 1, index));
  return CEFR_ORDER[clamped];
}

function raiseLevel(level: CefrLevel): CefrLevel {
  return levelAt(levelIndex(level) + 1);
}

function lowerLevel(level: CefrLevel): CefrLevel {
  return levelAt(levelIndex(level) - 1);
}

function cefrRangeLabel(range: { min: CefrLevel; max: CefrLevel }): string {
  return range.min === range.max ? range.min : `${range.min}-${range.max}`;
}

function cefrRangeOverlapsBand(
  range: { min: CefrLevel; max: CefrLevel },
  difficulty: CefrLevel,
): boolean {
  const lower = levelIndex(range.min) - 1;
  const upper = levelIndex(range.max) + 1;
  const current = levelIndex(difficulty);
  return current >= lower && current <= upper;
}

/**
 * Only competencies at least one blueprint task can actually produce
 * evidence for are required for the stop rule. This is what keeps
 * `listening` (zero tasks assign it, per the confirmed scope stub) from
 * ever blocking the assessment from stopping — its coverage would stay 0
 * forever and it always resolves to "insufficient_evidence" in the
 * Aggregator instead.
 */
export function requiredStopCompetencies(
  tasks: AssessmentTask[],
): AssessmentCompetency[] {
  const present = new Set<AssessmentCompetency>();
  for (const task of tasks) {
    for (const competency of task.competencies) {
      present.add(competency);
    }
  }
  return ALL_COMPETENCIES.filter((competency) => present.has(competency));
}

export type CompetencyEvidenceState = {
  competency: AssessmentCompetency;
  levelCandidates: Partial<Record<CefrLevel, number>>;
  confidence: number;
  sampleCount: number;
  coverage: number;
};

export type TaskRunRecord = {
  taskId: string;
  difficulty: CefrLevel;
  followUpIntentsUsed: FollowUpIntent[];
  status: "in_progress" | "completed";
};

export type StopReason =
  | "sufficient_coverage_and_confidence"
  | "max_turns_reached"
  | "no_remaining_tasks";

export type AssessmentState = {
  blueprintVersion: string;
  rubricVersion: string;
  tasks: AssessmentTask[];
  taskRuns: TaskRunRecord[];
  evidenceByCompetency: Record<AssessmentCompetency, CompetencyEvidenceState>;
  currentDifficulty: CefrLevel;
  turnsTaken: number;
  status: "in_progress" | "stopped";
  stopReason?: StopReason;
};

export type NextStep =
  | { kind: "anchor"; task: AssessmentTask }
  | {
      kind: "follow_up";
      task: AssessmentTask;
      intent: FollowUpIntent;
      targetCefr: string;
    }
  | { kind: "stop"; reason: StopReason };

export function createInitialState(
  tasks: AssessmentTask[] = BLUEPRINT_TASKS,
  blueprintVersion: string = BLUEPRINT_VERSION,
  rubricVersion: string = RUBRIC_VERSION,
): AssessmentState {
  const evidenceByCompetency = Object.fromEntries(
    ALL_COMPETENCIES.map((competency) => [
      competency,
      {
        competency,
        levelCandidates: {},
        confidence: 0,
        sampleCount: 0,
        coverage: 0,
      },
    ]),
  ) as Record<AssessmentCompetency, CompetencyEvidenceState>;

  return {
    blueprintVersion,
    rubricVersion,
    tasks,
    taskRuns: [],
    evidenceByCompetency,
    // Never start at A1: begin around the B1/B2 boundary and adapt from
    // there, per the confirmed "probe, don't start linearly" design.
    currentDifficulty: "B2",
    turnsTaken: 0,
    status: "in_progress",
  };
}

function findTask(
  tasks: AssessmentTask[],
  taskId: string,
): AssessmentTask | undefined {
  return tasks.find((task) => task.id === taskId);
}

function currentTaskRun(state: AssessmentState): TaskRunRecord | undefined {
  const last = state.taskRuns[state.taskRuns.length - 1];
  return last?.status === "in_progress" ? last : undefined;
}

function shouldStop(state: AssessmentState): boolean {
  const required = requiredStopCompetencies(state.tasks);
  if (required.length === 0) {
    return true;
  }

  const allCovered = required.every(
    (competency) => state.evidenceByCompetency[competency].coverage >= TARGET_COVERAGE,
  );
  if (!allCovered) {
    return false;
  }

  const confidences = required.map(
    (competency) => state.evidenceByCompetency[competency].confidence,
  );
  const overallConfidence =
    confidences.reduce((sum, value) => sum + value, 0) / confidences.length;
  return overallConfidence >= STOP_CONFIDENCE_THRESHOLD;
}

/**
 * The one decision function the orchestration hook calls after every
 * evidence update. Never touches state itself — callers apply the
 * returned step via beginTaskRun/recordFollowUp/stop below.
 */
export function selectNextStep(state: AssessmentState): NextStep {
  if (state.status === "stopped") {
    return { kind: "stop", reason: state.stopReason ?? "no_remaining_tasks" };
  }

  if (state.turnsTaken >= MAX_TURNS || state.taskRuns.length >= MAX_TASK_RUNS) {
    return { kind: "stop", reason: "max_turns_reached" };
  }

  if (shouldStop(state)) {
    return { kind: "stop", reason: "sufficient_coverage_and_confidence" };
  }

  const inProgress = currentTaskRun(state);
  if (inProgress) {
    const task = findTask(state.tasks, inProgress.taskId);
    if (task) {
      const remainingIntents = task.followUpPolicy.allowedIntents.filter(
        (intent) => !inProgress.followUpIntentsUsed.includes(intent),
      );
      const belowMinimum =
        inProgress.followUpIntentsUsed.length < task.followUpPolicy.min;
      const hasBudget =
        inProgress.followUpIntentsUsed.length < task.followUpPolicy.max;
      const targetsUnderCovered = task.competencies.some(
        (competency) =>
          state.evidenceByCompetency[competency].coverage < TARGET_COVERAGE,
      );

      if (remainingIntents.length > 0 && hasBudget && (belowMinimum || targetsUnderCovered)) {
        return {
          kind: "follow_up",
          task,
          intent: remainingIntents[0],
          targetCefr: cefrRangeLabel(task.cefrRange),
        };
      }
    }
  }

  const required = requiredStopCompetencies(state.tasks);
  const underCovered = required
    .map((competency) => state.evidenceByCompetency[competency])
    .filter((evidence) => evidence.coverage < TARGET_COVERAGE)
    .sort(
      (a, b) => a.coverage - b.coverage || a.confidence - b.confidence,
    );

  const targetCompetency = underCovered[0]?.competency;
  if (!targetCompetency) {
    return { kind: "stop", reason: "sufficient_coverage_and_confidence" };
  }

  const usedTaskIds = new Set(state.taskRuns.map((run) => run.taskId));
  const inBand = state.tasks.find(
    (task) =>
      task.competencies.includes(targetCompetency) &&
      !usedTaskIds.has(task.id) &&
      cefrRangeOverlapsBand(task.cefrRange, state.currentDifficulty),
  );
  if (inBand) {
    return { kind: "anchor", task: inBand };
  }

  const anyUnused = state.tasks.find(
    (task) =>
      task.competencies.includes(targetCompetency) && !usedTaskIds.has(task.id),
  );
  if (anyUnused) {
    return { kind: "anchor", task: anyUnused };
  }

  return { kind: "stop", reason: "no_remaining_tasks" };
}

export function beginTaskRun(
  state: AssessmentState,
  task: AssessmentTask,
): AssessmentState {
  const taskRuns = currentTaskRun(state)
    ? completeCurrentTaskRun(state).taskRuns
    : state.taskRuns;
  const record: TaskRunRecord = {
    taskId: task.id,
    difficulty: state.currentDifficulty,
    followUpIntentsUsed: [],
    status: "in_progress",
  };
  return {
    ...state,
    taskRuns: [...taskRuns, record],
    turnsTaken: state.turnsTaken + 1,
  };
}

export function recordFollowUp(
  state: AssessmentState,
  intent: FollowUpIntent,
): AssessmentState {
  const lastIndex = state.taskRuns.length - 1;
  if (lastIndex < 0 || state.taskRuns[lastIndex].status !== "in_progress") {
    return state;
  }
  const taskRuns = state.taskRuns.slice();
  taskRuns[lastIndex] = {
    ...taskRuns[lastIndex],
    followUpIntentsUsed: [...taskRuns[lastIndex].followUpIntentsUsed, intent],
  };
  return { ...state, taskRuns, turnsTaken: state.turnsTaken + 1 };
}

export function completeCurrentTaskRun(state: AssessmentState): AssessmentState {
  const lastIndex = state.taskRuns.length - 1;
  if (lastIndex < 0 || state.taskRuns[lastIndex].status !== "in_progress") {
    return state;
  }
  const taskRuns = state.taskRuns.slice();
  taskRuns[lastIndex] = { ...taskRuns[lastIndex], status: "completed" };
  return { ...state, taskRuns };
}

export function stop(state: AssessmentState, reason: StopReason): AssessmentState {
  return { ...completeCurrentTaskRun(state), status: "stopped", stopReason: reason };
}

/**
 * Folds one evaluate_response result into the running per-competency
 * evidence state. sampleCount always increases for a requested competency
 * (an evaluation attempt happened, even if it came back
 * insufficientEvidence) so coverage still climbs toward the stop
 * threshold for competencies like `pronunciation` that will often have no
 * usable transcript-level signal — only the level vote is skipped for
 * those, so their final confidence stays low/zero rather than fabricated.
 */
export function applyEvidence(
  state: AssessmentState,
  results: CompetencyEvidenceResult[],
): AssessmentState {
  const evidenceByCompetency = { ...state.evidenceByCompetency };

  for (const result of results) {
    const current = evidenceByCompetency[result.competency];
    const sampleCount = current.sampleCount + 1;
    const levelCandidates = { ...current.levelCandidates };

    if (!result.insufficientEvidence && result.levelEvidence) {
      levelCandidates[result.levelEvidence] =
        (levelCandidates[result.levelEvidence] ?? 0) + result.confidence;
    }

    const weights = Object.values(levelCandidates).filter(
      (value): value is number => value !== undefined,
    );
    const totalWeight = weights.reduce((sum, value) => sum + value, 0);
    const topWeight = weights.length > 0 ? Math.max(...weights) : 0;
    const samplePenalty = sampleCount < 2 ? 0.7 : 1;
    const confidence = totalWeight > 0 ? (topWeight / totalWeight) * samplePenalty : 0;

    evidenceByCompetency[result.competency] = {
      competency: result.competency,
      levelCandidates,
      confidence,
      sampleCount,
      coverage: Math.min(1, sampleCount / TARGET_SAMPLES_PER_COMPETENCY),
    };
  }

  return { ...state, evidenceByCompetency };
}

/**
 * Adjusts currentDifficulty from one turn's evidence: strong evidence at
 * or above the current band raises it; evidence consistently below the
 * current band lowers it; ambiguous/low-confidence evidence leaves it
 * unchanged. Only evidence at or above STRONG_EVIDENCE_CONFIDENCE counts
 * — a single uncertain answer should never move the probe.
 */
export function adjustDifficulty(
  state: AssessmentState,
  results: CompetencyEvidenceResult[],
): AssessmentState {
  const scored = results.filter(
    (result) =>
      !result.insufficientEvidence &&
      result.levelEvidence &&
      result.confidence >= STRONG_EVIDENCE_CONFIDENCE,
  );
  if (scored.length === 0) {
    return state;
  }

  const currentIndex = levelIndex(state.currentDifficulty);
  const strongAtOrAbove = scored.some(
    (result) => levelIndex(result.levelEvidence as CefrLevel) >= currentIndex,
  );
  if (strongAtOrAbove) {
    return { ...state, currentDifficulty: raiseLevel(state.currentDifficulty) };
  }

  const allBelow = scored.every(
    (result) => levelIndex(result.levelEvidence as CefrLevel) < currentIndex,
  );
  if (allBelow) {
    return { ...state, currentDifficulty: lowerLevel(state.currentDifficulty) };
  }

  return state;
}
