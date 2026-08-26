import type { AssessmentTask } from "./types";

/**
 * Bump whenever a task's cefrRange, competencies, or requiredFunctions
 * change in a way that would make an old assessment's evidence
 * incomparable to a new one. Wording-only edits to anchorPrompt do not
 * require a bump — the construct being measured is what must stay stable.
 */
export const BLUEPRINT_VERSION = "blueprint-2026.1";

/**
 * Static, versioned task definitions. Each task declares what must be
 * observed (competencies, requiredFunctions, a CEFR difficulty band) —
 * not a fixed question script. The Controller (controller.ts) picks
 * which task to run next and adapts difficulty; the LLM never sees this
 * list and never decides which task runs.
 *
 * Every task requests `pronunciation` alongside its other competencies so
 * the evaluator gets a genuine chance to comment on transcript-level
 * intelligibility signal each turn (per its prompt, it will usually return
 * insufficientEvidence there, which is expected and correct — see
 * EVALUATOR_SYSTEM_INSTRUCTION in src-tauri/src/commands/assessment.rs).
 *
 * Listening is intentionally stubbed: the type system and DB schema
 * already model it as a competency/category, but no listening-
 * comprehension task type exists yet (it needs audio playback + a
 * dedicated task shape this app doesn't have), so zero listening tasks
 * ship here, and it is excluded from REQUIRED_STOP_COMPETENCIES in
 * controller.ts so it never blocks the assessment from stopping. The
 * Aggregator always reports listening as "insufficient_evidence" until a
 * later slice adds real tasks.
 */
export const BLUEPRINT_TASKS: AssessmentTask[] = [
  {
    id: "warm_up.intro.v1",
    category: "warm_up",
    cefrRange: { min: "A2", max: "B1" },
    competencies: ["fluency", "interactiveCommunication", "pronunciation"],
    requiredFunctions: ["describe"],
    anchorPrompt:
      "Hi! Let's start easy. What's your name, and what do you do day to day?",
    followUpPolicy: { min: 0, max: 1, allowedIntents: ["clarify"] },
  },
  {
    id: "personal_narrative.recent_change.v1",
    category: "personal_narrative",
    cefrRange: { min: "B1", max: "B2" },
    competencies: [
      "fluency",
      "discourseManagement",
      "grammaticalAccuracy",
      "pronunciation",
    ],
    requiredFunctions: ["narrate", "describe"],
    anchorPrompt:
      "Tell me about something that changed recently in your work or your life. What happened?",
    followUpPolicy: {
      min: 1,
      max: 2,
      allowedIntents: ["clarify", "reformulate"],
    },
  },
  {
    id: "everyday_interaction.disagreement.v1",
    category: "everyday_interaction",
    cefrRange: { min: "B1", max: "B2" },
    competencies: [
      "interactiveCommunication",
      "discourseManagement",
      "pronunciation",
    ],
    requiredFunctions: ["negotiate", "clarify"],
    anchorPrompt:
      "Imagine a coworker disagrees with a decision you made. How would you explain your reasoning to them?",
    followUpPolicy: {
      min: 1,
      max: 2,
      allowedIntents: ["reformulate", "negotiate"],
    },
  },
  {
    id: "extended_production.technical_decision.v1",
    category: "extended_production",
    cefrRange: { min: "B2", max: "C1" },
    competencies: [
      "lexicalResource",
      "discourseManagement",
      "grammaticalRange",
      "pronunciation",
    ],
    requiredFunctions: ["explain", "justify"],
    anchorPrompt:
      "Tell me about a technical or professional decision you were involved in recently — what happened, and why did you choose that path?",
    followUpPolicy: {
      min: 1,
      max: 3,
      allowedIntents: ["counterArgument", "hypothesize", "qualifyStatement"],
    },
  },
  {
    id: "professional_interaction.tradeoff.v1",
    category: "professional_interaction",
    cefrRange: { min: "B2", max: "C1" },
    competencies: ["lexicalResource", "interactiveCommunication", "pronunciation"],
    requiredFunctions: ["compare", "justify"],
    anchorPrompt:
      "Describe a trade-off you had to weigh at work, where there was no perfect option. How did you decide?",
    followUpPolicy: {
      min: 1,
      max: 2,
      allowedIntents: ["counterArgument", "clarify"],
    },
  },
  {
    id: "opinion.remote_work.v1",
    category: "opinion",
    cefrRange: { min: "B1", max: "C1" },
    competencies: ["discourseManagement", "grammaticalRange", "pronunciation"],
    requiredFunctions: ["expressOpinion", "justify"],
    anchorPrompt:
      "What's your honest opinion on remote work compared to working in an office? Why?",
    followUpPolicy: {
      min: 1,
      max: 2,
      allowedIntents: ["counterArgument", "qualifyStatement"],
    },
  },
  {
    id: "abstract_discussion.technology_society.v1",
    category: "abstract_discussion",
    cefrRange: { min: "B2", max: "C2" },
    competencies: [
      "discourseManagement",
      "lexicalResource",
      "grammaticalRange",
      "pronunciation",
    ],
    requiredFunctions: ["hypothesize", "qualifyStatement"],
    anchorPrompt:
      "Do you think AI will make software engineers more or less skilled over time? Why?",
    followUpPolicy: {
      min: 1,
      max: 2,
      allowedIntents: ["counterArgument", "hypothesize"],
    },
  },
];
