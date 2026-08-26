import type { AssessmentCompetency, CefrLevel } from "../types/assessment";

export const COMPETENCY_LABELS: Record<AssessmentCompetency, string> = {
  fluency: "Fluency",
  grammaticalRange: "Grammar range",
  grammaticalAccuracy: "Grammar accuracy",
  lexicalResource: "Vocabulary",
  discourseManagement: "Organizing ideas",
  interactiveCommunication: "Interaction",
  pronunciation: "Pronunciation",
  listening: "Listening",
};

export function levelLabel(level: CefrLevel | undefined): string {
  return level ?? "Not yet estimated";
}
